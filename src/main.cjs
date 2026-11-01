'use strict';
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const sharp = require('sharp');

let win;
const approvedFiles = new Set();
let outputDir = null;
const FORMATS = new Set(['jpeg','png','webp','avif','tiff','gif','heif']);
const extFor = { jpeg:'.jpg', png:'.png', webp:'.webp', avif:'.avif', tiff:'.tiff', gif:'.gif', heif:'.heif' };
const MAX_PIXELS = 160_000_000;
const MAX_HEIF_PIXELS = 40_000_000;
const APP_URL = pathToFileURL(path.join(__dirname, 'index.html')).href;

function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }
function requireTrustedSender(event) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== APP_URL) {
    throw new Error('허용되지 않은 앱 요청입니다.');
  }
}
function createWindow() {
  win = new BrowserWindow({ width: 1120, height: 800, minWidth: 760, minHeight: 600, title: 'PPFC — Pro Photo Format Converter', backgroundColor: '#f6f6f2',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
  });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.webContents.on('will-attach-webview', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile(path.join(__dirname, 'index.html'));
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle('files:choose', async event => {
  requireTrustedSender(event);
  const result = await dialog.showOpenDialog(win, { properties: ['openFile','multiSelections'], title: '사진 선택', filters: [{ name: '이미지 파일', extensions: ['jpg','jpeg','png','webp','avif','tif','tiff','gif','bmp','heic','heif','jp2','j2k','jxl','ppm','pgm','pbm','svg','raw','dng'] }] });
  if (result.canceled) return [];
  const list = [];
  for (const p of result.filePaths) { try { const real = await fs.realpath(p); const st = await fs.stat(real); if (st.isFile() && st.size <= 2_000_000_000) { approvedFiles.add(real); list.push({ id: crypto.randomUUID(), path: real, name: path.basename(p), bytes: st.size }); } } catch {} }
  return list;
});
ipcMain.handle('folder:choose', async event => {
  requireTrustedSender(event);
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory','createDirectory'], title: '저장 폴더 선택' });
  if (result.canceled || !result.filePaths[0]) return null;
  outputDir = path.resolve(result.filePaths[0]); return outputDir;
});
ipcMain.handle('folder:get', event => { requireTrustedSender(event); return outputDir; });
ipcMain.handle('files:approve-drop', async (event, paths) => {
  requireTrustedSender(event);
  if (!Array.isArray(paths)) return [];
  const approved = [];
  for (const value of paths) {
    if (typeof value !== 'string' || value.length > 4096) continue;
    try {
      const p = path.resolve(value), real = await fs.realpath(p), st = await fs.stat(real);
      if (!st.isFile() || st.size > 2_000_000_000) continue;
      approvedFiles.add(p); approved.push(p);
    } catch {}
  }
  return approved;
});
ipcMain.handle('formats:get', event => { requireTrustedSender(event); return { formats: [...FORMATS], input: sharp.format, heifCodec: sharp.format.heif?.output?.file ?? false }; });
ipcMain.handle('convert:batch', async (event, payload) => {
  requireTrustedSender(event);
  if (!payload || !Array.isArray(payload.items) || !payload.items.length) throw new Error('변환 목록을 확인해 주세요.');
  if (!FORMATS.has(payload.format)) throw new Error('지원하지 않는 출력 형식입니다.');
  if (!outputDir) throw new Error('먼저 저장 폴더를 선택해 주세요.');
  const od = await fs.realpath(outputDir);
  for (const item of payload.items) {
    const p = path.resolve(String(item?.path || ''));
    const id = item?.id;
    if (!approvedFiles.has(p)) { send('convert:result', { id, ok:false, error:'파일 선택을 다시 해 주세요.' }); continue; }
    let temp;
    try {
      const stat = await fs.stat(p);
      if (!stat.isFile() || stat.size > 2_000_000_000) throw new Error('파일 크기가 너무 크거나 일반 파일이 아닙니다. (최대 2 GB)');
      const real = await fs.realpath(p);
      const isHeif = ['.heic','.heif','.hif'].includes(path.extname(real).toLowerCase());
      if (isHeif && stat.size > 200_000_000) throw new Error('HEIC/HEIF 파일은 안전을 위해 200 MB 이하만 처리합니다.');
      let source = real, sourceOptions = {}, meta, heifSource = false;
      if (isHeif) {
        const decoded = await decodeHeif(real);
        // sharp takes the pixel buffer as its first argument and raw layout in
        // the second argument. Passing { input, raw } as the first argument is
        // not a supported sharp input and prevents every HEIC conversion.
        source = Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
        sourceOptions = { raw: { width: decoded.width, height: decoded.height, channels: 4 } };
        meta = { width: decoded.width, height: decoded.height }; heifSource = true;
      } else {
        meta = await sharp(real, { limitInputPixels: MAX_PIXELS, failOn: 'error', animated: payload.format === 'gif' }).metadata();
      }
      const pixelLimit = isHeif ? MAX_HEIF_PIXELS : MAX_PIXELS;
      if (!meta.width || !meta.height || meta.width * meta.height > pixelLimit) throw new Error(`이미지 크기가 안전 한도(${isHeif ? '4천만' : '1억 6천만'} 픽셀)를 넘었습니다.`);
      let outName = path.basename(item.name || p, path.extname(item.name || p)).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim().slice(0, 160) || 'image';
      const ext = extFor[payload.format];
      let dest = path.join(od, outName + ext), suffix = 1;
      while (true) { try { await fs.access(dest); dest = path.join(od, `${outName} (${suffix++})${ext}`); } catch { break; } }
      temp = path.join(od, `.ppfc-${crypto.randomUUID()}.tmp`);
      const width = safeDimension(payload.width), height = safeDimension(payload.height);
      if (width && height && width * height > MAX_PIXELS) throw new Error('출력 크기는 최대 1억 6천만 픽셀까지 가능합니다.');
      let pipeline = sharp(source, { ...sourceOptions, limitInputPixels: MAX_PIXELS, failOn: 'error', animated: payload.format === 'gif' });
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
      await fs.link(temp, dest); // exclusive creation: never overwrite an existing file
      await fs.unlink(temp); temp = null;
      send('convert:result', { id, ok:true, output:path.basename(dest) });
    } catch (e) { if (temp) await fs.unlink(temp).catch(()=>{}); send('convert:result', { id, ok:false, error: conciseError(e) }); }
  }
  send('convert:done', {}); return true;
});
async function decodeHeif(filePath) {
  const libheif = require('libheif-js/wasm');
  const bytes = await fs.readFile(filePath);
  const images = new libheif.HeifDecoder().decode(bytes);
  if (!Array.isArray(images) || !images.length) throw new Error('HEIC/HEIF 이미지에서 사진을 찾지 못했습니다.');
  const image = images[0];
  const width = image.get_width(), height = image.get_height();
  try {
    if (!width || !height || width * height > MAX_HEIF_PIXELS) throw new Error('이미지 크기가 안전 한도(4천만 픽셀)를 넘었습니다.');
    const data = new Uint8ClampedArray(width * height * 4);
    await new Promise((resolve, reject) => image.display({ data, width, height }, result => result ? resolve() : reject(new Error('HEIC/HEIF 픽셀 디코딩에 실패했습니다.'))));
    return { data, width, height };
  } finally { for (const frame of images) if (typeof frame.free === 'function') frame.free(); }
}
function bounded(v, fallback, min, max) { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback; }
function safeDimension(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 30_000) throw new Error('가로와 세로는 1~30,000 사이의 정수여야 합니다.');
  return n;
}
function conciseError(e) { const m = String(e?.message || '변환할 수 없습니다.'); return m.includes('heif') || m.includes('HEIF') || m.includes('hevc') || m.includes('HEVC') ? '이 포맷을 처리할 코덱이 설치 빌드에 없습니다.' : m.slice(0, 240); }
