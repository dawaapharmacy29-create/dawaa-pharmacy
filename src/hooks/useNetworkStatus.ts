import { useEffect, useState } from 'react';

type NavigatorWithConnection = Navigator & {
  connection?: {
    effectiveType?: string;
    addEventListener?: (event: 'change', handler: () => void) => void;
    removeEventListener?: (event: 'change', handler: () => void) => void;
  };
};

export function useNetworkStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [effectiveType, setEffectiveType] = useState<string | null>(() => {
    const connection = (navigator as NavigatorWithConnection | undefined)?.connection;
    return connection?.effectiveType ?? null;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const update = () => {
      setOnline(navigator.onLine);
      const connection = (navigator as NavigatorWithConnection).connection;
      setEffectiveType(connection?.effectiveType ?? null);
    };

    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    const connection = (navigator as NavigatorWithConnection).connection;
    connection?.addEventListener?.('change', update);

    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      connection?.removeEventListener?.('change', update);
    };
  }, []);

  const isSlowNetwork = !online || effectiveType === 'slow-2g' || effectiveType === '2g';

  return {
    online,
    effectiveType,
    isSlowNetwork,
  };
}
