import { Button, Form, Input, Modal, Typography } from 'antd';

interface Props {
  open: boolean;
  initialName: string;
  firstRun: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}

/** Display name only, no accounts (D12). The server is fixed in the build (D35). */
export function Setup({ open, initialName, firstRun, onSave, onCancel }: Props) {
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
          Burada ekran paylaşılır, kamera yoxdur. Mikrofon yalnız komandadan ayrı oturanda açılır. Başqalarının sizi tanıması üçün adınızı yazın.
        </Typography.Paragraph>
      )}
      <Form
        layout="vertical"
        initialValues={{ name: initialName }}
        onFinish={(v: { name: string }) => onSave(v.name.trim())}
        requiredMark={false}
      >
        <Form.Item name="name" label="Adınız" rules={[{ required: true, whitespace: true, message: 'Adınızı yazın' }]}>
          <Input maxLength={40} autoFocus placeholder="məs. Aysel Məmmədova" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block>
          Yadda saxla
        </Button>
      </Form>
    </Modal>
  );
}
