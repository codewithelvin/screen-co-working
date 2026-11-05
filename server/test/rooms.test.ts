import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CODE_ALPHABET, hostOf, newCode, roomTitle, sameSecret, uniqueName } from '../src/rooms.ts';

describe('newCode', () => {
  it('is 6 characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = newCode();
      assert.match(code, /^[A-Z2-9]{6}$/);
      for (const ch of code) assert.ok(CODE_ALPHABET.includes(ch), ch);
      assert.doesNotMatch(code, /[IO01]/);
    }
  });

  it('maps bytes deterministically', () => {
    assert.equal(newCode(new Uint8Array([0, 1, 2, 31, 32, 255])), 'ABC9A9');
  });
});

describe('hostOf (D16)', () => {
  it('picks whoever joined first', () => {
    const people = [
      { name: 'b', joinedAt: 20n },
      { name: 'a', joinedAt: 10n },
      { name: 'c', joinedAt: 30n },
    ];
    assert.equal(hostOf(people)?.name, 'a');
  });

  it('hands over to the next longest-present person when the host leaves', () => {
    const people = [
      { name: 'b', joinedAt: 20n },
      { name: 'c', joinedAt: 30n },
    ];
    assert.equal(hostOf(people)?.name, 'b');
  });

  it('returns undefined for an empty room', () => {
    assert.equal(hostOf([]), undefined);
  });
});

describe('uniqueName (D24)', () => {
  it('keeps a free name unchanged', () => {
    assert.equal(uniqueName('Aysel', 'PC-1', ['Elvin']), 'Aysel');
  });

  it('appends the computer name on a clash, ignoring case', () => {
    assert.equal(uniqueName('Elvin', 'PC-042', ['elvin']), 'Elvin (PC-042)');
  });

  it('numbers further clashes from the same computer name', () => {
    assert.equal(uniqueName('Elvin', 'PC-042', ['Elvin', 'Elvin (PC-042)']), 'Elvin (PC-042 2)');
    assert.equal(uniqueName('Elvin', 'PC-042', ['Elvin', 'Elvin (PC-042)', 'Elvin (PC-042 2)']), 'Elvin (PC-042 3)');
  });

  it('falls back to numbers without a computer name', () => {
    assert.equal(uniqueName('Elvin', '', ['Elvin']), 'Elvin (2)');
    assert.equal(uniqueName('Elvin', '', ['Elvin', 'Elvin (2)']), 'Elvin (3)');
  });
});

describe('sameSecret', () => {
  it('compares exactly', () => {
    assert.equal(sameSecret('abc', 'abc'), true);
    assert.equal(sameSecret('abc', 'abd'), false);
    assert.equal(sameSecret('abc', 'abcd'), false);
    assert.equal(sameSecret('', ''), true);
  });
});

describe('roomTitle', () => {
  it('reads the title from metadata and falls back to the code', () => {
    assert.equal(roomTitle('{"title":"Dev komandası"}', 'ABC234'), 'Dev komandası');
    assert.equal(roomTitle('', 'ABC234'), 'ABC234');
    assert.equal(roomTitle('not json', 'ABC234'), 'ABC234');
    assert.equal(roomTitle('{}', 'ABC234'), 'ABC234');
  });
});
