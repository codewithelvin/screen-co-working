import { AudioMutedOutlined, AudioOutlined, LoadingOutlined, TeamOutlined } from '@ant-design/icons';
import { App, Button, Space, Tag, Tooltip } from 'antd';
import { useState } from 'react';
import type { Session, Snapshot } from '../session/Session';

/**
 * Voice (D36–D39): only people away from the others may talk. Someone sitting with
 * two or more call members is silent; their group talks and listens through one
 * "room mic" laptop. The mic always starts muted.
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

  if (snap.mode !== 'server' || snap.voice === 'off') return null;

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
        {snap.micOn ? 'Mikrofonu bağla' : 'Mikrofonu aç'}
      </Button>
    </Space>
  );
}
