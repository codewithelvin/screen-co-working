import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AnnoEvent, ScwApi, SignalMsg, UpdateState } from '../shared/types';

function listen<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const handler = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as A));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const info = ipcRenderer.sendSync('app:info') as { hostname: string; version: string; suggestedName: string };

const api: ScwApi = {
  platform: process.platform,
  hostname: info.hostname,
  version: info.version,
  suggestedName: info.suggestedName,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  listScreens: () => ipcRenderer.invoke('screens:list'),
  chooseScreen: (id) => ipcRenderer.invoke('screens:choose', id),
  overlayShow: (displayId, presenterName) => ipcRenderer.invoke('overlay:show', displayId, presenterName),
  overlayHide: () => ipcRenderer.invoke('overlay:hide'),
  overlayEvent: (e) => ipcRenderer.send('overlay:event', e),
  muteNotifications: (mute) => ipcRenderer.invoke('notify:mute', mute),
  wifiFingerprint: () => ipcRenderer.invoke('wifi:fingerprint'),
  p2pHostStart: (title, presenter) => ipcRenderer.invoke('p2p:host-start', title, presenter),
  p2pHostStop: () => ipcRenderer.invoke('p2p:host-stop'),
  p2pHostSend: (peerId, msg) => ipcRenderer.send('p2p:host-send', peerId, msg),
  p2pHostKick: (peerId) => ipcRenderer.send('p2p:host-kick', peerId),
  onP2pPeerMessage: (cb) => listen<[string, SignalMsg]>('p2p:peer-message', cb),
  onP2pPeerClosed: (cb) => listen<[string]>('p2p:peer-closed', cb),
  listLocalSessions: () => ipcRenderer.invoke('p2p:sessions'),
  onUpdate: (cb) => listen<[UpdateState]>('update:state', cb),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onOverlayEvent: (cb) => listen<[AnnoEvent]>('overlay:event', cb),
  onOverlayInit: (cb) => listen<[string]>('overlay:init', cb),
};

contextBridge.exposeInMainWorld('scw', api);
