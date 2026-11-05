/**
 * First-run name suggestion from the OS login: "elvin.huseynov" or "CYBER\elvin_huseynov" ->
 * "Elvin Huseynov". Falls back to the computer name when the login has no letters.
 */
export function suggestName(login: string, hostname: string): string {
  const user = login.split(/[\\/]/).pop() ?? '';
  const words = user
    .split(/[._\-\s]+/)
    .filter((w) => /\p{L}/u.test(w))
    .map((w) => w.charAt(0).toLocaleUpperCase('az') + w.slice(1).toLocaleLowerCase('az'));
  const name = words.join(' ').trim();
  return (name || hostname).slice(0, 40);
}
