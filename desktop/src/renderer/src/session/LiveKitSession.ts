import {
  DisconnectReason,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';
import type { AnnoEvent, AnnoMsg, ScreenSource, VoiceRole } from '../../../shared/types';
import { api, type JoinInfo } from '../api';
import { type HostAction, type Person, SCREEN_ENCODING, Session } from './Session';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
/** How often the Wi-Fi fingerprint is re-sent; the server forgets it after 90 s. */
const PRESENCE_MS = 20_000;
const ROLES: VoiceRole[] = ['remote', 'room-mic', 'group', 'unknown'];
/** Roles that may not transmit, and that hear the room through someone else's laptop or not yet. */
const SILENT: VoiceRole[] = ['group', 'pending', 'unknown'];

function roleOf(p: Participant): VoiceRole {
  const v = p.attributes.voice as VoiceRole;
  return ROLES.includes(v) ? v : 'pending';
}

/** A room on the LAN server, media relayed by LiveKit (D8, D26). */
export class LiveKitSession extends Session {
  private room = new Room({ adaptiveStream: false, dynacast: true });
  private publication: LocalTrackPublication | null = null;
  private source: ScreenSource | null = null;
  private presenceTimer: ReturnType<typeof setInterval> | undefined;
  /** Remote voices, played unless I sit in a group without the room mic (D38). */
  private audio = new Map<RemoteTrack, HTMLMediaElement[]>();

  private constructor(
    private server: string,
    private join: JoinInfo,
    code: string,
  ) {
    super({ mode: 'server', title: join.title, code, me: join.identity });
  }

  static async connect(server: string, code: string, name: string): Promise<LiveKitSession> {
    const join = await api.join(server, code, name, window.scw.hostname);
    const s = new LiveKitSession(server, join, code.toUpperCase());
    await s.start();
    return s;
  }

  private async start(): Promise<void> {
    const r = this.room;
    const refresh = () => this.refresh();
    r.on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.TrackPublished, refresh)
      .on(RoomEvent.TrackUnpublished, refresh)
      .on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) this.playVoice(track);
        refresh();
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        this.stopVoice(track);
        refresh();
      })
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.ParticipantAttributesChanged, () => void this.onVoiceChanged())
      .on(RoomEvent.ParticipantPermissionsChanged, () => void this.onVoiceChanged())
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.TrackMuted, (pub) => {
        if (pub.source === Track.Source.ScreenShare && pub.track && !pub.track.isLocal) this.update({ paused: true });
      })
      .on(RoomEvent.TrackUnmuted, (pub) => {
        if (pub.source === Track.Source.ScreenShare && pub.track && !pub.track.isLocal) this.update({ paused: false });
      })
      .on(RoomEvent.DataReceived, (payload, participant) => this.onData(payload, participant))
      .on(RoomEvent.Reconnecting, () => this.update({ reconnecting: true }))
      .on(RoomEvent.SignalReconnecting, () => this.update({ reconnecting: true }))
      .on(RoomEvent.Reconnected, () => {
        this.update({ reconnecting: false });
        void this.reportPresence();
      })
      .on(RoomEvent.Disconnected, (reason) => {
        clearInterval(this.presenceTimer);
        for (const t of [...this.audio.keys()]) this.stopVoice(t);
        void this.cleanupShare();
        const why =
          reason === DisconnectReason.PARTICIPANT_REMOVED
            ? 'Otağın sahibi sizi otaqdan çıxartdı.'
            : reason === DisconnectReason.ROOM_DELETED
              ? 'Otaq bağlandı.'
              : reason === DisconnectReason.CLIENT_INITIATED
                ? 'Otaqdan çıxdınız.'
                : 'Serverlə əlaqə kəsildi.';
        this.update({ ended: why });
      });
    await r.connect(this.join.url, this.join.token, { autoSubscribe: true });
    this.refresh();
    void this.reportPresence();
    this.presenceTimer = setInterval(() => void this.reportPresence(), PRESENCE_MS);
  }

  /** Send my Wi-Fi fingerprint; the server decides who sits together (D37). */
  private async reportPresence(): Promise<void> {
    const scan = await window.scw.wifiFingerprint().catch(() => ({ status: 'unavailable' as const, aps: [] }));
    if (this.room.state !== 'connected') return;
    if (scan.status !== this.snap.wifi) this.update({ wifi: scan.status });
    await api.presence(this.server, this.snap.code, this.join, scan).catch(() => undefined);
  }

  /** The server changed someone's voice role; a silent group member must not transmit (D36). */
  private async onVoiceChanged(): Promise<void> {
    const voice = roleOf(this.room.localParticipant);
    if (SILENT.includes(voice) && this.room.localParticipant.isMicrophoneEnabled) {
      await this.room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
    }
    this.refresh();
  }

  /** People in a group hear the room through the room-mic laptop, not their own (D38). */
  private get voiceMuted(): boolean {
    return SILENT.includes(this.snap.voice);
  }

  private playVoice(track: RemoteTrack): void {
    if (this.audio.has(track)) return;
    const els = [track.attach()];
    for (const el of els) {
      el.muted = this.voiceMuted;
      el.hidden = true;
      document.body.appendChild(el);
    }
    this.audio.set(track, els);
  }

  private stopVoice(track: RemoteTrack): void {
    const els = this.audio.get(track);
    if (!els) return;
    this.audio.delete(track);
    track.detach();
    for (const el of els) el.remove();
  }

  private refresh(): void {
    const r = this.room;
    const all: Participant[] = [r.localParticipant, ...r.remoteParticipants.values()];
    const host = [...all].sort((a, b) => (a.joinedAt?.getTime() ?? Infinity) - (b.joinedAt?.getTime() ?? Infinity))[0];
    const people: Person[] = all.map((p) => ({
      id: p.identity,
      name: p.name || p.identity,
      host: p === host,
      presenting: p.isScreenShareEnabled,
      me: p === r.localParticipant,
      voice: roleOf(p),
      micOn: p.isMicrophoneEnabled,
    }));

    let remoteStream: MediaStream | null = null;
    let paused = this.snap.paused;
    const presenter = [...r.remoteParticipants.values()].find((p: RemoteParticipant) => p.isScreenShareEnabled);
    const pub = presenter?.getTrackPublication(Track.Source.ScreenShare);
    if (pub?.track) {
      const current = this.snap.remoteStream?.getVideoTracks()[0];
      remoteStream =
        current === pub.track.mediaStreamTrack ? this.snap.remoteStream : new MediaStream([pub.track.mediaStreamTrack]);
      if (!this.snap.presenting && !this.snap.remoteStream) paused = pub.isMuted;
    } else if (!this.snap.presenting) {
      paused = false;
    }
    const me = r.localParticipant;
    const voice = roleOf(me);
    this.update({
      people,
      remoteStream,
      paused,
      voice,
      roomMic: me.attributes.roomMic ?? '',
      micOn: me.isMicrophoneEnabled,
    });
    for (const els of this.audio.values()) for (const el of els) el.muted = this.voiceMuted;
  }

  private onData(payload: Uint8Array, participant?: RemoteParticipant): void {
    let msg: AnnoMsg;
    try {
      msg = JSON.parse(decoder.decode(payload)) as AnnoMsg;
    } catch {
      return;
    }
    if (!participant) {
      // from the server: the host stopped my share (D15)
      if (msg.t === 'stop-share') void this.stopShare();
      return;
    }
    const e: AnnoEvent = { from: participant.identity, name: participant.name || participant.identity, msg };
    this.emitAnno(e);
  }

  async startShare(source: ScreenSource): Promise<void> {
    await api.present(this.server, this.snap.code, this.join, true);
    let track: MediaStreamTrack;
    try {
      track = await this.captureScreen(source);
    } catch (e) {
      await api.present(this.server, this.snap.code, this.join, false).catch(() => undefined);
      throw e;
    }
    track.addEventListener('ended', () => void this.stopShare());
    this.publication = await this.room.localParticipant.publishTrack(track, {
      source: Track.Source.ScreenShare,
      name: 'screen',
      simulcast: false,
      videoCodec: 'vp9',
      backupCodec: false,
      videoEncoding: { ...SCREEN_ENCODING, priority: 'high' },
      degradationPreference: 'maintain-resolution',
    });
    this.source = source;
    await this.presenterStarted(source);
    this.refresh();
  }

  private async cleanupShare(): Promise<void> {
    if (!this.publication && !this.snap.presenting) return;
    const pub = this.publication;
    this.publication = null;
    this.source = null;
    if (pub?.track && this.room.localParticipant) {
      await this.room.localParticipant.unpublishTrack(pub.track, true).catch(() => undefined);
    }
    await this.presenterStopped();
  }

  async stopShare(): Promise<void> {
    await this.cleanupShare();
    await api.present(this.server, this.snap.code, this.join, false).catch(() => undefined);
    this.refresh();
  }

  /** Viewers keep the last frame and show "paused" (D14); the message goes first so they can freeze it. */
  async setPaused(paused: boolean): Promise<void> {
    if (!this.publication?.track || !this.source) return;
    this.sendAnno({ t: 'paused', v: paused });
    if (paused) {
      await new Promise((r) => setTimeout(r, 150));
      await this.publication.track.mute();
    } else {
      await this.publication.track.unmute();
    }
    this.update({ paused });
  }

  sendAnno(msg: AnnoMsg): void {
    if (this.room.state !== 'connected') return;
    const lossy = msg.t === 'ptr' || msg.t === 'ptr-off';
    void this.room.localParticipant
      .publishData(encoder.encode(JSON.stringify(msg)), { reliable: !lossy, topic: 'anno' })
      .catch(() => undefined);
  }

  async hostAction(action: HostAction, target?: string): Promise<void> {
    await api.action(this.server, this.snap.code, this.join, action, target);
  }

  async setMic(on: boolean): Promise<void> {
    if (on && SILENT.includes(this.snap.voice)) return;
    await this.room.localParticipant.setMicrophoneEnabled(on, { echoCancellation: true, noiseSuppression: true });
    this.refresh();
  }

  async takeRoomMic(): Promise<void> {
    await api.takeRoomMic(this.server, this.snap.code, this.join);
  }

  async leave(): Promise<void> {
    clearInterval(this.presenceTimer);
    await this.stopShare();
    await this.room.disconnect();
  }
}
