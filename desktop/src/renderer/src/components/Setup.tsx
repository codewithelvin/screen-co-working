import { Button, Form, Input, Modal, Typography } from 'antd';
import { useState } from 'react';
import type { Settings } from '../../../shared/types';
import { api } from '../api';

interface Props {
  open: boolean;
  initial: Settings;
  firstRun: boolean;
  onSave: (s: Settings) => void;
  onCancel: () => void;
}

/** First launch: display name only, no accounts (D12); plus the LAN server address. */
export function Setup({ open, initial, firstRun, onSave, onCancel }: Props) {
  const [form] = Form.useForm<Settings>();
  const [checking, setChecking] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const submit = async (values: Settings) => {
    const s = { name: values.name.trim(), server: (values.server ?? '').trim() };
    const saveAnyway = serverError !== null;
    if (s.server && !saveAnyway) {
      setChecking(true);
      const ok = await api.health(s.server).then(
        () => true,
        () => false,
      );
      setChecking(false);
      if (!ok) {
        setServerError('Bu ünvanda server cavab vermir. Yenə də yadda saxlaya bilərsiniz — server tapılmayanda yerli rejim işləyir.');
        return;
      }
    }
    onSave(s);
  };

  return (
    <Modal
      open={open}
      title={firstRun ? 'Xoş gəlmisiniz' : 'Parametrlər'}
      closable={!firstRun}
      mask={{ closable: !firstRun }}
      keyboard={!firstRun}
      onCancel={onCancel}
      footer={null}
      destroyOnHidden
    >
      {firstRun && (
        <Typography.Paragraph type="secondary">
          Səs və kamera yoxdur — yalnız ekran. Başqalarının sizi tanıması üçün adınızı yazın.
        </Typography.Paragraph>
      )}
      <Form form={form} layout="vertical" initialValues={initial} onFinish={(v) => void submit(v)} requiredMark={false}>
        <Form.Item name="name" label="Adınız" rules={[{ required: true, whitespace: true, message: 'Adınızı yazın' }]}>
          <Input maxLength={40} autoFocus placeholder="məs. Aysel Məmmədova" />
        </Form.Item>
        <Form.Item
          name="server"
          label="Server ünvanı"
          extra="IT-dən alın, məs. 192.168.1.10:8080. Boş qalsa, yalnız yerli rejim işləyir."
          validateStatus={serverError ? 'warning' : undefined}
          help={serverError ?? undefined}
        >
          <Input placeholder="192.168.1.10:8080" onChange={() => setServerError(null)} />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={checking}>
          {serverError ? 'Yenə də yadda saxla' : 'Yadda saxla'}
        </Button>
      </Form>
    </Modal>
  );
}
