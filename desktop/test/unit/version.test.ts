import { describe, expect, it } from 'vitest';
import { isNewer } from '../../src/shared/version';

describe('isNewer', () => {
  it.each([
    ['0.1.1', '0.1.0', true],
    ['0.2.0', '0.1.9', true],
    ['1.0.0', '0.99.99', true],
    ['0.10.0', '0.9.0', true],
    ['0.1.0', '0.1.0', false],
    ['0.1.0', '0.1.1', false],
    ['1.0', '0.9.9', true],
    ['1.0', '1.0.0', false],
  ])('%s newer than %s → %s', (a, b, want) => {
    expect(isNewer(a, b)).toBe(want);
  });
});
