import { useEffect, useState } from 'react';
import { getOfflineQueueCount, syncOfflineQueue } from '@/lib/offlineQueue';

export function useOfflineQueueStatus() {
  const [pendingCount, setPendingCount] = useState(getOfflineQueueCount());
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const update = () => setPendingCount(getOfflineQueueCount());
    window.addEventListener('dawaa-offline-queue-changed', update as EventListener);
    window.addEventListener('storage', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('dawaa-offline-queue-changed', update as EventListener);
      window.removeEventListener('storage', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const syncNow = async () => {
    setSyncing(true);
    try {
      await syncOfflineQueue();
      setPendingCount(getOfflineQueueCount());
    } finally {
      setSyncing(false);
    }
  };

  return { pendingCount, syncing, syncNow };
}
