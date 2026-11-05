# Screen Co-Working — code repo

The spec and binding decisions (D1–D32) live in the Obsidian vault at
`Desktop/Projects/obsidian/Projects/Screen-Co-Working/Project Implementation.md`. Read §0 before changing behaviour.

## Invariants
- Screen only: no audio or camera tracks, no chat. One presenter per room. Entire screen only.
- Azerbaijani-only UI strings, written inline. Dark + compact antd theme.
- No deprecated APIs: `npm --workspace desktop run lint` fails on them (antd v6 renames).
- Portable builds only (Windows `portable`, Linux AppImage, macOS zip). Self-updater in `desktop/src/main/updater.ts`, no electron-updater.
- Sandboxed preload must stay CommonJS. Don't add `"type": "module"` to `desktop/package.json`.
- TypeScript 6.x (typescript-eslint doesn't support 7 yet). Electron version pinned exactly (electron-builder needs it).
- Commit straight to `main`.

## Test locally
- Stack on shifted ports so it doesn't clash with QueryDesk's LiveKit on 7880/8080: compose with an override that maps 17880/18080 and sets `LIVEKIT_PUBLIC_URL=ws://127.0.0.1:17880`.
- Two instances: `SCW_DATA_DIR=<dir> electron . --remote-debugging-port=93xx`, then drive them over CDP.
