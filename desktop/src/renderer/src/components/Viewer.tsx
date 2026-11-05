import { AimOutlined, ClearOutlined, EditOutlined, EyeOutlined, FullscreenOutlined, PauseCircleFilled } from '@ant-design/icons';
import { Button, Segmented, Tooltip, Typography } from 'antd';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { AnnoStore, type Rect } from '../annotations';
import type { Session, Snapshot } from '../session/Session';

type Tool = 'view' | 'pointer' | 'pen';

const POINTER_INTERVAL_MS = 33;
const STROKE_FLUSH_MS = 50;

/** Where the video frame actually sits inside the element (object-fit: contain). */
function contentRect(video: HTMLVideoElement): Rect {
  const w = video.clientWidth;
  const h = video.clientHeight;
  const vw = video.videoWidth || 16;
  const vh = video.videoHeight || 9;
  const scale = Math.min(w / vw, h / vh);
  const cw = vw * scale;
  const ch = vh * scale;
  return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch };
}

export function Viewer({ session, snap }: { session: Session; snap: Snapshot }) {
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const freeze = useRef<HTMLCanvasElement>(null);
  const store = useRef(new AnnoStore());
  const [tool, setTool] = useState<Tool>('pointer');
  const stroke = useRef<{ id: string; pending: [number, number][]; last: number } | null>(null);
  const lastPtr = useRef(0);
  const presenter = snap.people.find((p) => p.presenting);

  useEffect(() => {
    if (video.current && video.current.srcObject !== snap.remoteStream) video.current.srcObject = snap.remoteStream;
  }, [snap.remoteStream]);

  useEffect(() => session.onAnno((e) => store.current.apply(e)), [session]);

  // Keep the last frame on screen while the presenter has paused (D14).
  useEffect(() => {
    const v = video.current;
    const f = freeze.current;
    if (!v || !f) return;
    if (snap.paused && v.videoWidth) {
      f.width = v.videoWidth;
      f.height = v.videoHeight;
      f.getContext('2d')?.drawImage(v, 0, 0);
    }
  }, [snap.paused]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const c = canvas.current;
      const v = video.current;
      if (c && v) {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(c.clientWidth * dpr);
        const h = Math.round(c.clientHeight * dpr);
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
        }
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, c.clientWidth, c.clientHeight);
          store.current.draw(ctx, contentRect(v), 1);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toNorm = (ev: PointerEvent): [number, number] | null => {
    const v = video.current;
    if (!v) return null;
    const box = v.getBoundingClientRect();
    const r = contentRect(v);
    const x = (ev.clientX - box.left - r.x) / r.w;
    const y = (ev.clientY - box.top - r.y) / r.h;
    if (x < 0 || y < 0 || x > 1 || y > 1) return null;
    return [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000];
  };

  const flushStroke = (done = false) => {
    const s = stroke.current;
    if (!s || (s.pending.length === 0 && !done)) return;
    const msg = { t: 'stroke' as const, id: s.id, pts: s.pending, done };
    session.sendAnno(msg);
    store.current.apply({ from: snap.me, name: '', msg });
    s.pending = [];
    s.last = performance.now();
  };

  const onMove = (ev: PointerEvent) => {
    const pt = toNorm(ev);
    if (tool === 'pointer') {
      const now = performance.now();
      if (!pt) return;
      if (now - lastPtr.current < POINTER_INTERVAL_MS) return;
      lastPtr.current = now;
      session.sendAnno({ t: 'ptr', x: pt[0], y: pt[1] });
    } else if (tool === 'pen' && stroke.current && pt) {
      stroke.current.pending.push(pt);
      if (performance.now() - stroke.current.last > STROKE_FLUSH_MS) flushStroke();
    }
  };

  const onDown = (ev: PointerEvent) => {
    if (tool !== 'pen') return;
    const pt = toNorm(ev);
    if (!pt) return;
    (ev.target as Element).setPointerCapture(ev.pointerId);
    stroke.current = { id: crypto.randomUUID().slice(0, 8), pending: [pt], last: performance.now() };
  };

  const onUp = () => {
    if (tool !== 'pen' || !stroke.current) return;
    flushStroke(true);
    stroke.current = null;
  };

  const onLeave = () => {
    if (tool === 'pointer') session.sendAnno({ t: 'ptr-off' });
  };

  const clear = () => {
    const msg = { t: 'clear' as const };
    session.sendAnno(msg);
    store.current.apply({ from: snap.me, name: '', msg });
  };

  return (
    <div className="viewer" ref={wrap}>
      <div className="video-wrap">
        <video ref={video} autoPlay playsInline muted />
        <canvas ref={freeze} className={`freeze${snap.paused ? ' on' : ''}`} />
        <canvas
          ref={canvas}
          className={`anno tool-${tool}`}
          onPointerMove={onMove}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerLeave={onLeave}
        />
        {snap.paused && (
          <div className="paused-badge">
            <PauseCircleFilled /> Fasilə — {presenter?.name} paylaşımı dayandırıb
          </div>
        )}
      </div>
      <div className="toolbar">
        <Typography.Text type="secondary" className="toolbar-who">
          {presenter?.name} ekranını paylaşır
        </Typography.Text>
        <Segmented<Tool>
          value={tool}
          onChange={(v) => {
            if (tool === 'pointer') session.sendAnno({ t: 'ptr-off' });
            setTool(v);
          }}
          options={[
            { value: 'view', icon: <EyeOutlined />, label: 'Yalnız bax' },
            { value: 'pointer', icon: <AimOutlined />, label: 'Göstərici' },
            { value: 'pen', icon: <EditOutlined />, label: 'Qələm' },
          ]}
        />
        <Tooltip title="Öz qeydlərimi sil">
          <Button icon={<ClearOutlined />} onClick={clear} />
        </Tooltip>
        <Tooltip title="Tam ekran">
          <Button icon={<FullscreenOutlined />} onClick={() => void wrap.current?.requestFullscreen()} />
        </Tooltip>
      </div>
    </div>
  );
}
