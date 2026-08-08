import clickhouse from './clickhouse';
import cursor from './cursor';
import posthog from './posthog';
import binance from './binance';

export type AppTheme = {
  id: string;
  name: string;
  colors: Record<string, string>;
  typography: Record<string, unknown>;
};
export const themes: Record<string, AppTheme> = { cursor, clickhouse, posthog, binance };
export const DEFAULT_THEME_ID = 'cursor';

export function applyTheme(id: string) {
  const selected = themes[id] || themes[DEFAULT_THEME_ID];
  const c = selected.colors;
  const get = (key: string, fallback: string) => c[key] || fallback;
  const isBinance = selected.id === 'binance';
  const isDarkTheme = selected.id === 'binance' || selected.id === 'clickhouse';
  const root = document.documentElement;
  root.dataset.theme = selected.id;
  const vars: Record<string, string> = {
    '--color-surface-canvas': isBinance ? get('canvasDark', '#0b0e11') : get('canvas', '#f7f7f4'),
    '--color-surface-canvas-soft': isBinance ? get('surfaceElevatedDark', '#2b3139') : get('surfaceSoft', '#fafaf7'),
    '--color-surface-card': isBinance ? get('surfaceCardDark', '#1e2329') : get('surfaceCard', '#ffffff'),
    '--color-surface-strong': isBinance ? get('surfaceElevatedDark', '#2b3139') : get('surfaceElevated', get('surfaceSoft', '#e6e5e0')),
    '--color-primary': get('primary', '#f54e00'),
    '--color-primary-active': get('primaryActive', '#d04200'),
    '--color-primary-light': get('primaryDisabled', '#fef0e8'),
    '--color-black': isBinance ? get('canvasDark', '#0b0e11') : get('black', get('surfaceDark', '#000000')),
    '--color-ink': isBinance ? get('onDark', '#ffffff') : get('ink', '#26251e'),
    '--color-body': get('body', '#5a5852'),
    '--color-body-strong': get('bodyStrong', get('ink', '#26251e')),
    '--color-action-text': isBinance ? get('onDark', '#ffffff') : get('actionText', get('onPrimary', '#ffffff')),
    '--color-logo-bg': selected.id === 'posthog' ? get('primary', '#f7a501') : (isBinance ? get('surfaceCardDark', '#1e2329') : get('black', get('surfaceDark', '#000000'))),
    '--color-logo-text': selected.id === 'posthog' ? get('ink', '#23251d') : (isBinance ? get('primary', '#fcd535') : get('actionText', '#ffffff')),
    '--color-btn-dark-bg': isDarkTheme ? '#ffffff' : get('black', get('surfaceDark', '#23251d')),
    '--color-btn-dark-text': isDarkTheme ? '#181a20' : '#ffffff',
    '--color-btn-dark-border': isDarkTheme ? '#ffffff' : get('black', get('surfaceDark', '#23251d')),
    '--color-muted': get('muted', get('mute', '#807d72')),
    '--color-muted-soft': get('mutedSoft', get('ash', '#a09c92')),
    '--color-on-primary': get('onPrimary', '#ffffff'),
    '--color-hairline': isBinance ? get('hairlineOnDark', '#2b3139') : get('hairline', '#e6e5e0'),
    '--color-hairline-soft': isBinance ? get('hairlineOnDark', '#2b3139') : (selected.id === 'clickhouse' ? '#2a2a2a' : get('hairlineSoft', '#efeee8')),
    '--color-hairline-strong': isBinance ? get('hairlineOnDark', '#2b3139') : (selected.id === 'clickhouse' ? '#3a3a3a' : get('borderStrong', get('hairlineStrong', '#cfcdc4'))),
    '--color-semantic-error': get('error', get('accentRed', '#cf2d56')),
    '--color-semantic-success': get('success', get('accentGreen', '#1f8a65')),
    '--color-semantic-warning': get('warning', '#c08532'),
    '--color-timeline-thinking': get('accentRose', get('accentRed', '#dfa88f')),
    '--color-timeline-grep': get('success', get('accentGreen', '#1f8a65')),
    '--color-timeline-read': get('accentBlue', '#9fbbe0'),
    '--color-timeline-edit': get('primary', '#c0a8dd'),
    '--color-timeline-done': get('warning', '#c08532'),
  };
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  localStorage.setItem('vibenodeflow-theme', selected.id);
}

export function getThemeId() {
  const stored = localStorage.getItem('vibenodeflow-theme');
  return stored && themes[stored] ? stored : DEFAULT_THEME_ID;
}
