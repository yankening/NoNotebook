const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getNotebook: () => ipcRenderer.invoke('get-notebook'),
  saveNotebook: (data) => ipcRenderer.invoke('save-notebook', data),
  onBeforeClose: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('prepare-close', listener)
    return () => ipcRenderer.removeListener('prepare-close', listener)
  },
  finishClose: () => ipcRenderer.send('close-ready'),
  cancelClose: () => ipcRenderer.send('close-cancelled')
})
