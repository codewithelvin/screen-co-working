import {
  DisconnectReason,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';
import type { AnnoEvent, AnnoMsg, ScreenSource } from '../../../shared/types';
import { api, type JoinInfo } from '../api';
import { type HostAction, type Person, SCREEN_ENCODING, Session } from './Session';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A room on the LAN server, media relayed by LiveKit (D8, D26). */
export class LiveKitSession extends Session {
  private room = new Room({ adaptiveStream: false, dynacast: true });
  private publication: LocalTrackPublication | null = null;
  private source: ScreenSource | null = null;

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
      .on(RoomEvent.TrackSubscribed, refresh)
      .on(RoomEvent.TrackUnsubscribed, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.TrackMuted, (pub) => {
        if (pub.source === Track.Source.ScreenShare && pub.track && !pub.track.isLocal) this.update({ paused: true });
      })
      .on(RoomEvent.TrackUnmuted, (pub) => {
        if (pub.source === Track.Source.ScreenShare && pub.track && !pub.track.isLocal) this.update({ paused: false });
      })
      .on(RoomEvent.DataReceived, (payload, participant) => this.onData(payload, participant))
      .on(RoomEvent.Disconnected, (reason) => {
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
    this.update({ people, remoteStream, paused });
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

  async leave(): Promise<void> {
    await this.stopShare();
    await this.room.disconnect();
  }
}
