const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

// ── Storage ──────────────────────────────────────────────
const DATA_PATH = path.join(app.getPath('userData'), 'notebook.json')

function defaultNotebook() {
  return {
    version: 1,
    chapters: [
      {
        id: 'ch-' + Date.now().toString(36),
        title: '我的笔记',
        pages: [defaultPage()]
      }
    ]
  }
}

function defaultPage() {
  return {
    id: 'pg-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    content: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
}

function readNotebook() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      const nb = defaultNotebook()
      writeNotebook(nb)
      return nb
    }
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'))
  } catch (e) {
    console.error('Read error:', e)
    return defaultNotebook()
  }
}

function writeNotebook(data) {
  try {
    const dir = path.dirname(DATA_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8')
    return true
  } catch (e) {
    console.error('Write error:', e)
    return false
  }
}

// ── Window ───────────────────────────────────────────────
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

  win.setMenuBarVisibility(false)
  win.loadFile('index.html')
}

// ── IPC ──────────────────────────────────────────────────
ipcMain.handle('get-notebook', () => readNotebook())
ipcMain.handle('save-notebook', (_e, data) => writeNotebook(data))

// ── Start ────────────────────────────────────────────────
app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
