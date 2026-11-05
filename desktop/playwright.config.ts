import { defineConfig } from '@playwright/test';

// E2E: real Electron instances (the built app in out/) against the docker test stack.
export default defineConfig({
  testDir: 'test/e2e',
  timeout: 90_000,
  // Joining a LiveKit room on a loaded machine can take several seconds.
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
});
