export const LAST_RUNTIME_ERROR_KEY = 'dawA_last_runtime_error';
export const AUTH_STORAGE_KEY = 'dawaa_auth_user_v2';

const APP_STORAGE_PREFIXES = ['dawA', 'dawaA', 'dawaa', 'supabase', 'sb-'];
const STALE_CHUNK_RECOVERY_KEY_PREFIX = 'dawaa_stale_chunk_reload_at';
const STALE_CHUNK_RECOVERY_COOLDOWN_MS = 60_000;

function recordRuntimeError(source: string, error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error || 'unknown error');
  const payload = JSON.stringify({ source, message, at: new Date().toISOString() });
  try {
    window.sessionStorage.setItem(LAST_RUNTIME_ERROR_KEY, payload);
  } catch {
    // Storage can be unavailable in private or hardened browsing modes.
  }
}

function staleChunkRecoveryKey(scope: string) {
  const safeScope = scope.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
  return `${STALE_CHUNK_RECOVERY_KEY_PREFIX}:${safeScope || 'global'}`;
}

export function logRuntimeError(source: string, error: unknown) {
  console.error(`[Dawaa ${source}]`, error);
  if (typeof window !== 'undefined') recordRuntimeError(source, error);
}

export function isStaleChunkImportError(error: unknown) {
  const message = String((error as Error)?.message || error || '');
  return /Failed to fetch dynamically imported module|Loading chunk|dynamically imported module|error loading dynamically imported module/i.test(message);
}

export async function recoverFromStaleChunkOnce(scope = 'global') {
  if (typeof window === 'undefined') return false;
  const recoveryKey = staleChunkRecoveryKey(scope);

  try {
    const last = Number(window.sessionStorage.getItem(recoveryKey) || 0);
    if (Date.now() - last <= STALE_CHUNK_RECOVERY_COOLDOWN_MS) return false;
    window.sessionStorage.setItem(recoveryKey, String(Date.now()));
  } catch {
    // If sessionStorage is unavailable, still attempt one cache-clean reload for this execution.
  }

  await startRecoveryCleanup();
  const url = new URL(window.location.href);
  url.searchParams.set('_r', Date.now().toString());
  window.location.replace(url.toString());
  return true;
}

export function clearStaleChunkRecoveryMarker(scope = 'global') {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(staleChunkRecoveryKey(scope));
  } catch {
    // Ignore storage failures; recovery remains bounded by the current execution.
  }
}

export function clearRecoveredRuntimeError() {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.sessionStorage.getItem(LAST_RUNTIME_ERROR_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { source?: string; message?: string };
    const source = String(parsed?.source || '');
    const message = String(parsed?.message || '');
    const recoverable =
      source === 'index recovery' ||
      source === 'bootstrap App import failed' ||
      /asset load failed|chunk|dynamically imported module|failed to fetch dynamically imported module/i.test(message);
    if (!recoverable) return false;
    window.sessionStorage.removeItem(LAST_RUNTIME_ERROR_KEY);
    window.sessionStorage.removeItem('dawaa_health_banner_dismissed_error');
    return true;
  } catch {
    return false;
  }
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

export async function startRecoveryCleanup(options: { clearAppStorage?: boolean } = {}) {
  if (typeof window === 'undefined') return;

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
}

export function redirectToLoginWithRecovery(reason = 'recovery', clearAppStorage = false) {
  if (typeof window === 'undefined') return;
  const target = loginRecoveryUrl(reason);
  console.info('[Dawaa recovery] redirecting to login', target);
  void startRecoveryCleanup({ clearAppStorage }).finally(() => window.location.assign(target));
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
