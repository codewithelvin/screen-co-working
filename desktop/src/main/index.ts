import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session, shell } from 'electron';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { COMPANY_SERVER } from '../shared/config';
import { suggestName } from '../shared/names-suggest';
import type { AnnoEvent, ScreenSource, Settings, SignalMsg, UpdateState } from '../shared/types';
import { muteNotifications, restoreNotifications } from './notifications';
import * as p2p from './p2p';
import { setupPortableData } from './portable';
import { load, save } from './settings';
import { checkForUpdate, installUpdate } from './updater';
import { wifiFingerprint } from './wifi';

setupPortableData();

// P2P mode connects by LAN IP; Chromium would otherwise hide host candidates behind mDNS names.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

let main: BrowserWindow | null = null;
let overlay: BrowserWindow | null = null;
let chosenScreen: string | null = null;

/** Fixed company server (D35); SCW_SERVER only for tests and development. */
const SERVER = process.env.SCW_SERVER || COMPANY_SERVER;

const preload = join(__dirname, '../preload/index.js');

function loadPage(win: BrowserWindow, page: 'index' | 'overlay'): void {
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}.html`);
  else void win.loadFile(join(__dirname, `../renderer/${page}.html`));
}

function createMain(): void {
  main = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#141414',
    title: 'Screen Co-Working',
    autoHideMenuBar: true,
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  main.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  main.on('closed', () => {
    main = null;
    overlay?.destroy();
    overlay = null;
  });
  loadPage(main, 'index');
}

/**
 * Transparent, click-through window over the shared monitor: red "sharing" border and the
 * viewers' pointers/drawings (D7, D14). Content protection keeps it out of the capture,
 * so viewers don't see the annotations twice.
 */
function showOverlay(displayId: string, presenterName: string): void {
  const display = screen.getAllDisplays().find((d) => String(d.id) === displayId) ?? screen.getPrimaryDisplay();
  if (!overlay) {
    overlay = new BrowserWindow({
      ...display.bounds,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.setIgnoreMouseEvents(true);
    overlay.setContentProtection(true);
    overlay.on('closed', () => (overlay = null));
    loadPage(overlay, 'overlay');
    overlay.webContents.once('did-finish-load', () => {
      overlay?.webContents.send('overlay:init', presenterName);
      overlay?.showInactive();
    });
  } else {
    overlay.setBounds(display.bounds);
    overlay.webContents.send('overlay:init', presenterName);
    overlay.showInactive();
  }
}

function emitUpdate(s: UpdateState): void {
  main?.webContents.send('update:state', s);
}

function registerIpc(): void {
  ipcMain.on('app:info', (e) => {
    e.returnValue = {
      hostname: hostname().slice(0, 40),
      version: app.getVersion(),
      suggestedName: suggestName(userInfo().username, hostname()),
    };
  });
  ipcMain.handle('settings:get', (): Settings => {
    return { name: load().name, server: SERVER };
  });
  ipcMain.handle('settings:save', (_e, s: Pick<Settings, 'name'>) => {
    save({ name: String(s.name).slice(0, 40) });
  });

  ipcMain.handle('screens:list', async (): Promise<ScreenSource[]> => {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 320, height: 180 } });
    return sources.map((s, i) => ({
      id: s.id,
      name: s.name || `Ekran ${i + 1}`,
      displayId: s.display_id || String(screen.getPrimaryDisplay().id),
      thumbnail: s.thumbnail.toDataURL(),
    }));
  });
  ipcMain.handle('screens:choose', (_e, id: string) => {
    chosenScreen = id;
  });

  ipcMain.handle('overlay:show', (_e, displayId: string, presenterName: string) => showOverlay(displayId, presenterName));
  ipcMain.handle('overlay:hide', () => {
    overlay?.destroy();
    overlay = null;
  });
  ipcMain.on('overlay:event', (_e, ev: AnnoEvent) => overlay?.webContents.send('overlay:event', ev));

  ipcMain.handle('notify:mute', (_e, mute: boolean) => muteNotifications(mute));
  ipcMain.handle('wifi:fingerprint', () => wifiFingerprint());

  ipcMain.handle('p2p:host-start', (_e, title: string, presenter: string) =>
    p2p.hostStart(
      title,
      presenter,
      (peerId, msg) => main?.webContents.send('p2p:peer-message', peerId, msg),
      (peerId) => main?.webContents.send('p2p:peer-closed', peerId),
    ),
  );
  ipcMain.handle('p2p:host-stop', () => p2p.hostStop());
  ipcMain.on('p2p:host-send', (_e, peerId: string, msg: SignalMsg) => p2p.hostSend(peerId, msg));
  ipcMain.on('p2p:host-kick', (_e, peerId: string) => p2p.hostKick(peerId));
  ipcMain.handle('p2p:sessions', () => p2p.localSessions());

  ipcMain.handle('update:install', async () => {
    await p2p.hostStop();
    await restoreNotifications();
    installUpdate();
  });
}

void app.whenReady().then(async () => {
  await restoreNotifications(); // in case the last run crashed while sharing
  registerIpc();

  // getDisplayMedia() in the renderer gets the monitor picked in our own picker.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      void desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        const source = sources.find((s) => s.id === chosenScreen) ?? sources[0];
        callback(source ? { video: source } : {});
      });
    },
    { useSystemPicker: false },
  );

  p2p.startDiscovery();
  createMain();

  main?.webContents.once('did-finish-load', () => void checkForUpdate(SERVER, emitUpdate));
  setInterval(() => void checkForUpdate(SERVER, emitUpdate), 30 * 60 * 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMain();
  });
});

app.on('before-quit', () => {
  void p2p.hostStop();
  void restoreNotifications();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

