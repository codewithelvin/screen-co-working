import { describe, expect, it } from 'vitest';
import { uniqueName } from '../../src/shared/names';

describe('uniqueName (P2P, D24)', () => {
  it('keeps a free name', () => {
    expect(uniqueName('Aysel', 'PC-1', ['Elvin'])).toBe('Aysel');
  });
  it('appends the computer name on a clash, ignoring case', () => {
    expect(uniqueName('ELVIN', 'CN-PR-222', ['Elvin'])).toBe('ELVIN (CN-PR-222)');
  });
  it('numbers repeated clashes', () => {
    expect(uniqueName('Elvin', 'PC', ['Elvin', 'Elvin (PC)'])).toBe('Elvin (PC 2)');
    expect(uniqueName('Elvin', '', ['Elvin', 'Elvin (2)'])).toBe('Elvin (3)');
  });
});
