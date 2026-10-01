const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

function defaultNotebook() {
  const now = new Date().toISOString()
  return {
    version: 1,
    chapters: [{
      id: 'ch-' + randomUUID(),
      title: '我的笔记',
      pages: [{ id: 'pg-' + randomUUID(), content: '', createdAt: now, updatedAt: now }]
    }]
  }
}

function validateNotebook(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.chapters) || !data.chapters.length) {
    throw new Error('笔记格式不受支持或缺少章节。')
  }
  const chapterIds = new Set()
  for (const chapter of data.chapters) {
    if (!chapter || typeof chapter.id !== 'string' || !chapter.id || chapterIds.has(chapter.id) ||
        typeof chapter.title !== 'string' || !Array.isArray(chapter.pages) || !chapter.pages.length) {
      throw new Error('笔记章节数据不完整。')
    }
    chapterIds.add(chapter.id)
    const pageIds = new Set()
    for (const page of chapter.pages) {
      if (!page || typeof page.id !== 'string' || !page.id || pageIds.has(page.id) ||
          typeof page.content !== 'string' ||
          (page.height !== undefined && (!Number.isFinite(page.height) || page.height <= 0))) {
        throw new Error('笔记纸页数据不完整。')
      }
      pageIds.add(page.id)
    }
  }
  return data
}

function parseNotebook(text) {
  return validateNotebook(JSON.parse(text))
}

// All reads and writes share one queue. A failed operation must not block a retry.
function createNotebookStore(dataPath, fileSystem = fs) {
  let queue = Promise.resolve()
  let loaded = false

  function enqueue(operation) {
    const result = queue.then(operation)
    queue = result.catch(() => {})
    return result
  }

  async function atomicWrite(target, contents) {
    await fileSystem.mkdir(path.dirname(target), { recursive: true })
    const temporaryPath = `${target}.${process.pid}.${randomUUID()}.tmp`
    let handle
    try {
      handle = await fileSystem.open(temporaryPath, 'wx')
      await handle.writeFile(contents, 'utf8')
      await handle.sync()
      await handle.close()
      handle = null
      // The existing file remains intact if writing, flushing, or renaming fails.
      await fileSystem.rename(temporaryPath, target)
    } finally {
      if (handle) await handle.close().catch(() => {})
      await fileSystem.rm(temporaryPath, { force: true }).catch(() => {})
    }
  }

  async function readExisting() {
    try {
      return await fileSystem.readFile(dataPath, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }

  return {
    read() {
      return enqueue(async () => {
        loaded = false
        try {
          const contents = await readExisting()
          let notebook
          if (contents === null) {
            // A missing primary file with an existing backup needs recovery, not a blank notebook.
            try {
              await fileSystem.access(dataPath + '.bak')
              throw new Error('笔记文件缺失，但已找到备份。请先从备份恢复笔记。')
            } catch (error) {
              if (error.code !== 'ENOENT') throw error
            }
            notebook = defaultNotebook()
            await atomicWrite(dataPath, JSON.stringify(notebook, null, 2))
          } else {
            notebook = parseNotebook(contents)
          }
          loaded = true
          return notebook
        } catch (error) {
          throw new Error(`无法读取笔记，原文件和备份均已保留。文件：${dataPath}。${error.message}`, { cause: error })
        }
      })
    },

    write(data) {
      // Capture this revision before joining the queue, so later edits cannot mutate it.
      let contents
      try {
        validateNotebook(data)
        contents = JSON.stringify(data, null, 2)
        parseNotebook(contents)
      } catch (error) {
        return Promise.reject(error)
      }
      return enqueue(async () => {
        if (!loaded) throw new Error('笔记尚未成功读取，已阻止保存以保护原文件。')
        const previous = await readExisting()
        if (previous !== null) {
          // Do not overwrite an externally damaged file or replace a useful backup with it.
          parseNotebook(previous)
          if (previous === contents) return true
          await atomicWrite(dataPath + '.bak', previous)
        }
        await atomicWrite(dataPath, contents)
        return true
      })
    }
  }
}

module.exports = { createNotebookStore, validateNotebook }
