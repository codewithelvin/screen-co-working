import { Modal, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { ScreenSource } from '../../../shared/types';

interface Props {
  open: boolean;
  onPick: (s: ScreenSource) => void;
  onCancel: () => void;
}

/** Entire screen only (D6). Mounted only while the modal is open, so thumbnails are always fresh. */
function ScreenGrid({ onPick }: { onPick: (s: ScreenSource) => void }) {
  const [sources, setSources] = useState<ScreenSource[] | null>(null);

  useEffect(() => {
    void window.scw.listScreens().then(setSources);
  }, []);

  return !sources ? (
    <div className="center-pad">
      <Spin />
    </div>
  ) : (
    <div className="screen-grid">
      {sources.map((s) => (
        <button key={s.id} className="screen-card" onClick={() => onPick(s)}>
          <img src={s.thumbnail} alt="" />
          <span>{s.name}</span>
        </button>
      ))}
    </div>
  );
}

export function ScreenPicker({ open, onPick, onCancel }: Props) {
  return (
    <Modal open={open} title="Hansı ekranı paylaşırsınız?" onCancel={onCancel} footer={null} width={720} destroyOnHidden>
      {window.scw.platform === 'darwin' && (
        <Typography.Paragraph type="secondary">
          İlk dəfə macOS “Ekran yazısı” icazəsi soruşacaq: Sistem Parametrləri → Məxfilik və Təhlükəsizlik → Ekran və
          sistem audio yazısı.
        </Typography.Paragraph>
      )}
      <ScreenGrid onPick={onPick} />
    </Modal>
  );
}
