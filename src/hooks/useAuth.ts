import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { User } from "@/types";
import { getDefaultPermissionsForRole, isAdminRole, isBranchManagerRole, mergePermissionMaps, normalizeRole, userHasPermission } from "@/lib/permissionMatrix";

interface StaffAccountLoginRow {
  id: string;
  staff_id?: string | null;
  username: string;
  name: string;
  role: string;
  branch: string;
  phone: string | null;
  active: boolean;
  can_login?: boolean | null;
  permissions?: Record<string, boolean> | null;
}

const STORAGE_KEY = "dawaa_auth_user_v2";
const listeners = new Set<() => void>();
let currentUser: User | null = readStoredUser();

const PERMISSION_ALIASES: Record<string, string[]> = {
  "dashboard.view": ["view_dashboard"],
  "customers.view": ["view_customers", "view_customer_service"],
  "customers.create": ["create_customer", "create_followup"],
  "customers.edit": ["edit_customer", "edit_followup"],
  "customers.delete": ["delete_customer"],
  "team.view": ["view_team"],
  "team.create": ["create_team_member"],
  "team.edit": ["edit_team_member"],
  "team.delete": ["disable_team_member"],
  "shifts.view": ["view_schedule", "view_attendance_leaves"],
  "shifts.create": ["create_schedule", "create_leave_request"],
  "shifts.edit": ["edit_schedule", "edit_attendance"],
  "shifts.delete": ["delete_schedule"],
  "permissions.view": ["view_staff_accounts", "view_roles_permissions", "manage_user_permissions"],
  "permissions.edit": ["manage_permissions", "manage_user_permissions", "manage_roles"],
  "points.view": ["view_points_rewards", "view_points"],
  "points.manage": ["manage_points", "create_reward", "create_deduction", "edit_points_transaction"],
  "penalties.view": ["view_points_rewards"],
  "penalties.create": ["create_deduction"],
  "rewards.view": ["view_points_rewards"],
  "rewards.create": ["create_reward"],
  "evaluations.view": ["view_conversation_reviews", "view_shift_performance"],
  "evaluations.create": ["create_conversation_review", "create_shift_evaluation"],
  "evaluations.edit": ["edit_conversation_review", "edit_shift_evaluation"],
  "reports.view": ["view_analytics_sales", "view_activity_logs", "view_sales_reports"],
  "reports.export": ["export_sales_reports", "export_activity_logs", "export_points_report"],
  "settings.view": ["view_settings"],
  "settings.edit": ["manage_settings"],
};

function readStoredUser(): User | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as User) : null;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function setCurrentUser(user: User | null) {
  currentUser = user;
  if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  else localStorage.removeItem(STORAGE_KEY);
  listeners.forEach((listener) => listener());
}

function logAuthActivity(user: User, action: string, details: string) {
  if (!isSupabaseConfigured) return;
  supabase
    .from("activity_log")
    .insert({
      user_id: user.id,
      user_name: user.name,
      action,
      module: "النظام",
      details,
      branch: user.branch,
    })
    .then(() => {
      // نتجاهل الأخطاء في سجل الأنشطة — لا تؤثر على تجربة المستخدم
    });
}

async function loginWithStaffAccount(
  username: string,
  password: string,
): Promise<User | null> {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await supabase.rpc("staff_account_login", {
    p_username: username,
    p_password: password,
  });

  if (error) return null;

  const row = Array.isArray(data)
    ? (data[0] as StaffAccountLoginRow | undefined)
    : (data as StaffAccountLoginRow | null);
  if (!row?.id || row.active === false || row.can_login === false) return null;

  // ضبط سياق المستخدم لـ RLS
  try {
    await supabase.rpc("set_current_user_context", {
      p_user_id: row.id,
    });
  } catch {
    // نكمل حتى لو فشل ضبط السياق
  }

  // جيب الصلاحيات الفعلية من الأدوار والتخصيصات، مع fallback قوي حسب الدور
  const roleDefaultPermissions = getDefaultPermissionsForRole(row.role);
  let effectivePermissions = mergePermissionMaps(roleDefaultPermissions, row.permissions || {});
  try {
    const { data: permsData, error: permsError } = await supabase.rpc(
      "get_user_permissions",
      { p_user_id: row.id },
    );
    if (!permsError && permsData) {
      effectivePermissions = mergePermissionMaps(roleDefaultPermissions, permsData as Record<string, boolean>);
    }
  } catch {
    // استخدم صلاحيات الدور المخزنة في الواجهة كـ fallback آمن
  }

  return {
    id: row.id,
    staffId: row.staff_id || undefined,
    name: row.name,
    username: row.username,
    role: row.role,
    branch: row.branch,
    phone: row.phone || undefined,
    active: row.active,
    permissions: effectivePermissions,
  };
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(currentUser);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const listener = () => setUser(currentUser);
    listeners.add(listener);
    setUser(currentUser);
    setLoading(false);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  // طبقة أمان: إنهاء الجلسة بعد خمول طويل لتقليل مخاطر ترك الحساب مفتوحًا.
  useEffect(() => {
    if (!user) return;
    const timeoutMs = 12 * 60 * 60 * 1000; // 12 ساعة بدل ساعة واحدة — أنسب للموبايل
    let timerId: number | undefined;
    const resetTimer = () => {
      if (timerId) window.clearTimeout(timerId);
      timerId = window.setTimeout(() => {
        setCurrentUser(null);
      }, timeoutMs);
    };
    const events: Array<keyof WindowEventMap> = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((eventName) => window.addEventListener(eventName, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      if (timerId) window.clearTimeout(timerId);
      events.forEach((eventName) => window.removeEventListener(eventName, resetTimer));
    };
  }, [user]);

  const login = useCallback(
    async (username: string, password: string): Promise<boolean> => {
      // محاولة الدخول عبر Supabase staff_accounts فقط
      const accountUser = await loginWithStaffAccount(username, password);
      if (accountUser) {
        setCurrentUser(accountUser);
        logAuthActivity(accountUser, "تسجيل دخول", "تسجيل دخول ناجح");
        return true;
      }

      // لو Supabase مش متوفر — رسالة واضحة بدل الـ fallback
      if (!isSupabaseConfigured) {
        return false;
      }

      return false;
    },
    [],
  );

  const logout = useCallback(async () => {
    if (currentUser)
      logAuthActivity(currentUser, "تسجيل خروج", "تسجيل خروج ناجح");
    setCurrentUser(null);
    try {
      await supabase.rpc("set_current_user_context", {
        p_user_id: null,
      });
    } catch {
      // نكمل حتى لو فشل
    }
  }, []);

  const normalizedRole = normalizeRole(user?.role);
  const isAdmin = isAdminRole(normalizedRole);
  const isBranchManager = isBranchManagerRole(normalizedRole);
  const canManage = isAdmin || isBranchManager || normalizedRole === "executive_manager" || normalizedRole === "branches_manager";

  const checkPermission = useCallback(
    (permission?: string): boolean => {
      if (!permission) return true;
      if (userHasPermission(user, permission)) return true;
      const permissions = user?.permissions;
      if (!permissions || Object.keys(permissions).length === 0) return false;
      if (permissions[permission] === true) return true;
      return (PERMISSION_ALIASES[permission] || []).some((alias) => permissions[alias] === true);
    },
    [isAdmin, user?.permissions],
  );

  const hasPermission = useCallback(
    async (permission?: string): Promise<boolean> => {
      if (!permission) return true;
      if (userHasPermission(user, permission)) return true;

      const permissions = user?.permissions;
      if (permissions && Object.keys(permissions).length > 0) {
        if (permissions[permission] === true) return true;
        return (PERMISSION_ALIASES[permission] || []).some((alias) => permissions[alias] === true);
      }

      if (!user?.id) return false;

      try {
        const { data, error } = await supabase.rpc("user_has_permission", {
          p_user_id: user.id,
          p_permission_key: permission,
        });
        if (!error && data !== null) {
          return data as boolean;
        }
      } catch {
        // نرجع false لو فشل التحقق
      }

      return false;
    },
    [isAdmin, user?.permissions, user?.id],
  );

  return {
    user,
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

/**
 * يرجع UUID المستخدم الحالي، أو null لو مش متاح أو مش UUID صحيح.
 */
export function getSafeCurrentUserId(): string | null {
  if (!currentUser) return null;
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(currentUser.id)) return null;
  return currentUser.id;
}

export function getCurrentUserProfile() {
  if (!currentUser) {
    throw new Error("يجب تسجيل الدخول أولًا لتنفيذ العملية");
  }

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(currentUser.id)) {
    return {
      ...currentUser,
      id: "00000000-0000-0000-0000-000000000000",
    };
  }

  return currentUser;
}
