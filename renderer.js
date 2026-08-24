// ═══════════════════════════════════════════════════════
// NoNotebook — Renderer Logic
// Phase 2: Slide animations, zoom, touchpad gestures
// ═══════════════════════════════════════════════════════

const $ = (s) => document.querySelector(s)

// ── DOM ──────────────────────────────────────────────────
const dirView    = $('#dir-view')
const dirZoom    = $('#dir-zoom')
const paperView  = $('#paper-view')
const paperVp    = $('#paper-viewport')
const paperZoom  = $('#paper-zoom')
const pageStrip  = $('#page-strip')
const chList     = $('#chapter-list')
const dirAdd     = $('#dir-add')
const ctxMenu    = $('#ctx-menu')
const confirmBg  = $('#confirm-bg')
const confirmMsg = $('#confirm-msg')
const confirmYes = $('#confirm-yes')
const confirmNo  = $('#confirm-no')

// ── State ────────────────────────────────────────────────
let notebook = null
let currentChapterId = null
let currentPageIdx  = 0
let dirZoomLevel    = 1
let paperZoomLevel  = 1
let saveTimer       = null
let confirmResolve  = null
let pageAnimating   = false     // guard against rapid page flips

// ── Pointer (touch) swipe state ──────────────────────────
let ptrTracking      = false     // pointer down → tracking a swipe
let ptrStartX        = 0
let ptrStartY        = 0
let ptrMoved         = false     // true once pointer has moved enough to count as swipe

// ── Helpers ──────────────────────────────────────────────
function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }

function defaultPage() {
  return { id: uid('pg-'), content: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
}

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML }

function getChapter() { return notebook.chapters.find(c => c.id === currentChapterId) }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

// ── Auto Save ────────────────────────────────────────────
function markDirty() { clearTimeout(saveTimer); saveTimer = setTimeout(() => window.api.saveNotebook(notebook), 800) }
async function saveNow() { clearTimeout(saveTimer); await window.api.saveNotebook(notebook) }

// ══════════════════════════════════════════════════════════
//  DIRECTORY
// ══════════════════════════════════════════════════════════

function renderDir() {
  chList.innerHTML = ''
  notebook.chapters.forEach(ch => {
    const row = document.createElement('div')
    row.className = 'chapter-row'
    row.innerHTML = `<span>${esc(ch.title || '未命名')}</span>`

    row.addEventListener('click', () => openChapter(ch.id))
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
  notebook.chapters.push({ id: uid('ch-'), title: '', pages: [defaultPage()] })
  renderDir(); markDirty()
}

function renameChapter(id) {
  const ch = notebook.chapters.find(c => c.id === id)
  if (!ch) return
  const rows = chList.querySelectorAll('.chapter-row')
  const idx  = notebook.chapters.findIndex(c => c.id === id)
  const row  = rows[idx]
  row.innerHTML = ''
  const inp = document.createElement('input')
  inp.value = ch.title
  row.appendChild(inp); inp.focus(); inp.select()

  function done() { ch.title = inp.value.trim(); renderDir(); markDirty() }
  inp.addEventListener('blur', done)
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') done()
    if (e.key === 'Escape') { inp.value = ch.title; done() }
  })
}

function deleteChapter(id) {
  confirm('确定要删除这个项目吗？此操作不可撤销。').then(ok => {
    if (!ok) return
    notebook.chapters = notebook.chapters.filter(c => c.id !== id)
    if (notebook.chapters.length === 0) notebook.chapters.push({ id: uid('ch-'), title: '我的笔记', pages: [defaultPage()] })
    renderDir(); markDirty()
  })
}

// ══════════════════════════════════════════════════════════
//  PAPER VIEW
// ══════════════════════════════════════════════════════════

function openChapter(id) {
  currentChapterId = id
  currentPageIdx  = 0
  paperZoomLevel  = 1
  applyPaperZoom()

  dirView.classList.remove('active')
  paperView.classList.add('active', 'slide-in')
  setTimeout(() => paperView.classList.remove('slide-in'), 300)

  renderPages()
}

function closeChapter() {
  saveNow().then(() => {
    paperView.classList.remove('active')
    dirView.classList.add('active')
  })
}

function renderPages() {
  pageStrip.innerHTML = ''
  const ch = getChapter()
  if (!ch) return

  ch.pages.forEach((page, idx) => {
    pageStrip.appendChild(buildPageSheet(page, idx))
  })

  // update position instantly (no animation on initial load)
  pageStrip.style.transition = 'none'
  updatePagePos()
  pageStrip.offsetHeight // force reflow
  pageStrip.style.transition = ''
}

function buildPageSheet(page, idx) {
  const sheet = document.createElement('div')
  sheet.className = 'paper-sheet'
  sheet.dataset.idx = idx

  // contenteditable div — paper-like: click anywhere to place cursor
  const ed = document.createElement('div')
  ed.className = 'paper-textarea'
  ed.contentEditable = 'true'
  ed.spellcheck = false
  ed.textContent = page.content  // \n preserved as line breaks (white-space: pre-wrap)

  // Enter → plain \n, not HTML blocks
  ed.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      document.execCommand('insertText', false, '\n')
    }
  })

  // Paste → plain text only
  ed.addEventListener('paste', e => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (text) document.execCommand('insertText', false, text)
  })

  // Auto-save on input
  ed.addEventListener('input', () => {
    page.content = ed.innerText
    page.updatedAt = new Date().toISOString()
    markDirty()
  })

  // extend +
  const ext = document.createElement('div')
  ext.className = 'paper-extend'
  ext.textContent = '+'
  ext.addEventListener('click', (e) => {
    e.stopPropagation()
    const cur = parseInt(sheet.style.minHeight || getComputedStyle(sheet).minHeight || '960')
    sheet.style.minHeight = (cur + Math.round(window.innerHeight / 3)) + 'px'
  })

  // right-click delete
  sheet.addEventListener('contextmenu', e => {
    e.preventDefault()
    showCtx(e.clientX, e.clientY, [
      { label: '删除此页', danger: true, fn: () => deletePage(idx) }
    ])
  })

  sheet.addEventListener('click', () => ed.focus())
  sheet.append(ed, ext)
  return sheet
}

function updatePagePos(animate = true) {
  const ch = getChapter()
  if (!ch || ch.pages.length === 0) return

  pageStrip.style.transition = animate ? 'transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none'

  const pageWidth = 720
  const gap = 60
  const padLeft = 60

  // left edge of current page within the strip
  const pageLeft = padLeft + currentPageIdx * (pageWidth + gap)

  // center the page: viewport is scaled by zoom, so effective width = vpW / zoom
  const vpW = paperVp.clientWidth
  const offset = pageLeft - (vpW / paperZoomLevel - pageWidth) / 2

  pageStrip.style.transform = `translateX(${-offset}px)`

  if (!animate) { pageStrip.offsetHeight; pageStrip.style.transition = '' }
}

function nextPage() {
  if (pageAnimating) return
  pageAnimating = true  // lock BEFORE any work — prevents double-fire

  const ch = getChapter()
  if (!ch) { pageAnimating = false; return }

  if (currentPageIdx < ch.pages.length - 1) {
    // flip to existing page
    currentPageIdx++
    updatePagePos()
    setTimeout(() => { pageAnimating = false }, 300)
  } else {
    // create new page at end — with slide + fade-in
    const newPage = defaultPage()
    ch.pages.push(newPage)
    currentPageIdx = ch.pages.length - 1

    // build DOM for the new page, start invisible
    const sheet = buildPageSheet(newPage, currentPageIdx)
    sheet.classList.add('appear')
    pageStrip.appendChild(sheet)

    // animate slide + fade-in together
    updatePagePos(true)
    setTimeout(() => {
      pageAnimating = false
      sheet.classList.remove('appear')
    }, 400)

    markDirty()
  }
}

function prevPage() {
  if (pageAnimating || currentPageIdx <= 0) return
  currentPageIdx--
  updatePagePos()
  pageAnimating = true
  setTimeout(() => { pageAnimating = false }, 300)
}

function deletePage(idx) {
  const ch = getChapter()
  if (!ch) return
  confirm('确定要删除这一页吗？此操作不可撤销。').then(ok => {
    if (!ok) return
    ch.pages.splice(idx, 1)
    if (ch.pages.length === 0) ch.pages.push(defaultPage())
    if (currentPageIdx >= ch.pages.length) currentPageIdx = ch.pages.length - 1
    renderPages()
    updatePagePos(false)
    markDirty()
  })
}

// ══════════════════════════════════════════════════════════
//  ZOOM
// ══════════════════════════════════════════════════════════

function applyDirZoom() {
  dirZoom.style.transform = `scale(${dirZoomLevel})`
}

function applyPaperZoom() {
  paperZoom.style.transform = `scale(${paperZoomLevel})`
}

function zoomView(delta, isPaper) {
  if (isPaper) {
    paperZoomLevel = clamp(paperZoomLevel + delta, 0.5, 2.5)
    applyPaperZoom()
  } else {
    dirZoomLevel = clamp(dirZoomLevel + delta, 0.5, 2.5)
    applyDirZoom()
  }
}

// ══════════════════════════════════════════════════════════
//  CONTEXT MENU
// ══════════════════════════════════════════════════════════

function showCtx(x, y, items) {
  ctxMenu.innerHTML = ''
  items.forEach(it => {
    const el = document.createElement('div')
    el.className = 'ctx-item' + (it.danger ? ' danger' : '')
    el.textContent = it.label
    el.addEventListener('click', () => { hideCtx(); it.fn() })
    ctxMenu.appendChild(el)
  })
  ctxMenu.style.left = x + 'px'
  ctxMenu.style.top  = y + 'px'
  ctxMenu.classList.remove('hidden')
}

function hideCtx() { ctxMenu.classList.add('hidden') }

// ══════════════════════════════════════════════════════════
//  CONFIRM DIALOG
// ══════════════════════════════════════════════════════════

function confirm(msg) {
  return new Promise(resolve => {
    confirmMsg.textContent = msg
    confirmBg.classList.remove('hidden')
    confirmResolve = resolve
  })
}

confirmYes.addEventListener('click', () => { confirmBg.classList.add('hidden'); confirmResolve?.(true) })
confirmNo.addEventListener('click',  () => { confirmBg.classList.add('hidden'); confirmResolve?.(false) })

// ══════════════════════════════════════════════════════════
//  KEYBOARD
// ══════════════════════════════════════════════════════════

document.addEventListener('keydown', e => {
  // Escape
  if (e.key === 'Escape') {
    hideCtx()
    if (paperView.classList.contains('active')) closeChapter()
    return
  }

  if (!e.ctrlKey) return

  switch (e.key) {
    case 'ArrowLeft':  e.preventDefault(); prevPage(); break
    case 'ArrowRight': e.preventDefault(); nextPage(); break
    case '=': case '+': e.preventDefault(); zoomView(+0.05, paperView.classList.contains('active')); break
    case '-':          e.preventDefault(); zoomView(-0.05, paperView.classList.contains('active')); break
  }
})

// ══════════════════════════════════════════════════════════
//  WHEEL — Ctrl + wheel → zoom only
//  (Page flip is handled by pointer events below)
// ══════════════════════════════════════════════════════════

document.addEventListener('wheel', e => {
  if (e.ctrlKey) {
    e.preventDefault()
    zoomView(-e.deltaY * 0.001, paperView.classList.contains('active'))
  }
}, { passive: false })

// ══════════════════════════════════════════════════════════
//  POINTER SWIPE — One gesture = one page flip
//  pointerdown → move tracking → pointerup judges direction
//  No timeouts, no debounce. Each physical gesture is one
//  complete down–move–up cycle.
// ══════════════════════════════════════════════════════════

const SWIPE_DX_MIN  = 80    // minimum horizontal displacement (px)

paperVp.addEventListener('pointerdown', e => {
  if (ptrTracking) return           // already in a gesture
  if (e.pointerType === 'mouse') return  // mouse drag ≠ swipe
  ptrTracking = true
  ptrMoved    = false
  ptrStartX   = e.clientX
  ptrStartY   = e.clientY
  paperVp.setPointerCapture(e.pointerId)
})

paperVp.addEventListener('pointermove', e => {
  if (!ptrTracking) return
  // Mark as "moved" once the finger has travelled enough in any direction
  if (!ptrMoved && (Math.abs(e.clientX - ptrStartX) > 10 || Math.abs(e.clientY - ptrStartY) > 10)) {
    ptrMoved = true
  }
})

paperVp.addEventListener('pointerup', e => {
  if (!ptrTracking) return
  ptrTracking = false
  paperVp.releasePointerCapture(e.pointerId)

  if (!ptrMoved) return  // was a tap / click, not a swipe

  const dx = e.clientX - ptrStartX
  const dy = e.clientY - ptrStartY

  // Only flip if horizontal movement dominates and exceeds threshold
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_DX_MIN) {
    if (dx < 0) nextPage()   // finger moved left  → next page
    else        prevPage()   // finger moved right → previous page
  }
})

// Cancel gesture if pointer leaves the surface abnormally
paperVp.addEventListener('pointercancel', e => {
  if (ptrTracking) {
    ptrTracking = false
    paperVp.releasePointerCapture(e.pointerId)
  }
})

// ══════════════════════════════════════════════════════════
//  EVENTS
// ══════════════════════════════════════════════════════════

dirAdd.addEventListener('click', addChapter)
document.addEventListener('click', e => { if (!ctxMenu.contains(e.target)) hideCtx() })

// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════

async function init() {
  notebook = await window.api.getNotebook()
  if (!notebook?.chapters) {
    notebook = { version: 1, chapters: [{ id: uid('ch-'), title: '我的笔记', pages: [defaultPage()] }] }
  }
  applyDirZoom()
  applyPaperZoom()
  renderDir()
}

init()
