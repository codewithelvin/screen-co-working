/**
 * D24: a display name already present gets the computer name appended, then a number.
 * Same rule as server/src/rooms.ts uniqueName (used here for P2P mode).
 */
export function uniqueName(name: string, hostname: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const label = (i: number) => (hostname ? (i === 1 ? `${name} (${hostname})` : `${name} (${hostname} ${i})`) : `${name} (${i + 1})`);
  let i = 1;
  while (used.has(label(i).toLowerCase())) i++;
  return label(i);
}
