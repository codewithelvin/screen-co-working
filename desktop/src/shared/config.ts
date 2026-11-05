/**
 * The company server (D33, D35). Fixed in the build: users can't change it.
 * Tests and development point elsewhere with the SCW_SERVER environment variable.
 */
export const COMPANY_SERVER = '10.153.0.176:8090';

/** macOS copies come from the codewithelvin/homebrew-tap cask and update through Homebrew (D45). */
export const BREW_UPGRADE = 'brew update && brew upgrade --cask screen-co-working';
