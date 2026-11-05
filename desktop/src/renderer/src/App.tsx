import { App as AntApp, Flex, Spin } from 'antd';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { LocalSession, ScreenSource, Settings, UpdateState } from '../../shared/types';
import { ApiError, api } from './api';
import { ScreenPicker } from './components/ScreenPicker';
import { Setup } from './components/Setup';
import { Sidebar } from './components/Sidebar';
import { Stage } from './components/Stage';
import { UpdateAction, UpdateGate } from './components/UpdateGate';
import { LiveKitSession } from './session/LiveKitSession';
import { P2PHostSession, P2PViewerSession } from './session/P2PSession';
import type { HostAction, Session, Snapshot } from './session/Session';

const HEALTH_POLL_MS = 3000;
const LOCAL_POLL_MS = 2000;

const noop = () => () => {};
const nothing = (): Snapshot | null => null;

function errorText(e: unknown): string {
  if (e instanceof DOMException && e.name === 'NotAllowedError') return 'Ekranı paylaşmağa icazə verilmədi.';
  return e instanceof Error ? e.message : String(e);
}

export function App() {
  const { message, notification, modal } = AntApp.useApp();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [serverUp, setServerUp] = useState<boolean | null>(null);
  const [localSessions, setLocalSessions] = useState<LocalSession[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' });
  /** The server refused a join because this version is too old. */
  const [refused, setRefused] = useState(false);
  /** What to do with the monitor chosen in the picker. */
  const [picker, setPicker] = useState<null | { kind: 'room' } | { kind: 'local'; title: string }>(null);
  const sessionRef = useRef<Session | null>(null);
  /** Sessions being left on purpose: no "session ended" message for those. */
  const leaving = useRef(new WeakSet<Session>());

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const snap = useSyncExternalStore(session?.subscribe ?? noop, session?.getSnapshot ?? nothing);

  // While watching a shared screen the sidebar folds away for space; the user can open it again,
  // and that choice holds until watching starts or stops.
  const watching = !!snap?.remoteStream && !snap.presenting;
  const [sidebarChoice, setSidebarChoice] = useState<{ watching: boolean; open: boolean } | null>(null);
  const sidebarOpen = sidebarChoice?.watching === watching ? sidebarChoice.open : !watching;
  const toggleSidebar = () => setSidebarChoice({ watching, open: !sidebarOpen });

  useEffect(() => {
    void window.scw.getSettings().then((s) => {
      setSettings(s);
      if (!s.name) setSetupOpen(true);
    });
  }, []);

  // Is the server reachable? If not, fall back to local discovery (D10). Rooms are private (D46): no list.
  useEffect(() => {
    if (!settings) return;
    let stop = false;
    const tick = async () => {
      try {
        await api.health(settings.server);
        if (!stop) setServerUp(true);
      } catch {
        if (!stop) setServerUp(false);
      }
    };
    void tick();
    const t = setInterval(() => void tick(), HEALTH_POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [settings]);

  useEffect(() => {
    if (serverUp !== false) return;
    const tick = () => void window.scw.listLocalSessions().then(setLocalSessions);
    tick();
    const t = setInterval(tick, LOCAL_POLL_MS);
    return () => clearInterval(t);
  }, [serverUp]);

  useEffect(
    () =>
      window.scw.onUpdate((s: UpdateState) => {
        setUpdate(s);
        // A required update gets the blocking UpdateGate instead of this optional notice.
        if (s.status === 'ready' && !s.required) {
          notification.info({
            key: 'update',
            title: `Yeni versiya hazırdır (v${s.version})`,
            description: <UpdateAction update={s} small />,
            duration: 0,
          });
        }
      }),
    [notification],
  );

  // A session that ended by itself (kicked, room closed, presenter left).
  useEffect(() => {
    if (!session) return;
    return session.subscribe(() => {
      const why = session.getSnapshot().ended;
      if (!why) return;
      setSession((cur) => (cur === session ? null : cur));
      if (!leaving.current.has(session)) message.info(why);
    });
  }, [session, message]);

  const leave = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    leaving.current.add(s);
    sessionRef.current = null;
    setSession(null);
    await s.leave().catch(() => undefined);
  }, []);

  const confirmSwitch = (): Promise<boolean> =>
    new Promise((resolve) => {
      if (!sessionRef.current?.getSnapshot().presenting) return resolve(true);
      modal.confirm({
        title: 'Paylaşımı dayandırıb başqa otağa keçirsiniz?',
        okText: 'Bəli',
        cancelText: 'Xeyr',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });

  /** Resolves true once in the room, so the code box can clear. */
  const joinRoom = async (code: string): Promise<boolean> => {
    if (!settings || busy || !(await confirmSwitch())) return false;
    setBusy(true);
    try {
      await leave();
      setSession(await LiveKitSession.connect(settings.server, code.trim().toUpperCase(), settings.name));
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.updateRequired) {
        setRefused(true);
        void window.scw.checkUpdate();
      } else {
        message.error(errorText(e));
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createRoom = async (title: string) => {
    if (!settings) return;
    try {
      const r = await api.createRoom(settings.server, title);
      await joinRoom(r.code);
    } catch (e) {
      message.error(errorText(e));
    }
  };

  const joinLocal = async (s: LocalSession) => {
    if (!settings || busy) return;
    setBusy(true);
    try {
      await leave();
      setSession(await P2PViewerSession.connect(s, settings.name));
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const picked = async (source: ScreenSource) => {
    const what = picker;
    setPicker(null);
    if (!what || !settings) return;
    setBusy(true);
    try {
      if (what.kind === 'local') {
        await leave();
        const s = new P2PHostSession(what.title, settings.name);
        await s.startShare(source);
        setSession(s);
      } else {
        await sessionRef.current?.startShare(source);
      }
    } catch (e) {
      message.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const hostAction = async (action: HostAction, target?: string) => {
    try {
      await sessionRef.current?.hostAction(action, target);
    } catch (e) {
      message.error(errorText(e));
    }
  };

  if (!settings) {
    return (
      <Flex className="full" align="center" justify="center">
        <Spin />
      </Flex>
    );
  }

  return (
    <div className="layout">
      {sidebarOpen && (
      <Sidebar
        name={settings.name}
        serverUp={serverUp}
        localSessions={localSessions}
        snap={snap}
        busy={busy}
        onJoinRoom={joinRoom}
        onCreateRoom={(t) => void createRoom(t)}
        onJoinLocal={(s) => void joinLocal(s)}
        onStartLocal={(title) => setPicker({ kind: 'local', title })}
        onHostAction={(a, t) => void hostAction(a, t)}
        onSettings={() => setSetupOpen(true)}
      />
      )}
      <Stage
        session={session}
        snap={snap}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        busy={busy}
        onShare={() => setPicker({ kind: 'room' })}
        onLeave={() => void leave()}
        onHostAction={(a, t) => void hostAction(a, t)}
        onPause={(p) => void session?.setPaused(p)}
        onStop={() => void (snap?.mode === 'p2p' ? leave() : session?.stopShare())}
      />
      <UpdateGate open={(refused || ('required' in update && update.required)) && !session} update={update} />
      <ScreenPicker open={picker !== null} onPick={(s) => void picked(s)} onCancel={() => setPicker(null)} />
      <Setup
        open={setupOpen}
        initialName={settings.name || window.scw.suggestedName}
        firstRun={!settings.name}
        onCancel={() => setSetupOpen(false)}
        onSave={(name) => {
          void window.scw.saveSettings({ name }).then(() => {
            setSettings({ ...settings, name });
            setSetupOpen(false);
          });
        }}
      />
    </div>
  );
}
