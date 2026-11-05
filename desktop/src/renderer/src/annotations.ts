import type { AnnoEvent } from '../../shared/types';

/**
 * Pointers and pen strokes from viewers (D7), shared by the viewer stage and the
 * presenter's overlay. Coordinates are 0..1 of the shared screen; strokes fade out.
 */
const POINTER_TTL = 4000;
const STROKE_TTL = 6000;
const FADE = 1500;

const PALETTE = ['#ff4d4f', '#40a9ff', '#73d13d', '#ffc53d', '#b37feb', '#ff85c0', '#36cfc9', '#ff9c6e'];

export function colorFor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

interface Pointer {
  name: string;
  x: number;
  y: number;
  ts: number;
}

interface Stroke {
  from: string;
  pts: [number, number][];
  ts: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class AnnoStore {
  private pointers = new Map<string, Pointer>();
  private strokes = new Map<string, Stroke>();

  apply(e: AnnoEvent): void {
    const now = performance.now();
    const m = e.msg;
    switch (m.t) {
      case 'ptr':
        this.pointers.set(e.from, { name: e.name, x: m.x, y: m.y, ts: now });
        break;
      case 'ptr-off':
        this.pointers.delete(e.from);
        break;
      case 'stroke': {
        const key = `${e.from}:${m.id}`;
        const s = this.strokes.get(key);
        if (s) {
          s.pts.push(...m.pts);
          s.ts = now;
        } else {
          this.strokes.set(key, { from: e.from, pts: [...m.pts], ts: now });
        }
        break;
      }
      case 'clear':
        for (const [k, s] of this.strokes) if (m.all || s.from === e.from) this.strokes.delete(k);
        break;
      default:
        break;
    }
  }

  draw(ctx: CanvasRenderingContext2D, r: Rect, scale = 1): void {
    const now = performance.now();
    const alpha = (ts: number, ttl: number) => Math.max(0, Math.min(1, (ttl - (now - ts)) / FADE));

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [k, s] of this.strokes) {
      const a = alpha(s.ts, STROKE_TTL);
      if (a <= 0) {
        this.strokes.delete(k);
        continue;
      }
      ctx.globalAlpha = a;
      ctx.strokeStyle = colorFor(s.from);
      ctx.lineWidth = 4 * scale;
      ctx.beginPath();
      s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(r.x + x * r.w, r.y + y * r.h) : ctx.moveTo(r.x + x * r.w, r.y + y * r.h)));
      ctx.stroke();
    }

    ctx.font = `${12 * scale}px "Segoe UI", system-ui, sans-serif`;
    for (const [id, p] of this.pointers) {
      const a = alpha(p.ts, POINTER_TTL);
      if (a <= 0) {
        this.pointers.delete(id);
        continue;
      }
      const x = r.x + p.x * r.w;
      const y = r.y + p.y * r.h;
      const color = colorFor(id);
      ctx.globalAlpha = a;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 7 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 * scale;
      ctx.stroke();
      const w = ctx.measureText(p.name).width + 10 * scale;
      ctx.fillRect(x + 10 * scale, y + 8 * scale, w, 18 * scale);
      ctx.fillStyle = '#fff';
      ctx.fillText(p.name, x + 15 * scale, y + 21 * scale);
    }
    ctx.globalAlpha = 1;
  }
}
