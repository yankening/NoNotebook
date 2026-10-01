const test = require('node:test')
const assert = require('node:assert/strict')
const { CanvasCamera } = require('../canvas')
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`)

test('subpixel, diagonal, and consecutive pan streams all move the camera without a boundary', () => {
  const camera = new CanvasCamera()
  for (let i = 0; i < 1000; i++) camera.pan(-0.25, 0.125)
  camera.pan(-3000, -4000)
  camera.pan(50, 80)
  near(camera.x, -3200)
  near(camera.y, -3795)
  camera.pan(6400, 7590)
  near(camera.x, 3200)
  near(camera.y, 3795)
})

test('zooming keeps the same world point under a two-dimensional cursor anchor', () => {
  const camera = new CanvasCamera()
  camera.pan(-1200, 850)
  const world = camera.worldAt(210, 370)
  camera.zoomAt(2.4, 210, 370)
  near(camera.worldAt(210, 370).x, world.x)
  near(camera.worldAt(210, 370).y, world.y)
  camera.zoomAt(0.08, 210, 370)
  near(camera.worldAt(210, 370).x, world.x)
  near(camera.worldAt(210, 370).y, world.y)
})

test('zoom limits still preserve the anchor; pan remains in screen pixels at any zoom', () => {
  const camera = new CanvasCamera()
  const world = camera.worldAt(300, 240)
  camera.zoomAt(100, 300, 240)
  assert.equal(camera.scale, camera.maxScale)
  near(camera.worldAt(300, 240).x, world.x)
  camera.zoomAt(0.001, 300, 240)
  assert.equal(camera.scale, camera.minScale)
  near(camera.worldAt(300, 240).y, world.y)
  const x = camera.x
  const y = camera.y
  camera.pan(-25, 35)
  near(camera.x - x, -25)
  near(camera.y - y, 35)
})

test('window resize preserves the world point at the viewport center', () => {
  const camera = new CanvasCamera()
  camera.pan(-400, -800)
  camera.zoomAt(0.4, 150, 250)
  const world = camera.worldAt(600, 400)
  camera.resize(1200, 800, 900, 600)
  near(camera.worldAt(450, 300).x, world.x)
  near(camera.worldAt(450, 300).y, world.y)
})

test('overview fits a two-dimensional paper desktop into the viewport', () => {
  const camera = new CanvasCamera()
  const bounds = { x: 0, y: 0, width: 2352, height: 2016 }
  camera.fit(bounds, 1200, 800)
  assert.ok(camera.x >= 48 && camera.y >= 48)
  assert.ok(camera.x + bounds.width * camera.scale <= 1152)
  assert.ok(camera.y + bounds.height * camera.scale <= 752)
})
