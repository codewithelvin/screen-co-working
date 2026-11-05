import { CheckOutlined, CloudDownloadOutlined, LoadingOutlined, SyncOutlined } from '@ant-design/icons';
import { App, Button, Tooltip } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { BREW_UPGRADE } from '../../../shared/config';
import type { UpdateState } from '../../../shared/types';

/**
 * Next to the version in the sidebar footer: "update now" once a new version is downloaded,
 * progress while it downloads, otherwise a manual check (the app also checks every 5 minutes).
 */
export function UpdateButton({ update }: { update: UpdateState }) {
  const { message } = App.useApp();
  const [checking, setChecking] = useState(false);
  const [upToDate, setUpToDate] = useState(false);
  const latest = useRef(update);
  useEffect(() => {
    latest.current = update;
  }, [update]);

  if (update.status === 'downloading') {
    return (
      <Tooltip title={`v${update.version} yüklənir; hazır olanda bu düymə ilə yeniləyin.`}>
        <Button size="small" type="text" icon={<LoadingOutlined />} disabled>
          v{update.version}
        </Button>
      </Tooltip>
    );
  }

  if (update.status === 'ready') {
    if (update.how === 'brew') {
      return (
        <Tooltip title={`Terminalda: ${BREW_UPGRADE}`}>
          <Button
            size="small"
            type="primary"
            icon={<CloudDownloadOutlined />}
            onClick={() =>
              void navigator.clipboard.writeText(BREW_UPGRADE).then(() => message.success('Əmr kopyalandı; terminalda işə salın.'))
            }
          >
            Yenilə v{update.version}
          </Button>
        </Tooltip>
      );
    }
    return (
      <Tooltip title={update.how === 'installer' ? 'Quraşdırıcını açır.' : 'Proqram bağlanıb yeni versiya ilə açılır.'}>
        <Button
          size="small"
          type="primary"
          icon={<CloudDownloadOutlined />}
          onClick={() => void window.scw.installUpdate()}
        >
          Yenilə v{update.version}
        </Button>
      </Tooltip>
    );
  }

  const check = async () => {
    setChecking(true);
    setUpToDate(false);
    try {
      await window.scw.checkUpdate();
    } finally {
      setChecking(false);
    }
    // The state arrives as an event before the check resolves.
    const s = latest.current;
    if (s.status === 'error') message.error('Yeniləməni yoxlamaq alınmadı.');
    else if (s.status === 'idle') setUpToDate(true);
  };

  return (
    <Tooltip title={upToDate ? 'Ən son versiyadır.' : 'Yeni versiyanı yoxla'}>
      <Button
        size="small"
        type="text"
        aria-label="Yeniləməni yoxla"
        icon={checking ? <LoadingOutlined /> : upToDate ? <CheckOutlined /> : <SyncOutlined />}
        disabled={checking}
        onClick={() => void check()}
      />
    </Tooltip>
  );
}
