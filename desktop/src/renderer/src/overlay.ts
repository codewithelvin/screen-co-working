import { AnnoStore } from './annotations';
import './overlay.css';

/**
 * Presenter's overlay window: red border + "sharing" badge (D14) and viewers' pointers
 * and drawings on top of the real screen (D7). Plain DOM, no React needed.
 */
const store = new AnnoStore();
const canvas = document.getElementById('anno') as HTMLCanvasElement;
const badge = document.getElementById('badge')!;

window.scw.onOverlayInit(() => {
  badge.textContent = '● Ekranınız paylaşılır';
});
window.scw.onOverlayEvent((e) => {
  store.apply(e);
  if (e.msg.t === 'paused') {
    document.body.classList.toggle('paused', e.msg.v);
    badge.textContent = e.msg.v ? '❚❚ Paylaşım fasilədədir' : '● Ekranınız paylaşılır';
  }
});

function frame() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    store.draw(ctx, { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }, 1.2);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
