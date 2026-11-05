/** Client for the room API on the LAN server. */

import type { WifiScan } from '../../shared/types';

export interface JoinInfo {
  token: string;
  url: string;
  identity: string;
  secret: string;
  displayName: string;
  title: string;
}

export class ApiError extends Error {
  /** The server refused this app version (HTTP 426); it must update first. */
  updateRequired = false;
}

const MESSAGES: Record<string, string> = {
  'room not found': 'Otaq tapılmadı. Kodu yoxlayın.',
  'room is full': 'Otaq doludur (50 nəfər).',
  'only the host can do this': 'Bunu yalnız otağın sahibi edə bilər.',
  'not authorised': 'İcazə yoxdur.',
  'relay server unavailable': 'Media server cavab vermir.',
  'update required': 'Proqramın yeni versiyası tələb olunur.',
  'too many attempts': 'Çox sayda yanlış kod. Bir dəqiqə sonra yenidən cəhd edin.',
};

function base(server: string): string {
  return `http://${server.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
}

async function call<T>(server: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(base(server) + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    throw new ApiError('Serverə qoşulmaq olmur.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    const err = data.error ?? `HTTP ${res.status}`;
    const presenting = / is already presenting$/.exec(err);
    const error = new ApiError(presenting ? `${err.replace(/ is already presenting$/, '')} artıq ekranını paylaşır.` : (MESSAGES[err] ?? err));
    error.updateRequired = res.status === 426;
    throw error;
  }
  return data as T;
}

export const api = {
  health: (server: string) => call<{ ok: boolean }>(server, '/api/health'),
  createRoom: (server: string, title: string) => call<{ code: string; title: string }>(server, '/api/rooms', { title }),
  join: (server: string, code: string, name: string, hostname: string) =>
    call<JoinInfo>(server, '/api/join', { code, name, hostname, version: window.scw.version }),
  present: (server: string, code: string, j: JoinInfo, on: boolean) =>
    call(server, `/api/rooms/${code}/present`, { identity: j.identity, secret: j.secret, on }),
  presence: (server: string, code: string, j: JoinInfo, scan: WifiScan) =>
    call(server, `/api/rooms/${code}/presence`, { identity: j.identity, secret: j.secret, aps: scan.aps, wifi: scan.status }),
  takeRoomMic: (server: string, code: string, j: JoinInfo) =>
    call(server, `/api/rooms/${code}/room-mic`, { identity: j.identity, secret: j.secret }),
  action: (server: string, code: string, j: JoinInfo, action: string, target?: string) =>
    call(server, `/api/rooms/${code}/action`, { identity: j.identity, secret: j.secret, action, target }),
};
