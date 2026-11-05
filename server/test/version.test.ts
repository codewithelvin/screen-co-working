import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isNewer, mustUpdate } from '../src/version.ts';

test('isNewer compares numerically, missing parts are 0', () => {
  assert.equal(isNewer('0.10.0', '0.9.9'), true);
  assert.equal(isNewer('1.0', '1.0.0'), false);
  assert.equal(isNewer('0.2.1', '0.2.1'), false);
  assert.equal(isNewer('0.2.0', '0.2.1'), false);
});

test('no minimum set: every app may join', () => {
  assert.equal(mustUpdate(undefined, ''), false);
  assert.equal(mustUpdate('0.0.1', ''), false);
});

test('below the minimum must update; equal or above may join', () => {
  assert.equal(mustUpdate('0.2.0', '0.2.1'), true);
  assert.equal(mustUpdate('0.2.1', '0.2.1'), false);
  assert.equal(mustUpdate('0.3.0', '0.2.1'), false);
});

test('an app that sends no or a garbled version predates the rule and must update', () => {
  assert.equal(mustUpdate(undefined, '0.2.1'), true);
  assert.equal(mustUpdate('', '0.2.1'), true);
  assert.equal(mustUpdate('dev', '0.2.1'), true);
  assert.equal(mustUpdate(7, '0.2.1'), true);
});
