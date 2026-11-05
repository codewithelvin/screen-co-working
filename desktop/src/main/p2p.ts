import dgram from 'node:dgram';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, type WebSocket } from 'ws';
import type { LocalSession, SignalMsg } from '../shared/types';

/**
 * No-server LAN mode (D10/D27). The presenter's app runs a small WebSocket server for
 * WebRTC signalling and announces itself by UDP broadcast; viewers listen for the
 * announcements and connect straight to the presenter. Media then flows peer-to-peer.
 */
export const DISCOVERY_PORT = 41234;
export const MAX_P2P_VIEWERS = 5;
const ANNOUNCE_EVERY_MS = 2000;
const FORGET_AFTER_MS = 7000;

interface Announcement {
  app: 'scw';
  v: 1;
  id: string;
  title: string;
  presenter: string;
  port: number;
  viewers: number;
}

// ---------- presenter side ----------

let wss: WebSocketServer | null = null;
let announceTimer: NodeJS.Timeout | null = null;
let announceSocket: dgram.Socket | null = null;
const peers = new Map<string, WebSocket>();

function broadcastAddresses(): string[] {
  const out = new Set<string>(['255.255.255.255']);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      out.add(ip.map((o, i) => (o & mask[i]) | (~mask[i] & 255)).join('.'));
    }
  }
  return [...out];
}

export async function hostStart(
  title: string,
  presenter: string,
  onMessage: (peerId: string, msg: SignalMsg) => void,
  onClose: (peerId: string) => void,
): Promise<void> {
  await hostStop();
  const id = randomUUID();
  wss = new WebSocketServer({ port: 0, maxPayload: 256 * 1024 });
  await new Promise<void>((resolve) => wss!.once('listening', () => resolve()));
  const port = (wss.address() as { port: number }).port;

  wss.on('connection', (ws) => {
    if (peers.size >= MAX_P2P_VIEWERS) {
      ws.send(JSON.stringify({ t: 'full' } satisfies SignalMsg));
      ws.close();
      return;
    }
    const peerId = randomUUID();
    peers.set(peerId, ws);
    ws.on('message', (data) => {
      try {
        onMessage(peerId, JSON.parse(String(data)) as SignalMsg);
      } catch {
        // ignore malformed frames
      }
    });
    ws.on('close', () => {
      peers.delete(peerId);
      onClose(peerId);
    });
  });

  announceSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  await new Promise<void>((resolve) => announceSocket!.bind(0, () => resolve()));
  announceSocket.setBroadcast(true);
  const announce = () => {
    const msg: Announcement = { app: 'scw', v: 1, id, title, presenter, port, viewers: peers.size };
    const buf = Buffer.from(JSON.stringify(msg));
    for (const addr of broadcastAddresses()) announceSocket?.send(buf, DISCOVERY_PORT, addr);
  };
  announce();
  announceTimer = setInterval(announce, ANNOUNCE_EVERY_MS);
}

export function hostSend(peerId: string, msg: SignalMsg): void {
  peers.get(peerId)?.send(JSON.stringify(msg));
}

export function hostKick(peerId: string): void {
  const ws = peers.get(peerId);
  if (!ws) return;
  ws.send(JSON.stringify({ t: 'kicked' } satisfies SignalMsg));
  ws.close();
}

export async function hostStop(): Promise<void> {
  if (announceTimer) clearInterval(announceTimer);
  announceTimer = null;
  announceSocket?.close();
  announceSocket = null;
  for (const ws of peers.values()) {
    ws.send(JSON.stringify({ t: 'ended' } satisfies SignalMsg));
    ws.close();
  }
  peers.clear();
  if (wss) await new Promise<void>((resolve) => wss!.close(() => resolve()));
  wss = null;
}

// ---------- viewer side ----------

const sessions = new Map<string, LocalSession & { seen: number }>();
let listener: dgram.Socket | null = null;

export function startDiscovery(): void {
  if (listener) return;
  listener = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  listener.on('message', (buf, rinfo) => {
    try {
      const a = JSON.parse(String(buf)) as Announcement;
      if (a.app !== 'scw' || a.v !== 1) return;
      sessions.set(a.id, {
        id: a.id,
        title: a.title,
        presenter: a.presenter,
        address: rinfo.address,
        port: a.port,
        viewers: a.viewers,
        seen: Date.now(),
      });
    } catch {
      // not ours
    }
  });
  listener.on('error', () => {
    listener?.close();
    listener = null;
  });
  listener.bind(DISCOVERY_PORT);
}

export function localSessions(): LocalSession[] {
  const now = Date.now();
  const out: LocalSession[] = [];
  for (const [id, s] of sessions) {
    if (now - s.seen > FORGET_AFTER_MS) sessions.delete(id);
    else out.push({ id: s.id, title: s.title, presenter: s.presenter, address: s.address, port: s.port, viewers: s.viewers });
  }
  return out;
}
