const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createNotebookStore } = require('../storage')

async function fixture(t, fileSystem) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'no-notebook-test-'))
  const file = path.join(dir, 'notebook.json')
  t.after(async () => {
    const resolved = path.resolve(dir)
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()))
    assert.ok(path.basename(resolved).startsWith('no-notebook-test-'))
    await fs.rm(resolved, { recursive: true, force: true })
  })
  return { dir, file, store: createNotebookStore(file, fileSystem) }
}

test('first run creates a valid notebook; later reads retain text and page height', async t => {
  const { file, store } = await fixture(t)
  const notebook = await store.read()
  notebook.chapters[0].pages[0].content = '中文正文\n第二行'
  notebook.chapters[0].pages[0].height = 1280
  notebook.chapters[0].pages[0].customField = 'preserved'
  assert.equal(await store.write(notebook), true)
  const restored = await createNotebookStore(file).read()
  assert.deepEqual(restored, notebook)
})

test('queued saves capture each revision and keep the previous good revision as backup', async t => {
  const { file, store } = await fixture(t)
  const notebook = await store.read()
  notebook.chapters[0].pages[0].content = 'first'
  const first = store.write(notebook)
  notebook.chapters[0].pages[0].content = 'second'
  const second = store.write(notebook)
  await Promise.all([first, second])
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).chapters[0].pages[0].content, 'second')
  assert.equal(JSON.parse(await fs.readFile(file + '.bak', 'utf8')).chapters[0].pages[0].content, 'first')
})

test('failed atomic replacement retains the original file and a retry succeeds', async t => {
  let rejectPrimaryRename = false
  let primaryFile
  const fakeFs = { ...fs, rename: async (from, to) => {
    if (rejectPrimaryRename && to === primaryFile) throw Object.assign(new Error('disk failure'), { code: 'EIO' })
    return fs.rename(from, to)
  } }
  const { dir, file, store } = await fixture(t, fakeFs)
  primaryFile = file
  const notebook = await store.read()
  const original = await fs.readFile(file, 'utf8')
  notebook.chapters[0].pages[0].content = 'new text'
  rejectPrimaryRename = true
  await assert.rejects(store.write(notebook), /disk failure/)
  assert.equal(await fs.readFile(file, 'utf8'), original)
  assert.equal(await fs.readFile(file + '.bak', 'utf8'), original)
  assert.ok(!(await fs.readdir(dir)).some(name => name.endsWith('.tmp')))
  rejectPrimaryRename = false
  assert.equal(await store.write(notebook), true)
})

test('a corrupt notebook is never replaced with a blank notebook', async t => {
  const { file, store } = await fixture(t)
  await fs.writeFile(file, '{broken json', 'utf8')
  await assert.rejects(store.read(), /无法读取笔记/)
  const valid = { version: 1, chapters: [{ id: 'ch', title: '', pages: [{ id: 'pg', content: 'replacement' }] }] }
  await assert.rejects(store.write(valid), /尚未成功读取/)
  assert.equal(await fs.readFile(file, 'utf8'), '{broken json')
})

test('missing primary file with a backup requests recovery without creating blank data', async t => {
  const { file, store } = await fixture(t)
  await fs.writeFile(file + '.bak', 'backup contents', 'utf8')
  await assert.rejects(store.read(), /已找到备份/)
  await assert.rejects(fs.access(file), { code: 'ENOENT' })
  assert.equal(await fs.readFile(file + '.bak', 'utf8'), 'backup contents')
})

test('external file damage blocks a save and preserves the backup', async t => {
  const { file, store } = await fixture(t)
  const notebook = await store.read()
  notebook.chapters[0].pages[0].content = 'saved'
  await store.write(notebook)
  const backup = await fs.readFile(file + '.bak', 'utf8')
  await fs.writeFile(file, 'corrupted externally', 'utf8')
  notebook.chapters[0].pages[0].content = 'unsaved'
  await assert.rejects(store.write(notebook))
  assert.equal(await fs.readFile(file, 'utf8'), 'corrupted externally')
  assert.equal(await fs.readFile(file + '.bak', 'utf8'), backup)
})

test('unsupported schemas and invalid page heights cannot replace a valid notebook', async t => {
  const { file, store } = await fixture(t)
  const notebook = await store.read()
  const original = await fs.readFile(file, 'utf8')
  await assert.rejects(store.write({ version: 2, chapters: [] }))
  notebook.chapters[0].pages[0].height = NaN
  await assert.rejects(store.write(notebook))
  assert.equal(await fs.readFile(file, 'utf8'), original)
})
