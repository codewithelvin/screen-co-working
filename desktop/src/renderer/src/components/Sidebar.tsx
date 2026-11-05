import {
  AudioOutlined,
  CrownFilled,
  DesktopOutlined,
  EllipsisOutlined,
  PlusOutlined,
  SettingOutlined,
  TeamOutlined,
  WifiOutlined,
} from '@ant-design/icons';
import { Badge, Button, Dropdown, Flex, Input, Modal, Space, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import type { LocalSession } from '../../../shared/types';
import type { RoomInfo } from '../api';
import type { HostAction, Snapshot } from '../session/Session';

interface Props {
  name: string;
  serverUp: boolean | null;
  rooms: RoomInfo[];
  localSessions: LocalSession[];
  snap: Snapshot | null;
  busy: boolean;
  onJoinRoom: (code: string) => Promise<boolean>;
  onCreateRoom: (title: string) => void;
  onJoinLocal: (s: LocalSession) => void;
  onStartLocal: (title: string) => void;
  onHostAction: (action: HostAction, target: string) => void;
  onSettings: () => void;
}

export function Sidebar(p: Props) {
  const [createOpen, setCreateOpen] = useState<'room' | 'local' | null>(null);
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const me = p.snap?.people.find((x) => x.me);

  const submitCreate = () => {
    const t = title.trim() || `${p.name} otağı`;
    if (createOpen === 'room') p.onCreateRoom(t);
    else p.onStartLocal(t);
    setCreateOpen(null);
    setTitle('');
  };

  // A mistyped code stays in the box to fix; a successful join clears it.
  const joinByCode = async () => {
    if (code && (await p.onJoinRoom(code))) setCode('');
  };

  return (
    <Flex vertical className="sidebar">
      <Flex align="center" justify="space-between" className="sidebar-head">
        <Space size={8}>
          <DesktopOutlined className="logo" />
          <Typography.Text strong>Screen Co-Working</Typography.Text>
        </Space>
        <Tooltip title="Parametrlər">
          <Button type="text" size="small" icon={<SettingOutlined />} onClick={p.onSettings} />
        </Tooltip>
      </Flex>

      <div className="sidebar-status">
        {p.serverUp === null ? (
          <Tag>Server yoxlanılır…</Tag>
        ) : p.serverUp ? (
          <Tag color="success" icon={<WifiOutlined />}>
            Serverə qoşulub
          </Tag>
        ) : (
          <Tooltip title="Server əlçatmazdır. Kiçik qruplar üçün birbaşa şəbəkə üzərindən paylaşmaq olar (ən çox 5 izləyici).">
            <Tag color="warning">Yerli rejim</Tag>
          </Tooltip>
        )}
      </div>

      <div className="sidebar-scroll">
        {p.serverUp ? (
          <>
            <Flex align="center" justify="space-between" className="section-head">
              <Typography.Text type="secondary">OTAQLAR</Typography.Text>
              <Tooltip title="Yeni otaq">
                <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => setCreateOpen('room')} />
              </Tooltip>
            </Flex>
            <Space.Compact block className="code-join">
              <Input
                size="small"
                placeholder="Otaq kodu"
                value={code}
                maxLength={12}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onPressEnter={() => void joinByCode()}
              />
              <Button size="small" disabled={!code || p.busy} onClick={() => void joinByCode()}>
                Qoşul
              </Button>
            </Space.Compact>
            {p.rooms.length === 0 && <div className="muted-row">Açıq otaq yoxdur</div>}
            {p.rooms.map((r) => {
              const active = p.snap?.mode === 'server' && p.snap.code === r.code;
              const presenter = r.participants.find((x) => x.presenting);
              return (
                <button
                  key={r.code}
                  className={`room-row${active ? ' active' : ''}`}
                  disabled={p.busy || active}
                  onClick={() => void p.onJoinRoom(r.code)}
                >
                  <Badge status={presenter ? 'processing' : 'default'} />
                  <span className="room-title">{r.title}</span>
                  <span className="room-count">
                    <TeamOutlined /> {r.participants.length}
                  </span>
                </button>
              );
            })}
          </>
        ) : p.serverUp === false ? (
          <>
            <Flex align="center" justify="space-between" className="section-head">
              <Typography.Text type="secondary">YERLİ PAYLAŞIMLAR</Typography.Text>
            </Flex>
            {p.localSessions.length === 0 && <div className="muted-row">Şəbəkədə paylaşım tapılmadı</div>}
            {p.localSessions.map((s) => {
              const active = p.snap?.mode === 'p2p' && p.snap.code === `${s.address}:${s.port}`;
              return (
                <button
                  key={s.id}
                  className={`room-row${active ? ' active' : ''}`}
                  disabled={p.busy || active || !!p.snap?.presenting}
                  onClick={() => p.onJoinLocal(s)}
                >
                  <Badge status="processing" />
                  <span className="room-title">
                    {s.title}
                    <span className="room-sub">{s.presenter}</span>
                  </span>
                  <span className="room-count">
                    <TeamOutlined /> {s.viewers}/5
                  </span>
                </button>
              );
            })}
            <Button
              block
              size="small"
              icon={<DesktopOutlined />}
              className="local-share"
              disabled={p.busy || !!p.snap}
              onClick={() => setCreateOpen('local')}
            >
              Ekranımı yerli paylaş
            </Button>
          </>
        ) : null}

        {p.snap && (
          <>
            <div className="section-head">
              <Typography.Text type="secondary">İŞTİRAKÇILAR ({p.snap.people.length})</Typography.Text>
            </div>
            {p.snap.people.map((x) => {
              const items = [
                ...(x.presenting && !x.me ? [{ key: 'stopShare', label: 'Paylaşımı dayandır' }] : []),
                { key: 'kick', label: p.snap?.mode === 'p2p' ? 'Paylaşımdan çıxart' : 'Otaqdan çıxart', danger: true },
              ];
              return (
                <Flex key={x.id} align="center" gap={6} className="person-row">
                  <span className="person-name">
                    {x.name}
                    {x.me && <span className="room-sub"> (siz)</span>}
                  </span>
                  {x.host && (
                    <Tooltip title="Otağın sahibi">
                      <CrownFilled className="crown" />
                    </Tooltip>
                  )}
                  {x.micOn && (
                    <Tooltip title={x.voice === 'room-mic' ? 'Danışır (otaq mikrofonu)' : 'Mikrofonu açıqdır'}>
                      <AudioOutlined className="mic-icon" />
                    </Tooltip>
                  )}
                  {x.presenting && (
                    <Tooltip title="Ekranını paylaşır">
                      <DesktopOutlined className="presenting-icon" />
                    </Tooltip>
                  )}
                  {me?.host && !x.me && (
                    <Dropdown
                      trigger={['click']}
                      menu={{ items, onClick: ({ key }) => p.onHostAction(key as HostAction, x.id) }}
                    >
                      <Button type="text" size="small" icon={<EllipsisOutlined />} />
                    </Dropdown>
                  )}
                </Flex>
              );
            })}
          </>
        )}
      </div>

      <div className="sidebar-foot">
        <Typography.Text type="secondary" ellipsis>
          {p.name} · v{window.scw.version}
        </Typography.Text>
      </div>

      <Modal
        open={createOpen !== null}
        title={createOpen === 'room' ? 'Yeni otaq' : 'Yerli paylaşım'}
        okText={createOpen === 'room' ? 'Yarat' : 'Ekranı seç'}
        cancelText="Ləğv et"
        onOk={submitCreate}
        onCancel={() => setCreateOpen(null)}
        destroyOnHidden
      >
        <Input
          autoFocus
          maxLength={60}
          placeholder={`${p.name} otağı`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onPressEnter={submitCreate}
        />
      </Modal>
    </Flex>
  );
}
