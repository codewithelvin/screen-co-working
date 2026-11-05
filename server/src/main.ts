import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { join as joinPath, normalize, extname } from 'node:path';
import { AccessToken, RoomServiceClient, DataPacket_Kind, TrackSource, TrackType, type ParticipantInfo } from 'livekit-server-sdk';
import { config } from './config.ts';
import { hostOf, newCode, roomTitle, sameSecret, uniqueName } from './rooms.ts';

const rooms = new RoomServiceClient(config.livekitInternalUrl, config.apiKey, config.apiSecret);

/** identity -> per-join secret, proves who is calling a host action. */
const secrets = new Map<string, { secret: string; room: string }>();
/** room code -> identity of the current presenter. */
const presenters = new Map<string, string>();

const MAX_PARTICIPANTS = 50;

/** Our rooms in LiveKit are `<prefix><code>`, so a LiveKit shared with another app (QueryDesk) stays separate. */
const lk = (code: string) => config.roomPrefix + code;

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64 * 1024) throw new HttpError(413, 'body too large');
  }
  if (!body) return {};
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

function str(v: unknown, field: string, max = 80): string {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${field} is required`);
  return v.trim().slice(0, max);
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(data));
}

function isPresenting(p: ParticipantInfo): boolean {
  return p.tracks.some((t) => t.source === TrackSource.SCREEN_SHARE && t.type === TrackType.VIDEO);
}

async function participantsOf(code: string): Promise<ParticipantInfo[]> {
  try {
    return await rooms.listParticipants(lk(code));
  } catch {
    return [];
  }
}

/** Presenter lock is released once that person left or stopped sharing. */
function currentPresenter(code: string, participants: ParticipantInfo[]): string | undefined {
  const id = presenters.get(code);
  if (!id) return undefined;
  const p = participants.find((x) => x.identity === id);
  if (!p) {
    presenters.delete(code);
    return undefined;
  }
  return id;
}

async function listRooms() {
  const list = (await rooms.listRooms()).filter((r) => r.name.startsWith(config.roomPrefix));
  const result = [];
  for (const r of list) {
    const code = r.name.slice(config.roomPrefix.length);
    const participants = await participantsOf(code);
    const host = hostOf(participants);
    const presenter = currentPresenter(code, participants);
    result.push({
      code,
      title: roomTitle(r.metadata, code),
      createdAt: Number(r.creationTime) * 1000,
      participants: participants.map((p) => ({
        identity: p.identity,
        name: p.name,
        host: p.identity === host?.identity,
        presenting: p.identity === presenter || isPresenting(p),
      })),
    });
  }
  return result.sort((a, b) => b.createdAt - a.createdAt);
}

async function createRoom(body: Record<string, unknown>) {
  const title = str(body.title, 'title', 60);
  const code = newCode();
  await rooms.createRoom({
    name: lk(code),
    emptyTimeout: 120,
    departureTimeout: 20,
    maxParticipants: MAX_PARTICIPANTS,
    metadata: JSON.stringify({ title }),
  });
  return { code, title };
}

async function join(body: Record<string, unknown>, req: IncomingMessage) {
  const code = str(body.code, 'code', 12).toUpperCase();
  const name = str(body.name, 'name', 40);
  const hostname = typeof body.hostname === 'string' ? body.hostname.trim().slice(0, 40) : '';

  const existing = await rooms.listRooms([lk(code)]);
  if (existing.length === 0) throw new HttpError(404, 'room not found');
  const participants = await participantsOf(code);
  if (participants.length >= MAX_PARTICIPANTS) throw new HttpError(409, 'room is full');

  // D24: same display name already present -> append the computer name.
  const displayName = uniqueName(name, hostname, participants.map((p) => p.name));

  const identity = randomUUID();
  const secret = randomBytes(24).toString('base64url');
  secrets.set(identity, { secret, room: code });

  const at = new AccessToken(config.apiKey, config.apiSecret, { identity, name: displayName, ttl: '12h' });
  at.addGrant({
    room: lk(code),
    roomJoin: true,
    canSubscribe: true,
    canPublish: true,
    canPublishData: true,
    canPublishSources: [TrackSource.SCREEN_SHARE],
  });

  return {
    token: await at.toJwt(),
    url: config.livekitPublicUrl || `ws://${(req.headers.host || 'localhost').split(':')[0]}:7880`,
    identity,
    secret,
    displayName,
    title: roomTitle(existing[0].metadata, code),
  };
}

function authenticate(code: string, body: Record<string, unknown>): string {
  const identity = str(body.identity, 'identity');
  const secret = str(body.secret, 'secret', 200);
  const known = secrets.get(identity);
  const ok = known !== undefined && known.room === code && sameSecret(known.secret, secret);
  if (!ok) throw new HttpError(403, 'not authorised');
  return identity;
}

/** One presenter at a time (D6). */
async function present(code: string, body: Record<string, unknown>) {
  const identity = authenticate(code, body);
  const participants = await participantsOf(code);
  const current = currentPresenter(code, participants);
  if (body.on === false) {
    if (current === identity) presenters.delete(code);
    return { ok: true };
  }
  if (current && current !== identity) {
    const p = participants.find((x) => x.identity === current);
    throw new HttpError(409, `${p?.name ?? 'Someone'} is already presenting`);
  }
  presenters.set(code, identity);
  return { ok: true };
}

const encoder = new TextEncoder();

/** Host-only actions (D15). */
async function hostAction(code: string, body: Record<string, unknown>) {
  const identity = authenticate(code, body);
  const participants = await participantsOf(code);
  if (hostOf(participants)?.identity !== identity) throw new HttpError(403, 'only the host can do this');
  const action = str(body.action, 'action');

  if (action === 'end') {
    await rooms.deleteRoom(lk(code));
    presenters.delete(code);
    return { ok: true };
  }
  const target = participants.find((p) => p.identity === body.target);
  if (!target) throw new HttpError(404, 'participant not found');

  if (action === 'kick') {
    await rooms.removeParticipant(lk(code), target.identity);
    secrets.delete(target.identity);
    if (presenters.get(code) === target.identity) presenters.delete(code);
    return { ok: true };
  }
  if (action === 'stopShare') {
    await rooms.sendData(lk(code), encoder.encode(JSON.stringify({ t: 'stop-share' })), DataPacket_Kind.RELIABLE, {
      destinationIdentities: [target.identity],
    });
    for (const t of target.tracks) {
      if (t.source === TrackSource.SCREEN_SHARE) await rooms.mutePublishedTrack(lk(code), target.identity, t.sid, true);
    }
    presenters.delete(code);
    return { ok: true };
  }
  throw new HttpError(400, 'unknown action');
}

const MIME: Record<string, string> = {
  '.yml': 'text/yaml',
  '.exe': 'application/octet-stream',
  '.blockmap': 'application/octet-stream',
  '.dmg': 'application/octet-stream',
  '.zip': 'application/zip',
  '.AppImage': 'application/octet-stream',
};

/** Static files for electron-updater's generic provider (D19). */
function serveUpdate(path: string, res: ServerResponse): void {
  const rel = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '');
  if (rel.startsWith('..')) return send(res, 400, { error: 'bad path' });
  const file = joinPath(config.updatesDir, rel);
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'content-length': st.size });
    createReadStream(file).pipe(res);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const path = url.pathname;
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST',
        'access-control-allow-headers': 'content-type',
      });
      return res.end();
    }
    if (req.method === 'GET' && path === '/api/health') return send(res, 200, { ok: true, app: 'screen-co-working' });
    if (req.method === 'GET' && path === '/api/rooms') return send(res, 200, await listRooms());
    if (req.method === 'POST' && path === '/api/rooms') return send(res, 201, await createRoom(await readJson(req)));
    if (req.method === 'POST' && path === '/api/join') return send(res, 200, await join(await readJson(req), req));

    const m = /^\/api\/rooms\/([A-Z0-9]{4,12})\/(present|action)$/.exec(path);
    if (req.method === 'POST' && m) {
      const body = await readJson(req);
      return send(res, 200, m[2] === 'present' ? await present(m[1], body) : await hostAction(m[1], body));
    }
    if (req.method === 'GET' && path.startsWith('/updates/')) return serveUpdate(path.slice('/updates/'.length), res);
    send(res, 404, { error: 'not found' });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 502, { error: 'relay server unavailable' });
  }
});

server.listen(config.port, () => {
  console.log(`screen-co-working api on :${config.port}, livekit ${config.livekitInternalUrl}`);
});
