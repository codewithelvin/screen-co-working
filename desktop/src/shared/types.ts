/** Contract between the Electron main process and the renderers (exposed as window.scw). */

export interface Settings {
  name: string;
  /** Room API address. Fixed (COMPANY_SERVER, D35); read-only for the UI. */
  server: string;
}

/** One visible Wi-Fi access point: hashed BSSID and signal 0..100 (D37). */
export interface AccessPoint {
  h: string;
  s: number;
}

/** Voice role set by the server (D36–D38); 'pending' until it has placed us, 'off' in P2P mode. */
export type VoiceRole = 'pending' | 'off' | 'remote' | 'room-mic' | 'group';

export interface ScreenSource {
  id: string;
  name: string;
  displayId: string;
  thumbnail: string;
}

/** A presenter announcing a local (no-server) session on the subnet (D10/D27). */
export interface LocalSession {
  id: string;
  title: string;
  presenter: string;
  address: string;
  port: number;
  viewers: number;
}

export type NotifyMuteResult = 'ok' | 'unsupported' | 'failed';

export type UpdateState =
  | { status: 'idle' }
  | { status: 'downloading'; version: string; required: boolean }
  | { status: 'ready'; version: string; required: boolean }
  | { status: 'error'; message: string; required: boolean };

/** Pointer/annotation and control messages, coordinates normalised to 0..1 of the shared screen. */
export type AnnoMsg =
  | { t: 'ptr'; x: number; y: number }
  | { t: 'ptr-off' }
  | { t: 'stroke'; id: string; pts: [number, number][]; done?: boolean }
  | { t: 'clear'; all?: boolean }
  | { t: 'paused'; v: boolean }
  | { t: 'stop-share' };

/** An annotation message as delivered to an overlay, with its sender attached. */
export interface AnnoEvent {
  from: string;
  name: string;
  msg: AnnoMsg;
}

/** P2P signalling between a viewer and the presenter's app. */
export type SignalMsg =
  | { t: 'hello'; name: string; hostname: string }
  | { t: 'welcome'; id: string; name: string; title: string; presenter: string; peers: { id: string; name: string }[] }
  | { t: 'peers'; peers: { id: string; name: string }[] }
  | { t: 'full' }
  | { t: 'kicked' }
  | { t: 'ended' }
  | { t: 'sdp'; sdp: RTCSessionDescriptionInit }
  | { t: 'ice'; candidate: RTCIceCandidateInit };

export interface ScwApi {
  platform: NodeJS.Platform;
  hostname: string;
  version: string;
  /** First-run name suggestion from the OS login. */
  suggestedName: string;
  getSettings(): Promise<Settings>;
  saveSettings(s: Pick<Settings, 'name'>): Promise<void>;
  listScreens(): Promise<ScreenSource[]>;
  chooseScreen(id: string): Promise<void>;
  overlayShow(displayId: string, presenterName: string): Promise<void>;
  overlayHide(): Promise<void>;
  overlayEvent(e: AnnoEvent): void;
  muteNotifications(mute: boolean): Promise<NotifyMuteResult>;
  wifiFingerprint(): Promise<AccessPoint[]>;
  // P2P presenter side
  p2pHostStart(title: string, presenter: string): Promise<void>;
  p2pHostStop(): Promise<void>;
  p2pHostSend(peerId: string, msg: SignalMsg): void;
  p2pHostKick(peerId: string): void;
  onP2pPeerMessage(cb: (peerId: string, msg: SignalMsg) => void): () => void;
  onP2pPeerClosed(cb: (peerId: string) => void): () => void;
  // P2P viewer side
  listLocalSessions(): Promise<LocalSession[]>;
  // Updates
  onUpdate(cb: (s: UpdateState) => void): () => void;
  installUpdate(): Promise<void>;
  /** Check the server for an update now (after a refused join, or to retry a failed download). */
  checkUpdate(): Promise<void>;
  // Overlay window only
  onOverlayEvent(cb: (e: AnnoEvent) => void): () => void;
  onOverlayInit(cb: (presenterName: string) => void): () => void;
}
