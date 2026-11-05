import { CloudDownloadOutlined } from '@ant-design/icons';
import { Button, Flex, Modal, Progress, Typography } from 'antd';
import type { UpdateState } from '../../../shared/types';

/**
 * The server no longer accepts this version (it refused a join, or latest.json sets a higher
 * minVersion). Nothing else can be done until the app updates; it downloads on its own and the
 * user restarts with one click. Never shown in the middle of a room: App waits until they leave.
 */
export function UpdateGate({ open, update }: { open: boolean; update: UpdateState }) {
  const retry = () => void window.scw.checkUpdate();
  return (
    <Modal open={open} closable={false} mask={{ closable: false }} keyboard={false} footer={null} width={460} centered>
      <Flex vertical align="center" gap={14} className="update-gate">
        <CloudDownloadOutlined className="update-gate-icon" />
        <Typography.Title level={4} className="no-margin">
          Yeni versiya tələb olunur
        </Typography.Title>
        <Typography.Text type="secondary">
          Bu versiya (v{window.scw.version}) artıq dəstəklənmir. Otaqlara qoşulmaq üçün proqramı yeniləyin.
        </Typography.Text>
        {update.status === 'downloading' && (
          <>
            <Progress percent={100} status="active" showInfo={false} />
            <Typography.Text>v{update.version} yüklənir…</Typography.Text>
          </>
        )}
        {update.status === 'ready' && (
          <Button type="primary" size="large" onClick={() => void window.scw.installUpdate()}>
            Yenidən başlat və yenilə (v{update.version})
          </Button>
        )}
        {(update.status === 'error' || update.status === 'idle') && (
          <>
            <Typography.Text type="danger">
              {update.status === 'error' ? 'Yeni versiyanı yükləmək alınmadı.' : 'Yeni versiya serverdə tapılmadı.'}
            </Typography.Text>
            <Button size="large" onClick={retry}>
              Yenidən cəhd et
            </Button>
          </>
        )}
      </Flex>
    </Modal>
  );
}
