;(function () {
  class CanvasCamera {
    constructor() {
      this.x = 0
      this.y = 0
      this.scale = 1
      this.minScale = 0.05
      this.maxScale = 6
    }

    pan(dx, dy) {
      if (Number.isFinite(dx)) this.x += dx
      if (Number.isFinite(dy)) this.y += dy
    }

    worldAt(x, y) {
      return { x: (x - this.x) / this.scale, y: (y - this.y) / this.scale }
    }

    zoomAt(scale, x, y) {
      if (!Number.isFinite(scale)) return
      // Keep the world point under the pointer fixed while the scale changes.
      const world = this.worldAt(x, y)
      this.scale = Math.max(this.minScale, Math.min(this.maxScale, scale))
      this.x = x - world.x * this.scale
      this.y = y - world.y * this.scale
    }

    fit(bounds, width, height, padding = 48) {
      const scale = Math.min(1, (width - padding * 2) / bounds.width, (height - padding * 2) / bounds.height)
      this.scale = Math.max(this.minScale, Math.min(this.maxScale, scale))
      this.x = width / 2 - (bounds.x + bounds.width / 2) * this.scale
      this.y = height / 2 - (bounds.y + bounds.height / 2) * this.scale
    }

    resize(oldWidth, oldHeight, width, height) {
      this.pan((width - oldWidth) / 2, (height - oldHeight) / 2)
    }

    get transform() {
      return `translate3d(${this.x}px, ${this.y}px, 0) scale(${this.scale})`
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { CanvasCamera }
  else globalThis.CanvasCamera = CanvasCamera
})()
