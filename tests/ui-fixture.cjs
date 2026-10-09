const { app, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { once } = require('node:events')
const { createNotebookStore } = require('../storage')

// This fixture sets userData before the real entry point is loaded.
const testDir = process.argv[2]
if (!testDir || !path.isAbsolute(testDir)) throw new Error('An absolute test directory is required')
app.setPath('userData', testDir)
app.disableHardwareAcceleration()
const file = path.join(testDir, 'notebook.json')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let finished = false
let checks = 0

app.on('before-quit', event => { if (!finished) event.preventDefault() })
app.once('browser-window-created', (_event, win) => {
  win.hide()
  win.webContents.setBackgroundThrottling(false)
  win.webContents.once('did-finish-load', () => run(win).catch(error => {
    console.error(error.stack)
    finished = true
    app.exit(1)
  }))
})
require('../main')

async function run(win) {
  const wc = win.webContents
  const evaluate = (fn, argument) => wc.executeJavaScript(`(${fn.toString()})(${JSON.stringify(argument) ?? ''})`, true)
  async function waitFor(fn) {
    const start = Date.now()
    while (!await evaluate(fn)) {
      if (Date.now() - start > 5000) throw new Error('Timed out waiting for ' + fn.toString())
      await pause(20)
    }
  }
  const click = selector => evaluate(s => document.querySelector(s).click(), selector)
  const key = (name, extra = {}) => evaluate(({ name, extra }) => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra })
    document.activeElement.dispatchEvent(event)
    return event.defaultPrevented
  }, { name, extra })
  const wheel = (x, y = 0, ctrl = false, options = {}) => evaluate(({ x, y, ctrl, options }) => {
    const viewport = document.querySelector('#paper-viewport')
    const rect = viewport.getBoundingClientRect()
    const target = options.editor ? document.querySelector('.paper-sheet[aria-current="page"] textarea') : viewport
    const event = new WheelEvent('wheel', {
      deltaX: x, deltaY: y, ctrlKey: ctrl, bubbles: true, cancelable: true,
      clientX: rect.left + (options.x ?? rect.width / 2),
      clientY: rect.top + (options.y ?? rect.height / 2), deltaMode: options.mode || 0
    })
    target.dispatchEvent(event)
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }, { x, y, ctrl, options })
  const frame = () => evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const mapPosition = async () => {
    await frame()
    return evaluate(() => {
      const matrix = new DOMMatrix(getComputedStyle(document.querySelector('#canvas-world')).transform)
      const viewport = document.querySelector('#paper-viewport')
      const rect = viewport.getBoundingClientRect()
      return { x: matrix.m41, y: matrix.m42, scale: matrix.a, width: rect.width, height: rect.height }
    })
  }
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.01, `${actual} differs from ${expected}`)
  const activeIndex = () => evaluate(() => Number(document.querySelector('.paper-sheet[aria-current="page"]').dataset.idx))
  const contextMenu = () => evaluate(() => {
    document.querySelector('.paper-sheet[aria-current="page"]').dispatchEvent(new MouseEvent('contextmenu', {
      clientX: innerWidth - 1, clientY: innerHeight - 1, bubbles: true, cancelable: true
    }))
  })
  const check = label => { checks++; console.log(`OK ${checks}: ${label}`) }
  async function reload() {
    const loaded = once(wc, 'did-finish-load')
    wc.reload()
    await loaded
  }

  await waitFor(() => !document.querySelector('#dir-add').disabled)
  assert.equal(await evaluate(() => document.querySelectorAll('.chapter-row').length), 1)
  check('startup loads a valid notebook')

  await click('#dir-add')
  await evaluate(() => {
    const input = document.querySelector('.chapter-row input')
    input.click()
    input.value = '新章节'
  })
  assert.equal(await evaluate(() => document.querySelector('#dir-view').classList.contains('active')), true)
  await key('Enter')
  assert.equal(await evaluate(() => document.querySelectorAll('.chapter-row')[1].textContent), '新章节')
  await evaluate(() => document.querySelectorAll('.chapter-row')[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  await click('#ctx-menu .ctx-item')
  await evaluate(() => { document.querySelector('.chapter-row input').value = '取消这个名字' })
  await key('Escape')
  assert.equal(await evaluate(() => document.querySelectorAll('.chapter-row')[1].textContent), '新章节')
  await evaluate(() => document.querySelectorAll('.chapter-row')[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  await click('#ctx-menu .ctx-item')
  await evaluate(() => {
    document.querySelector('.chapter-row input').value = '新章节改名'
    const target = document.querySelector('.chapter-row')
    target.focus()
    target.click()
  })
  assert.equal(await evaluate(() => document.querySelector('#paper-view').classList.contains('active')), true)
  await click('#back-to-dir')
  assert.equal(await evaluate(() => document.querySelectorAll('.chapter-row')[1].textContent), '新章节改名')
  check('rename Enter/Escape/blur work without swallowing the next chapter click')

  await click('.chapter-row')
  await pause(320)
  await wc.insertText('A')
  await key('ArrowRight', { ctrlKey: true })
  assert.equal(await activeIndex(), 1)
  assert.equal(await evaluate(() => document.activeElement.getAttribute('aria-label')), '第 2 页')
  await wc.insertText('B')
  assert.deepEqual(await evaluate(() => Array.from(document.querySelectorAll('.paper-textarea'), ed => ed.value)), ['A', 'B'])
  await key('ArrowLeft', { ctrlKey: true })
  assert.equal(await activeIndex(), 0)
  check('explicit keyboard navigation locates a paper and moves typing focus')

  let before = await mapPosition()
  for (let i = 0; i < 24; i++) await wheel(0.5)
  for (let i = 0; i < 3; i++) await wheel(80)
  for (let i = 0; i < 7; i++) { await pause(20); await wheel(2) }
  await wheel(80)
  let after = await mapPosition()
  near(after.x - before.x, -346)
  near(after.y, before.y)
  for (let i = 0; i < 4; i++) await wheel(800)
  const far = await mapPosition()
  near(far.x - after.x, -3200)
  await wheel(-3200)
  after = await mapPosition()
  near(after.x, far.x + 3200)
  assert.equal(await activeIndex(), 0)
  assert.equal(await evaluate(() => document.querySelectorAll('.paper-sheet').length), 2)
  check('subpixel and back-to-back touchpad streams pan continuously through every page and beyond')

  before = await mapPosition()
  await wheel(70, 120, false, { editor: true })
  after = await mapPosition()
  near(after.x - before.x, -70)
  near(after.y - before.y, -120)
  assert.equal(await evaluate(() => document.querySelector('.paper-sheet[aria-current="page"] textarea').scrollTop), 0)
  check('diagonal wheel movement over a text editor pans both axes without a nested scroll trap')

  before = await mapPosition()
  const anchor = await wheel(0, -140, true, { x: 210, y: 230 })
  const world = { x: (anchor.x - before.x) / before.scale, y: (anchor.y - before.y) / before.scale }
  after = await mapPosition()
  near((anchor.x - after.x) / after.scale, world.x)
  near((anchor.y - after.y) / after.scale, world.y)
  const center = { x: (after.width / 2 - after.x) / after.scale, y: (after.height / 2 - after.y) / after.scale }
  win.setSize(1000, 700)
  after = await mapPosition()
  near((after.width / 2 - after.x) / after.scale, center.x)
  near((after.height / 2 - after.y) / after.scale, center.y)
  await key('0', { ctrlKey: true })
  assert.equal((await mapPosition()).scale, 1)
  check('pinch zoom preserves its two-dimensional anchor; resize preserves the viewed map location')

  wc.sendInputEvent({ type: 'keyDown', keyCode: '0', modifiers: ['control', 'shift'] })
  wc.sendInputEvent({ type: 'keyUp', keyCode: '0', modifiers: ['control', 'shift'] })
  const shortcutOverview = await mapPosition()
  await click('#fit-canvas')
  after = await mapPosition()
  assert.ok(shortcutOverview.scale < 1)
  near(shortcutOverview.scale, after.scale)
  near(shortcutOverview.x, after.x)
  near(shortcutOverview.y, after.y)
  check('native Ctrl+Shift+0 fits the desktop when the keyboard reports a closing parenthesis')

  await click('#add-page')
  await click('#add-page')
  await click('#fit-canvas')
  await frame()
  assert.equal(await evaluate(() => {
    const sheets = Array.from(document.querySelectorAll('.paper-sheet'))
    const viewport = document.querySelector('#paper-viewport').getBoundingClientRect()
    return sheets.length === 4 && sheets[3].offsetTop > sheets[0].offsetTop &&
      sheets[3].offsetLeft === sheets[0].offsetLeft && sheets.every(sheet => {
        const rect = sheet.getBoundingClientRect()
        return !sheet.inert && rect.left >= viewport.left && rect.right <= viewport.right &&
          rect.top >= viewport.top && rect.bottom <= viewport.bottom
      })
  }), true)
  before = await mapPosition()
  await evaluate(() => document.querySelectorAll('.paper-textarea')[0].focus({ preventScroll: true }))
  assert.equal(await activeIndex(), 0)
  await evaluate(() => document.querySelectorAll('.paper-textarea')[1].focus({ preventScroll: true }))
  assert.equal(await activeIndex(), 1)
  after = await mapPosition()
  near(after.x, before.x)
  near(after.y, before.y)
  check('papers form a two-dimensional desktop; all are editable and focus never snaps the camera')

  await evaluate(() => document.querySelectorAll('.paper-textarea')[2].focus({ preventScroll: true }))
  await wc.insertText(Array.from({ length: 40 }, (_value, index) => `长文本第 ${index + 1} 行`).join('\n'))
  await waitFor(() => {
    const sheet = document.querySelectorAll('.paper-sheet')[2]
    const editor = sheet.querySelector('textarea')
    return sheet.offsetHeight > 960 && editor.scrollHeight <= editor.clientHeight + 1 && editor.scrollTop === 0
  })
  assert.equal(await evaluate(() => {
    const sheets = document.querySelectorAll('.paper-sheet')
    return sheets[3].offsetTop >= sheets[2].offsetTop + sheets[2].offsetHeight
  }), true)
  await evaluate(() => document.querySelectorAll('.paper-textarea')[1].focus({ preventScroll: true }))
  check('long text grows its paper and pushes the next row down without an inner scroll surface')

  await evaluate(() => {
    window.nativeWheelEvents = []
    window.auditNativeWheel = event => {
      if (event.isTrusted) window.nativeWheelEvents.push({ x: event.deltaX, y: event.deltaY, ctrl: event.ctrlKey })
    }
    document.addEventListener('wheel', window.auditNativeWheel, true)
  })
  before = await mapPosition()
  for (let i = 0; i < 20; i++) {
    wc.sendInputEvent({ type: 'mouseWheel', x: 20, y: 100, deltaX: -12, deltaY: -6, hasPreciseScrollingDeltas: true, canScroll: true })
  }
  await waitFor(() => window.nativeWheelEvents.reduce((sum, event) => sum + Math.abs(event.x), 0) >= 239)
  after = await mapPosition()
  const deltas = await evaluate(() => window.nativeWheelEvents.reduce((sum, event) => ({ x: sum.x + event.x, y: sum.y + event.y }), { x: 0, y: 0 }))
  near(after.x - before.x, -deltas.x)
  near(after.y - before.y, -deltas.y)
  before = after
  wc.sendInputEvent({ type: 'mouseWheel', x: 210, y: 280, deltaY: 60, modifiers: ['control'], hasPreciseScrollingDeltas: true, canScroll: true })
  await waitFor(() => window.nativeWheelEvents.some(event => event.ctrl))
  after = await mapPosition()
  assert.ok(after.scale > before.scale)
  assert.equal(await evaluate(() => visualViewport.scale), 1)
  await evaluate(() => document.removeEventListener('wheel', window.auditNativeWheel, true))
  check('trusted Chromium wheel streams pan continuously and Ctrl-wheel scales only the canvas')

  before = await mapPosition()
  wc.sendInputEvent({ type: 'mouseDown', x: 20, y: 100, button: 'middle', clickCount: 1 })
  await waitFor(() => document.querySelector('#paper-viewport').classList.contains('canvas-panning'))
  wc.sendInputEvent({ type: 'mouseMove', x: 65, y: 160, button: 'middle' })
  after = await mapPosition()
  near(after.x - before.x, 45)
  near(after.y - before.y, 60)
  wc.sendInputEvent({ type: 'mouseUp', x: 65, y: 160, button: 'middle', clickCount: 1 })
  await waitFor(() => !document.querySelector('#paper-viewport').classList.contains('canvas-panning'))
  check('native middle-mouse drag freely moves both axes and releases cleanly')

  await evaluate(() => document.querySelector('.paper-sheet[aria-current="page"] textarea').focus({ preventScroll: true }))
  await key('0', { ctrlKey: true })
  await key('ArrowLeft', { ctrlKey: true })
  await key('ArrowRight', { ctrlKey: true })

  assert.equal(await key('Enter', { isComposing: true, keyCode: 229 }), false)
  assert.equal(await evaluate(() => document.querySelector('.paper-sheet[aria-current="page"] .paper-textarea').value), 'B')
  await evaluate(() => {
    const editor = document.querySelector('.paper-sheet[aria-current="page"] .paper-textarea')
    editor.setSelectionRange(editor.value.length, editor.value.length)
  })
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
  wc.sendInputEvent({ type: 'char', keyCode: '\r' })
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
  await waitFor(() => {
    const editor = document.querySelector('.paper-sheet[aria-current="page"] .paper-textarea')
    return editor.value === 'B\n' && editor.selectionStart === 2
  })
  await wc.insertText('第二行')
  assert.equal(await evaluate(() => document.querySelector('.paper-sheet[aria-current="page"] .paper-textarea').value), 'B\n第二行')
  check('composing Enter is untouched; ordinary Enter inserts a plain text line break')

  await contextMenu()
  assert.equal(await evaluate(() => {
    const rect = document.querySelector('#ctx-menu').getBoundingClientRect()
    return rect.right <= innerWidth && rect.bottom <= innerHeight
  }), true)
  await click('#ctx-menu .ctx-item')
  assert.equal(await evaluate(() => document.activeElement.id), 'confirm-no')
  before = await mapPosition()
  await key('ArrowRight', { ctrlKey: true })
  await wheel(100)
  after = await mapPosition()
  near(after.x, before.x)
  near(after.y, before.y)
  assert.equal(await activeIndex(), 1)
  await key('Tab')
  assert.equal(await evaluate(() => document.activeElement.id), 'confirm-yes')
  await key('Escape')
  assert.equal(await evaluate(() => document.querySelector('#confirm-bg').classList.contains('hidden') && document.querySelector('#paper-view').classList.contains('active')), true)
  check('context menu stays on screen; confirmation blocks camera movement and Escape cancels')

  await click('.paper-sheet[aria-current="page"] .paper-extend')
  await click('#back-to-dir')
  await waitFor(() => document.querySelector('#save-status').dataset.state === 'saved')
  assert.ok(JSON.parse(await fs.readFile(file, 'utf8')).chapters[0].pages[1].height > 960)
  await reload()
  await waitFor(() => !document.querySelector('#dir-add').disabled)
  await click('.chapter-row')
  await key('ArrowRight', { ctrlKey: true })
  assert.ok(await evaluate(() => parseInt(document.querySelector('.paper-sheet[aria-current="page"]').style.minHeight)) > 960)
  check('extended paper height survives a complete renderer reload')
  before = await mapPosition()
  await wheel(115, -75)
  const remembered = await mapPosition()
  await click('#back-to-dir')
  await click('.chapter-row')
  after = await mapPosition()
  near(after.x, remembered.x)
  near(after.y, remembered.y)
  near(after.scale, remembered.scale)
  assert.equal(await activeIndex(), 1)
  check('returning to a chapter restores the same desktop location and selected paper')

  const store = createNotebookStore(file)
  await store.read()
  ipcMain.removeHandler('save-notebook')
  ipcMain.handle('save-notebook', async (_event, data) => { await pause(100); return store.write(data) })
  await wc.insertText('S')
  await key('s', { ctrlKey: true })
  await wc.insertText('T')
  await waitFor(() => document.querySelector('#save-status').dataset.state === 'saved')
  assert.match(JSON.parse(await fs.readFile(file, 'utf8')).chapters[0].pages[1].content, /ST/)
  check('edits made during an in-flight save also reach disk')

  await wc.insertText('刷新前刚输入')
  assert.doesNotMatch(JSON.parse(await fs.readFile(file, 'utf8')).chapters[0].pages[1].content, /刷新前刚输入/)
  await reload()
  await waitFor(() => !document.querySelector('#dir-add').disabled)
  await click('.chapter-row')
  await evaluate(() => document.querySelectorAll('.paper-textarea')[1].focus({ preventScroll: true }))
  assert.match(await evaluate(() => document.activeElement.value), /刷新前刚输入/)
  assert.match(JSON.parse(await fs.readFile(file, 'utf8')).chapters[0].pages[1].content, /刷新前刚输入/)
  check('refreshing immediately after typing saves the latest text before reloading')

  await click('#back-to-dir')
  await evaluate(() => document.querySelector('.chapter-row').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
  await click('#ctx-menu .ctx-item')
  await evaluate(() => { document.querySelector('.chapter-row input').value = '刷新前改名' })
  await reload()
  await waitFor(() => !document.querySelector('#dir-add').disabled)
  assert.equal(await evaluate(() => document.querySelector('.chapter-row').textContent), '刷新前改名')
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).chapters[0].title, '刷新前改名')
  await click('.chapter-row')
  await evaluate(() => document.querySelectorAll('.paper-textarea')[1].focus({ preventScroll: true }))
  check('refreshing during a chapter rename commits and saves the new title')

  ipcMain.removeHandler('save-notebook')
  ipcMain.handle('save-notebook', () => false)
  await wc.insertText('未保存')
  await evaluate(() => { window.reloadMarker = 'same document' })
  const preventedReload = once(wc, 'will-prevent-unload')
  wc.reload()
  await preventedReload
  await waitFor(() => document.querySelector('#save-status').dataset.state === 'error' && !document.body.inert)
  assert.equal(await evaluate(() => window.reloadMarker), 'same document')
  assert.match(await evaluate(() => document.querySelectorAll('.paper-textarea')[1].value), /未保存/)
  assert.doesNotMatch(JSON.parse(await fs.readFile(file, 'utf8')).chapters[0].pages[1].content, /未保存/)
  check('failed refresh-save keeps the original document and unsaved text editable')

  win.close()
  await waitFor(() => document.querySelector('#save-status').dataset.state === 'error' && !document.body.inert)
  assert.equal(win.isDestroyed(), false)
  assert.doesNotMatch(JSON.parse(await fs.readFile(file, 'utf8')).chapters[0].pages[1].content, /未保存/)
  check('failed close-save keeps the window and unsaved text available')

  ipcMain.removeHandler('save-notebook')
  ipcMain.handle('save-notebook', (_event, data) => store.write(data))
  await click('#save-retry')
  await waitFor(() => document.querySelector('#save-status').dataset.state === 'saved')
  assert.match(JSON.parse(await fs.readFile(file, 'utf8')).chapters[0].pages[1].content, /未保存/)
  check('retry persists the text after a save failure')

  const valid = await fs.readFile(file, 'utf8')
  await fs.writeFile(file, '{broken')
  await reload()
  await waitFor(() => document.querySelector('#save-status').dataset.state === 'load-error')
  assert.equal(await evaluate(() => document.querySelector('#dir-add').disabled), true)
  assert.equal(await fs.readFile(file, 'utf8'), '{broken')
  await fs.writeFile(file, valid)
  await reload()
  await waitFor(() => !document.querySelector('#dir-add').disabled)
  await click('.chapter-row')
  check('read failure reports the error without overwriting the damaged notebook')

  if (process.env.NO_NOTEBOOK_SCREENSHOT_DIR) {
    await fs.mkdir(process.env.NO_NOTEBOOK_SCREENSHOT_DIR, { recursive: true })
    await pause(350)
    const image = await wc.capturePage()
    await fs.writeFile(path.join(process.env.NO_NOTEBOOK_SCREENSHOT_DIR, 'notebook.png'), image.toPNG())
  }
  await wc.insertText('最后一刻')
  const closed = once(win, 'closed')
  win.close()
  await closed
  assert.match(JSON.parse(await fs.readFile(file, 'utf8')).chapters[0].pages[0].content, /最后一刻/)
  check('closing immediately after typing flushes the latest text')
  finished = true
  console.log(`All ${checks} interaction checks passed`)
  app.exit(0)
}
