/** True when version a is newer than b (major.minor.patch, missing parts count as 0). */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

/** An app below the minimum must update before joining; one that sends no version is older than this rule. */
export function mustUpdate(clientVersion: unknown, minVersion: string): boolean {
  if (!minVersion) return false;
  if (typeof clientVersion !== 'string' || !/^\d+(\.\d+){0,2}$/.test(clientVersion.trim())) return true;
  return isNewer(minVersion, clientVersion.trim());
}
