import { describe, expect, it } from 'vitest';
import { suggestName } from '../../src/shared/names-suggest';

describe('suggestName', () => {
  it.each([
    ['elvin.huseynov', 'PC-1', 'Elvin Huseynov'],
    [String.raw`CYBER\aysel_mammadova`, 'PC-1', 'Aysel Mammadova'],
    ['İLKİN', 'PC-1', 'İlkin'],
    ['user', 'PC-1', 'User'],
    ['12345', 'CN-PR-222', 'CN-PR-222'],
    ['', 'CN-PR-222', 'CN-PR-222'],
  ])('%s on %s → %s', (login, host, want) => {
    expect(suggestName(login, host)).toBe(want);
  });
});
