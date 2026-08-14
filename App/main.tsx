import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import { getRenderPage } from './registry';
import { applyTheme, getThemeId } from './themes';

applyTheme(getThemeId());

const renderMode = new URLSearchParams(window.location.search).get('videoRender');
const ExtensionRenderPage = getRenderPage();

// Global error handlers — catch errors that ErrorBoundary can't (event handlers, async, etc.)
window.addEventListener('error', (e) => {
  console.error('[GlobalError]', e.message, e.filename, e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[UnhandledRejection]', e.reason);
});

createRoot(document.getElementById('root')!).render(
  renderMode === '1' || renderMode === 'true' ? (
    ExtensionRenderPage ? <ExtensionRenderPage /> : (
      <div style={{ padding: 24 }}>No node extensions providing a standalone render page are installed.</div>
    )
  ) : (
    <StrictMode>
      <ErrorBoundary label="App">
        <App />
      </ErrorBoundary>
    </StrictMode>
  ),
);
