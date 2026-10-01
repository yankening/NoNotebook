const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

test('Electron interaction and close-save checks use an isolated notebook', { timeout: 60000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'no-notebook-test-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [path.join(__dirname, 'ui-fixture.cjs'), dir], {
    env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolve(code))
  })
  const timeout = setTimeout(() => child.kill(), 55000)
  t.after(async () => {
    clearTimeout(timeout)
    if (child.exitCode === null) { child.kill(); await completed.catch(() => {}) }
    const resolved = path.resolve(dir)
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()))
    assert.ok(path.basename(resolved).startsWith('no-notebook-test-'))
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })
  const code = await completed
  t.diagnostic(output.trim())
  assert.equal(code, 0, output)
  assert.match(output, /All 19 interaction checks passed/)
})
