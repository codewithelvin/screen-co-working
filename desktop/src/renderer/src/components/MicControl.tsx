import { AudioMutedOutlined, AudioOutlined, LoadingOutlined, TeamOutlined } from '@ant-design/icons';
import { App, Button, Space, Tag, Tooltip } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { Session, Snapshot } from '../session/Session';

/**
 * Voice (D36–D39): only people away from the others may talk. Someone sitting with
 * another call member is silent; their group talks and listens through one "room mic"
 * laptop. The mic always starts muted. Space toggles it (except while typing).
 */
export function MicControl({ session, snap }: { session: Session; snap: Snapshot }) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>, fail: string) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      message.error(fail);
    } finally {
      setBusy(false);
    }
  };

  // Space = mute/unmute, whenever this person may talk. Captured before buttons see it, so a
  // focused button doesn't also "click" on the same key press.
  const canTalk = snap.mode === 'server' && (snap.voice === 'remote' || snap.voice === 'room-mic');
  const toggle = useRef<() => void>(() => undefined);
  useEffect(() => {
    toggle.current = () => {
      if (!busy) void run(() => session.setMic(!snap.micOn), 'Mikrofonu açmaq alınmadı. Mikrofona icazəni yoxlayın.');
    };
  });
  useEffect(() => {
    if (!canTalk) return;
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) toggle.current();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e.target)) e.preventDefault();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
  }, [canTalk]);

  if (snap.mode !== 'server' || snap.voice === 'off') return null;

  // Without access points the server can't see who sits together and treats this person as alone.
  const locationHint =
    snap.wifi === 'denied' ? (
      <Tooltip title="Windows Wi-Fi şəbəkələrini göstərmir, ona görə yanınızda kimin olduğu bilinmir. Parametrlərdə «Masaüstü proqramlara yerləşməyə icazə ver» seçimini açın.">
        <Button size="small" danger onClick={() => void window.scw.openLocationSettings()}>
          Yerləşməni açın
        </Button>
      </Tooltip>
    ) : null;

  if (snap.voice === 'unknown') {
    return (
      <Space size={6}>
        <Tooltip title="Windows Wi-Fi şəbəkələrini göstərmir, ona görə yanınızda kimin olduğu bilinmir. Yerləşməni açana qədər mikrofon bağlıdır.">
          <Tag icon={<AudioMutedOutlined />}>Mikrofon bağlıdır</Tag>
        </Tooltip>
        <Button size="small" danger onClick={() => void window.scw.openLocationSettings()}>
          Yerləşməni açın
        </Button>
      </Space>
    );
  }

  if (snap.voice === 'pending') {
    return (
      <Tooltip title="Yanınızda zəngdə olan başqa adamların olub-olmadığı yoxlanılır.">
        <Tag icon={<LoadingOutlined />}>Səs yoxlanılır…</Tag>
      </Tooltip>
    );
  }

  if (snap.voice === 'group') {
    const holder = snap.people.find((p) => p.id === snap.roomMic)?.name;
    return (
      <Space size={6}>
        <Tooltip
          title={`Yanınızda zəngdə olan başqa adamlar var. Qrupunuz ${holder ? `${holder} adlı iştirakçının` : 'bir'} kompüteri ilə danışır və eşidir.`}
        >
          <Tag icon={<TeamOutlined />} className="voice-tag">
            Qrup səsi{holder ? `: ${holder}` : ''}
          </Tag>
        </Tooltip>
        <Button
          size="small"
          loading={busy}
          onClick={() => void run(() => session.takeRoomMic(), 'Otaq mikrofonunu götürmək alınmadı.')}
        >
          Otaq mikrofonunu götür
        </Button>
      </Space>
    );
  }

  return (
    <Space size={6}>
      {locationHint}
      {snap.voice === 'room-mic' && (
        <Tooltip title="Yanınızdakılar sizin kompüterinizlə danışır və eşidir.">
          <Tag color="processing" icon={<TeamOutlined />}>
            Otaq mikrofonu
          </Tag>
        </Tooltip>
      )}
      <Button
        size="small"
        type={snap.micOn ? 'primary' : 'default'}
        icon={snap.micOn ? <AudioOutlined /> : <AudioMutedOutlined />}
        loading={busy}
        className="mic-button"
        onClick={() =>
          void run(() => session.setMic(!snap.micOn), 'Mikrofonu açmaq alınmadı. Mikrofona icazəni yoxlayın.')
        }
      >
        {snap.micOn ? 'Mikrofonu bağla' : 'Mikrofonu aç'} <span className="kbd">Space</span>
      </Button>
    </Space>
  );
}
