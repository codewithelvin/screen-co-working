import type { AnnoEvent, AnnoMsg, ScreenSource, VoiceRole } from '../../../shared/types';

export interface Person {
  id: string;
  name: string;
  host: boolean;
  presenting: boolean;
  me: boolean;
  voice: VoiceRole;
  /** Transmitting an unmuted microphone. */
  micOn: boolean;
}

export interface Snapshot {
  mode: 'server' | 'p2p';
  title: string;
  /** Room code (server mode) or the presenter's address (P2P). */
  code: string;
  me: string;
  people: Person[];
  /** The presenter's screen, when someone else is presenting. */
  remoteStream: MediaStream | null;
  presenting: boolean;
  paused: boolean;
  /** Set once the session is over; the text says why. */
  ended: string | null;
  notifyResult: 'ok' | 'unsupported' | 'failed' | null;
  /** My voice role (D36–D38) and the identity holding my group's room mic. */
  voice: VoiceRole;
  roomMic: string;
  micOn: boolean;
}

export type HostAction = 'kick' | 'stopShare' | 'end';

/**
 * Common base for a room on the LAN server (LiveKit) and a direct P2P session.
 * Handles the presenter-side extras once: overlay window, notification mute, and
 * forwarding viewers' pointers to the overlay.
 */
export abstract class Session {
  protected snap: Snapshot;
  private listeners = new Set<() => void>();
  private annoListeners = new Set<(e: AnnoEvent) => void>();

  constructor(init: Pick<Snapshot, 'mode' | 'title' | 'code' | 'me'>) {
    this.snap = {
      ...init,
      people: [],
      remoteStream: null,
      presenting: false,
      paused: false,
      ended: null,
      notifyResult: null,
      voice: init.mode === 'p2p' ? 'off' : 'pending',
      roomMic: '',
      micOn: false,
    };
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): Snapshot => this.snap;

  protected update(patch: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  onAnno(cb: (e: AnnoEvent) => void): () => void {
    this.annoListeners.add(cb);
    return () => this.annoListeners.delete(cb);
  }

  protected emitAnno(e: AnnoEvent): void {
    if (e.msg.t === 'paused') {
      this.update({ paused: e.msg.v });
    }
    for (const l of this.annoListeners) l(e);
    if (this.snap.presenting) window.scw.overlayEvent(e);
  }

  get myName(): string {
    return this.snap.people.find((p) => p.me)?.name ?? '';
  }

  /** Called by subclasses once the local screen track is live. */
  protected async presenterStarted(source: ScreenSource): Promise<void> {
    await window.scw.overlayShow(source.displayId, this.myName);
    const notifyResult = await window.scw.muteNotifications(true);
    this.update({ presenting: true, paused: false, notifyResult });
  }

  protected async presenterStopped(): Promise<void> {
    await window.scw.overlayHide();
    await window.scw.muteNotifications(false);
    this.update({ presenting: false, paused: false, notifyResult: null });
  }

  /** Capture the chosen monitor; sharp text first (D11). */
  protected async captureScreen(source: ScreenSource): Promise<MediaStreamTrack> {
    await window.scw.chooseScreen(source.id);
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { max: 15 } }, audio: false });
    const track = stream.getVideoTracks()[0];
    track.contentHint = 'detail';
    return track;
  }

  abstract startShare(source: ScreenSource): Promise<void>;
  abstract stopShare(): Promise<void>;
  abstract setPaused(paused: boolean): Promise<void>;
  abstract sendAnno(msg: AnnoMsg): void;
  abstract hostAction(action: HostAction, target?: string): Promise<void>;
  abstract leave(): Promise<void>;
  /** Microphone on/off; only works while the server allows it (D39, D40). */
  abstract setMic(on: boolean): Promise<void>;
  /** Take over my group's room mic (D38). */
  abstract takeRoomMic(): Promise<void>;
}

export const SCREEN_ENCODING = { maxBitrate: 8_000_000, maxFramerate: 15 };
