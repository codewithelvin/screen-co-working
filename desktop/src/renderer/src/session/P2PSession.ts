import { uniqueName } from '../../../shared/names';
import type { AnnoEvent, AnnoMsg, LocalSession, ScreenSource, SignalMsg } from '../../../shared/types';
import { type HostAction, type Person, SCREEN_ENCODING, Session } from './Session';

/**
 * No-server mode (D10, D27): the presenter's app is the room. Each viewer gets its own
 * RTCPeerConnection straight to the presenter; annotation messages travel over a data
 * channel and the presenter relays them to the other viewers.
 */
const RTC_CONFIG: RTCConfiguration = { iceServers: [] };
const HOST_ID = 'presenter';

async function tuneSender(sender: RTCRtpSender): Promise<void> {
  const params = sender.getParameters();
  params.degradationPreference = 'maintain-resolution';
  params.encodings = (params.encodings.length ? params.encodings : [{}]).map((e) => ({
    ...e,
    maxBitrate: SCREEN_ENCODING.maxBitrate,
    maxFramerate: SCREEN_ENCODING.maxFramerate,
  }));
  await sender.setParameters(params).catch(() => undefined);
}

interface Peer {
  name: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
}

/** Presenter side. */
export class P2PHostSession extends Session {
  private peers = new Map<string, Peer>();
  private track: MediaStreamTrack | null = null;
  private stream: MediaStream | null = null;
  private off: (() => void)[] = [];

  constructor(title: string, private name: string) {
    super({ mode: 'p2p', title, code: 'yerli', me: HOST_ID });
    this.refresh();
  }

  private refresh(): void {
    const people: Person[] = [
      { id: HOST_ID, name: this.name, host: true, presenting: this.snap.presenting, me: true, voice: 'off', micOn: false },
      ...[...this.peers].map(([id, p]) => ({ id, name: p.name, host: false, presenting: false, me: false, voice: 'off' as const, micOn: false })),
    ];
    this.update({ people });
  }

  private peerList() {
    return [{ id: HOST_ID, name: this.name }, ...[...this.peers].map(([id, p]) => ({ id, name: p.name }))];
  }

  private broadcastPeers(): void {
    for (const id of this.peers.keys()) window.scw.p2pHostSend(id, { t: 'peers', peers: this.peerList() });
  }

  async startShare(source: ScreenSource): Promise<void> {
    this.track = await this.captureScreen(source);
    this.stream = new MediaStream([this.track]);
    this.track.addEventListener('ended', () => void this.leave());
    this.off.push(
      window.scw.onP2pPeerMessage((id, msg) => void this.onSignal(id, msg)),
      window.scw.onP2pPeerClosed((id) => this.dropPeer(id)),
    );
    await window.scw.p2pHostStart(this.snap.title, this.name);
    await this.presenterStarted(source);
    this.refresh();
  }

  private async onSignal(id: string, msg: SignalMsg): Promise<void> {
    if (msg.t === 'hello') {
      if (!this.track || !this.stream) return;
      const name = uniqueName(String(msg.name).slice(0, 40), String(msg.hostname).slice(0, 40), [
        this.name,
        ...[...this.peers.values()].map((p) => p.name),
      ]);
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const sender = pc.addTrack(this.track, this.stream);
      const dc = pc.createDataChannel('anno');
      dc.onmessage = (ev) => this.onViewerAnno(id, ev.data as string);
      pc.onicecandidate = (ev) => {
        if (ev.candidate) window.scw.p2pHostSend(id, { t: 'ice', candidate: ev.candidate.toJSON() });
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') window.scw.p2pHostKick(id);
      };
      this.peers.set(id, { name, pc, dc });
      if (this.snap.paused) await sender.replaceTrack(null);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await tuneSender(sender);
      window.scw.p2pHostSend(id, {
        t: 'welcome',
        id,
        name,
        title: this.snap.title,
        presenter: this.name,
        peers: this.peerList(),
      });
      window.scw.p2pHostSend(id, { t: 'sdp', sdp: offer });
      this.broadcastPeers();
      this.refresh();
    } else if (msg.t === 'sdp') {
      await this.peers.get(id)?.pc.setRemoteDescription(msg.sdp);
    } else if (msg.t === 'ice') {
      await this.peers.get(id)?.pc.addIceCandidate(msg.candidate).catch(() => undefined);
    }
  }

  private onViewerAnno(id: string, raw: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    let msg: AnnoMsg;
    try {
      msg = JSON.parse(raw) as AnnoMsg;
    } catch {
      return;
    }
    if (msg.t === 'paused' || msg.t === 'stop-share') return; // only the presenter sends these
    const e: AnnoEvent = { from: id, name: peer.name, msg };
    this.emitAnno(e);
    this.relay(e, id);
  }

  private relay(e: AnnoEvent, except?: string): void {
    const data = JSON.stringify(e);
    for (const [id, p] of this.peers) if (id !== except && p.dc.readyState === 'open') p.dc.send(data);
  }

  private dropPeer(id: string): void {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    this.peers.delete(id);
    this.broadcastPeers();
    this.refresh();
  }

  async stopShare(): Promise<void> {
    await this.leave();
  }

  async setPaused(paused: boolean): Promise<void> {
    this.relay({ from: HOST_ID, name: this.name, msg: { t: 'paused', v: paused } });
    if (paused) await new Promise((r) => setTimeout(r, 150));
    for (const p of this.peers.values()) {
      for (const s of p.pc.getSenders()) await s.replaceTrack(paused ? null : this.track);
    }
    this.update({ paused });
  }

  sendAnno(msg: AnnoMsg): void {
    this.relay({ from: HOST_ID, name: this.name, msg });
  }

  async hostAction(action: HostAction, target?: string): Promise<void> {
    if (action === 'end') return this.leave();
    if (target) window.scw.p2pHostKick(target);
  }

  async setMic(): Promise<void> {}

  async takeRoomMic(): Promise<void> {}

  async leave(): Promise<void> {
    if (this.snap.ended) return;
    for (const f of this.off) f();
    this.off = [];
    for (const p of this.peers.values()) p.pc.close();
    this.peers.clear();
    await window.scw.p2pHostStop();
    this.track?.stop();
    this.track = null;
    await this.presenterStopped();
    this.update({ ended: 'Yerli paylaşım bitdi.' });
  }
}

/** Viewer side: connects straight to the presenter announced on the subnet. */
export class P2PViewerSession extends Session {
  private ws: WebSocket;
  private pc = new RTCPeerConnection(RTC_CONFIG);
  private dc: RTCDataChannel | null = null;
  private presenterName = '';

  private constructor(local: LocalSession, name: string) {
    super({ mode: 'p2p', title: local.title, code: `${local.address}:${local.port}`, me: '' });
    this.presenterName = local.presenter;
    this.ws = new WebSocket(`ws://${local.address}:${local.port}`);
    this.ws.onopen = () => this.signal({ t: 'hello', name, hostname: window.scw.hostname });
    this.ws.onmessage = (ev) => void this.onSignal(JSON.parse(String(ev.data)) as SignalMsg);
    this.ws.onclose = () => this.end('Yerli paylaşım bitdi.');
    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) this.signal({ t: 'ice', candidate: ev.candidate.toJSON() });
    };
    this.pc.ontrack = (ev) => this.update({ remoteStream: ev.streams[0] ?? new MediaStream([ev.track]) });
    this.pc.ondatachannel = (ev) => {
      this.dc = ev.channel;
      this.dc.onmessage = (m) => {
        try {
          this.emitAnno(JSON.parse(String(m.data)) as AnnoEvent);
        } catch {
          // ignore
        }
      };
    };
  }

  static connect(local: LocalSession, name: string): Promise<P2PViewerSession> {
    const s = new P2PViewerSession(local, name);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Təqdimatçıya qoşulmaq olmur.')), 6000);
      const off = s.subscribe(() => {
        const snap = s.getSnapshot();
        if (snap.me || snap.ended) {
          clearTimeout(timer);
          off();
          if (snap.ended) reject(new Error(snap.ended));
          else resolve(s);
        }
      });
    });
  }

  private signal(msg: SignalMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private setPeople(peers: { id: string; name: string }[]): void {
    const people: Person[] = peers.map((p) => ({
      id: p.id,
      name: p.name,
      host: p.id === HOST_ID,
      presenting: p.id === HOST_ID,
      me: p.id === this.snap.me,
      voice: 'off' as const,
      micOn: false,
    }));
    this.update({ people });
  }

  private async onSignal(msg: SignalMsg): Promise<void> {
    switch (msg.t) {
      case 'welcome':
        this.presenterName = msg.presenter;
        this.update({ me: msg.id, title: msg.title });
        this.setPeople(msg.peers);
        break;
      case 'peers':
        this.setPeople(msg.peers);
        break;
      case 'sdp': {
        await this.pc.setRemoteDescription(msg.sdp);
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.signal({ t: 'sdp', sdp: answer });
        break;
      }
      case 'ice':
        await this.pc.addIceCandidate(msg.candidate).catch(() => undefined);
        break;
      case 'full':
        this.end('Yerli paylaşım doludur (ən çox 5 izləyici).');
        break;
      case 'kicked':
        this.end(`${this.presenterName} sizi paylaşımdan çıxartdı.`);
        break;
      case 'ended':
        this.end('Təqdimatçı paylaşımı bitirdi.');
        break;
      case 'hello':
        break;
    }
  }

  private end(why: string): void {
    if (this.snap.ended) return;
    this.pc.close();
    this.ws.close();
    this.update({ ended: why, remoteStream: null });
  }

  async startShare(): Promise<void> {
    throw new Error('Yerli rejimdə yalnız təqdimatçı paylaşır.');
  }

  async stopShare(): Promise<void> {}

  async setPaused(): Promise<void> {}

  sendAnno(msg: AnnoMsg): void {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(msg));
  }

  async hostAction(): Promise<void> {}

  async setMic(): Promise<void> {}

  async takeRoomMic(): Promise<void> {}

  async leave(): Promise<void> {
    this.end('Paylaşımdan çıxdınız.');
  }
}
