# Screen Co-Working — code repo

The spec and binding decisions (D1–D32) live in the Obsidian vault at
`Desktop/Projects/obsidian/Projects/Screen-Co-Working/Project Implementation.md`. Read §0 before changing behaviour.

## Invariants
- Screen only: no camera, no chat. One presenter per room. Entire screen only.
- Voice only for people with fewer than 2 call members nearby (Wi-Fi fingerprint, D36–D41). The server grants the mic through LiveKit permissions; never let the client decide. A group of 3+ uses one room-mic laptop. P2P has no voice.
- Azerbaijani-only UI strings, written inline. QueryDesk's Indigo dark palette (`theme.ts`), 14px base; every text colour must pass WCAG AA (4.5:1). Check with `npm run audit:ui` in desktop.
- No deprecated APIs: `npm --workspace desktop run lint` fails on them (antd v6 renames).
- Portable builds only (Windows `portable`, Linux AppImage, macOS zip). Self-updater in `desktop/src/main/updater.ts`, no electron-updater.
- Sandboxed preload must stay CommonJS. Don't add `"type": "module"` to `desktop/package.json`.
- TypeScript 6.x (typescript-eslint doesn't support 7 yet). Electron version pinned exactly (electron-builder needs it).
- Commit straight to `main`.

## Test locally
- Stack on shifted ports so it doesn't clash with QueryDesk's LiveKit on 7880/8080: compose with an override that maps 17880/18080 and sets `LIVEKIT_PUBLIC_URL=ws://127.0.0.1:17880`.
- Two instances: `SCW_DATA_DIR=<dir> electron . --remote-debugging-port=93xx`, then drive them over CDP.
