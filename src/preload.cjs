const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workiq', {
  invoke: (action, payload) => ipcRenderer.invoke('workiq', action, payload),
  onTrace: callback => {
    const listener = (_event, trace) => callback(trace);
    ipcRenderer.on('workiq:trace', listener);
    return () => ipcRenderer.removeListener('workiq:trace', listener);
  },
});
