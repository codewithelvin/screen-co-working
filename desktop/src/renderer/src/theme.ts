import { theme, type ThemeConfig } from 'antd';

/**
 * QueryDesk's "Indigo" dark palette (querydesk frontend/src/theme/darkTheme.ts), so the company's
 * apps look alike. Every text shade passes WCAG AA (4.5:1) on bgLayout, bgContainer and sider;
 * text4 is for placeholders only.
 */
export const INDIGO = {
  bgLayout: '#1d1424',
  bgContainer: '#2e2434',
  bgSpotlight: '#3f3546',
  sider: '#120a18',
  text: '#f6f3f8',
  text2: '#d8d3dd',
  text3: '#bdb7c3',
  text4: '#968f9d',
  border: '#5e5665',
  borderSoft: '#463e4c',
  primary: '#64a7e9',
  primaryBg: '#2c4054',
  link: '#9cc8f5',
  success: '#7fd0b0',
  warning: '#e8b45a',
  error: '#f0a3aa',
  buttonDefault: '#524c58',
} as const;

/** The palette as CSS variables (`--scw-bg-layout` …) for styles.css. */
export function applyCssVars(): void {
  for (const [k, v] of Object.entries(INDIGO)) {
    document.documentElement.style.setProperty(`--scw-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, v);
  }
}

export const darkTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
    fontSize: 14,
    borderRadius: 6,
    colorPrimary: INDIGO.primary,
    colorLink: INDIGO.link,
    colorInfo: INDIGO.link,
    colorSuccess: INDIGO.success,
    colorWarning: INDIGO.warning,
    colorError: INDIGO.error,
    colorText: INDIGO.text,
    colorTextSecondary: INDIGO.text2,
    colorTextTertiary: INDIGO.text3,
    colorTextQuaternary: INDIGO.text4,
    colorTextPlaceholder: INDIGO.text4,
    colorTextDescription: INDIGO.text2,
    colorTextHeading: INDIGO.text,
    colorBgBase: INDIGO.bgLayout,
    colorBgLayout: INDIGO.bgLayout,
    colorBgContainer: INDIGO.bgContainer,
    colorBgElevated: INDIGO.bgContainer,
    colorBgSpotlight: INDIGO.bgSpotlight,
    colorBorder: INDIGO.border,
    colorBorderSecondary: INDIGO.borderSoft,
    colorSplit: INDIGO.borderSoft,
  },
  components: {
    Tag: {
      defaultBg: 'rgba(255,255,255,0.10)',
      defaultColor: INDIGO.text,
    },
    // Primary is light on dark, as in QueryDesk; a danger fill gets dark text for the same reason.
    Button: {
      colorPrimary: INDIGO.text,
      colorPrimaryHover: '#ffffff',
      colorPrimaryActive: '#d9d3de',
      primaryColor: INDIGO.bgLayout,
      dangerColor: INDIGO.bgLayout,
      primaryShadow: 'none',
      dangerShadow: 'none',
      defaultBg: INDIGO.buttonDefault,
      defaultBorderColor: INDIGO.buttonDefault,
      defaultColor: INDIGO.text,
    },
    Segmented: {
      itemSelectedBg: INDIGO.buttonDefault,
      itemSelectedColor: INDIGO.text,
      itemColor: INDIGO.text2,
      itemHoverColor: INDIGO.text,
      trackBg: INDIGO.sider,
    },
  },
};
