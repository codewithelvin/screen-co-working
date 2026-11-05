import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type AccessPoint, type Fingerprint, groupsOf, similarity, voicePlan } from '../src/proximity.ts';

const meetingRoom: AccessPoint[] = [
  { h: 'ap1', s: 90 },
  { h: 'ap2', s: 60 },
  { h: 'ap3', s: 30 },
];
const meetingRoomBit: AccessPoint[] = [
  { h: 'ap1', s: 85 },
  { h: 'ap2', s: 55 },
  { h: 'ap3', s: 35 },
];
const canteen: AccessPoint[] = [
  { h: 'ap7', s: 88 },
  { h: 'ap8', s: 50 },
  { h: 'ap3', s: 20 },
];

const opts = { now: 100_000, maxAgeMs: 90_000, threshold: 0.5 };
const fp = (aps: AccessPoint[], at = 99_000): Fingerprint => ({ aps, at });
const member = (identity: string, joinedAt: bigint, presenting = false) => ({ identity, joinedAt, presenting });

describe('similarity', () => {
  it('is 1 for identical fingerprints and high for the same room', () => {
    assert.equal(similarity(meetingRoom, meetingRoom), 1);
    assert.ok(similarity(meetingRoom, meetingRoomBit) > 0.85);
  });

  it('is low between the meeting room and the canteen', () => {
    assert.ok(similarity(meetingRoom, canteen) < 0.2);
  });

  it('is 0 when nothing is shared or a side is empty', () => {
    assert.equal(similarity(meetingRoom, [{ h: 'zzz', s: 50 }]), 0);
    assert.equal(similarity([], meetingRoom), 0);
    assert.equal(similarity([], []), 0);
  });
});

describe('groupsOf', () => {
  it('links people with similar fingerprints and leaves others alone', () => {
    const fps = new Map([
      ['a', fp(meetingRoom)],
      ['b', fp(meetingRoomBit)],
      ['c', fp(meetingRoom)],
      ['d', fp(canteen)],
    ]);
    const groups = groupsOf(['a', 'b', 'c', 'd'], fps, opts).map((g) => g.sort());
    assert.deepEqual(groups.sort((x, y) => y.length - x.length), [['a', 'b', 'c'], ['d']]);
  });

  it('ignores stale and missing fingerprints (wired PC, macOS, stopped reporting)', () => {
    const fps = new Map([
      ['a', fp(meetingRoom)],
      ['b', fp(meetingRoom, 1_000)], // 99 s old
      ['c', fp([])], // no Wi-Fi
    ]);
    assert.deepEqual(groupsOf(['a', 'b', 'c', 'd'], fps, opts), [['a']]);
  });
});

describe('voicePlan (D36, D38)', () => {
  const groups = [['a', 'b', 'c'], ['d']];

  it('a group of 3+ has one room mic and silent members; others are remote', () => {
    const plan = voicePlan([member('a', 1n), member('b', 2n), member('c', 3n), member('d', 4n)], groups, new Map());
    assert.equal(plan.get('a')?.role, 'room-mic'); // joined first
    assert.equal(plan.get('b')?.role, 'group');
    assert.equal(plan.get('c')?.role, 'group');
    assert.equal(plan.get('b')?.roomMic, 'a');
    assert.equal(plan.get('d')?.role, 'remote');
  });

  it('a pair side by side shares one mic (D36 amended: two live mics next to each other echo)', () => {
    const plan = voicePlan([member('a', 1n), member('b', 2n)], [['a', 'b']], new Map());
    assert.equal(plan.get('a')?.role, 'room-mic');
    assert.equal(plan.get('b')?.role, 'group');
  });

  it('someone alone may talk', () => {
    const plan = voicePlan([member('a', 1n), member('b', 2n)], [['a'], ['b']], new Map());
    assert.equal(plan.get('a')?.role, 'remote');
    assert.equal(plan.get('b')?.role, 'remote');
  });

  it('the presenter holds the room mic when in the group', () => {
    const plan = voicePlan([member('a', 1n), member('b', 2n, true), member('c', 3n)], groups, new Map());
    assert.equal(plan.get('b')?.role, 'room-mic');
    assert.equal(plan.get('a')?.role, 'group');
  });

  it('the latest claim wins when nobody in the group presents', () => {
    const claims = new Map([
      ['b', 10],
      ['c', 20],
    ]);
    const plan = voicePlan([member('a', 1n), member('b', 2n), member('c', 3n)], groups, claims);
    assert.equal(plan.get('c')?.role, 'room-mic');
  });

  it('people who left the call do not count towards a group', () => {
    const plan = voicePlan([member('a', 1n)], [['a', 'gone']], new Map());
    assert.equal(plan.get('a')?.role, 'remote');
  });
});
