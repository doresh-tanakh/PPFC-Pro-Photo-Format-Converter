'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('forma', Object.freeze({
  chooseFiles: () => ipcRenderer.invoke('files:choose'),
  registerDroppedFiles: async files => {
    const items = files.map(file => ({ name: file.name, bytes: file.size, path: webUtils.getPathForFile(file) })).filter(item => item.path);
    const approved = new Set(await ipcRenderer.invoke('files:approve-drop', items.map(item => item.path)));
    return items.filter(item => approved.has(item.path)).map(item => ({ ...item, id: `${Date.now()}-${Math.random()}` }));
  },
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  getFolder: () => ipcRenderer.invoke('folder:get'),
  getFormats: () => ipcRenderer.invoke('formats:get'),
  convert: options => ipcRenderer.invoke('convert:batch', options),
  onResult: callback => { const fn = (_e, value) => callback(value); ipcRenderer.on('convert:result', fn); return () => ipcRenderer.removeListener('convert:result', fn); },
  onDone: callback => { const fn = () => callback(); ipcRenderer.on('convert:done', fn); return () => ipcRenderer.removeListener('convert:done', fn); },
  onProgress: callback => { const fn = (_e, value) => callback(value); ipcRenderer.on('convert:progress', fn); return () => ipcRenderer.removeListener('convert:progress', fn); }
}));
