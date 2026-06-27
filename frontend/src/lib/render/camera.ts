/**
 * Pan/zoom camera for the Canvas and WebGL boards (the SVG board has its own).
 * Framework-agnostic: a component constructs one, binds it to its container, and each
 * render reads `viewFor()` to get the world-space rectangle to draw. Pointer events
 * cover mouse drag + wheel zoom and touch drag + pinch zoom.
 */
import type { BoardView } from './boardRender';

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 8;

export class BoardCamera {
  cx = 0;
  cy = 0;
  zoom = 1;
  private initialized = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;

  /** Centre on the board the first time we know its bounds. */
  private ensureInit(bounds: BoardView) {
    if (this.initialized) return;
    this.cx = bounds.x + bounds.w / 2;
    this.cy = bounds.y + bounds.h / 2;
    this.zoom = 1;
    this.initialized = true;
  }

  /** Screen pixels per world unit at the current zoom (contain-fit at zoom 1). */
  private scale(bounds: BoardView, cssW: number, cssH: number): number {
    return Math.min(cssW / bounds.w, cssH / bounds.h) * this.zoom;
  }

  /** The world rectangle to render: matches the container aspect (so drawBoard's
   *  contain-fit fills it exactly), centred on the camera, sized by the zoom. */
  viewFor(bounds: BoardView, cssW: number, cssH: number): BoardView {
    this.ensureInit(bounds);
    const s = this.scale(bounds, cssW, cssH);
    const w = cssW / s;
    const h = cssH / s;
    return { x: this.cx - w / 2, y: this.cy - h / 2, w, h };
  }

  /** Attach pointer/wheel listeners to `el`. `getBounds`/`getSize` read the current
   *  board bounds + container size; `onChange` fires after any pan/zoom (so a
   *  change-driven renderer can repaint). Returns a cleanup function. */
  bind(
    el: HTMLElement,
    getBounds: () => BoardView,
    getSize: () => { w: number; h: number },
    onChange: () => void
  ): () => void {
    const onDown = (e: PointerEvent) => {
      el.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) this.pinchDist = this.twoDist();
    };
    const onMove = (e: PointerEvent) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      this.pointers.set(e.pointerId, cur);
      const s = this.scale(getBounds(), getSize().w, getSize().h);
      if (this.pointers.size === 1) {
        // drag-pan: move the world under the finger
        this.cx -= (cur.x - prev.x) / s;
        this.cy -= (cur.y - prev.y) / s;
        onChange();
      } else if (this.pointers.size === 2) {
        const d = this.twoDist();
        if (this.pinchDist > 0) this.applyZoom(d / this.pinchDist, this.twoMid(), el, getBounds, getSize);
        this.pinchDist = d;
        onChange();
      }
    };
    const onUp = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      el.releasePointerCapture?.(e.pointerId);
      if (this.pointers.size < 2) this.pinchDist = 0;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.applyZoom(Math.exp(-e.deltaY * 0.0015), { x: e.clientX, y: e.clientY }, el, getBounds, getSize);
      onChange();
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }

  /** Zoom by `factor` about a screen point, keeping the world point under it fixed. */
  private applyZoom(
    factor: number,
    screen: { x: number; y: number },
    el: HTMLElement,
    getBounds: () => BoardView,
    getSize: () => { w: number; h: number }
  ) {
    const bounds = getBounds();
    const { w: cssW, h: cssH } = getSize();
    const rect = el.getBoundingClientRect();
    const before = this.screenToWorld(screen.x - rect.left, screen.y - rect.top, bounds, cssW, cssH);
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    const after = this.screenToWorld(screen.x - rect.left, screen.y - rect.top, bounds, cssW, cssH);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }

  private screenToWorld(px: number, py: number, bounds: BoardView, cssW: number, cssH: number) {
    const v = this.viewFor(bounds, cssW, cssH);
    const s = this.scale(bounds, cssW, cssH);
    return { x: v.x + px / s, y: v.y + py / s };
  }

  private twoDist(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  private twoMid(): { x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}
