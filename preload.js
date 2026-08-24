const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getNotebook: () => ipcRenderer.invoke('get-notebook'),
  saveNotebook: (data) => ipcRenderer.invoke('save-notebook', data)
})
