'use strict';
const path = require('node:path');
let queue = Promise.resolve();
function decodeAvif(bytes) {
  const task = queue.then(() => new Promise((resolve, reject) => {
    const { utilityProcess } = require('electron');
    const child = utilityProcess.fork(path.join(__dirname, 'avif-worker.cjs'), [], { stdio: 'ignore', serviceName: 'PPFC AVIF decoder' });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); child.kill();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('AVIF 처리 시간이 안전 한도(30초)를 넘었습니다.')), 30_000);
    child.once('error', () => finish(new Error('AVIF 디코더를 실행하지 못했습니다.')));
    child.once('exit', () => finish(new Error('AVIF 디코더가 종료되었습니다.')));
    child.once('message', result => {
      if (!result || result.ok !== true) return finish(new Error(result?.error || 'AVIF 디코딩에 실패했습니다.'));
      const { width, height, data } = result;
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 40_000_000 || !(data instanceof Uint8Array) || data.byteLength !== width * height * 4) return finish(new Error('AVIF 디코더 응답을 확인할 수 없습니다.'));
      finish(null, { width, height, data: Buffer.from(data) });
    });
    child.once('spawn', () => child.postMessage(bytes));
  }));
  queue = task.catch(() => {});
  return task;
}
module.exports = { decodeAvif };
