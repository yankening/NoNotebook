const $ = (s) => document.querySelector(s)

const dirView = $('#dir-view')
const dirZoom = $('#dir-zoom')
const paperView = $('#paper-view')
const canvasViewport = $('#paper-viewport')
const canvasWorld = $('#canvas-world')
const paperGrid = $('#paper-grid')
const chList = $('#chapter-list')
const dirAdd = $('#dir-add')
const ctxMenu = $('#ctx-menu')
const confirmBg = $('#confirm-bg')
const confirmMsg = $('#confirm-msg')
const confirmYes = $('#confirm-yes')
const confirmNo = $('#confirm-no')
const saveStatus = $('#save-status')
const saveMessage = $('#save-message')
const saveRetry = $('#save-retry')
const pageCounter = $('#page-counter')
const backToDir = $('#back-to-dir')
const addPageButton = $('#add-page')
const fitButton = $('#fit-canvas')
const zoomReadout = $('#zoom-readout')

let notebook = null
let currentChapterId = null
let currentPageIdx = 0
let dirZoomLevel = 1
let saveTimer = null
let confirmResolve = null
let editRevision = 0
let savedRevision = 0
let savePromise = null
let statusTimer = null
let closing = false
let reloading = false
let confirmFocus = null
let renderFrame = null
let contextFocus = null
let composing = false
const camera = new CanvasCamera()
const chapterViews = new Map()
let viewport = { left: 0, top: 0, width: 0, height: 0 }
let activeSheet = null
let spaceHeld = false
const pointers = new Map()
let pinch = null
let suppressClick = false

function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }

function defaultPage() {
  const now = new Date().toISOString()
  return { id: uid('pg-'), content: '', createdAt: now, updatedAt: now }
}

function getChapter() { return notebook?.chapters.find(c => c.id === currentChapterId) }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

function showSaveStatus(message, state = 'saving') {
  clearTimeout(statusTimer)
  saveMessage.textContent = message
  saveStatus.dataset.state = state
  saveStatus.hidden = false
  saveRetry.hidden = state !== 'error'
  if (state === 'saved') statusTimer = setTimeout(() => { saveStatus.hidden = true }, 1500)
}

function markDirty() {
  editRevision++
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 500)
}

function saveNow() {
  clearTimeout(saveTimer)
  if (savePromise) return savePromise
  if (!notebook || savedRevision === editRevision) return Promise.resolve(true)
  const save = async () => {
    try {
      do {
        const revision = editRevision
        showSaveStatus('正在保存…')
        if (!await window.api.saveNotebook(structuredClone(notebook))) throw new Error('Save failed')
        savedRevision = revision
      } while (savedRevision !== editRevision)
      showSaveStatus('已保存', 'saved')
      return true
    } catch (error) {
      console.error('Save error:', error)
      showSaveStatus('保存失败，内容仍保留在窗口中', 'error')
      return false
    }
  }
  savePromise = save().finally(() => { savePromise = null })
  return savePromise
}

saveRetry.addEventListener('click', saveNow)
window.addEventListener('beforeunload', e => {
  document.activeElement?.blur()
  if (!notebook || savedRevision === editRevision) return
  e.preventDefault()
  e.returnValue = false
  if (closing || reloading) return
  reloading = true
  document.body.inert = true
  saveNow().then(saved => {
    reloading = false
    if (closing) return
    document.body.inert = false
    if (saved) window.location.reload()
    else saveRetry.focus()
  })
})
window.api.onBeforeClose(async () => {
  if (closing) return
  closing = true
  document.activeElement?.blur()
  document.body.inert = true
  if (await saveNow()) {
    window.api.finishClose()
  } else {
    closing = false
    document.body.inert = false
    window.api.cancelClose()
    saveRetry.focus()
  }
})

function renderDir() {
  chList.innerHTML = ''
  notebook.chapters.forEach(ch => {
    const row = document.createElement('div')
    row.className = 'chapter-row'
    row.tabIndex = 0
    row.setAttribute('role', 'button')
    const label = document.createElement('span')
    label.textContent = ch.title || '未命名'
    row.appendChild(label)

    row.addEventListener('click', () => openChapter(ch.id))
    row.addEventListener('keydown', e => {
      if (e.target === row && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        openChapter(ch.id)
      }
    })
    row.addEventListener('contextmenu', e => {
      e.preventDefault()
      showCtx(e.clientX, e.clientY, [
        { label: '重命名', fn: () => renameChapter(ch.id) },
        { label: '删除项目', danger: true, fn: () => deleteChapter(ch.id) }
      ])
    })
    chList.appendChild(row)
  })
}

function addChapter() {
  if (!notebook) return
  const id = uid('ch-')
  notebook.chapters.push({ id, title: '', pages: [defaultPage()] })
  renderDir()
  markDirty()
  renameChapter(id)
}

function renameChapter(id) {
  const ch = notebook.chapters.find(c => c.id === id)
  if (!ch) return
  const rows = chList.querySelectorAll('.chapter-row')
  const idx = notebook.chapters.findIndex(c => c.id === id)
  const row = rows[idx]
  row.innerHTML = ''
  const inp = document.createElement('input')
  inp.value = ch.title
  inp.setAttribute('aria-label', '章节名称')
  row.appendChild(inp)
  inp.focus()
  inp.select()

  let finished = false
  function done(cancel = false) {
    if (finished) return
    finished = true
    const title = inp.value.trim()
    if (!cancel && ch.title !== title) { ch.title = title; markDirty() }
    const label = document.createElement('span')
    label.textContent = ch.title || '未命名'
    row.replaceChildren(label)
  }
  inp.addEventListener('click', e => e.stopPropagation())
  inp.addEventListener('contextmenu', e => e.stopPropagation())
  inp.addEventListener('blur', () => done())
  inp.addEventListener('keydown', e => {
    e.stopPropagation()
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault()
      done(e.key === 'Escape')
      chList.children[idx]?.focus()
    }
  })
}

function deleteChapter(id) {
  confirmDelete('确定要删除这个项目吗？此操作不可撤销。').then(ok => {
    if (!ok) return
    notebook.chapters = notebook.chapters.filter(c => c.id !== id)
    if (notebook.chapters.length === 0) notebook.chapters.push({ id: uid('ch-'), title: '我的笔记', pages: [defaultPage()] })
    renderDir()
    markDirty()
  })
}

function openChapter(id) {
  if (!notebook?.chapters.some(ch => ch.id === id) || closing) return
  hideCtx()
  endCanvasDrag()
  currentChapterId = id
  const remembered = chapterViews.get(id)
  currentPageIdx = clamp(remembered?.page || 0, 0, getChapter().pages.length - 1)

  dirView.classList.remove('active')
  paperView.classList.add('active')

  measureViewport(false)
  renderPages()
  if (remembered) {
    camera.x = remembered.x
    camera.y = remembered.y
    camera.scale = remembered.scale
    camera.resize(remembered.width, remembered.height, viewport.width, viewport.height)
    requestCanvasRender()
  } else {
    fitCanvas()
  }
  focusCurrentPage()
}

function closeChapter() {
  if (!paperView.classList.contains('active')) return
  const chapterIndex = notebook.chapters.findIndex(ch => ch.id === currentChapterId)
  chapterViews.set(currentChapterId, {
    x: camera.x, y: camera.y, scale: camera.scale, page: currentPageIdx,
    width: viewport.width, height: viewport.height
  })
  endCanvasDrag()
  hideCtx()
  paperView.classList.remove('active')
  dirView.classList.add('active')
  renderDir()
  chList.children[chapterIndex]?.focus({ preventScroll: true })
  saveNow()
}

function renderPages() {
  paperGrid.innerHTML = ''
  activeSheet = null
  const ch = getChapter()
  if (!ch) return

  const fragment = document.createDocumentFragment()
  ch.pages.forEach((page, idx) => fragment.appendChild(buildPageSheet(page, idx)))
  paperGrid.appendChild(fragment)
  Array.from(paperGrid.children).forEach(sheet => growPaper(sheet))
  updateCurrentPage()
  requestCanvasRender()
}

function buildPageSheet(page, idx) {
  const sheet = document.createElement('div')
  sheet.className = 'paper-sheet'
  sheet.dataset.idx = idx
  sheet.dataset.pageNumber = String(idx + 1).padStart(2, '0')
  if (Number.isFinite(page.height)) sheet.style.minHeight = Math.max(960, page.height) + 'px'

  // A native plain-text editor preserves line breaks, IME and undo behavior.
  const ed = document.createElement('textarea')
  ed.className = 'paper-textarea'
  ed.spellcheck = false
  ed.setAttribute('role', 'textbox')
  ed.setAttribute('aria-multiline', 'true')
  ed.setAttribute('aria-label', `第 ${idx + 1} 页`)
  ed.value = page.content
  ed.addEventListener('compositionstart', () => { composing = true })
  ed.addEventListener('compositionend', () => { composing = false })
  ed.addEventListener('focus', () => {
    currentPageIdx = Number(sheet.dataset.idx)
    updateCurrentPage()
  })

  ed.addEventListener('input', () => {
    page.content = ed.value
    page.updatedAt = new Date().toISOString()
    growPaper(sheet, page)
    markDirty()
  })

  const ext = document.createElement('button')
  ext.className = 'paper-extend'
  ext.textContent = '+'
  ext.type = 'button'
  ext.setAttribute('aria-label', '延长纸张')
  ext.addEventListener('click', (e) => {
    e.stopPropagation()
    const cur = parseInt(sheet.style.minHeight || getComputedStyle(sheet).minHeight || '960')
    page.height = cur + Math.round(window.innerHeight / 3)
    sheet.style.minHeight = page.height + 'px'
    markDirty()
  })

  sheet.addEventListener('contextmenu', e => {
    e.preventDefault()
    showCtx(e.clientX, e.clientY, [
      { label: '删除此页', danger: true, fn: () => deletePage(idx) }
    ])
  })

  sheet.addEventListener('click', e => { if (e.target === sheet) ed.focus({ preventScroll: true }) })
  sheet.append(ed, ext)
  return sheet
}

function growPaper(sheet, page) {
  const editor = sheet.querySelector('.paper-textarea')
  // Account for the sheet border so the editor never needs its own scroll area.
  const height = Math.ceil(editor.scrollHeight + 2)
  if (height > sheet.offsetHeight) {
    sheet.style.minHeight = height + 'px'
    if (page) page.height = height
  }
  editor.scrollTop = 0
}

function updateCurrentPage() {
  const ch = getChapter()
  if (!ch) return
  activeSheet?.removeAttribute('aria-current')
  activeSheet = paperGrid.children[currentPageIdx]
  activeSheet?.setAttribute('aria-current', 'page')
  pageCounter.textContent = `${currentPageIdx + 1} / ${ch.pages.length}`
}

function focusCurrentPage() {
  paperGrid.children[currentPageIdx]?.querySelector('.paper-textarea').focus({ preventScroll: true })
}

function navigatePage(direction) {
  if (closing || composing || confirmResolve || !paperView.classList.contains('active')) return
  const ch = getChapter()
  if (!ch || currentPageIdx + direction < 0) return
  hideCtx()
  if (currentPageIdx + direction >= ch.pages.length) {
    addPage()
    return
  }
  currentPageIdx += direction
  updateCurrentPage()
  centerCurrentPage()
  focusCurrentPage()
}

function nextPage() { navigatePage(1) }
function prevPage() { navigatePage(-1) }

function addPage() {
  if (closing || composing || confirmResolve || !getChapter()) return
  const chapter = getChapter()
  const page = defaultPage()
  chapter.pages.push(page)
  currentPageIdx = chapter.pages.length - 1
  paperGrid.appendChild(buildPageSheet(page, currentPageIdx))
  updateCurrentPage()
  centerCurrentPage()
  focusCurrentPage()
  markDirty()
}

function deletePage(idx) {
  const ch = getChapter()
  if (!ch) return
  confirmDelete('确定要删除这一页吗？此操作不可撤销。').then(ok => {
    if (!ok) return
    ch.pages.splice(idx, 1)
    if (ch.pages.length === 0) ch.pages.push(defaultPage())
    if (currentPageIdx >= ch.pages.length) currentPageIdx = ch.pages.length - 1
    renderPages()
    centerCurrentPage()
    focusCurrentPage()
    markDirty()
  })
}

function applyDirZoom() {
  dirZoom.style.transform = `scale(${dirZoomLevel})`
}

function zoomView(factor, isPaper, point = { x: viewport.width / 2, y: viewport.height / 2 }) {
  if (isPaper) {
    camera.zoomAt(camera.scale * factor, point.x, point.y)
    requestCanvasRender()
  } else {
    dirZoomLevel = clamp(dirZoomLevel * factor, 0.5, 2.5)
    applyDirZoom()
  }
}

function requestCanvasRender() {
  if (renderFrame !== null) return
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null
    canvasWorld.style.transform = camera.transform
    zoomReadout.textContent = Math.round(camera.scale * 100) + '%'
  })
}

function measureViewport(preserveCenter = true) {
  const rect = canvasViewport.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  if (preserveCenter && viewport.width && viewport.height) {
    camera.resize(viewport.width, viewport.height, rect.width, rect.height)
  }
  viewport = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  requestCanvasRender()
}

function centerCurrentPage() {
  const sheet = paperGrid.children[currentPageIdx]
  if (!sheet) return
  camera.x = viewport.width / 2 - (sheet.offsetLeft + sheet.offsetWidth / 2) * camera.scale
  const height = sheet.offsetHeight * camera.scale
  camera.y = Math.max(32, (viewport.height - height) / 2) - sheet.offsetTop * camera.scale
  requestCanvasRender()
}

function fitCanvas() {
  const sheets = Array.from(paperGrid.children)
  if (!sheets.length) return
  const right = Math.max(...sheets.map(sheet => sheet.offsetLeft + sheet.offsetWidth))
  const bottom = Math.max(...sheets.map(sheet => sheet.offsetTop + sheet.offsetHeight))
  camera.fit({ x: 0, y: 0, width: right, height: bottom }, viewport.width, viewport.height)
  requestCanvasRender()
}

function viewportPoint(e) {
  const x = e.clientX - viewport.left
  const y = e.clientY - viewport.top
  return x >= 0 && x <= viewport.width && y >= 0 && y <= viewport.height
    ? { x, y } : { x: viewport.width / 2, y: viewport.height / 2 }
}

function showCtx(x, y, items) {
  if (closing || confirmResolve) return
  contextFocus = document.activeElement
  ctxMenu.innerHTML = ''
  items.forEach(it => {
    const el = document.createElement('button')
    el.type = 'button'
    el.setAttribute('role', 'menuitem')
    el.className = 'ctx-item' + (it.danger ? ' danger' : '')
    el.textContent = it.label
    el.addEventListener('click', () => { hideCtx(true); it.fn() })
    ctxMenu.appendChild(el)
  })
  ctxMenu.classList.remove('hidden')
  ctxMenu.style.left = clamp(x, 8, Math.max(8, window.innerWidth - ctxMenu.offsetWidth - 8)) + 'px'
  ctxMenu.style.top = clamp(y, 8, Math.max(8, window.innerHeight - ctxMenu.offsetHeight - 8)) + 'px'
  ctxMenu.firstElementChild?.focus({ preventScroll: true })
}

function hideCtx(restoreFocus = false) {
  ctxMenu.classList.add('hidden')
  if (restoreFocus && contextFocus?.isConnected) contextFocus.focus({ preventScroll: true })
  contextFocus = null
}

function confirmDelete(msg) {
  if (confirmResolve) return Promise.resolve(false)
  return new Promise(resolve => {
    confirmFocus = document.activeElement
    hideCtx()
    endCanvasDrag()
    confirmMsg.textContent = msg
    confirmBg.classList.remove('hidden')
    confirmResolve = resolve
    dirView.inert = true
    paperView.inert = true
    confirmNo.focus()
  })
}

function finishConfirm(ok) {
  if (!confirmResolve) return
  const resolve = confirmResolve
  confirmResolve = null
  confirmBg.classList.add('hidden')
  dirView.inert = false
  paperView.inert = false
  if (confirmFocus?.isConnected) confirmFocus.focus({ preventScroll: true })
  confirmFocus = null
  resolve(ok)
}

confirmYes.addEventListener('click', () => finishConfirm(true))
confirmNo.addEventListener('click', () => finishConfirm(false))
confirmBg.addEventListener('click', e => { if (e.target === confirmBg) finishConfirm(false) })

document.addEventListener('keydown', e => {
  if (closing || e.isComposing || e.keyCode === 229) return
  if (confirmResolve) {
    if (e.key === 'Escape') { e.preventDefault(); finishConfirm(false) }
    else if (e.key === 'Tab') {
      e.preventDefault()
      ;(document.activeElement === confirmNo ? confirmYes : confirmNo).focus()
    } else if (e.ctrlKey || e.metaKey) e.preventDefault()
    return
  }
  if (!ctxMenu.classList.contains('hidden')) {
    if (e.key === 'Escape') { e.preventDefault(); hideCtx(true); return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const items = Array.from(ctxMenu.children)
      const direction = e.key === 'ArrowDown' ? 1 : -1
      items[(items.indexOf(document.activeElement) + direction + items.length) % items.length].focus()
      return
    }
  }
  if (e.key === 'Escape') {
    hideCtx()
    if (paperView.classList.contains('active')) closeChapter()
    return
  }

  if (e.code === 'Space' && paperView.classList.contains('active') &&
      !e.target.closest('textarea, input, [contenteditable="true"]')) {
    e.preventDefault()
    spaceHeld = true
    canvasViewport.classList.add('canvas-pan-ready')
    return
  }

  if (!e.ctrlKey && !e.metaKey) return

  switch (e.code === 'Digit0' ? '0' : e.key) {
    case 'ArrowLeft':
    case 'ArrowRight':
      if (!paperView.classList.contains('active')) break
      e.preventDefault()
      if (!e.repeat) { e.key === 'ArrowLeft' ? prevPage() : nextPage() }
      break
    case '=': case '+': e.preventDefault(); zoomView(1.1, paperView.classList.contains('active')); break
    case '-':          e.preventDefault(); zoomView(1 / 1.1, paperView.classList.contains('active')); break
    case '0':
      e.preventDefault()
      if (paperView.classList.contains('active')) {
        if (e.shiftKey) fitCanvas()
        else zoomView(1 / camera.scale, true)
      }
      else { dirZoomLevel = 1; applyDirZoom() }
      break
    case 'n': case 'N':
      if (paperView.classList.contains('active')) { e.preventDefault(); if (!e.repeat) addPage() }
      break
    case 's': case 'S': e.preventDefault(); saveNow(); break
  }
})

document.addEventListener('wheel', e => {
  if (closing || confirmResolve) { e.preventDefault(); return }
  const isPaper = paperView.classList.contains('active')
  const unitX = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.width : 1
  const unitY = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.height : 1
  let dx = e.deltaX * unitX
  let dy = e.deltaY * unitY
  // Chromium represents a touchpad pinch as Ctrl + wheel.
  if (e.ctrlKey) {
    e.preventDefault()
    zoomView(Math.exp(clamp(-dy * 0.0025, -2, 2)), isPaper, viewportPoint(e))
    return
  }
  if (!isPaper) return
  e.preventDefault() // Wheel input moves the shared canvas, even over an editor.
  hideCtx()
  if (e.shiftKey && dx === 0) { dx = dy; dy = 0 }
  camera.pan(-dx, -dy)
  requestCanvasRender()
}, { passive: false })

canvasViewport.addEventListener('pointerdown', e => {
  if (closing || confirmResolve || e.button === 2) return
  const background = !e.target.closest('.paper-sheet')
  const movable = e.button === 1 || spaceHeld || background
  if (e.pointerType !== 'touch' && !movable) return
  pointers.set(e.pointerId, { type: e.pointerType, x: e.clientX, y: e.clientY, movable, moved: 0 })
  pinch = touchPinch()
  if (movable || pinch) {
    e.preventDefault()
    hideCtx()
    canvasViewport.setPointerCapture(e.pointerId)
    canvasViewport.classList.add('canvas-panning')
    if (background) canvasViewport.focus({ preventScroll: true })
  }
})

canvasViewport.addEventListener('pointermove', e => {
  const pointer = pointers.get(e.pointerId)
  if (!pointer) return
  const dx = e.clientX - pointer.x
  const dy = e.clientY - pointer.y
  pointer.x = e.clientX
  pointer.y = e.clientY
  pointer.moved += Math.hypot(dx, dy)
  const nextPinch = touchPinch()
  if (pinch && nextPinch) {
    e.preventDefault()
    camera.pan(nextPinch.x - pinch.x, nextPinch.y - pinch.y)
    if (pinch.distance > 0) {
      camera.zoomAt(camera.scale * nextPinch.distance / pinch.distance,
        nextPinch.x - viewport.left, nextPinch.y - viewport.top)
    }
    pinch = nextPinch
    requestCanvasRender()
  } else if (pointer.movable) {
    e.preventDefault()
    camera.pan(dx, dy)
    requestCanvasRender()
  }
})

function touchPinch() {
  const touches = Array.from(pointers.values()).filter(pointer => pointer.type === 'touch')
  if (touches.length < 2) return null
  const [a, b] = touches
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) }
}

function endPointer(e) {
  const pointer = pointers.get(e.pointerId)
  if (!pointer) return
  if (pointer.moved > 3) {
    suppressClick = true
    setTimeout(() => { suppressClick = false }, 0)
  }
  pointers.delete(e.pointerId)
  pinch = touchPinch()
  if (canvasViewport.hasPointerCapture(e.pointerId)) canvasViewport.releasePointerCapture(e.pointerId)
  if (!pointers.size) canvasViewport.classList.remove('canvas-panning')
}

function endCanvasDrag() {
  const ids = Array.from(pointers.keys())
  pointers.clear()
  pinch = null
  spaceHeld = false
  canvasViewport.classList.remove('canvas-panning', 'canvas-pan-ready')
  for (const id of ids) {
    if (canvasViewport.hasPointerCapture(id)) canvasViewport.releasePointerCapture(id)
  }
}

canvasViewport.addEventListener('pointerup', endPointer)
canvasViewport.addEventListener('pointercancel', endPointer)
canvasViewport.addEventListener('lostpointercapture', endPointer)
canvasViewport.addEventListener('click', e => {
  if (suppressClick) { e.preventDefault(); e.stopPropagation() }
}, true)
document.addEventListener('keyup', e => {
  if (e.code === 'Space') { spaceHeld = false; canvasViewport.classList.remove('canvas-pan-ready') }
})

dirAdd.addEventListener('click', addChapter)
backToDir.addEventListener('click', closeChapter)
addPageButton.addEventListener('click', addPage)
fitButton.addEventListener('click', fitCanvas)
zoomReadout.addEventListener('click', () => zoomView(1 / camera.scale, true))
new ResizeObserver(() => measureViewport()).observe(canvasViewport)
window.addEventListener('resize', () => { hideCtx(); measureViewport() })
window.addEventListener('blur', () => { endCanvasDrag(); saveNow() })
document.addEventListener('click', e => { if (!ctxMenu.contains(e.target)) hideCtx() })

async function init() {
  dirAdd.disabled = true
  try {
    // Font metrics affect line wrapping and paper height.
    const [loadedNotebook] = await Promise.all([
      window.api.getNotebook(),
      document.fonts.load('400 16px "Source Han Sans CN"', '中文笔记 NoNotebook')
        .catch(error => console.warn('Font load failed:', error))
    ])
    notebook = loadedNotebook
    applyDirZoom()
    requestCanvasRender()
    renderDir()
    dirAdd.disabled = false
  } catch (error) {
    console.error('Read error:', error)
    showSaveStatus('笔记未能读取，原文件已保留。请重新打开应用或从备份恢复。', 'load-error')
  }
}

init()
