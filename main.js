const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { createNotebookStore } = require('./storage')

const DATA_PATH = path.join(app.getPath('userData'), 'notebook.json')
const store = createNotebookStore(DATA_PATH)
let mainWindow = null

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#fdfdfd',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow = win
  let allowClose = false
  let closing = false
  let rendererReady = false

  win.webContents.on('did-finish-load', () => { rendererReady = true })
  win.webContents.on('did-start-loading', () => { rendererReady = false; closing = false })
  win.webContents.on('render-process-gone', () => { rendererReady = false; closing = false })
  win.on('close', event => {
    if (allowClose || !rendererReady) return
    event.preventDefault()
    if (closing) return
    closing = true
    win.webContents.send('prepare-close')
  })

  const finishClose = event => {
    if (event.sender !== win.webContents || !closing) return
    allowClose = true
    win.close()
  }
  const cancelClose = event => {
    if (event.sender === win.webContents) closing = false
  }
  ipcMain.on('close-ready', finishClose)
  ipcMain.on('close-cancelled', cancelClose)
  win.on('closed', () => {
    ipcMain.removeListener('close-ready', finishClose)
    ipcMain.removeListener('close-cancelled', cancelClose)
    if (mainWindow === win) mainWindow = null
  })

  win.setMenuBarVisibility(false)
  win.loadFile(path.join(__dirname, 'index.html'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // A second launch focuses the existing window instead of creating a second writer.
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  ipcMain.handle('get-notebook', () => store.read())
  ipcMain.handle('save-notebook', async (_event, data) => {
    try {
      return await store.write(data)
    } catch (error) {
      console.error('Write error:', error)
      return false
    }
  })

  app.whenReady().then(() => {
    createWindow()
    app.on('activate', () => {
      if (!mainWindow) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
