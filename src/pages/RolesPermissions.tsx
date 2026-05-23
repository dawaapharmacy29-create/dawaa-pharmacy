import { useMemo, useState } from "react";
import { Plus, ShieldCheck, RefreshCw, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useSupabaseQuery, logActivity } from "@/hooks/useSupabaseQuery";
import { useAuth, getCurrentUserProfile, getSafeCurrentUserId } from "@/hooks/useAuth";
import { TABLES } from "@/lib/supabaseTables";
import { upsertUserPermission } from "@/services/permissionService";

interface Role {
  id: string;
  name: string;
  name_ar: string;
  description: string | null;
  permissions: Record<string, boolean>;
}

interface PermissionRow {
  id: string;
  permission_key: string;
  name_ar?: string | null;
  description?: string | null;
  category?: string | null;
  active?: boolean | null;
}

interface UserPermission {
  id: string;
  user_id: string;
  permission_key: string;
  allowed: boolean;
  created_at: string;
}

interface StaffAccount {
  id: string;
  name: string;
  username: string;
  role: string;
  branch: string;
  status?: string;
  permissions?: Record<string, boolean> | null;
}

interface StaffMember {
  id: string;
  name: string;
  role: string;
  branch: string;
  status?: string;
  is_active?: boolean;
}

const PERMISSION_CATEGORIES = [
  {
    name: "لوحة التحكم",
    permissions: [
      { key: "view_dashboard", label: "مشاهدة لوحة التحكم" },
      { key: "view_dashboard_stats", label: "مشاهدة إحصائيات لوحة التحكم" },
      { key: "view_alerts", label: "مشاهدة التنبيهات" },
      { key: "manage_alerts", label: "إدارة التنبيهات" },
    ],
  },
  {
    name: "تقييم الشيفتات",
    permissions: [
      { key: "view_shift_performance", label: "مشاهدة تقييم الشيفتات" },
      { key: "create_shift_evaluation", label: "إنشاء تقييم شيفت" },
      { key: "edit_shift_evaluation", label: "تعديل تقييم شيفت" },
      { key: "delete_shift_evaluation", label: "حذف تقييم شيفت" },
      { key: "approve_shift_evaluation", label: "اعتماد تقييم شيفت" },
    ],
  },
  {
    name: "لوحة الدكتور",
    permissions: [
      { key: "view_doctor_dashboard", label: "مشاهدة لوحة الدكتور" },
      { key: "view_own_performance", label: "مشاهدة أداءه الشخصي" },
      { key: "view_all_doctors_performance", label: "مشاهدة أداء كل الدكاترة" },
    ],
  },
  {
    name: "العملاء",
    permissions: [
      { key: "view_customers", label: "مشاهدة العملاء" },
      { key: "create_customer", label: "إضافة عميل" },
      { key: "edit_customer", label: "تعديل عميل" },
      { key: "delete_customer", label: "حذف عميل" },
      { key: "view_customer_details", label: "مشاهدة تفاصيل العميل" },
      { key: "export_customers", label: "تصدير العملاء" },
    ],
  },
  {
    name: "خدمة العملاء",
    permissions: [
      { key: "view_customer_service", label: "مشاهدة خدمة العملاء" },
      { key: "create_followup", label: "إنشاء متابعة" },
      { key: "edit_followup", label: "تعديل متابعة" },
      { key: "close_followup", label: "إغلاق متابعة" },
      { key: "assign_followup", label: "إسناد متابعة لموظف" },
      { key: "whatsapp_customer", label: "فتح واتساب للعميل" },
    ],
  },
  {
    name: "الفريق",
    permissions: [
      { key: "view_team", label: "مشاهدة الفريق" },
      { key: "create_team_member", label: "إضافة عضو فريق" },
      { key: "edit_team_member", label: "تعديل عضو فريق" },
      { key: "disable_team_member", label: "تعطيل عضو فريق" },
    ],
  },
  {
    name: "الجدول الأسبوعي",
    permissions: [
      { key: "view_schedule", label: "مشاهدة الجدول" },
      { key: "create_schedule", label: "إنشاء جدول" },
      { key: "edit_schedule", label: "تعديل جدول" },
      { key: "delete_schedule", label: "حذف جدول" },
    ],
  },
  {
    name: "الإذونات والإجازات",
    permissions: [
      { key: "view_attendance_leaves", label: "مشاهدة الإذونات والإجازات" },
      { key: "create_leave_request", label: "إنشاء طلب إجازة" },
      { key: "approve_leave_request", label: "اعتماد طلب إجازة" },
      { key: "reject_leave_request", label: "رفض طلب إجازة" },
      { key: "edit_attendance", label: "تعديل الحضور" },
    ],
  },
  {
    name: "النقاط والمكافآت",
    permissions: [
      { key: "view_points_rewards", label: "مشاهدة النقاط والمكافآت" },
      { key: "create_reward", label: "إضافة مكافأة" },
      { key: "create_deduction", label: "إضافة خصم" },
      { key: "edit_points_transaction", label: "تعديل حركة نقاط" },
      { key: "approve_points_changes", label: "اعتماد تعديلات النقاط" },
      { key: "export_points_report", label: "تصدير تقرير النقاط" },
    ],
  },
  {
    name: "تقييم المحادثات",
    permissions: [
      { key: "view_conversation_reviews", label: "مشاهدة تقييم المحادثات" },
      { key: "create_conversation_review", label: "إنشاء تقييم محادثة" },
      { key: "edit_conversation_review", label: "تعديل تقييم محادثة" },
      { key: "approve_conversation_review", label: "اعتماد تقييم محادثة" },
    ],
  },
  {
    name: "الأدوية الراكدة",
    permissions: [
      { key: "view_stagnant_medicines", label: "مشاهدة الأدوية الراكدة" },
      { key: "create_stagnant_medicine", label: "إضافة صنف راكد" },
      { key: "edit_stagnant_medicine", label: "تعديل صنف راكد" },
      { key: "delete_stagnant_medicine", label: "حذف صنف راكد" },
      { key: "dispense_stagnant_medicine", label: "تسجيل صرف صنف راكد" },
      { key: "view_stagnant_reports", label: "مشاهدة تقارير الرواكد" },
    ],
  },
  {
    name: "أدوية الحوافز",
    permissions: [
      { key: "view_incentive_medicines", label: "مشاهدة أدوية الحوافز" },
      { key: "create_incentive_medicine", label: "إضافة صنف حوافز" },
      { key: "edit_incentive_medicine", label: "تعديل صنف حوافز" },
      { key: "delete_incentive_medicine", label: "حذف صنف حوافز" },
      { key: "dispense_incentive_medicine", label: "صرف صنف حوافز" },
      { key: "view_incentive_reports", label: "مشاهدة تقارير الحوافز" },
    ],
  },
  {
    name: "التوصيل وتقييم الدليفري",
    permissions: [
      { key: "view_delivery", label: "مشاهدة التوصيل" },
      { key: "create_delivery_evaluation", label: "إنشاء تقييم دليفري" },
      { key: "edit_delivery_evaluation", label: "تعديل تقييم دليفري" },
      { key: "approve_delivery_deduction", label: "اعتماد خصم دليفري" },
      { key: "view_delivery_reports", label: "مشاهدة تقارير الدليفري" },
    ],
  },
  {
    name: "التحليلات والمبيعات",
    permissions: [
      { key: "view_analytics_sales", label: "مشاهدة التحليلات والمبيعات" },
      { key: "view_sales_reports", label: "مشاهدة تقارير المبيعات" },
      { key: "export_sales_reports", label: "تصدير تقارير المبيعات" },
      { key: "view_branch_comparison", label: "مقارنة الفروع" },
    ],
  },
  {
    name: "استيراد الفواتير",
    permissions: [
      { key: "view_invoice_import", label: "مشاهدة استيراد الفواتير" },
      { key: "import_sales_invoices", label: "استيراد فواتير المبيعات" },
      { key: "review_import_errors", label: "مراجعة أخطاء الاستيراد" },
      { key: "delete_import_batch", label: "حذف دفعة استيراد" },
      { key: "reprocess_import_batch", label: "إعادة معالجة دفعة استيراد" },
    ],
  },
  {
    name: "حسابات وصلاحيات",
    permissions: [
      { key: "view_staff_accounts", label: "مشاهدة حسابات الموظفين" },
      { key: "create_staff_account", label: "إنشاء حساب موظف" },
      { key: "edit_staff_account", label: "تعديل حساب موظف" },
      { key: "reset_staff_password", label: "تغيير كلمة مرور موظف" },
      { key: "disable_staff_account", label: "تعطيل حساب موظف" },
      { key: "manage_roles", label: "إدارة الأدوار" },
      { key: "manage_permissions", label: "إدارة الصلاحيات" },
      { key: "manage_user_permissions", label: "إدارة صلاحيات مستخدم" },
    ],
  },
  {
    name: "سجل الأنشطة",
    permissions: [
      { key: "view_activity_logs", label: "مشاهدة سجل الأنشطة" },
      { key: "view_activity_details", label: "مشاهدة تفاصيل النشاط" },
      { key: "export_activity_logs", label: "تصدير سجل الأنشطة" },
    ],
  },
  {
    name: "الإعدادات",
    permissions: [
      { key: "view_settings", label: "مشاهدة الإعدادات" },
      { key: "manage_settings", label: "تعديل الإعدادات" },
      { key: "manage_branches", label: "إدارة الفروع" },
      { key: "manage_system_config", label: "إدارة إعدادات النظام" },
    ],
  },
];

function friendlyError(error: unknown): string {
  let msg: string;
  
  if (error instanceof Error) {
    msg = error.message;
  } else if (typeof error === "object" && error !== null) {
    const supabaseError = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
      error_description?: unknown;
    };
    msg = [
      supabaseError.message,
      supabaseError.details,
      supabaseError.hint,
      supabaseError.error_description,
      supabaseError.code,
    ]
      .filter(Boolean)
      .map(String)
      .join(" - ");
    if (!msg) {
      try {
        msg = JSON.stringify(error);
      } catch {
        msg = "حدث خطأ غير متوقع";
      }
    }
  } else {
    msg = String(error);
  }
  
  if (msg.includes("row-level security") || msg.includes("permission denied")) {
    return "ليس لديك صلاحية لتنفيذ هذه العملية أو الحساب غير مربوط بصلاحيات مناسبة.";
  }
  if (msg.includes("duplicate") || msg.includes("unique")) {
    return "هذه الصلاحية محفوظة لهذا المستخدم بالفعل.";
  }
  if (msg.includes("invalid input syntax for type uuid")) {
    return "معرف المستخدم غير صالح. برجاء تسجيل الدخول بحساب مربوط بشكل صحيح.";
  }
  return `حدث خطأ: ${msg}`;
}

export default function RolesPermissions() {
  const { user, checkPermission } = useAuth();
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [newRoleName, setNewRoleName] = useState("");
  const [newPermissionKey, setNewPermissionKey] = useState("");
  const [newPermissionLabel, setNewPermissionLabel] = useState("");
  const [newPermissionCategory, setNewPermissionCategory] = useState(
    "حسابات وصلاحيات",
  );
  const [saving, setSaving] = useState(false);

  const {
    data: roles,
    loading: rolesLoading,
    refetch: refetchRoles,
  } = useSupabaseQuery<Role>({
    table: "roles",
    orderBy: { column: "name", ascending: true },
  });

  const { data: userPermissions, refetch: refetchUserPermissions } =
    useSupabaseQuery<UserPermission>({
      table: TABLES.userPermissions,
      orderBy: { column: "created_at", ascending: false },
    });

  const { data: permissionRows, refetch: refetchPermissions } =
    useSupabaseQuery<PermissionRow>({
      table: TABLES.permissionDefinitions,
      orderBy: { column: "category", ascending: true },
    });

  const {
    data: staffAccounts,
    loading: staffLoading,
    refetch: refetchStaff,
  } = useSupabaseQuery<StaffAccount>({
    table: TABLES.staffAccounts,
    orderBy: { column: "name", ascending: true },
  });

  const { data: staffMembers, loading: staffMembersLoading } =
    useSupabaseQuery<StaffMember>({
      table: TABLES.staff,
      orderBy: { column: "name", ascending: true },
    });

  const allUsers = useMemo(() => {
    // صفحة الأدوار والصلاحيات يجب أن تعدّل حسابات الدخول فقط، وليس صفوف staff.
    // استخدام staff.id هنا كان سبب "معرف المستخدم غير صالح" لأن user_permissions مرتبط بحساب staff_accounts.
    return (staffAccounts || [])
      .filter((acc) => acc.id)
      .map((acc) => ({
        id: acc.id,
        name: acc.name || acc.username || "مستخدم بدون اسم",
        username: acc.username,
        role: acc.role || "غير محدد",
        branch: acc.branch || "غير محدد",
        status: acc.status,
      }));
  }, [staffAccounts]);

  const permissionCategories = useMemo(() => {
    const categories = PERMISSION_CATEGORIES.map((category) => ({
      ...category,
      permissions: [...category.permissions],
    }));
    const known = new Set(
      categories.flatMap((category) =>
        category.permissions.map((permission) => permission.key),
      ),
    );

    for (const row of permissionRows || []) {
      if (!row.permission_key || row.active === false) continue;
      if (known.has(row.permission_key)) continue;

      const categoryName = row.category || "صلاحيات إضافية";
      let category = categories.find((item) => item.name === categoryName);
      if (!category) {
        category = { name: categoryName, permissions: [] };
        categories.push(category);
      }

      category.permissions.push({
        key: row.permission_key,
        label: row.name_ar || row.permission_key,
      });
      known.add(row.permission_key);
    }

    return categories;
  }, [permissionRows]);

  const allPermissions = useMemo(
    () => permissionCategories.flatMap((cat) => cat.permissions),
    [permissionCategories],
  );

  const selectedRoleData = useMemo(() => {
    return roles?.find((r) => r.id === selectedRole) || null;
  }, [roles, selectedRole]);

  const selectedUserData = useMemo(() => {
    return allUsers.find((item) => item.id === selectedUser) || null;
  }, [allUsers, selectedUser]);

  const selectedUserAccount = useMemo(() => {
    if (!selectedUser) return null;
    return staffAccounts.find((account) => account.id === selectedUser) || null;
  }, [selectedUser, staffAccounts]);

  const selectedUserOverrides = useMemo(() => {
    const map = new Map<string, UserPermission>();
    if (!selectedUser) return map;
    for (const permission of userPermissions || []) {
      if (permission.user_id === selectedUser)
        map.set(permission.permission_key, permission);
    }
    return map;
  }, [selectedUser, userPermissions]);

  const selectedRoleForUser = useMemo(() => {
    if (!selectedUserData) return null;
    return (
      roles.find(
        (role) =>
          role.name === selectedUserData.role ||
          role.name_ar === selectedUserData.role,
      ) || null
    );
  }, [roles, selectedUserData]);

  const safeActorId = () => getSafeCurrentUserId();

  const isUserPermissionEnabled = (permissionKey: string) => {
    // First check user-specific overrides (highest priority)
    const override = selectedUserOverrides.get(permissionKey);
    if (override) return override.allowed;

    // Then check role permissions (from staff_accounts.role -> roles table)
    if (
      selectedRoleForUser?.permissions &&
      permissionKey in selectedRoleForUser.permissions
    ) {
      return selectedRoleForUser.permissions[permissionKey] === true;
    }

    // Finally check staff_account.permissions (legacy field)
    if (
      selectedUserAccount?.permissions &&
      permissionKey in selectedUserAccount.permissions
    ) {
      return selectedUserAccount.permissions[permissionKey] === true;
    }

    return false;
  };

  const toggleRolePermission = async (role: Role, permissionKey: string) => {
    if (!user) {
      toast.error("يجب تسجيل الدخول أولًا");
      return;
    }

    try {
      const currentUserProfile = getCurrentUserProfile();
      setSaving(true);

      const newPermissions = {
        ...role.permissions,
        [permissionKey]: !role.permissions[permissionKey],
      };

      const { error } = await supabase
        .from("roles")
        .update({
          permissions: newPermissions,
          updated_at: new Date().toISOString(),
        })
        .eq("id", role.id);

      if (error) throw error;

      toast.success("تم تحديث صلاحيات الدور");
      await logActivity(
        currentUserProfile.id,
        currentUserProfile.name,
        "تعديل صلاحيات الدور",
        "الأدوار والصلاحيات",
        role.name_ar,
        user?.branch || "",
      );
      refetchRoles();
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setSaving(false);
    }
  };

  const addUserPermission = async (
    userId: string,
    permissionKey: string,
    allowed: boolean,
  ) => {
    if (!user) {
      toast.error("يجب تسجيل الدخول أولًا");
      return;
    }

    try {
      const currentUserProfile = getCurrentUserProfile();
      setSaving(true);

      const { error } = await supabase.from("user_permissions").upsert(
        {
          user_id: userId,
          permission_key: permissionKey,
          allowed,
          created_by: safeActorId(),
        },
        { onConflict: "user_id,permission_key" },
      );

      if (error) throw error;

      toast.success("تم إضافة الصلاحية الخاصة");
      await logActivity(
        currentUserProfile.id,
        currentUserProfile.name,
        "إضافة صلاحية خاصة",
        "الأدوار والصلاحيات",
        permissionKey,
        user?.branch || "",
      );
      refetchUserPermissions();
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setSaving(false);
    }
  };

  const setUserPermission = async (
    userId: string,
    permissionKey: string,
    allowed: boolean,
  ) => {
    if (!user) {
      toast.error("يجب تسجيل الدخول أولًا");
      return;
    }

    try {
      const currentUserProfile = getCurrentUserProfile();
      setSaving(true);

      // احفظ الصلاحية داخل staff_accounts.permissions أولًا لضمان ظهورها فورًا في التطبيق
      const account = staffAccounts.find((item) => item.id === userId);
      const nextPermissions = { ...(account?.permissions || {}), [permissionKey]: allowed };
      const accountUpdate = await supabase
        .from(TABLES.staffAccounts)
        .update({ permissions: nextPermissions, updated_at: new Date().toISOString() })
        .eq("id", userId);
      if (accountUpdate.error) throw accountUpdate.error;

      // ثم حاول مزامنة جدول user_permissions إن كان موجودًا ومهيأً
      const { error } = await upsertUserPermission(
        userId,
        permissionKey,
        allowed,
        safeActorId(),
      );

      if (error) console.warn("[user_permissions sync skipped]", error.message);

      toast.success(allowed ? "تم تفعيل الصلاحية" : "تم إيقاف الصلاحية");
      await logActivity(
        currentUserProfile.id,
        currentUserProfile.name,
        "تعديل صلاحية مستخدم",
        "الأدوار والصلاحيات",
        `${selectedUserData?.name || userId} - ${permissionKey}: ${allowed ? "on" : "off"}`,
        selectedUserData?.branch || user?.branch || "",
      );
      refetchUserPermissions();
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setSaving(false);
    }
  };

  const deleteUserPermission = async (permId: string) => {
    if (!user) {
      toast.error("يجب تسجيل الدخول أولًا");
      return;
    }

    try {
      const currentUserProfile = getCurrentUserProfile();
      setSaving(true);

      const { error } = await supabase
        .from(TABLES.userPermissions)
        .delete()
        .eq("id", permId);

      if (error) throw error;

      toast.success("تم حذف الصلاحية الخاصة");
      await logActivity(
        currentUserProfile.id,
        currentUserProfile.name,
        "حذف صلاحية خاصة",
        "الأدوار والصلاحيات",
        "",
        user?.branch || "",
      );
      refetchUserPermissions();
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setSaving(false);
    }
  };

  const createRole = async () => {
    const roleName = newRoleName.trim();
    if (!roleName || !user) {
      toast.error("اكتب اسم الدور أولًا");
      return;
    }

    try {
      const currentUserProfile = getCurrentUserProfile();
      setSaving(true);
      const slug = roleName
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "_") || `role_${Date.now()}`;
      const { error } = await supabase.from("roles").insert({
        name: slug,
        name_ar: roleName,
        description: `دور ${roleName}`,
        permissions: {},
      });
      if (error) throw error;

      toast.success("تم إضافة الدور");
      await logActivity(
        currentUserProfile.id,
        currentUserProfile.name,
        "إضافة دور جديد",
        "الأدوار والصلاحيات",
        roleName,
        user.branch || "",
      );
      setNewRoleName("");
      refetchRoles();
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setSaving(false);
    }
  };

  const createPermission = async () => {
    const permissionKey = newPermissionKey.trim();
    const label = newPermissionLabel.trim() || permissionKey;
    if (!permissionKey || !user) {
      toast.error("اكتب مفتاح الصلاحية أولًا");
      return;
    }

    try {
      const currentUserProfile = getCurrentUserProfile();
      setSaving(true);
      const { error } = await supabase.from(TABLES.permissionDefinitions).upsert(
        {
          permission_key: permissionKey,
          name_ar: label,
          description: label,
          category: newPermissionCategory || "صلاحيات إضافية",
          active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "permission_key" },
      );
      if (error) throw error;

      toast.success("تم حفظ الصلاحية الجديدة");
      await logActivity(
        currentUserProfile.id,
        currentUserProfile.name,
        "إضافة صلاحية جديدة",
        "الأدوار والصلاحيات",
        `${permissionKey} - ${label}`,
        user.branch || "",
      );
      setNewPermissionKey("");
      setNewPermissionLabel("");
      refetchPermissions();
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setSaving(false);
    }
  };

  const refresh = () => {
    refetchRoles();
    refetchUserPermissions();
    refetchStaff();
    refetchPermissions();
  };

  if (!checkPermission("manage_user_permissions")) {
    return (
      <div className="stat-card text-center text-slate-400 py-16">
        ليس لديك صلاحية للوصول إلى هذه الصفحة
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1">
          <h1 className="text-white text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="text-teal-400" size={24} />
            الأدوار والصلاحيات
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            إدارة الأدوار الافتراضية والصلاحيات الخاصة لكل مستخدم
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="btn-secondary flex items-center gap-2"
        >
          <RefreshCw size={16} /> تحديث
        </button>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Roles Section */}
        <div className="stat-card">
          <h2 className="text-white text-lg font-bold mb-4">
            الأدوار الافتراضية
          </h2>
          <div className="mb-4 grid grid-cols-[1fr_auto] gap-2">
            <input
              value={newRoleName}
              onChange={(event) => setNewRoleName(event.target.value)}
              className="input-dark"
              placeholder="اسم دور جديد"
              disabled={saving}
            />
            <button
              type="button"
              onClick={createRole}
              disabled={saving || !newRoleName.trim()}
              className="btn-primary flex items-center gap-2"
            >
              <Plus size={16} />
              إضافة
            </button>
          </div>
          {rolesLoading ? (
            <div className="text-slate-400 text-center py-8">
              جاري التحميل...
            </div>
          ) : (
            <div className="space-y-3">
              {roles?.map((role) => (
                <div
                  key={role.id}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedRole === role.id
                      ? "bg-teal-500/10 border-teal-500/30"
                      : "bg-white/5 border-[#2d4063] hover:border-teal-500/20"
                  }`}
                  onClick={() => setSelectedRole(role.id)}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="text-white font-bold">{role.name_ar}</div>
                      <div className="text-slate-400 text-sm">{role.name}</div>
                    </div>
                    <div className="text-slate-400 text-sm">
                      {Object.values(role.permissions).filter(Boolean).length}{" "}
                      صلاحية
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedRoleData && (
            <div className="mt-4 pt-4 border-t border-[#2d4063]">
              <h3 className="text-white font-bold mb-3">
                صلاحيات {selectedRoleData.name_ar}
              </h3>
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {permissionCategories.map((category) => (
                  <div key={category.name}>
                    <h4 className="text-teal-400 text-sm font-bold mb-2">
                      {category.name}
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      {category.permissions.map((perm) => {
                        const enabled = selectedRoleData.permissions[perm.key];
                        return (
                          <button
                            key={perm.key}
                            disabled={saving}
                            onClick={() =>
                              toggleRolePermission(selectedRoleData, perm.key)
                            }
                            className={`px-3 py-2 rounded-lg border text-xs text-right transition-all ${
                              enabled
                                ? "bg-teal-500/15 border-teal-500/30 text-teal-300"
                                : "bg-white/5 border-[#2d4063] text-slate-400"
                            }`}
                          >
                            {perm.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* User Permissions Section */}
        <div className="stat-card">
          <h2 className="text-white text-lg font-bold mb-4">
            الصلاحيات الخاصة
          </h2>

          <div className="mb-4 grid md:grid-cols-4 gap-2 rounded-xl border border-[#2d4063] bg-white/5 p-3">
            <input
              value={newPermissionKey}
              onChange={(event) => setNewPermissionKey(event.target.value)}
              className="input-dark"
              placeholder="permission_key"
              disabled={saving}
            />
            <input
              value={newPermissionLabel}
              onChange={(event) => setNewPermissionLabel(event.target.value)}
              className="input-dark"
              placeholder="اسم الصلاحية"
              disabled={saving}
            />
            <select
              value={newPermissionCategory}
              onChange={(event) => setNewPermissionCategory(event.target.value)}
              className="input-dark"
              disabled={saving}
            >
              {permissionCategories.map((category) => (
                <option key={category.name} value={category.name}>
                  {category.name}
                </option>
              ))}
              <option value="صلاحيات إضافية">صلاحيات إضافية</option>
            </select>
            <button
              type="button"
              onClick={createPermission}
              disabled={saving || !newPermissionKey.trim()}
              className="btn-primary flex items-center justify-center gap-2"
            >
              <Plus size={16} />
              حفظ صلاحية
            </button>
          </div>

          <div className="mb-4">
            <select
              value={selectedUser || ""}
              onChange={(e) => setSelectedUser(e.target.value || null)}
              className="input-dark w-full"
              disabled={staffLoading || staffMembersLoading}
            >
              <option value="">اختر مستخدم...</option>
              {allUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} - {user.role} - {user.branch}{" "}
                  {user.status ? `(${user.status})` : ""}
                </option>
              ))}
            </select>
          </div>

          {selectedUser && selectedUserData && (
            <div className="mb-4 p-4 bg-white/5 rounded-lg border border-[#2d4063]">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-white font-bold flex items-center gap-2">
                    <UserRound size={18} className="text-teal-300" />
                    {selectedUserData.name}
                  </h3>
                  <div className="text-slate-400 text-xs mt-1">
                    {selectedUserData.role} - {selectedUserData.branch}
                    {selectedUserData.username
                      ? ` - ${selectedUserData.username}`
                      : ""}
                  </div>
                </div>
                <div className="text-xs text-slate-400">
                  الدور الأساسي: {selectedRoleForUser?.name_ar || "غير محدد"}
                </div>
              </div>

              <div className="space-y-5 max-h-[620px] overflow-y-auto pr-1">
                {permissionCategories.map((category) => (
                  <div
                    key={category.name}
                    className="bg-[#172743] border border-[#2d4063]/70 rounded-xl p-3"
                  >
                    <h4 className="text-teal-300 text-sm font-bold mb-3">
                      {category.name}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {category.permissions.map((perm) => {
                        const enabled = isUserPermissionEnabled(perm.key);
                        const overridden = selectedUserOverrides.has(perm.key);
                        return (
                          <button
                            key={perm.key}
                            disabled={saving}
                            onClick={() =>
                              setUserPermission(
                                selectedUser,
                                perm.key,
                                !enabled,
                              )
                            }
                            className="flex items-center justify-between gap-3 bg-white/5 hover:bg-white/10 border border-[#2d4063] rounded-xl px-3 py-2 text-right transition-colors"
                          >
                            <span>
                              <span className="block text-white text-sm">
                                {perm.label}
                              </span>
                              <span className="block text-slate-500 text-[11px] mt-0.5">
                                {overridden
                                  ? "تخصيص مباشر للمستخدم"
                                  : "من الدور الأساسي"}
                              </span>
                            </span>
                            <span
                              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors ${
                                enabled
                                  ? "bg-emerald-500 border-emerald-400"
                                  : "bg-slate-600 border-slate-500"
                              }`}
                            >
                              <span
                                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                                  enabled ? "right-5" : "right-0.5"
                                }`}
                              />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {userPermissions?.length === 0 ? (
              <div className="text-slate-400 text-center py-8">
                لا توجد صلاحيات خاصة
              </div>
            ) : (
              userPermissions?.map((perm) => {
                const staff = allUsers.find((s) => s.id === perm.user_id);
                return (
                  <div
                    key={perm.id}
                    className="flex items-center justify-between p-2 bg-white/5 rounded-lg border border-[#2d4063]"
                  >
                    <div className="flex-1">
                      <div className="text-white text-sm">
                        {staff?.name || "مستخدم غير معروف"}
                      </div>
                      <div className="text-slate-400 text-xs">
                        {staff?.role} - {staff?.branch}
                      </div>
                      <div className="text-slate-400 text-xs">
                        {allPermissions.find(
                          (p) => p.key === perm.permission_key,
                        )?.label || perm.permission_key}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          perm.allowed
                            ? "bg-green-500/15 text-green-400"
                            : "bg-red-500/15 text-red-400"
                        }`}
                      >
                        {perm.allowed ? "مسموح" : "ممنوع"}
                      </span>
                      <button
                        disabled={saving}
                        onClick={() => deleteUserPermission(perm.id)}
                        className="text-red-400 hover:text-red-300 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
