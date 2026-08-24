/* eslint-disable no-empty */
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
  staff_name?: string | null;
  role: unknown;
  branch: unknown;
  phone: string | null;
  active: boolean;
  can_login?: boolean | null;
  permissions?: unknown;
}

const STORAGE_KEY = 'dawaa_auth_user_v2';
const listeners = new Set<() => void>();
const ACCOUNT_REFRESH_TTL_MS = 5 * 60 * 1000;
const ACCOUNT_REFRESH_TIMEOUT_MS = 3500;
let lastAccountRefreshAt = 0;
let accountRefreshPromise: Promise<User | null> | null = null;

const DOCTOR_WORKSPACE_PERMISSIONS = [
  'view_doctor_dashboard',
  'view_own_performance',
  'view_customers',
  'view_customer_details',
  'view_customer_360',
  'view_customer_service',
  'view_customer_requests',
  'manage_customer_requests',
  'create_followup',
  'whatsapp_customer',
  'view_schedule',
  'create_leave_request',
  'record_attendance',
  'view_points',
  'view_reviews',
  'view_medicines',
  'view_stagnant_medicines',
  'view_incentive_medicines',
  'view_expiry_tracker',
];

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

function isPlaceholderName(value: unknown) {
  const normalized = safeText(value).toLowerCase();
  return !normalized || ['غير محدد', 'غير معروف', 'user', 'unknown', 'undefined', 'null'].includes(normalized);
}

function normalizePermissionInput(extra: unknown): Record<string, boolean> {
  if (!extra) return {};
  if (Array.isArray(extra)) return Object.fromEntries(extra.map((key) => [String(key), true]));
  if (typeof extra === 'string') {
    return Object.fromEntries(
      extra.split(',').map((key) => key.trim()).filter(Boolean).map((key) => [key, true])
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

type SupabaseRpcResult<T> = { data: T | null; error: { message?: string } | null };

const EXPLICIT_OVERRIDABLE_PERMISSIONS = new Set([
  'customer_welcome_messages.view',
  'customer_welcome_messages.create',
  'customer_welcome_messages.update',
]);

function capPermissionsToRole(role: unknown, extra?: unknown): Record<string, boolean> {
  const roleKey = normalizeRole(safeText(role, 'assistant'));
  if (roleKey === 'general_manager') return Object.fromEntries(ALL_PERMISSION_KEYS.map((key) => [key, true]));
  const roleDefaults = getDefaultPermissionsForRole(roleKey);
  const explicit = normalizePermissionInput(extra);
  const capped: Record<string, boolean> = { ...roleDefaults };
  for (const [key, value] of Object.entries(explicit)) {
    if (!(key in roleDefaults) && !EXPLICIT_OVERRIDABLE_PERMISSIONS.has(key)) continue;
    capped[key] = value === true;
  }
  if (roleKey === 'shift_supervisor_morning' || roleKey === 'shift_supervisor_evening') {
    for (const key of DOCTOR_WORKSPACE_PERMISSIONS) {
      if (!(key in explicit) || explicit[key] !== false) capped[key] = true;
    }
  }
  return capped;
}

function sanitizeUser(user: User | null): User | null {
  if (!user) return null;
  const role = normalizeRole(safeText(user.role, 'assistant'));
  const username = safeText(user.username);
  const cleanName = isPlaceholderName(user.name) ? username || 'حساب موظف' : safeText(user.name);
  return {
    ...user,
    id: safeText(user.id),
    staffId: user.staffId ? safeText(user.staffId) : undefined,
    name: cleanName,
    username: username || cleanName,
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    promise.then(resolve).catch(reject).finally(() => window.clearTimeout(timeoutId));
  });
}

async function loadEffectivePermissions(accountId: string, role: unknown, fallback?: unknown): Promise<Record<string, boolean>> {
  const roleKey = normalizeRole(safeText(role, 'assistant'));
  let effectivePermissions = capPermissionsToRole(roleKey, fallback || {});
  try {
    const { data: permsData, error: permsError } = await withTimeout<SupabaseRpcResult<unknown>>(
      supabase.rpc('get_user_permissions', { p_user_id: accountId }),
      2500,
      'get_user_permissions'
    );
    if (!permsError && permsData) {
      effectivePermissions = capPermissionsToRole(roleKey, permsData as Record<string, boolean>);
    }
  } catch (error) {
    if (import.meta.env.DEV) console.warn('[Dawaa auth] permission refresh skipped', error);
  }
  return effectivePermissions;
}

async function resolveCurrentStaffAccount(user: User): Promise<User | null> {
  if (!isSupabaseConfigured) return sanitizeUser(user);

  const identifiers = Array.from(new Set(
    [user.id, user.staffId, user.username].map((value) => safeText(value)).filter(Boolean)
  ));

  for (const identifier of identifiers.slice(0, 2)) {
    try {
      const { data, error } = await withTimeout<SupabaseRpcResult<unknown>>(
        supabase.rpc('resolve_staff_account_safe', { p_identifier: identifier }),
        ACCOUNT_REFRESH_TIMEOUT_MS,
        'resolve_staff_account_safe'
      );
      if (error) continue;
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      const row = rows.find((item: StaffAccountLoginRow) => safeText(item.id) === safeText(user.id)) || rows[0];
      if (!row) continue;
      if (row.active === false || row.can_login === false) return null;
      const role = normalizeRole(safeText(row.role, user.role));
      const resolvedName = isPlaceholderName(row.name)
        ? safeText(row.staff_name, safeText(row.username, user.name))
        : safeText(row.name);
      const accountId = safeText(row.id, user.id);
      const effectivePermissions = await loadEffectivePermissions(accountId, role, row.permissions || user.permissions || {});
      return sanitizeUser({
        ...user,
        id: accountId,
        staffId: safeText(row.staff_id, user.staffId),
        username: safeText(row.username, user.username),
        name: resolvedName,
        role,
        branch: safeText(row.branch, user.branch),
        active: row.active !== false,
        permissions: effectivePermissions,
      } as User);
    } catch (error) {
      if (import.meta.env.DEV) console.warn('[Dawaa auth] account refresh skipped', error);
      break;
    }
  }

  return sanitizeUser(user);
}

function refreshCurrentStaffAccount(user: User): Promise<User | null> {
  const now = Date.now();
  if (now - lastAccountRefreshAt < ACCOUNT_REFRESH_TTL_MS) return Promise.resolve(sanitizeUser(user));
  if (accountRefreshPromise) return accountRefreshPromise;

  accountRefreshPromise = resolveCurrentStaffAccount(user)
    .then((resolvedUser) => {
      lastAccountRefreshAt = Date.now();
      return resolvedUser;
    })
    .finally(() => {
      accountRefreshPromise = null;
    });

  return accountRefreshPromise;
}

async function loginWithStaffAccount(username: string, password: string): Promise<User | null> {
  if (!isSupabaseConfigured) return null;

  const attemptLogin = async (): Promise<{ data: unknown; networkFailure: boolean }> => {
    try {
      const result = await withTimeout<SupabaseRpcResult<unknown>>(
        supabase.rpc('staff_account_login', { p_username: username, p_password: password }),
        15000,
        'staff_account_login'
      );
      if (result.error) {
        console.warn('[Dawaa auth] login failed reason', result.error.message || result.error);
        return { data: null, networkFailure: false };
      }
      return { data: result.data, networkFailure: false };
    } catch (error) {
      console.warn('[Dawaa auth] login failed reason', error);
      return { data: null, networkFailure: true };
    }
  };

  let outcome = await attemptLogin();
  if (outcome.networkFailure) {
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    outcome = await attemptLogin();
  }

  if (outcome.networkFailure && !outcome.data) {
    logRuntimeError('auth login rpc failed', new Error('staff_account_login timed out after retry'));
  }

  const data = outcome.data;
  const row = Array.isArray(data) ? (data[0] as StaffAccountLoginRow | undefined) : (data as StaffAccountLoginRow | null);
  if (!row?.id || row.active === false || row.can_login === false) return null;

  void withTimeout(
    supabase.rpc('set_current_user_context', { p_user_id: row.id }),
    2000,
    'set_current_user_context'
  ).catch(() => {});

  const roleKey = normalizeRole(safeText(row.role, 'assistant'));
  const effectivePermissions = await loadEffectivePermissions(safeText(row.id), roleKey, row.permissions || {});

  const resolvedName = isPlaceholderName(row.name)
    ? safeText(row.staff_name, safeText(row.username, 'حساب موظف'))
    : safeText(row.name);
  return sanitizeUser({
    id: safeText(row.id),
    staffId: row.staff_id || undefined,
    name: resolvedName,
    username: safeText(row.username, resolvedName),
    role: roleKey,
    branch: safeText(row.branch, 'all'),
    phone: row.phone || undefined,
    active: row.active,
    permissions: effectivePermissions,
  } as User);
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(currentUser);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const listener = () => setUser(currentUser);
    listeners.add(listener);
    setUser(currentUser);
    return () => { listeners.delete(listener); };
  }, []);

  useEffect(() => {
    if (!currentUser) { setLoading(false); return; }
    let cancelled = false;

    const shouldBlockForRefresh = Date.now() - lastAccountRefreshAt >= ACCOUNT_REFRESH_TTL_MS;
    setLoading(shouldBlockForRefresh);

    void refreshCurrentStaffAccount(currentUser)
      .then((freshUser) => {
        if (cancelled) return;
        if (!freshUser) setCurrentUser(null);
        else if (
          freshUser.id !== currentUser?.id ||
          freshUser.role !== currentUser?.role ||
          freshUser.branch !== currentUser?.branch ||
          freshUser.name !== currentUser?.name ||
          JSON.stringify(freshUser.permissions || {}) !== JSON.stringify(currentUser?.permissions || {})
        ) {
          setCurrentUser(freshUser);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
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
    if (accountUser) {
      lastAccountRefreshAt = Date.now();
      setCurrentUser(accountUser);
      logAuthActivity(accountUser, 'login', 'success');
      return true;
    }
    return false;
  }, []);

  const logout = useCallback(async () => {
    if (currentUser) logAuthActivity(currentUser, 'logout', 'success');
    setCurrentUser(null);
    lastAccountRefreshAt = 0;
    try {
      await withTimeout(
        supabase.rpc('set_current_user_context', { p_user_id: null }),
        2000,
        'clear_current_user_context'
      );
    } catch {}
  }, []);

  const safeUser = useMemo(() => sanitizeUser(user), [user?.id, user?.role, user?.branch, user?.name, user?.username, user?.active, user?.phone, user?.staffId, JSON.stringify(user?.permissions || {})]);
  const roleKey = normalizeRole(safeText(safeUser?.role, 'assistant'));
  const isAdmin = isAdminRole(roleKey);
  const isBranchManager = isBranchManagerRole(roleKey);
  const canManage = isPrivilegedRole(roleKey) || isBranchManager;
  const checkPermission = useCallback((permission?: string): boolean => {
    try { return coreHasPermission(safeUser, permission || ''); }
    catch (error) { logRuntimeError('auth checkPermission failed', error); return false; }
  }, [safeUser]);
  const hasPermission = useCallback(async (permission?: string): Promise<boolean> => {
    try { return !permission || coreHasPermission(safeUser, permission); }
    catch (error) { logRuntimeError('auth hasPermission failed', error); return false; }
  }, [safeUser]);
  return { user: safeUser, loading, login, logout, isAdmin, isBranchManager, canManage, checkPermission, hasPermission };
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
