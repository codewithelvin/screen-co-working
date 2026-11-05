import { App as AntApp, ConfigProvider } from 'antd';
import azAZ from 'antd/locale/az_AZ';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyCssVars, darkTheme } from './theme';
import './styles.css';

applyCssVars();

// QueryDesk's Indigo dark palette at a readable 14px (D29), Azerbaijani UI (D20).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={azAZ} theme={darkTheme}>
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
