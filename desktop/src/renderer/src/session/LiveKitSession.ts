import {
  DisconnectReason,
  type LocalAudioTrack,
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
import { type AudioDevices, type HostAction, type Person, SCREEN_ENCODING, Session } from './Session';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
/** How often the Wi-Fi fingerprint is re-sent; the server forgets it after 90 s. */
const PRESENCE_MS = 20_000;
const ROLES: VoiceRole[] = ['remote', 'room-mic', 'group', 'unknown'];
/** Roles that may not transmit, and that hear the room through someone else's laptop or not yet. */
const SILENT: VoiceRole[] = ['group', 'pending', 'unknown'];

/** Chosen microphone and speaker, per computer (a convenience; the default device works without). */
const MIC_KEY = 'scw.mic';
const SPEAKER_KEY = 'scw.speaker';
/** Below this peak a mic counts as dead: real microphones always pick up some noise. */
const SILENCE = 0.0005;
const SILENT_MS = 3000;
const TRY_MS = 2000;

function stored(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private storage unavailable: the choice just isn't remembered
  }
}

/** Highest sample level of a live audio track within `ms` (stops early once there is sound). */
async function peakOf(track: MediaStreamTrack, ms: number): Promise<number> {
  const ctx = new AudioContext();
  try {
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let peak = 0;
    for (const end = Date.now() + ms; Date.now() < end && peak <= SILENCE; ) {
      await new Promise((r) => setTimeout(r, 200));
      analyser.getFloatTimeDomainData(buf);
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
    }
    return peak;
  } finally {
    void ctx.close();
  }
}

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
  /** Bumped to cancel a running microphone check. */
  private micCheck = 0;
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
    const speaker = stored(SPEAKER_KEY);
    if (speaker) void r.switchActiveDevice('audiooutput', speaker).catch(() => false);
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
    const deviceId = stored(MIC_KEY) || undefined;
    await this.room.localParticipant.setMicrophoneEnabled(on, { echoCancellation: true, noiseSuppression: true, deviceId });
    this.refresh();
    if (on) void this.checkMic();
    else {
      this.micCheck++;
      this.update({ micProblem: null, micChecking: false });
    }
  }

  private micTrack(): MediaStreamTrack | undefined {
    return this.room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
  }

  /**
   * A working mic always carries some noise; exact silence means Windows' privacy switch is off
   * (it then hands out a silent device) or the device gives nothing (live test, 2026-11-05).
   * The switch is reported (the person can turn it on with one click); a dead device is replaced
   * by the first other microphone that does carry sound.
   */
  private async checkMic(): Promise<void> {
    const run = ++this.micCheck;
    const current = () => run === this.micCheck && this.room.state === 'connected';
    const first = this.micTrack();
    if (!first || (await peakOf(first, SILENT_MS)) > SILENCE) {
      if (current()) this.update({ micProblem: null });
      return;
    }
    if (!current()) return;
    const access = await window.scw.micAccess().catch(() => 'allowed' as const);
    if (!current()) return;
    if (access !== 'allowed') {
      this.update({ micProblem: access });
      return;
    }
    this.update({ micChecking: true });
    const original = this.room.getActiveDevice('audioinput');
    try {
      const others = (await Room.getLocalDevices('audioinput', false)).filter(
        (d) => d.deviceId !== original && d.deviceId !== 'communications',
      );
      for (const d of others.slice(0, 6)) {
        if (!current()) return;
        await this.room.switchActiveDevice('audioinput', d.deviceId).catch(() => false);
        const t = this.micTrack();
        if (t && (await peakOf(t, TRY_MS)) > SILENCE) {
          if (current()) {
            store(MIC_KEY, d.deviceId);
            this.update({ micProblem: null });
          }
          return;
        }
      }
      if (!current()) return;
      if (original) await this.room.switchActiveDevice('audioinput', original).catch(() => false);
      this.update({ micProblem: 'silent' });
    } finally {
      if (run === this.micCheck) this.update({ micChecking: false });
    }
  }

  async allowMic(): Promise<void> {
    const access = await window.scw.allowMic();
    this.update({ micProblem: access === 'allowed' ? null : access });
    if (access !== 'allowed') return;
    // The device was opened while blocked and keeps recording silence: open it again.
    const pub = this.room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (pub?.track && this.room.localParticipant.isMicrophoneEnabled) {
      await (pub.track as LocalAudioTrack).restartTrack().catch(() => undefined);
      void this.checkMic();
    }
  }

  async audioDevices(): Promise<AudioDevices> {
    let [mics, speakers] = await Promise.all([
      Room.getLocalDevices('audioinput', false),
      Room.getLocalDevices('audiooutput', false),
    ]);
    // Device names stay empty until the app has used a mic once.
    if (mics.some((d) => !d.label)) {
      [mics, speakers] = await Promise.all([Room.getLocalDevices('audioinput'), Room.getLocalDevices('audiooutput')]);
    }
    return {
      mics: mics.filter((d) => d.deviceId !== 'communications'),
      speakers: speakers.filter((d) => d.deviceId !== 'communications'),
      mic: this.room.getActiveDevice('audioinput') ?? (stored(MIC_KEY) || 'default'),
      speaker: this.room.getActiveDevice('audiooutput') ?? (stored(SPEAKER_KEY) || 'default'),
    };
  }

  async setAudioDevice(kind: 'audioinput' | 'audiooutput', id: string): Promise<void> {
    store(kind === 'audioinput' ? MIC_KEY : SPEAKER_KEY, id);
    await this.room.switchActiveDevice(kind, id);
    if (kind === 'audioinput' && this.room.localParticipant.isMicrophoneEnabled) void this.checkMic();
  }

  async takeRoomMic(): Promise<void> {
    await api.takeRoomMic(this.server, this.snap.code, this.join);
  }

  async leave(): Promise<void> {
    clearInterval(this.presenceTimer);
    this.micCheck++;
    await this.stopShare();
    await this.room.disconnect();
  }
}
