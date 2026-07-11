export const LAST_RUNTIME_ERROR_KEY = 'dawA_last_runtime_error';
export const AUTH_STORAGE_KEY = 'dawaa_auth_user_v2';

const APP_STORAGE_PREFIXES = ['dawA', 'dawaA', 'dawaa', 'supabase', 'sb-'];

function recordRuntimeError(source: string, error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error || 'unknown error');
  const payload = JSON.stringify({ source, message, at: new Date().toISOString() });
  try {
    window.sessionStorage.setItem(LAST_RUNTIME_ERROR_KEY, payload);
  } catch {
    // Storage can be unavailable in private or hardened browsing modes.
  }
}

export function logRuntimeError(source: string, error: unknown) {
  console.error(`[Dawaa ${source}]`, error);
  if (typeof window !== 'undefined') recordRuntimeError(source, error);
}

export function loginRecoveryUrl(reason = 'recovery') {
  const url = new URL('/login', window.location.origin);
  url.searchParams.set('_recovery', `${reason}_${Date.now()}`);
  return url.toString();
}

export function diagnosticsUrl(reason = 'recovery') {
  const url = new URL('/diagnostics', window.location.origin);
  url.searchParams.set('_recovery', `${reason}_${Date.now()}`);
  return url.toString();
}

export function startRecoveryCleanup(options: { clearAppStorage?: boolean } = {}) {
  if (typeof window === 'undefined') return;

  void (async () => {
    try {
      if ('caches' in window) {
        const keys = await window.caches.keys();
        console.info('[Dawaa recovery] cache names found', keys);
        await Promise.all(keys.map((key) => window.caches.delete(key)));
      }
    } catch (error) {
      logRuntimeError('recovery cache cleanup failed', error);
    }

    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        console.info('[Dawaa sw] registrations found/removed', registrations.length);
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
    } catch (error) {
      logRuntimeError('sw cleanup failed', error);
    }

    if (!options.clearAppStorage) return;

    try {
      removeMatchingStorageKeys(window.localStorage);
      removeMatchingStorageKeys(window.sessionStorage);
    } catch (error) {
      logRuntimeError('recovery storage cleanup failed', error);
    }
  })();
}

export function redirectToLoginWithRecovery(reason = 'recovery', clearAppStorage = false) {
  if (typeof window === 'undefined') return;
  const target = loginRecoveryUrl(reason);
  console.info('[Dawaa recovery] redirecting to login', target);
  startRecoveryCleanup({ clearAppStorage });
  window.location.assign(target);
}

export function removeMatchingStorageKeys(storage: Storage) {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && APP_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
  return keys;
}

export function clearCorruptStoredUser() {
  try {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Ignore storage failures; auth will continue as logged out.
  }
}
