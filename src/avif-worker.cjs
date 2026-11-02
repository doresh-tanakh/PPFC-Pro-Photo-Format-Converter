'use strict';
const sharp = require('sharp');
const MAX_PIXELS = 40_000_000;

async function decodeAvif(input) {
  if (!(input instanceof Uint8Array) || input.byteLength > 200_000_000) throw new Error('AVIF 파일 크기를 확인해 주세요.');
  const bytes = Buffer.from(input);
  const options = { limitInputPixels: MAX_PIXELS, failOn: 'error' };
  const meta = await sharp(bytes, options).metadata();
  if (meta.format !== 'heif' || meta.compression !== 'av1') throw new Error('올바른 AVIF 이미지가 아닙니다.');
  if ((meta.pages || 1) !== 1) throw new Error('움직이는 AVIF 입력은 지원하지 않습니다.');
  if (!Number.isSafeInteger(meta.width) || !Number.isSafeInteger(meta.height) || meta.width < 1 || meta.height < 1 || meta.width * meta.height > MAX_PIXELS) throw new Error('AVIF 크기가 안전 한도를 넘었습니다.');
  const { data, info } = await sharp(bytes, options).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

if (process.parentPort) process.parentPort.once('message', async event => {
  try { process.parentPort.postMessage({ ok: true, ...await decodeAvif(event.data) }); }
  catch (error) { process.parentPort.postMessage({ ok: false, error: String(error.message).slice(0, 240) }); }
});
module.exports = { decodeAvif };
