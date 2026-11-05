import { App as AntApp, ConfigProvider, theme } from 'antd';
import azAZ from 'antd/locale/az_AZ';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Dark + compact (D29), Azerbaijani UI (D20).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      locale={azAZ}
      theme={{
        algorithm: [theme.darkAlgorithm, theme.compactAlgorithm],
        token: { colorPrimary: '#4f7cff', borderRadius: 6, fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif' },
      }}
    >
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
