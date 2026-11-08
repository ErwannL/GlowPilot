// Must run before the store reads anything (it loads the PC's saved data file).
import './desktopStorageInit';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service workers need a secure context (https or localhost); the Electron file:// shell has none.
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
