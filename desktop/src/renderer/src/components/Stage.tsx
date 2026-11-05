import { CopyOutlined, DesktopOutlined, LogoutOutlined, PauseOutlined, PoweroffOutlined, StopOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Flex, Popconfirm, Space, Tag, Typography } from 'antd';
import type { HostAction, Session, Snapshot } from '../session/Session';
import { MicControl } from './MicControl';
import { Viewer } from './Viewer';

interface Props {
  session: Session | null;
  snap: Snapshot | null;
  busy: boolean;
  onShare: () => void;
  onLeave: () => void;
  onHostAction: (action: HostAction, target?: string) => void;
  onPause: (paused: boolean) => void;
  onStop: () => void;
}

function PresenterPanel({ snap, onPause, onStop }: { snap: Snapshot; onPause: (p: boolean) => void; onStop: () => void }) {
  const viewers = snap.people.filter((p) => !p.me);
  return (
    <Flex vertical align="center" justify="center" className="presenter-panel" gap={20}>
      <div className={`live-dot${snap.paused ? ' paused' : ''}`} />
      <Typography.Title level={3} className="no-margin">
        {snap.paused ? 'Paylaşım fasilədədir' : 'Ekranınız paylaşılır'}
      </Typography.Title>
      <Typography.Text type="secondary">
        {snap.paused
          ? 'İzləyənlər fasilədən əvvəlki son görüntünü görür.'
          : 'Qırmızı çərçivə paylaşılan ekranı göstərir. İzləyənlərin göstəriciləri ekranınızda görünür.'}
      </Typography.Text>
      <Space>
        <Button size="large" icon={snap.paused ? <DesktopOutlined /> : <PauseOutlined />} onClick={() => onPause(!snap.paused)}>
          {snap.paused ? 'Davam et' : 'Fasilə'}
        </Button>
        <Button size="large" danger type="primary" icon={<StopOutlined />} onClick={onStop}>
          Dayandır
        </Button>
      </Space>
      {snap.notifyResult === 'unsupported' && (
        <Alert
          type="info"
          showIcon
          title="Bildirişləri özünüz söndürün"
          description={
            window.scw.platform === 'darwin'
              ? 'macOS proqramlara “Narahat etməyin” rejimini açmağa icazə vermir. İdarəetmə mərkəzindən Fokus rejimini açın.'
              : 'Bu iş masası mühitində bildirişləri avtomatik gizlətmək olmur.'
          }
        />
      )}
      {snap.notifyResult === 'failed' && <Alert type="warning" showIcon title="Bildirişləri gizlətmək alınmadı." />}
      <div className="watchers">
        <Typography.Text type="secondary">İZLƏYƏNLƏR ({viewers.length})</Typography.Text>
        <Flex wrap gap={6} className="watchers-list">
          {viewers.length === 0 ? (
            <Typography.Text type="secondary">Hələ heç kim izləmir</Typography.Text>
          ) : (
            viewers.map((v) => <Tag key={v.id}>{v.name}</Tag>)
          )}
        </Flex>
      </div>
    </Flex>
  );
}

export function Stage({ session, snap, busy, onShare, onLeave, onHostAction, onPause, onStop }: Props) {
  if (!session || !snap) {
    return (
      <Flex className="stage" align="center" justify="center">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Soldan otaq seçin və ya yeni otaq yaradın" />
      </Flex>
    );
  }

  const me = snap.people.find((p) => p.me);
  const presenter = snap.people.find((p) => p.presenting && !p.me);

  return (
    <Flex vertical className="stage">
      <Flex align="center" justify="space-between" className="stage-head">
        <Space size={12}>
          <Typography.Text strong className="stage-title">
            {snap.title}
          </Typography.Text>
          {snap.mode === 'server' ? (
            <Typography.Text type="secondary" copyable={{ text: snap.code, icon: <CopyOutlined />, tooltips: ['Kodu kopyala', 'Kopyalandı'] }}>
              Kod: {snap.code}
            </Typography.Text>
          ) : (
            <Tag color="warning">Yerli rejim</Tag>
          )}
        </Space>
        <Space>
          <MicControl session={session} snap={snap} />
          {me?.host && snap.mode === 'server' && (
            <Popconfirm
              title="Otaq hamı üçün bağlansın?"
              okText="Bağla"
              cancelText="Xeyr"
              okButtonProps={{ danger: true }}
              onConfirm={() => onHostAction('end')}
            >
              <Button size="small" danger icon={<PoweroffOutlined />}>
                Otağı bağla
              </Button>
            </Popconfirm>
          )}
          <Button size="small" icon={<LogoutOutlined />} onClick={onLeave}>
            {snap.mode === 'p2p' && snap.presenting ? 'Paylaşımı bitir' : 'Çıx'}
          </Button>
        </Space>
      </Flex>

      {snap.presenting ? (
        <PresenterPanel snap={snap} onPause={onPause} onStop={onStop} />
      ) : presenter && snap.remoteStream ? (
        <Viewer session={session} snap={snap} />
      ) : presenter ? (
        <Flex className="stage-body" align="center" justify="center">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`${presenter.name} ekranını paylaşır — yüklənir…`} />
        </Flex>
      ) : (
        <Flex className="stage-body" vertical align="center" justify="center" gap={16}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Hələ heç kim ekranını paylaşmır" />
          {snap.mode === 'server' && (
            <Button type="primary" size="large" icon={<DesktopOutlined />} loading={busy} onClick={onShare}>
              Ekranımı paylaş
            </Button>
          )}
        </Flex>
      )}
    </Flex>
  );
}
