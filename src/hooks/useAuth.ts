import { useCallback, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { clearCorruptStoredUser, logRuntimeError } from '@/lib/appRecovery';
import type { User } from '@/types';
import {
  ALL_PERMISSION_KEYS,
  getDefaultPermissionsForRole,
  isAdminRole,
  isBranchManagerRole,
  mergePermissions,
  normalizeRole,
  hasPermission as coreHasPermission,
  isPrivilegedRole,
} from '@/lib/core/permissionSystem';

export { normalizeRole, isAdminRole, isBranchManagerRole };
export const mergePermissionMaps = mergePermissions;
export const userHasPermission = (
  user: Pick<User, 'role' | 'permissions'> | null | undefined,
  permission?: string
) => coreHasPermission(sanitizeUser(user as User | null), permission || '');

interface StaffAccountLoginRow {
  id: string;
  staff_id?: string | null;
  username: string;
  name: string;
  role: unknown;
  branch: unknown;
  phone: string | null;
  active: boolean;
  can_login?: boolean | null;
  permissions?: unknown;
}

const STORAGE_KEY = 'dawaa_auth_user_v2';
const listeners = new Set<() => void>();

function safeText(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferred = record.key ?? record.role ?? record.name ?? record.label ?? record.labelAr ?? record.value;
    if (preferred != null) return safeText(preferred, fallback);
  }
  return fallback;
}

function normalizePermissionInput(extra: unknown): Record<string, boolean> {
  if (!extra) return {};
  if (Array.isArray(extra)) {
    return Object.fromEntries(extra.map((key) => [String(key), true]));
  }
  if (typeof extra === 'string') {
    return Object.fromEntries(
      extra
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean)
        .map((key) => [key, true])
    );
  }
  if (typeof extra === 'object') {
    const result: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(extra as Record<string, unknown>)) {
      result[key] = value === true || value === 'true' || value === 1;
    }
    return result;
  }
  return {};
}

function capPermissionsToRole(role: unknown, extra?: unknown): Record<string, boolean> {
  const roleKey = normalizeRole(safeText(role, 'assistant'));
  if (roleKey === 'general_manager') return Object.fromEntries(ALL_PERMISSION_KEYS.map((key) => [key, true]));
  const roleDefaults = getDefaultPermissionsForRole(roleKey);
  const capped: Record<string, boolean> = { ...roleDefaults };
  for (const [key, value] of Object.entries(normalizePermissionInput(extra))) {
    if (!(key in roleDefaults)) continue;
    capped[key] = value === true;
  }
  return capped;
}

function sanitizeUser(user: User | null): User | null {
  if (!user) return null;
  const role = normalizeRole(safeText(user.role, 'assistant'));
  return {
    ...user,
    id: safeText(user.id),
    staffId: user.staffId ? safeText(user.staffId) : undefined,
    name: safeText(user.name, 'User'),
    username: safeText(user.username, safeText(user.name, 'user')),
    role,
    branch: safeText(user.branch, 'all'),
    phone: user.phone ? safeText(user.phone) : undefined,
    active: user.active !== false,
    permissions: capPermissionsToRole(role, user.permissions || {}),
  };
}

function readStoredUser(): User | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? sanitizeUser(JSON.parse(stored) as User) : null;
  } catch (error) {
    console.warn('[Dawaa auth] corrupt stored user removed', error);
    clearCorruptStoredUser();
    return null;
  }
}

let currentUser: User | null = readStoredUser();

function setCurrentUser(user: User | null) {
  currentUser = sanitizeUser(user);
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      if (currentUser) localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) { console.debug('Failed to update localStorage:', e); }
  }
  listeners.forEach((listener) => listener());
}

function logAuthActivity(user: User, action: string, details: string) {
  if (!isSupabaseConfigured) return;
  supabase.from('activity_log').insert({ user_id: user.id, user_name: user.name, action, module: 'system', details, branch: user.branch }).then(() => {});
}

async function loginWithStaffAccount(username: string, password: string): Promise<User | null> {
  if (!isSupabaseConfigured) return null;
  let data: unknown;
  try {
    const result = await supabase.rpc('staff_account_login', { p_username: username, p_password: password });
    data = result.data;
    if (result.error) {
      console.warn('[Dawaa auth] login failed reason', result.error.message || result.error);
      return null;
    }
  } catch (error) {
    console.warn('[Dawaa auth] login failed reason', error);
    logRuntimeError('auth login rpc failed', error);
    return null;
  }
  const row = Array.isArray(data) ? (data[0] as StaffAccountLoginRow | undefined) : (data as StaffAccountLoginRow | null);
  if (!row?.id || row.active === false || row.can_login === false) {
    console.warn('[Dawaa auth] login failed reason', 'inactive or invalid staff account');
    return null;
  }
  try { await supabase.rpc('set_current_user_context', { p_user_id: row.id }); } catch {}
  const roleKey = normalizeRole(safeText(row.role, 'assistant'));
  let effectivePermissions = capPermissionsToRole(roleKey, row.permissions || {});
  try {
    const { data: permsData, error: permsError } = await supabase.rpc('get_user_permissions', { p_user_id: row.id });
    if (!permsError && permsData) effectivePermissions = capPermissionsToRole(roleKey, permsData as Record<string, boolean>);
  } catch {}
  return sanitizeUser({ id: safeText(row.id), staffId: row.staff_id || undefined, name: safeText(row.name, safeText(row.username, 'User')), username: safeText(row.username, safeText(row.name, 'user')), role: roleKey, branch: safeText(row.branch, 'all'), phone: row.phone || undefined, active: row.active, permissions: effectivePermissions } as User);
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(currentUser);
  const [authTimedOut, setAuthTimedOut] = useState(false);
  useEffect(() => {
    const timeoutId = window.setTimeout(() => setAuthTimedOut(true), 6000);
    const listener = () => setUser(currentUser);
    listeners.add(listener);
    setUser(currentUser);
    return () => {
      window.clearTimeout(timeoutId);
      listeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    const TIMEOUT = 12 * 60 * 60 * 1000;
    let timerId: number | undefined;
    const reset = () => { if (timerId) window.clearTimeout(timerId); timerId = window.setTimeout(() => setCurrentUser(null), TIMEOUT); };
    const events: Array<keyof WindowEventMap> = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach((eventName) => window.addEventListener(eventName, reset, { passive: true }));
    reset();
    return () => { if (timerId) window.clearTimeout(timerId); events.forEach((eventName) => window.removeEventListener(eventName, reset)); };
  }, [user?.id]);
  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    const accountUser = await loginWithStaffAccount(username, password);
    if (accountUser) { setCurrentUser(accountUser); logAuthActivity(accountUser, 'login', 'success'); return true; }
    return false;
  }, []);
  const logout = useCallback(async () => {
    if (currentUser) logAuthActivity(currentUser, 'logout', 'success');
    setCurrentUser(null);
    try { await supabase.rpc('set_current_user_context', { p_user_id: null }); } catch {}
  }, []);
  const safeUser = useMemo(() => sanitizeUser(user), [user?.id, user?.role, user?.branch, user?.name, user?.username, user?.active, user?.phone, user?.staffId, JSON.stringify(user?.permissions || {})]);
  const roleKey = normalizeRole(safeText(safeUser?.role, 'assistant'));
  const isAdmin = isAdminRole(roleKey);
  const isBranchManager = isBranchManagerRole(roleKey);
  const canManage = isPrivilegedRole(roleKey) || isBranchManager;
  const checkPermission = useCallback((permission?: string): boolean => {
    try {
      return coreHasPermission(safeUser, permission || '');
    } catch (error) {
      console.warn('[Dawaa auth] checkPermission failed', error);
      logRuntimeError('auth checkPermission failed', error);
      return false;
    }
  }, [safeUser]);
  const hasPermission = useCallback(async (permission?: string): Promise<boolean> => {
    try {
      return !permission || coreHasPermission(safeUser, permission);
    } catch (error) {
      console.warn('[Dawaa auth] hasPermission failed', error);
      logRuntimeError('auth hasPermission failed', error);
      return false;
    }
  }, [safeUser]);
  return { user: safeUser, loading: !authTimedOut && false, login, logout, isAdmin, isBranchManager, canManage, checkPermission, hasPermission };
}

export function getSafeCurrentUserId(): string | null {
  if (!currentUser) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(currentUser.id) ? currentUser.id : null;
}

export function getCurrentUserProfile() {
  if (!currentUser) throw new Error('Login required');
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(currentUser.id)) return { ...currentUser, id: '00000000-0000-0000-0000-000000000000' };
  return sanitizeUser(currentUser) || currentUser;
}
