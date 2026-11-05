// Integration tests against a running stack (deploy/docker-compose). Skipped when SCW_API is unset.
// SCW_API=127.0.0.1:18080 node --test test/api.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const API = process.env.SCW_API;
const opts = { skip: API ? false : 'SCW_API not set' };

async function call(path: string, body?: unknown) {
  const res = await fetch(`http://${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

describe('room API', opts, () => {
  it('reports health', async () => {
    const r = await call('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
  });

  it('creates a private room: not listed, joinable with the code', async () => {
    const created = await call('/api/rooms', { title: 'API test' });
    assert.equal(created.status, 201);
    const code = created.data.code as string;
    assert.match(code, /^[A-Z2-9]{6}$/);

    const list = await fetch(`http://${API}/api/rooms`).then((r) => r.json() as Promise<{ code: string; title: string }[]>);
    assert.equal(list.length, 0);

    const join = await call('/api/join', { code: code.toLowerCase(), name: 'Tester', hostname: 'PC-1' });
    assert.equal(join.status, 200);
    assert.equal(join.data.displayName, 'Tester');
    assert.equal(join.data.title, 'API test');
    assert.equal(typeof join.data.token, 'string');
    assert.match(join.data.url as string, /^wss?:\/\//);
  });

  it('rejects bad input', async () => {
    assert.equal((await call('/api/rooms', {})).status, 400);
    assert.equal((await call('/api/join', { code: 'ZZZZZZ', name: 'x' })).status, 404);
    assert.equal((await call('/api/join', { code: 'ZZZZZZ' })).status, 400);
  });

  it('refuses host actions without the join secret', async () => {
    const { data } = await call('/api/rooms', { title: 'Auth test' });
    const join = await call('/api/join', { code: data.code, name: 'A' });
    const bad = await call(`/api/rooms/${data.code}/action`, { identity: join.data.identity, secret: 'wrong', action: 'end' });
    assert.equal(bad.status, 403);
    const otherRoom = await call(`/api/rooms/ZZZZZZ/present`, { identity: join.data.identity, secret: join.data.secret, on: true });
    assert.equal(otherRoom.status, 403);
  });

  it('does not serve files outside the updates folder', async () => {
    const res = await fetch(`http://${API}/updates/..%2f..%2fetc%2fpasswd`);
    assert.notEqual(res.status, 200);
  });
});
