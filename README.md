# Screen Co-Working

Silent co-working on the office LAN: one person shares their screen to a room of up to 50 people.
There is no voice, video or chat, only the screen plus viewers' pointers and pen strokes. The UI is in Azerbaijani.

- `server/` holds the room API (Node/TypeScript, runs with Node type stripping, no build step).
- `deploy/` holds docker compose for the Linux LAN server: LiveKit (media relay) and the room API.
- `desktop/` holds the Electron app (React + Ant Design, dark theme). It's portable: no installer.

The spec and decision log (D1–D32) live in the Obsidian vault: `Projects/Screen-Co-Working/Project Implementation.md`.

## Server (Linux)

```sh
cd deploy
cp .env.example .env     # set NODE_IP to the server's LAN IP and a long LIVEKIT_API_SECRET
docker compose up -d
curl http://localhost:8080/api/health
```

Open these on the server firewall: TCP 8080 (API + updates), TCP 7880–7881 (LiveKit), UDP 40000–40100 (media).

## Desktop app

```sh
npm install
npm run dev                      # development
npm --workspace desktop run dist:win    # release/Screen-Co-Working-<v>-win-portable.exe
npm --workspace desktop run dist:linux  # AppImage (build on Linux)
npm --workspace desktop run dist:mac    # zipped .app (build on macOS)
```

Users copy the single file anywhere and run it. Settings (name, server address) and browser data
are kept in `ScreenCoWorking-data/` next to the program. When that folder isn't writable, they go
to the normal per-user folder instead.

**Windows firewall:** the first run asks to allow network access. That access is only needed for
no-server (P2P) mode: UDP 41234 for discovery, plus a random TCP port on the presenter's machine.
IT can pre-allow the exe with a GPO rule so users never see the prompt.

## Releasing an update

1. Bump `version` in `desktop/package.json` and build each platform.
2. `cd desktop && node scripts/publish-update.mts <server>/deploy/updates`. This copies the builds and
   writes `latest.json` with SHA-256 checksums.
3. Running apps check `http://<server>:8080/updates/latest.json` at start and every 30 minutes. They
   download in the background and offer "Yenidən başlat" (restart) to swap the file in place.

macOS builds are unsigned. Gatekeeper asks the user to allow the app on first launch.

## Tests

```sh
npm run typecheck
npm run lint        # includes @typescript-eslint/no-deprecated
npm test            # unit: server (node:test) + desktop (Vitest)
```

API integration tests and E2E need the docker stack running. On a dev machine where 7880/8080 are
taken, map it to 17880/18080 and set `LIVEKIT_PUBLIC_URL=ws://127.0.0.1:17880`.

```sh
SCW_API=127.0.0.1:18080 npm run test:api   # room API against real LiveKit
SCW_API=127.0.0.1:18080 npm run test:e2e   # Playwright drives real app windows (it captures your screen)
```

The E2E suite covers first run, share/watch/annotate/pause, one presenter, kick, the host stopping
a share, duplicate names, host handover, closing a room, and server-down P2P mode.

`SCW_DATA_DIR=<folder>` runs an instance with its own settings, so you can run two on one machine by hand.
