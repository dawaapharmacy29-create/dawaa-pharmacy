import { useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { User } from "@/types";

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

const AUTH_USERS = [
  {
    username: "admin",
    password: "admin123",
    role: "أدمن",
    name: "المدير العام",
    branch: "الكل",
    id: "00000000-0000-0000-0000-000000000000",
  },
  {
    username: "yasmine.farouk",
    password: "pass123",
    role: "مدير فرع",
    name: "ياسمين فاروق",
    branch: "فرع شكري",
    id: "11111111-0010-0000-0000-000000000010",
  },
  {
    username: "omar.sherif",
    password: "pass123",
    role: "مدير فرع",
    name: "عمر الشريف",
    branch: "فرع الشامي",
    id: "11111111-0011-0000-0000-000000000011",
  },
  {
    username: "ahmed.mahmoud",
    password: "pass123",
    role: "صيدلاني",
    name: "د. أحمد محمود",
    branch: "فرع شكري",
    id: "11111111-0001-0000-0000-000000000001",
  },
  {
    username: "sara.khaled",
    password: "pass123",
    role: "صيدلاني",
    name: "د. سارة خالد",
    branch: "فرع شكري",
    id: "11111111-0002-0000-0000-000000000002",
  },
  {
    username: "mona.ramadan",
    password: "pass123",
    role: "خدمة عملاء",
    name: "منى رمضان",
    branch: "فرع شكري",
    id: "11111111-0009-0000-0000-000000000009",
  },
  {
    username: "ali.hassan",
    password: "pass123",
    role: "توصيل",
    name: "علي حسن",
    branch: "فرع شكري",
    id: "11111111-0004-0000-0000-000000000004",
  },
];

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
    .then(({ error }) => {
      if (error) console.warn("[auth] activity log error:", error.message);
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

  if (error) {
    console.warn("[auth] staff account login unavailable:", error.message);
    return null;
  }

  const row = Array.isArray(data)
    ? (data[0] as StaffAccountLoginRow | undefined)
    : (data as StaffAccountLoginRow | null);
  if (!row?.id || row.active === false || row.can_login === false) return null;

  // Set the current user context for RLS
  try {
    await supabase.rpc("set_current_user_context", {
      p_user_id: row.id,
    });
  } catch (e) {
    console.warn("[auth] failed to set user context for RLS:", e);
  }

  // Get effective permissions from roles + overrides
  let effectivePermissions = row.permissions || {};
  try {
    const { data: permsData, error: permsError } = await supabase.rpc(
      "get_user_permissions",
      {
        p_user_id: row.id,
      },
    );
    if (!permsError && permsData) {
      effectivePermissions = permsData as Record<string, boolean>;
    }
  } catch (e) {
    console.warn("[auth] failed to fetch user permissions:", e);
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

  useEffect(() => {
    const listener = () => setUser(currentUser);
    listeners.add(listener);
    setUser(currentUser);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const login = useCallback(
    async (username: string, password: string): Promise<boolean> => {
      const accountUser = await loginWithStaffAccount(username, password);
      if (accountUser) {
        setCurrentUser(accountUser);
        logAuthActivity(
          accountUser,
          "تسجيل دخول",
          "تسجيل دخول ناجح من حسابات الفريق",
        );
        return true;
      }

      if (isSupabaseConfigured) {
        return false;
      }

      const found = AUTH_USERS.find(
        (item) => item.username === username && item.password === password,
      );
      if (!found) return false;

      const userData: User = {
        id: found.id,
        name: found.name,
        username: found.username,
        role: found.role,
        branch: found.branch,
        active: true,
      };

      setCurrentUser(userData);
      logAuthActivity(userData, "تسجيل دخول", "تسجيل دخول ناجح");
      return true;
    },
    [],
  );

  const logout = useCallback(async () => {
    if (currentUser)
      logAuthActivity(currentUser, "تسجيل خروج", "تسجيل خروج ناجح");
    setCurrentUser(null);
    // Clear the user context for RLS
    try {
      await supabase.rpc("set_current_user_context", {
        p_user_id: null,
      });
    } catch (e) {
      console.warn("[auth] failed to clear user context:", e);
    }
  }, []);

  const normalizedRole = user?.role?.trim();
  const isAdmin =
    normalizedRole === "مدير عام" ||
    normalizedRole === "المدير العام" ||
    normalizedRole === "admin" ||
    normalizedRole === "أدمن";
  const isBranchManager = normalizedRole === "مدير فرع";
  const canManage = isAdmin || isBranchManager;
  const checkPermission = useCallback(
    (permission?: string): boolean => {
      if (!permission) return true;
      if (isAdmin) return true;
      const permissions = user?.permissions;
      // If no permissions configured yet, allow all (open access for demo/basic users)
      if (!permissions || Object.keys(permissions).length === 0) return true;
      if (permissions[permission] === true) return true;
      return (PERMISSION_ALIASES[permission] || []).some((alias) => permissions[alias] === true);
    },
    [isAdmin, user?.permissions],
  );

  const hasPermission = useCallback(
    async (permission?: string): Promise<boolean> => {
      if (!permission) return true;
      if (isAdmin) return true;

      // Check local permissions first
      const permissions = user?.permissions;
      if (permissions && Object.keys(permissions).length > 0) {
        if (permissions[permission] === true) return true;
        return (PERMISSION_ALIASES[permission] || []).some((alias) => permissions[alias] === true);
      }

      // Fall back to server-side check if user ID is valid
      if (user?.id) {
        try {
          const { data, error } = await supabase.rpc("user_has_permission", {
            p_user_id: user.id,
            p_permission_key: permission,
          });
          if (!error && data !== null) {
            return data as boolean;
          }
        } catch (e) {
          console.warn("[auth] permission check failed:", e);
        }
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
 * Returns the current user's UUID, or null if not available/invalid.
 * NEVER returns "admin" or any non-UUID string.
 */
export function getSafeCurrentUserId(): string | null {
  if (!currentUser) return null;
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(currentUser.id)) return null;
  return currentUser.id;
}

// Helper function to get current user profile with validation
export function getCurrentUserProfile() {
  if (!currentUser) {
    throw new Error("يجب تسجيل الدخول أولًا لتنفيذ العملية");
  }

  // بعض النسخ القديمة خزنت المستخدم في localStorage بمعرف غير UUID مثل "admin".
  // لا نوقف حفظ البيانات بسبب سجل الأنشطة؛ نستبدله بمعرف نظام آمن ونحافظ على الاسم والدور.
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(currentUser.id)) {
    console.warn("Invalid user ID format, using system UUID for audit fields:", currentUser.id);
    return {
      ...currentUser,
      id: "00000000-0000-0000-0000-000000000000",
    };
  }

  return currentUser;
}
