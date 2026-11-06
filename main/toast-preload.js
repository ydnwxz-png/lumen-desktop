const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('toastApi', {
  onToast: (fn) => ipcRenderer.on('toast', (_e, p) => fn(p)),
  mouse: (inside) => ipcRenderer.send('toast:mouse', inside),
  click: (node) => ipcRenderer.send('toast:click', node),
  empty: () => ipcRenderer.send('toast:empty'),
  size: (h) => ipcRenderer.send('toast:size', h),
});
