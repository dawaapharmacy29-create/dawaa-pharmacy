import { STAFF_SESSION_STORAGE_KEY, supabase } from '@/lib/supabase';

export { STAFF_SESSION_STORAGE_KEY };

export type StaffSessionStatus = 'valid' | 'invalid' | 'unavailable';

type StaffSessionVerificationInFlight = {
  token: string;
  promise: Promise<StaffSessionStatus>;
};

type StaffSessionVerificationCache = {
  token: string;
  status: StaffSessionStatus;
  checkedAt: number;
};

// useAuth can be mounted by many components at once. In-flight de-duplication prevents truly
// simultaneous RPCs, but sequential effects/focus handlers can still fan out the same session
// verification dozens of times. A short module-level result cache keeps one browser tab from
// repeatedly refreshing an already-verified token while staying well inside the existing 5-minute
// visibility re-check and the server's 12-hour sliding session window.
const STAFF_SESSION_VALID_CACHE_MS = 4 * 60 * 1000;
const STAFF_SESSION_UNAVAILABLE_CACHE_MS = 15 * 1000;

let verificationInFlight: StaffSessionVerificationInFlight | null = null;
let verificationCache: StaffSessionVerificationCache | null = null;

function normalizeToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  if (!token || token.length < 32 || token.length > 512) return null;
  return token;
}

export function getStaffSessionToken(): string | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
  try {
    return normalizeToken(localStorage.getItem(STAFF_SESSION_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function setStaffSessionToken(token: string | null | undefined): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    const normalized = normalizeToken(token);
    verificationCache = null;
    if (normalized) localStorage.setItem(STAFF_SESSION_STORAGE_KEY, normalized);
    else localStorage.removeItem(STAFF_SESSION_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in privacy/recovery modes. Authentication will fail closed
    // for privileged server actions while the regular read-only UI can still recover.
  }
}

export function clearStaffSessionToken(): void {
  setStaffSessionToken(null);
}

/**
 * Extends the server session (sliding 12h) and reports whether it is still valid.
 * Concurrent callers sharing one token reuse the same request so mounting many useAuth consumers
 * (or returning a tab to the foreground) cannot fan out identical refresh RPCs. Successful checks
 * are also reused briefly so sequential hook effects cannot recreate the same request storm.
 * 'invalid'     → the server rejected the token (expired, revoked, account disabled): log out.
 * 'unavailable' → network/transport failure: keep the user signed in and retry later.
 */
export async function verifyStoredStaffSession(): Promise<StaffSessionStatus> {
  const token = getStaffSessionToken();
  if (!token) return 'invalid';

  const now = Date.now();
  if (verificationCache?.token === token) {
    const age = now - verificationCache.checkedAt;
    if (verificationCache.status === 'valid' && age < STAFF_SESSION_VALID_CACHE_MS) return 'valid';
    if (verificationCache.status === 'unavailable' && age < STAFF_SESSION_UNAVAILABLE_CACHE_MS)
      return 'unavailable';
  }

  if (verificationInFlight?.token === token) return verificationInFlight.promise;

  const promise = (async (): Promise<StaffSessionStatus> => {
    try {
      const { data, error } = await supabase.rpc('refresh_staff_login_session_v1', {
        p_session_token: token,
      });
      if (error) return 'unavailable';
      if (data !== true) {
        // Do not let an older in-flight verification erase a newer login token.
        if (getStaffSessionToken() === token) clearStaffSessionToken();
        return 'invalid';
      }
      return 'valid';
    } catch {
      return 'unavailable';
    }
  })();

  verificationInFlight = { token, promise };
  void promise.then((status) => {
    // Cache only while the same token is still current. A newer login must never inherit an old
    // verification result.
    if (getStaffSessionToken() === token) {
      verificationCache = { token, status, checkedAt: Date.now() };
    }
  });
  void promise.finally(() => {
    if (verificationInFlight?.promise === promise) verificationInFlight = null;
  });
  return promise;
}

export async function refreshStoredStaffSession(): Promise<boolean> {
  return (await verifyStoredStaffSession()) === 'valid';
}

export async function revokeStoredStaffSession(): Promise<void> {
  const token = getStaffSessionToken();
  clearStaffSessionToken();
  if (!token) return;
  try {
    await supabase.rpc('revoke_staff_login_session_v1', { p_session_token: token });
  } catch {
    // Client-side logout remains effective even if the best-effort server revoke is unavailable.
  }
}
