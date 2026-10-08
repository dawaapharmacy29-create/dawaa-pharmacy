import { STAFF_SESSION_STORAGE_KEY, supabase } from '@/lib/supabase';

export { STAFF_SESSION_STORAGE_KEY };

export type StaffSessionStatus = 'valid' | 'invalid' | 'unavailable';

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
 * 'invalid'     → the server rejected the token (expired, revoked, account disabled): log out.
 * 'unavailable' → network/transport failure: keep the user signed in and retry later.
 */
export async function verifyStoredStaffSession(): Promise<StaffSessionStatus> {
  const token = getStaffSessionToken();
  if (!token) return 'invalid';
  try {
    const { data, error } = await supabase.rpc('refresh_staff_login_session_v1', {
      p_session_token: token,
    });
    if (error) return 'unavailable';
    if (data !== true) {
      clearStaffSessionToken();
      return 'invalid';
    }
    return 'valid';
  } catch {
    return 'unavailable';
  }
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
