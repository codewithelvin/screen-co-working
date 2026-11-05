/**
 * Who sits together (D36–D38), from Wi-Fi fingerprints. Pure functions so they can be unit-tested.
 *
 * Each client reports the access points it sees as hashed BSSIDs with signal strength 0..100.
 * Two people are "next to" each other when their fingerprints are similar enough. People linked
 * that way form a group; a group of 3+ is "together": one room mic transmits for it, the rest
 * stay silent. Everyone else (alone, in a pair, no Wi-Fi, no recent report) may use their own mic.
 */

export interface AccessPoint {
  /** Hashed BSSID. */
  h: string;
  /** Signal strength 0..100. */
  s: number;
}

export interface Fingerprint {
  aps: AccessPoint[];
  /** When it was reported (ms). */
  at: number;
}

export type VoiceRole = 'remote' | 'room-mic' | 'group';

export interface VoiceMember {
  identity: string;
  joinedAt: bigint;
  presenting: boolean;
}

export interface VoicePlanEntry {
  role: VoiceRole;
  /** Shared by all members of a together-group (empty for remote people). */
  group: string;
  /** Identity of the group's room-mic holder (empty for remote people). */
  roomMic: string;
}

/** Group size from which people are "together" (the person plus at least 2 others). */
export const GROUP_MIN = 3;

/** Weighted Jaccard similarity 0..1 of two fingerprints: Σ min(signal) / Σ max(signal) over all APs. */
export function similarity(a: AccessPoint[], b: AccessPoint[]): number {
  const sa = new Map(a.map((p) => [p.h, p.s]));
  const sb = new Map(b.map((p) => [p.h, p.s]));
  let min = 0;
  let max = 0;
  for (const h of new Set([...sa.keys(), ...sb.keys()])) {
    const x = sa.get(h) ?? 0;
    const y = sb.get(h) ?? 0;
    min += Math.min(x, y);
    max += Math.max(x, y);
  }
  return max === 0 ? 0 : min / max;
}

/** Connected components of the "next to" graph; only fresh, non-empty fingerprints take part. */
export function groupsOf(
  identities: string[],
  fingerprints: ReadonlyMap<string, Fingerprint>,
  opts: { now: number; maxAgeMs: number; threshold: number },
): string[][] {
  const live = identities.filter((id) => {
    const f = fingerprints.get(id);
    return f !== undefined && f.aps.length > 0 && opts.now - f.at <= opts.maxAgeMs;
  });
  const parent = new Map(live.map((id) => [id, id]));
  const find = (id: string): string => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(id, r);
    return r;
  };
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = fingerprints.get(live[i])!.aps;
      const b = fingerprints.get(live[j])!.aps;
      if (similarity(a, b) >= opts.threshold) parent.set(find(live[i]), find(live[j]));
    }
  }
  const groups = new Map<string, string[]>();
  for (const id of live) {
    const root = find(id);
    groups.set(root, [...(groups.get(root) ?? []), id]);
  }
  return [...groups.values()];
}

/**
 * Role per participant. Room mic of a together-group: the presenter if they are in it, else the
 * latest claimer still in it ("take the room mic"), else whoever joined first.
 */
export function voicePlan(
  members: VoiceMember[],
  groups: string[][],
  claims: ReadonlyMap<string, number>,
): Map<string, VoicePlanEntry> {
  const plan = new Map<string, VoicePlanEntry>();
  for (const m of members) plan.set(m.identity, { role: 'remote', group: '', roomMic: '' });
  const byId = new Map(members.map((m) => [m.identity, m]));

  for (const g of groups) {
    const inRoom = g.filter((id) => byId.has(id));
    if (inRoom.length < GROUP_MIN) continue;
    const people = inRoom.map((id) => byId.get(id)!);
    const presenter = people.find((p) => p.presenting);
    const claimer = people
      .filter((p) => claims.has(p.identity))
      .sort((a, b) => claims.get(b.identity)! - claims.get(a.identity)!)[0];
    const first = [...people].sort((a, b) => (a.joinedAt < b.joinedAt ? -1 : a.joinedAt > b.joinedAt ? 1 : 0))[0];
    const mic = (presenter ?? claimer ?? first).identity;
    const group = [...inRoom].sort()[0];
    for (const id of inRoom) plan.set(id, { role: id === mic ? 'room-mic' : 'group', group, roomMic: mic });
  }
  return plan;
}
