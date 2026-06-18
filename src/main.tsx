import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './styles/dawaa-theme.css';
import './styles/dawaa-design-system.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Deferred heavy initializers to speed up first render
(async () => {
  try {
    const [{ installRuntimeSafetyGuards }, { initOfflineQueueAutoSync }] = await Promise.all([
      import('@/lib/runtimeSafety'),
      import('@/lib/offlineQueue'),
    ]);

    installRuntimeSafetyGuards?.();
    initOfflineQueueAutoSync?.();
  } catch (e) {
    // Non-fatal: log to console for now
    console.debug('Deferred init failed', e);
  }
})();
