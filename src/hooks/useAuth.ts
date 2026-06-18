import { useCallback, useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { User } from '@/types';
import {
  getDefaultPermissionsForRole,
  isAdminRole,
  isBranchManagerRole,
  mergePermissions,
  normalizeRole,
  hasPermission as coreHasPermission,
  isPrivilegedRole,
} from '@/lib/core/permissionSystem';

// backward-compat re-exports used by other files
export { normalizeRole, isAdminRole, isBranchManagerRole };
export const mergePermissionMaps = mergePermissions;
export const userHasPermission = (
  user: Pick<User, 'role' | 'permissions'> | null | undefined,
  permission?: string
) => coreHasPermission(user, permission || '');

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
  permissions?: Record<string, boolean> | null;
}

const STORAGE_KEY = 'dawaa_auth_user_v2';
const listeners = new Set<() => void>();

function safeText(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  if (typeof value === 'string') return value.trim() || fallback;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferred =
      record.key ?? record.role ?? record.name ?? record.label ?? record.labelAr ?? record.value;
    if (preferred != null) return safeText(preferred, fallback);
  }
  return fallback;
}

function sanitizeUser(user: User | null): User | null {
  if (!user) return null;
  return {
    ...user,
    id: safeText(user.id),
    staffId: user.staffId ? safeText(user.staffId) : undefined,
    name: safeText(user.name, 'مستخدم'),
    username: safeText(user.username, safeText(user.name, 'user')),
    role: normalizeRole(safeText(user.role, 'assistant')),
    branch: safeText(user.branch, 'كل الفروع'),
    phone: user.phone ? safeText(user.phone) : undefined,
    active: user.active !== false,
    permissions: user.permissions || {},
  };
}

function readStoredUser(): User | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? sanitizeUser(JSON.parse(stored) as User) : null;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

let currentUser: User | null = readStoredUser();

function setCurrentUser(user: User | null) {
  currentUser = sanitizeUser(user);
  if (currentUser) localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
  else localStorage.removeItem(STORAGE_KEY);
  listeners.forEach((listener) => listener());
}

function logAuthActivity(user: User, action: string, details: string) {
  if (!isSupabaseConfigured) return;
  supabase
    .from('activity_log')
    .insert({
      user_id: user.id,
      user_name: user.name,
      action,
      module: 'النظام',
      details,
      branch: user.branch,
    })
    .then(() => {});
}

async function loginWithStaffAccount(username: string, password: string): Promise<User | null> {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await supabase.rpc('staff_account_login', {
    p_username: username,
    p_password: password,
  });
  if (error) return null;

  const row = Array.isArray(data)
    ? (data[0] as StaffAccountLoginRow | undefined)
    : (data as StaffAccountLoginRow | null);

  if (!row?.id || row.active === false || row.can_login === false) return null;

  try {
    await supabase.rpc('set_current_user_context', { p_user_id: row.id });
  } catch {
    // The context RPC is optional on older databases.
  }

  const roleKey = normalizeRole(safeText(row.role, 'assistant'));
  const roleDefaults = getDefaultPermissionsForRole(roleKey);
  let effectivePermissions = mergePermissions(roleDefaults, row.permissions || {});

  try {
    const { data: permsData, error: permsError } = await supabase.rpc('get_user_permissions', {
      p_user_id: row.id,
    });
    if (!permsError && permsData) {
      effectivePermissions = mergePermissions(roleDefaults, permsData as Record<string, boolean>);
    }
  } catch {
    // use role defaults
  }

  return sanitizeUser({
    id: safeText(row.id),
    staffId: row.staff_id || undefined,
    name: safeText(row.name, safeText(row.username, 'مستخدم')),
    username: safeText(row.username, safeText(row.name, 'user')),
    role: roleKey,
    branch: safeText(row.branch, 'كل الفروع'),
    phone: row.phone || undefined,
    active: row.active,
    permissions: effectivePermissions,
  } as User);
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(currentUser);

  useEffect(() => {
    const listener = () => setUser(currentUser);
    listeners.add(listener);
    setUser(currentUser);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const TIMEOUT = 12 * 60 * 60 * 1000;
    let timerId: number | undefined;
    const reset = () => {
      if (timerId) window.clearTimeout(timerId);
      timerId = window.setTimeout(() => setCurrentUser(null), TIMEOUT);
    };
    const events: Array<keyof WindowEventMap> = [
      'mousemove',
      'keydown',
      'click',
      'scroll',
      'touchstart',
    ];
    events.forEach((eventName) => window.addEventListener(eventName, reset, { passive: true }));
    reset();
    return () => {
      if (timerId) window.clearTimeout(timerId);
      events.forEach((eventName) => window.removeEventListener(eventName, reset));
    };
  }, [user]);

  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    const accountUser = await loginWithStaffAccount(username, password);
    if (accountUser) {
      setCurrentUser(accountUser);
      logAuthActivity(accountUser, 'تسجيل دخول', 'تسجيل دخول ناجح');
      return true;
    }
    return false;
  }, []);

  const logout = useCallback(async () => {
    if (currentUser) logAuthActivity(currentUser, 'تسجيل خروج', 'تسجيل خروج ناجح');
    setCurrentUser(null);
    try {
      await supabase.rpc('set_current_user_context', { p_user_id: null });
    } catch {}
  }, []);

  const roleKey = normalizeRole(safeText(user?.role, 'assistant'));
  const isAdmin = isAdminRole(roleKey);
  const isBranchManager = isBranchManagerRole(roleKey);
  const canManage = isPrivilegedRole(roleKey) || isBranchManager;

  const checkPermission = useCallback(
    (permission?: string): boolean => coreHasPermission(sanitizeUser(user), permission || ''),
    [user]
  );

  const hasPermission = useCallback(
    async (permission?: string): Promise<boolean> => {
      if (!permission) return true;
      const safeUser = sanitizeUser(user);
      if (coreHasPermission(safeUser, permission)) return true;
      if (!safeUser?.id) return false;
      try {
        const { data, error } = await supabase.rpc('user_has_permission', {
          p_user_id: safeUser.id,
          p_permission_key: permission,
        });
        if (!error && data !== null) return data as boolean;
      } catch {}
      return false;
    },
    [user]
  );

  return {
    user: sanitizeUser(user),
    loading: false,
    login,
    logout,
    isAdmin,
    isBranchManager,
    canManage,
    checkPermission,
    hasPermission,
  };
}

export function getSafeCurrentUserId(): string | null {
  if (!currentUser) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(currentUser.id) ? currentUser.id : null;
}

export function getCurrentUserProfile() {
  if (!currentUser) throw new Error('يجب تسجيل الدخول أولًا');
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(currentUser.id)) {
    return { ...currentUser, id: '00000000-0000-0000-0000-000000000000' };
  }
  return sanitizeUser(currentUser) || currentUser;
}
