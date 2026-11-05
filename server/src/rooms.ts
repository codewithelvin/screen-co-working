import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Pure room rules, kept apart from HTTP and LiveKit so they can be unit-tested. */

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

/** Short room code without look-alike characters (no I, O, 0, 1). */
export function newCode(bytes: Uint8Array = randomBytes(CODE_LENGTH)): string {
  return Array.from(bytes.slice(0, CODE_LENGTH), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** Host = participant who has been in the room longest (D16). */
export function hostOf<T extends { joinedAt: bigint }>(participants: T[]): T | undefined {
  let host: T | undefined;
  for (const p of participants) if (!host || p.joinedAt < host.joinedAt) host = p;
  return host;
}

/** D24: a display name already in the room gets the computer name appended, then a number. */
export function uniqueName(name: string, hostname: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const label = (i: number) => (hostname ? (i === 1 ? `${name} (${hostname})` : `${name} (${hostname} ${i})`) : `${name} (${i + 1})`);
  let i = 1;
  while (used.has(label(i).toLowerCase())) i++;
  return label(i);
}

/** Constant-time string comparison for join secrets. */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Room title from LiveKit room metadata, falling back to the code. */
export function roomTitle(metadata: string | undefined, code: string): string {
  try {
    return (JSON.parse(metadata || '{}') as { title?: string }).title || code;
  } catch {
    return code;
  }
}
