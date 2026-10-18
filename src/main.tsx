import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { useStore } from './model/store';
import * as actions from './model/actions';
import { getIndex } from './model/index';

// test hook for automated browser checks (dev builds only)
if (import.meta.env.DEV) {
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(e.message));
  (window as any).__nb = { useStore, actions, getIndex, errors };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// installable app + offline start (production builds only)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
  });
}
