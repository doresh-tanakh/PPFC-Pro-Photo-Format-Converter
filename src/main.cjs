'use strict';
const { app, BrowserWindow, dialog, ipcMain, protocol, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsConstants = require('node:fs').constants;
const crypto = require('node:crypto');
const { URL } = require('node:url');
const sharp = require('sharp');
const { createBoundedHeifDecoder } = require('./heif-decoder.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'ppfc', privileges: { standard: true, secure: true } }]);

let win;
const approvedFiles = new Map();
const approvedByPath = new Map();
let outputDir = null;
let heifDecoder = null;
let heifDecodeQueue = Promise.resolve();
const FORMATS = new Set(['jpeg','png','webp','avif','tiff','gif','heif']);
const extFor = { jpeg:'.jpg', png:'.png', webp:'.webp', avif:'.avif', tiff:'.tiff', gif:'.gif', heif:'.heif' };
const MAX_PIXELS = 40_000_000;
const MAX_HEIF_PIXELS = MAX_PIXELS;
const MAX_FILE_BYTES = 200_000_000;
const MAX_ANIMATION_FRAMES = 500;
const APP_URL = 'ppfc://app/index.html';
const APP_FILES = new Map([
  ['/index.html', [path.join(__dirname, 'index.html'), 'text/html; charset=utf-8']],
  ['/renderer.js', [path.join(__dirname, 'renderer.js'), 'text/javascript; charset=utf-8']],
  ['/styles.css', [path.join(__dirname, 'styles.css'), 'text/css; charset=utf-8']],
  ['/assets/icon.svg', [path.join(__dirname, '..', 'assets', 'icon.svg'), 'image/svg+xml']],
]);
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";

// HEIC/HEIF input is decoded only by the WASM decoder below. This prevents a
// disguised file from falling back to sharp/libvips' native HEIF loader.
sharp.block({ operation: ['VipsForeignLoadHeif'] });
sharp.cache({ memory: 32, files: 0, items: 50 });
sharp.concurrency(2);

// Do not expose file:// privileges to the renderer. Only serve the four static
// resources that belong to this app, with an HTTP-style origin and CSP header.
async function registerAppProtocol() {
  protocol.handle('ppfc', async request => {
    let url;
    try { url = new URL(request.url); } catch { return new Response('Not found', { status: 404 }); }
    const resource = APP_FILES.get(url.pathname);
    if (url.host !== 'app' || request.method !== 'GET' || url.search || url.hash || !resource) {
      return new Response('Not found', { status: 404, headers: { 'X-Content-Type-Options': 'nosniff' } });
    }
    try {
      return new Response(await fs.readFile(resource[0]), { status: 200, headers: {
        'Content-Type': resource[1], 'Content-Security-Policy': CSP,
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
      } });
    } catch {
      return new Response('Not found', { status: 404, headers: { 'X-Content-Type-Options': 'nosniff' } });
    }
  });
}

function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }
function requireTrustedSender(event) {
  if (!win || event.sender !== win.webContents || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== APP_URL) {
    throw new Error('허용되지 않은 앱 요청입니다.');
  }
}
function createWindow() {
  win = new BrowserWindow({ width: 1120, height: 800, minWidth: 760, minHeight: 600, title: 'PPFC — Pro Photo Format Converter', backgroundColor: '#f6f6f2',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
  });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.on('will-attach-webview', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (url !== APP_URL) e.preventDefault(); });
  win.webContents.on('will-redirect', (e, url) => { if (url !== APP_URL) e.preventDefault(); });
  win.loadURL(APP_URL);
}
app.whenReady().then(async () => {
  await registerAppProtocol();
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle('files:choose', async event => {
  requireTrustedSender(event);
  const result = await dialog.showOpenDialog(win, { properties: ['openFile','multiSelections'], title: '사진 선택', filters: [{ name: '이미지 파일', extensions: ['jpg','jpeg','png','webp','avif','tif','tiff','gif','bmp','heic','heif','jp2','j2k','jxl','ppm','pgm','pbm','svg','raw','dng'] }] });
  if (result.canceled) return [];
  const list = [];
  for (const p of result.filePaths) { try {
    const real = await fs.realpath(p), st = await fs.stat(real);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
    const id = approveFile(real, st);
    list.push({ id, path: real, name: path.basename(real), bytes: st.size });
  } catch {} }
  return list;
});
ipcMain.handle('folder:choose', async event => {
  requireTrustedSender(event);
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory','createDirectory'], title: '저장 폴더 선택' });
  if (result.canceled || !result.filePaths[0]) return null;
  const real = await fs.realpath(result.filePaths[0]);
  if (!(await fs.stat(real)).isDirectory()) throw new Error('저장 폴더를 확인할 수 없습니다.');
  outputDir = real; return outputDir;
});
ipcMain.handle('folder:get', event => { requireTrustedSender(event); return outputDir; });
ipcMain.handle('files:approve-drop', async (event, items) => {
  requireTrustedSender(event);
  if (!Array.isArray(items)) return [];
  const approved = [];
  for (const item of items) {
    if (typeof item?.path !== 'string' || item.path.length > 4096) continue;
    try {
      const real = await fs.realpath(item.path), st = await fs.stat(real);
      if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
      const id = approveFile(real, st);
      approved.push({ id, path: real, name: path.basename(real), bytes: st.size });
    } catch {}
  }
  return approved;
});
ipcMain.handle('files:revoke', (event, ids) => {
  requireTrustedSender(event);
  if (!Array.isArray(ids)) return false;
  for (const id of ids) if (typeof id === 'string') revokeFile(id);
  return true;
});
ipcMain.handle('formats:get', event => { requireTrustedSender(event); return { formats: [...FORMATS], input: sharp.format, heifCodec: sharp.format.heif?.output?.file ?? false }; });
ipcMain.handle('convert:batch', async (event, payload) => {
  requireTrustedSender(event);
  if (!payload || !Array.isArray(payload.items) || !payload.items.length) throw new Error('변환 목록을 확인해 주세요.');
  if (!FORMATS.has(payload.format)) throw new Error('지원하지 않는 출력 형식입니다.');
  if (!outputDir) throw new Error('먼저 저장 폴더를 선택해 주세요.');
  const od = await fs.realpath(outputDir);
  if (od !== outputDir || !(await fs.stat(od)).isDirectory()) throw new Error('저장 폴더가 변경되었습니다. 다시 선택해 주세요.');
  const total = payload.items.length;
  let completed = 0;
  for (const item of payload.items) {
    const id = item?.id;
    const approved = typeof id === 'string' ? approvedFiles.get(id) : null;
    if (!approved || item.path !== approved.path) { send('convert:result', { id, ok:false, error:'파일 선택을 다시 해 주세요.' }); completed++; send('convert:progress', { completed, total, percent: Math.round(completed * 100 / total) }); continue; }
    let temp, tempDir;
    try {
      const { bytes } = await readApprovedFile(approved);
      const real = approved.path;
      const isHeif = ['.heic','.heif','.hif'].includes(path.extname(approved.path).toLowerCase());
      let source = real, sourceOptions = {}, meta, heifSource = false;
      if (isHeif) {
        const decoded = await decodeHeif(bytes);
        source = Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
        sourceOptions = { raw: { width: decoded.width, height: decoded.height, channels: 4 } };
        meta = { width: decoded.width, height: decoded.height }; heifSource = true;
      } else {
        meta = await sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'error', animated: true }).metadata();
      }
      const pages = Number(meta.pages ?? 1);
      const frameHeight = Number(meta.pageHeight) || (pages > 1 ? Math.floor(meta.height / pages) : meta.height);
      if (!Number.isSafeInteger(meta.width) || !Number.isSafeInteger(frameHeight) || !Number.isSafeInteger(pages) || meta.width < 1 || frameHeight < 1 || pages < 1 || pages > MAX_ANIMATION_FRAMES || meta.width * frameHeight * pages > MAX_PIXELS) {
        throw new Error(`이미지 크기 또는 프레임 수가 안전 한도(${MAX_PIXELS.toLocaleString('ko-KR')} 픽셀, ${MAX_ANIMATION_FRAMES}프레임)를 넘었습니다.`);
      }
      let outName = path.basename(approved.path, path.extname(approved.path)).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim().slice(0, 160) || 'image';
      const ext = extFor[payload.format];
      tempDir = await fs.mkdtemp(path.join(od, '.ppfc-'));
      temp = path.join(tempDir, `output${ext}`);
      const width = safeDimension(payload.width), height = safeDimension(payload.height);
      if (width && height && width * height > MAX_PIXELS) throw new Error(`출력 크기는 최대 ${MAX_PIXELS.toLocaleString('ko-KR')} 픽셀까지 가능합니다.`);
      let pipeline = sharp(source === real ? bytes : source, { ...sourceOptions, limitInputPixels: MAX_PIXELS, failOn: 'error', animated: payload.format === 'gif' });
      if (!heifSource) pipeline = pipeline.rotate();
      if (width || height) pipeline = pipeline.resize({ width: width || undefined, height: height || undefined, fit: 'inside', withoutEnlargement: true });
      if (payload.format === 'jpeg') pipeline = pipeline.flatten({ background: payload.background || '#ffffff' }).jpeg({ quality: bounded(payload.quality, 90, 1, 100), mozjpeg: true });
      else if (payload.format === 'png') pipeline = pipeline.png({ compressionLevel: 8 });
      else if (payload.format === 'webp') pipeline = pipeline.webp({ quality: bounded(payload.quality, 90, 1, 100) });
      else if (payload.format === 'avif') pipeline = pipeline.avif({ quality: bounded(payload.quality, 70, 1, 100) });
      else if (payload.format === 'tiff') pipeline = pipeline.tiff({ quality: bounded(payload.quality, 90, 1, 100) });
      else if (payload.format === 'gif') pipeline = pipeline.gif();
      else if (payload.format === 'heif') pipeline = pipeline.heif({ compression: 'hevc', quality: bounded(payload.quality, 90, 1, 100) });
      await pipeline.toFile(temp);
      let dest, suffix = 0;
      while (true) {
        dest = path.join(od, suffix ? `${outName} (${suffix})${ext}` : `${outName}${ext}`);
        try { await fs.link(temp, dest); break; }
        catch (error) { if (error.code !== 'EEXIST') throw error; suffix++; }
      }
      await fs.rm(tempDir, { recursive: true, force: true }); temp = null; tempDir = null;
      send('convert:result', { id, ok:true, output:path.basename(dest) });
    } catch (e) { if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(()=>{}); send('convert:result', { id, ok:false, error: conciseError(e) }); }
    completed++;
    send('convert:progress', { completed, total, percent: Math.round(completed * 100 / total) });
  }
  send('convert:done', {}); return true;
});
function decodeHeif(bytes) {
  // Multiple batch requests can overlap across awaits. Serialize access to
  // the shared WASM context until pixel decoding and handle cleanup finish.
  const queued = heifDecodeQueue.then(() => decodeHeifNow(bytes));
  heifDecodeQueue = queued.catch(() => {});
  return queued;
}
async function decodeHeifNow(bytes) {
  // The self-contained WebAssembly decoder avoids sharp's native HEIF parser.
  // Reuse one HEIF context and reject excessive image counts before creating
  // per-image handles, keeping the untrusted container parser resource-bounded.
  if (!heifDecoder) {
    const libheif = require('libheif-js/wasm-bundle');
    heifDecoder = createBoundedHeifDecoder(libheif, MAX_ANIMATION_FRAMES);
  }
  const images = heifDecoder.decode(bytes);
  if (!Array.isArray(images) || !images.length) throw new Error('HEIC/HEIF 이미지에서 사진을 찾지 못했습니다.');
  try {
    if (images.length > MAX_ANIMATION_FRAMES) throw new Error(`HEIC/HEIF 이미지가 안전 한도(${MAX_ANIMATION_FRAMES}프레임)를 넘었습니다.`);
    const image = images[0];
    const width = image.get_width(), height = image.get_height();
    if (!width || !height || width * height > MAX_HEIF_PIXELS) throw new Error('이미지 크기가 안전 한도(4천만 픽셀)를 넘었습니다.');
    const data = new Uint8ClampedArray(width * height * 4);
    await new Promise((resolve, reject) => image.display({ data, width, height }, result => result ? resolve() : reject(new Error('HEIC/HEIF 픽셀 디코딩에 실패했습니다.'))));
    return { data, width, height };
  } finally { for (const frame of images) if (typeof frame.free === 'function') frame.free(); }
}
function approveFile(filePath, stat) {
  const existingId = approvedByPath.get(filePath);
  const existing = existingId && approvedFiles.get(existingId);
  if (existing && existing.size === stat.size && existing.dev === String(stat.dev) && existing.ino === String(stat.ino) && existing.mtimeMs === stat.mtimeMs && existing.ctimeMs === stat.ctimeMs) return existingId;
  if (existingId) revokeFile(existingId);
  const id = crypto.randomUUID();
  approvedFiles.set(id, { path: filePath, size: stat.size, dev: String(stat.dev), ino: String(stat.ino), mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
  approvedByPath.set(filePath, id);
  return id;
}
function revokeFile(id) {
  const approved = approvedFiles.get(id);
  if (!approved) return;
  if (approvedByPath.get(approved.path) === id) approvedByPath.delete(approved.path);
  approvedFiles.delete(id);
}
async function readApprovedFile(approved) {
  const currentPath = await fs.realpath(approved.path);
  if (currentPath !== approved.path) throw new Error('선택한 파일의 경로가 변경되었습니다. 다시 선택해 주세요.');
  const handle = await fs.open(currentPath, fsConstants.O_RDONLY);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_FILE_BYTES || before.size !== approved.size || String(before.dev) !== approved.dev || String(before.ino) !== approved.ino || before.mtimeMs !== approved.mtimeMs || before.ctimeMs !== approved.ctimeMs) {
      throw new Error('선택한 파일이 변경되었거나 안전 한도(200 MB)를 넘었습니다. 다시 선택해 주세요.');
    }
    // Read into a fixed-size buffer derived from the approved size. A file that
    // grows after fstat cannot make readFile allocate unbounded memory.
    const buffer = Buffer.allocUnsafe(approved.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== approved.size) throw new Error('변환 중 원본 파일 크기가 변경되었습니다.');
    const bytes = buffer.subarray(0, offset);
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error('변환 중 원본 파일이 변경되었습니다.');
    return { bytes, stat: after };
  } finally { await handle.close(); }
}
function bounded(v, fallback, min, max) { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback; }
function safeDimension(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 30_000) throw new Error('가로와 세로는 1~30,000 사이의 정수여야 합니다.');
  return n;
}
function conciseError(e) { const m = String(e?.message || '변환할 수 없습니다.'); return m.includes('heif') || m.includes('HEIF') || m.includes('hevc') || m.includes('HEVC') ? '이 포맷을 처리할 코덱이 설치 빌드에 없습니다.' : m.slice(0, 240); }
