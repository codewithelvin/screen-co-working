import { AudioMutedOutlined, AudioOutlined, LoadingOutlined, SettingOutlined, TeamOutlined, WarningOutlined } from '@ant-design/icons';
import { App, Button, Dropdown, type MenuProps, Space, Tag, Tooltip } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { AudioDevices, Session, Snapshot } from '../session/Session';

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

  const micIssue = snap.micChecking ? (
    <Tooltip title="Mikrofondan səs gəlmir. Kompüterdəki digər mikrofonlar yoxlanılır.">
      <Tag icon={<LoadingOutlined />}>Mikrofon yoxlanılır…</Tag>
    </Tooltip>
  ) : snap.micProblem === 'blocked' ? (
    <Tooltip title="Windows bu proqrama mikrofonu vermir və səsiniz eşidilmir. Düymə Windows-da «Masaüstü proqramlara mikrofona icazə ver» seçimini açır.">
      <Button
        size="small"
        danger
        icon={<WarningOutlined />}
        loading={busy}
        onClick={() => void run(() => session.allowMic(), 'İcazəni açmaq alınmadı. Windows parametrlərində açın.')}
      >
        Mikrofona icazə ver
      </Button>
    </Tooltip>
  ) : snap.micProblem === 'blocked-device' ? (
    <Tooltip title="Bu kompüterdə mikrofon Windows parametrlərində tam söndürülüb. Onu yalnız administrator aça bilər.">
      <Button size="small" danger icon={<WarningOutlined />} onClick={() => void window.scw.openMicSettings()}>
        Mikrofon söndürülüb
      </Button>
    </Tooltip>
  ) : snap.micProblem === 'silent' ? (
    <Tooltip title="Mikrofondan səs gəlmir və başqa işlək mikrofon tapılmadı. Mikrofonun qoşulduğunu və səsinin bağlı olmadığını yoxlayın.">
      <Button size="small" danger icon={<WarningOutlined />} onClick={() => void window.scw.openMicSettings()}>
        Mikrofondan səs gəlmir
      </Button>
    </Tooltip>
  ) : null;

  return (
    <Space size={6}>
      {locationHint}
      {snap.micOn && micIssue}
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
      <DevicePicker session={session} />
    </Space>
  );
}

/** Which microphone and speaker the call uses; Windows' default is often a monitor without speakers. */
function DevicePicker({ session }: { session: Session }) {
  const { message } = App.useApp();
  const [devices, setDevices] = useState<AudioDevices | null>(null);

  const load = () =>
    void session
      .audioDevices()
      .then(setDevices)
      .catch(() => setDevices(null));

  const name = (d: MediaDeviceInfo, i: number) =>
    d.deviceId === 'default' ? `Windows-un seçimi${d.label ? ` (${d.label.replace(/^Default - /, '')})` : ''}` : d.label || `Cihaz ${i + 1}`;

  const items: MenuProps['items'] = devices
    ? [
        {
          type: 'group',
          label: 'Mikrofon',
          children: devices.mics.map((d, i) => ({ key: `audioinput:${d.deviceId}`, label: name(d, i) })),
        },
        { type: 'divider' },
        {
          type: 'group',
          label: 'Dinamik',
          children: devices.speakers.map((d, i) => ({ key: `audiooutput:${d.deviceId}`, label: name(d, i) })),
        },
      ]
    : [{ key: 'loading', label: 'Cihazlar yüklənir…', disabled: true }];

  const pick: MenuProps['onClick'] = ({ key }) => {
    const [kind, ...rest] = key.split(':');
    if (kind !== 'audioinput' && kind !== 'audiooutput') return;
    session
      .setAudioDevice(kind, rest.join(':'))
      .then(load)
      .catch(() => message.error('Cihazı dəyişmək alınmadı.'));
  };

  return (
    <Dropdown
      trigger={['click']}
      onOpenChange={(open) => open && load()}
      menu={{
        items,
        onClick: pick,
        selectable: true,
        selectedKeys: devices ? [`audioinput:${devices.mic}`, `audiooutput:${devices.speaker}`] : [],
      }}
    >
      <Tooltip title="Mikrofon və dinamik">
        <Button size="small" icon={<SettingOutlined />} aria-label="Səs cihazları" />
      </Tooltip>
    </Dropdown>
  );
}
