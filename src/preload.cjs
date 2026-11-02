'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('forma', Object.freeze({
  chooseFiles: () => ipcRenderer.invoke('files:choose'),
  revokeFiles: ids => ipcRenderer.invoke('files:revoke', ids),
  registerDroppedFiles: async files => {
    const items = files.map(file => ({ path: webUtils.getPathForFile(file) })).filter(item => item.path);
    return ipcRenderer.invoke('files:approve-drop', items);
  },
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  getFolder: () => ipcRenderer.invoke('folder:get'),
  getFormats: () => ipcRenderer.invoke('formats:get'),
  convert: options => ipcRenderer.invoke('convert:batch', options),
  onResult: callback => { const fn = (_e, value) => callback(value); ipcRenderer.on('convert:result', fn); return () => ipcRenderer.removeListener('convert:result', fn); },
  onDone: callback => { const fn = () => callback(); ipcRenderer.on('convert:done', fn); return () => ipcRenderer.removeListener('convert:done', fn); },
  onProgress: callback => { const fn = (_e, value) => callback(value); ipcRenderer.on('convert:progress', fn); return () => ipcRenderer.removeListener('convert:progress', fn); }
}));
