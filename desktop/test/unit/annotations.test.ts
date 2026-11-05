import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnnoStore, colorFor } from '../../src/renderer/src/annotations';

/** Records what the store draws, enough to count pointers and strokes. */
function fakeCtx() {
  const calls = { arcs: [] as [number, number][], strokes: 0, labels: [] as string[], moves: [] as [number, number][] };
  const ctx = {
    lineCap: '',
    lineJoin: '',
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    font: '',
    beginPath() {},
    moveTo(x: number, y: number) {
      calls.moves.push([x, y]);
    },
    lineTo() {},
    stroke() {
      calls.strokes++;
    },
    arc(x: number, y: number) {
      calls.arcs.push([x, y]);
    },
    fill() {},
    fillRect() {},
    measureText: (t: string) => ({ width: t.length * 6 }),
    fillText(t: string) {
      calls.labels.push(t);
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const rect = { x: 100, y: 50, w: 1000, h: 500 };
let now = 0;
vi.spyOn(performance, 'now').mockImplementation(() => now);

afterEach(() => {
  now = 0;
});

describe('AnnoStore', () => {
  it('draws a pointer at the normalised position inside the rect, with the name', () => {
    const s = new AnnoStore();
    s.apply({ from: 'a', name: 'Aysel', msg: { t: 'ptr', x: 0.5, y: 0.2 } });
    const { ctx, calls } = fakeCtx();
    s.draw(ctx, rect);
    expect(calls.arcs).toEqual([[600, 150]]);
    expect(calls.labels).toEqual(['Aysel']);
  });

  it('removes a pointer on ptr-off', () => {
    const s = new AnnoStore();
    s.apply({ from: 'a', name: 'Aysel', msg: { t: 'ptr', x: 0.5, y: 0.5 } });
    s.apply({ from: 'a', name: 'Aysel', msg: { t: 'ptr-off' } });
    const { ctx, calls } = fakeCtx();
    s.draw(ctx, rect);
    expect(calls.arcs).toHaveLength(0);
  });

  it('joins stroke chunks with the same id into one line', () => {
    const s = new AnnoStore();
    s.apply({ from: 'a', name: 'A', msg: { t: 'stroke', id: 's1', pts: [[0, 0], [0.1, 0.1]] } });
    s.apply({ from: 'a', name: 'A', msg: { t: 'stroke', id: 's1', pts: [[0.2, 0.2]], done: true } });
    s.apply({ from: 'b', name: 'B', msg: { t: 'stroke', id: 's1', pts: [[0.5, 0.5]] } });
    const { ctx, calls } = fakeCtx();
    s.draw(ctx, rect);
    expect(calls.strokes).toBe(2); // a:s1 and b:s1 are different strokes
    expect(calls.moves[0]).toEqual([100, 50]);
  });

  it('clear removes only the sender’s strokes, clear-all removes everyone’s', () => {
    const s = new AnnoStore();
    s.apply({ from: 'a', name: 'A', msg: { t: 'stroke', id: '1', pts: [[0, 0]] } });
    s.apply({ from: 'b', name: 'B', msg: { t: 'stroke', id: '1', pts: [[0, 0]] } });
    s.apply({ from: 'a', name: 'A', msg: { t: 'clear' } });
    let f = fakeCtx();
    s.draw(f.ctx, rect);
    expect(f.calls.strokes).toBe(1);
    s.apply({ from: 'host', name: 'H', msg: { t: 'clear', all: true } });
    f = fakeCtx();
    s.draw(f.ctx, rect);
    expect(f.calls.strokes).toBe(0);
  });

  it('fades pointers and strokes out over time', () => {
    const s = new AnnoStore();
    s.apply({ from: 'a', name: 'A', msg: { t: 'ptr', x: 0.1, y: 0.1 } });
    s.apply({ from: 'a', name: 'A', msg: { t: 'stroke', id: '1', pts: [[0, 0]] } });
    now = 4500; // pointer TTL 4 s has passed, stroke TTL 6 s has not
    let f = fakeCtx();
    s.draw(f.ctx, rect);
    expect(f.calls.arcs).toHaveLength(0);
    expect(f.calls.strokes).toBe(1);
    now = 6500;
    f = fakeCtx();
    s.draw(f.ctx, rect);
    expect(f.calls.strokes).toBe(0);
  });

  it('ignores control messages', () => {
    const s = new AnnoStore();
    s.apply({ from: 'p', name: 'P', msg: { t: 'paused', v: true } });
    const { ctx, calls } = fakeCtx();
    s.draw(ctx, rect);
    expect(calls.arcs).toHaveLength(0);
    expect(calls.strokes).toBe(0);
  });
});

describe('colorFor', () => {
  it('is stable per participant', () => {
    expect(colorFor('abc')).toBe(colorFor('abc'));
    expect(colorFor('abc')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
