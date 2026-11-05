/**
 * The company server (D33, D35). Fixed in the build: users can't change it.
 * Tests and development point elsewhere with the SCW_SERVER environment variable.
 */
export const COMPANY_SERVER = '10.153.0.176:8090';

/** macOS copies come from the codewithelvin/homebrew-tap cask and update through Homebrew (D45). */
export const BREW_UPGRADE = 'brew update && brew upgrade --cask screen-co-working';

/**
 * Public half of the release key (scripts/update-key.mts). Updates are accepted only with a
 * latest.json signature made by its private half, which stays on the release PC (2026-11-05).
 */
export const UPDATE_PUBLIC_KEY = 'MCowBQYDK2VwAyEANKKGEKSFX1H9mZRgAUxe0JLKzqxfUMvu/lH3R66oTMY=';
