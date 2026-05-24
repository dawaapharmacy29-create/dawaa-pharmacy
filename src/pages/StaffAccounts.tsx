import { useMemo, useState } from "react";
import {
  KeyRound,
  ExternalLink,
  Power,
  RefreshCw,
  Save,
  ShieldCheck,
  UserPlus,
  Edit2,
  Eye,
  EyeOff,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { TABLES } from "@/lib/supabaseTables";
import { selectableStaffChoices } from "@/lib/staffFallback";
import { useSupabaseQuery, logActivity } from "@/hooks/useSupabaseQuery";
import { Link } from "react-router-dom";
import {
  useAuth,
  getCurrentUserProfile,
  getSafeCurrentUserId,
} from "@/hooks/useAuth";

interface StaffRow {
  id: string;
  name: string;
  role: string;
  branch: string;
  branch_id?: string | null;
  status?: string | null;
  active?: boolean | null;
  deleted_at?: string | null;
  is_deleted?: boolean | null;
  points?: number | null;
  max_points?: number | null;
}

interface StaffAccountRow {
  id: string;
  staff_id?: string | null;
  username?: string | null;
  temporary_password?: string | null;
  password_status?: string | null;
  name?: string | null;
  staff_name?: string | null;
  role?: string | null;
  staff_role?: string | null;
  branch?: string | null;
  active?: boolean | null;
  can_login?: boolean | null;
  visible_in_admin?: boolean | null;
  permissions?: Record<string, boolean> | null;
  auth_user_id?: string | null;
  last_login_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

const PERMISSIONS = [
  { key: "view_dashboard", label: "لوحة التحكم" },
  { key: "view_customers", label: "العملاء" },
  { key: "edit_customers", label: "تعديل العملاء" },
  { key: "view_customer_service", label: "خدمة العملاء" },
  { key: "manage_followups", label: "إدارة المتابعات" },
  { key: "view_points", label: "النقاط والحوافز" },
  { key: "manage_points", label: "إضافة خصم أو مكافأة" },
  { key: "view_reviews", label: "تقييم المحادثات" },
  { key: "add_reviews", label: "إضافة تقييم محادثة" },
  { key: "view_schedule", label: "الجدول الأسبوعي" },
  { key: "manage_time_off", label: "الإذونات والإجازات" },
  { key: "view_invoices", label: "استيراد الفواتير" },
  { key: "view_activity_log", label: "سجل الأنشطة" },
];

const FULL_PERMISSIONS = [
  {
    key: "view_shift_performance",
    label:
      "\u062a\u0642\u064a\u064a\u0645 \u0627\u0644\u0634\u064a\u0641\u062a\u0627\u062a",
  },
  {
    key: "view_dashboard",
    label: "\u0644\u0648\u062d\u0629 \u0627\u0644\u062a\u062d\u0643\u0645",
  },
  {
    key: "view_doctor_dashboard",
    label:
      "\u0644\u0648\u062d\u0629 \u0627\u0644\u062f\u0643\u062a\u0648\u0631",
  },
  {
    key: "view_customers",
    label: "\u0627\u0644\u0639\u0645\u0644\u0627\u0621",
  },
  {
    key: "edit_customers",
    label:
      "\u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u0639\u0645\u0644\u0627\u0621",
  },
  {
    key: "view_customer_service",
    label:
      "\u062e\u062f\u0645\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621",
  },
  {
    key: "manage_followups",
    label:
      "\u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u0645\u062a\u0627\u0628\u0639\u0627\u062a",
  },
  { key: "view_team", label: "\u0627\u0644\u0641\u0631\u064a\u0642" },
  {
    key: "view_schedule",
    label:
      "\u0627\u0644\u062c\u062f\u0648\u0644 \u0627\u0644\u0623\u0633\u0628\u0648\u0639\u064a",
  },
  {
    key: "manage_time_off",
    label:
      "\u0627\u0644\u0625\u0630\u0648\u0646\u0627\u062a \u0648\u0627\u0644\u0625\u062c\u0627\u0632\u0627\u062a",
  },
  {
    key: "view_points",
    label:
      "\u0627\u0644\u0646\u0642\u0627\u0637 \u0648\u0627\u0644\u0645\u0643\u0627\u0641\u0622\u062a",
  },
  {
    key: "manage_points",
    label:
      "\u0625\u0636\u0627\u0641\u0629 \u062e\u0635\u0645 \u0623\u0648 \u0645\u0643\u0627\u0641\u0623\u0629",
  },
  {
    key: "view_reviews",
    label:
      "\u062a\u0642\u064a\u064a\u0645 \u0627\u0644\u0645\u062d\u0627\u062f\u062b\u0627\u062a",
  },
  {
    key: "add_reviews",
    label:
      "\u0625\u0636\u0627\u0641\u0629 \u062a\u0642\u064a\u064a\u0645 \u0645\u062d\u0627\u062f\u062b\u0629",
  },
  {
    key: "view_medicines",
    label:
      "\u0627\u0644\u0631\u0648\u0627\u0643\u062f \u0648\u0623\u062f\u0648\u064a\u0629 \u0627\u0644\u062d\u0648\u0627\u0641\u0632",
  },
  {
    key: "view_delivery",
    label:
      "\u0627\u0644\u062a\u0648\u0635\u064a\u0644 \u0648\u0627\u0644\u062f\u0644\u064a\u0641\u0631\u064a",
  },
  {
    key: "view_analytics",
    label:
      "\u0627\u0644\u062a\u062d\u0644\u064a\u0644\u0627\u062a \u0648\u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a",
  },
  {
    key: "view_invoices",
    label:
      "\u0627\u0633\u062a\u064a\u0631\u0627\u062f \u0627\u0644\u0641\u0648\u0627\u062a\u064a\u0631",
  },
  {
    key: "manage_permissions",
    label:
      "\u062d\u0633\u0627\u0628\u0627\u062a \u0648\u0635\u0644\u0627\u062d\u064a\u0627\u062a",
  },
  {
    key: "view_activity_log",
    label: "\u0633\u062c\u0644 \u0627\u0644\u0623\u0646\u0634\u0637\u0629",
  },
  { key: "view_shortages", label: "النواقص" },
  { key: "manage_shortages", label: "إدارة النواقص" },
  { key: "view_supplies", label: "المستلزمات" },
  { key: "manage_supplies", label: "إدارة المستلزمات" },
  { key: "view_accessories", label: "الإكسسوار" },
  { key: "manage_accessories", label: "إدارة الإكسسوار" },
  { key: "view_shelf_organization", label: "تنظيم الأدوية والرفوف" },
  { key: "manage_shelf_organization", label: "إدارة تنظيم الرفوف" },
  { key: "view_inventory_counts", label: "الجرد" },
  { key: "manage_inventory_counts", label: "إدارة الجرد" },
  { key: "view_branch_cleaning", label: "نظافة الفروع" },
  { key: "manage_branch_cleaning", label: "إدارة نظافة الفروع" },
  { key: "review_branch_cleaning", label: "مراجعة نظافة الفروع" },
  { key: "view_training", label: "التدريب والاختبارات" },
  { key: "manage_training", label: "إدارة التدريب" },
];

const PERMISSION_GROUPS = [
  { title: "??????? ????????", keys: ["view_shortages", "manage_shortages", "view_supplies", "manage_supplies", "view_accessories", "manage_accessories", "view_shelf_organization", "manage_shelf_organization", "view_inventory_counts", "manage_inventory_counts", "view_branch_cleaning", "manage_branch_cleaning", "review_branch_cleaning"] },
  { title: "???????", keys: ["view_training", "manage_training"] },
  { title: "لوحة التحكم", keys: ["view_dashboard", "view_doctor_dashboard"] },
  { title: "العملاء وخدمة العملاء", keys: ["view_customers", "edit_customers", "view_customer_service", "manage_followups"] },
  { title: "الفريق والجدول", keys: ["view_team", "view_schedule", "manage_time_off"] },
  { title: "النقاط والمكافآت", keys: ["view_points", "manage_points"] },
  { title: "تقييم المحادثات", keys: ["view_reviews", "add_reviews", "view_shift_performance"] },
  { title: "الرواكد والتوصيل", keys: ["view_medicines", "view_delivery"] },
  { title: "التحليلات والفواتير", keys: ["view_analytics", "view_invoices"] },
  { title: "حسابات وصلاحيات", keys: ["manage_permissions", "view_activity_log"] },
];

const PERMISSION_LABELS = new Map(FULL_PERMISSIONS.map((permission) => [permission.key, permission.label]));

function accountName(account: StaffAccountRow) {
  return (account.staff_name || account.name || "").trim();
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function missingColumnFromMessage(message: string) {
  return (
    message.match(/Could not find the ["']([^"']+)["'] column/i)?.[1] ||
    message.match(/column ["']?([^"'\s]+)["']? (?:of relation [^ ]+ )?does not exist/i)?.[1] ||
    null
  );
}

async function updateAccountFlexible(accountId: string, payload: Record<string, unknown>) {
  const next = { ...payload };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await supabase.from(TABLES.staffAccounts).update(next).eq("id", accountId);
    if (!result.error) return result;

    const column = missingColumnFromMessage(result.error.message || "");
    if (!column || !(column in next)) return result;
    delete next[column];
  }
  return supabase.from(TABLES.staffAccounts).update(next).eq("id", accountId);
}

async function insertAccountFlexible(payload: Record<string, unknown>) {
  const next = { ...payload };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await supabase.from(TABLES.staffAccounts).insert(next);
    if (!result.error) return result;

    const column = missingColumnFromMessage(result.error.message || "");
    if (!column || !(column in next)) return result;
    delete next[column];
  }
  return supabase.from(TABLES.staffAccounts).insert(next);
}

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
    return "ليس لديك صلاحية لتنفيذ هذه العملية. تأكد من صلاحيات الحساب الحالي.";
  }
  if (msg.includes("unique") || msg.includes("duplicate")) {
    return "يوجد حساب بهذا الاسم أو اسم المستخدم مسبقًا.";
  }
  if (msg.includes("not null") || msg.includes("null value")) {
    return "هناك حقل مطلوب فارغ. تأكد من ملء جميع الحقول الأساسية.";
  }
  if (msg.includes("foreign key") || msg.includes("violates")) {
    return "خطأ في ربط البيانات. تأكد من صحة البيانات المدخلة.";
  }
  if (msg.includes("network") || msg.includes("fetch")) {
    return "تعذر الاتصال بقاعدة البيانات. راجع الاتصال بالإنترنت.";
  }
  return `خطأ: ${msg}`;
}

export default function StaffAccounts() {
  const { user, canManage } = useAuth();
  const currentUserId = getSafeCurrentUserId();
  const canCreateAccount =
    canManage || user?.permissions?.create_staff_account === true;
  const canEditAccount =
    canManage || user?.permissions?.edit_staff_account === true;
  const canResetPassword =
    canManage || user?.permissions?.reset_staff_password === true;
  const canDisableAccount =
    canManage || user?.permissions?.disable_staff_account === true;
  const [savingId, setSavingId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
  const [editingUsername, setEditingUsername] = useState<string | null>(null);
  const [editingPassword, setEditingPassword] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [showManualAccount, setShowManualAccount] = useState(false);
  const [manualAccount, setManualAccount] = useState({
    staff_id: "",
    name: "",
    username: "",
    password: "",
    role: "صيدلاني",
    branch: "فرع شكري",
  });

  const {
    data: staffRows,
    loading: staffLoading,
    refetch: refetchStaff,
  } = useSupabaseQuery<StaffRow>({
    table: TABLES.staff,
    orderBy: { column: "name", ascending: true },
    realtimeEnabled: true,
  });

  const {
    data: accountRows,
    loading: accountLoading,
    error: accountError,
    refetch: refetchAccounts,
  } = useSupabaseQuery<StaffAccountRow>({
    table: TABLES.staffAccounts,
    select: "id,staff_id,username,temporary_password,password_status,name,staff_name,role,staff_role,branch,branch_id,active,can_login,visible_in_admin,permissions,auth_user_id,last_login_at,updated_at,created_at",
    orderBy: { column: "username", ascending: true },
    realtimeEnabled: true,
  });

  const staff = useMemo(() => selectableStaffChoices(staffRows), [staffRows]);
  const accountsByStaff = useMemo(() => {
    const map = new Map<string, StaffAccountRow>();
    for (const account of accountRows) {
      if (account.visible_in_admin === false) continue;
      if (account.staff_id) map.set(account.staff_id, account);
      const name = accountName(account);
      if (name) map.set(`name:${name}`, account);
    }
    return map;
  }, [accountRows]);

  const rows = useMemo(() => {
    return staff.map((item) => ({
      staff: item,
      account:
        accountsByStaff.get(item.id) ||
        accountsByStaff.get(`name:${item.name}`) ||
        null,
    }));
  }, [staff, accountsByStaff]);

  const filteredRows = useMemo(() => {
    const q = accountSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(({ staff: item, account }) => {
      const haystack = [
        item.name,
        item.role,
        item.branch,
        account?.username,
        account?.staff_name,
        account?.name,
        account?.temporary_password,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [accountSearch, rows]);

  const refresh = () => {
    refetchStaff();
    refetchAccounts();
  };

  const createManualAccount = async () => {
    if (!user) {
      toast.error("يجب تسجيل الدخول أولًا");
      return;
    }
    const selectedStaff = staff.find((item) => item.id === manualAccount.staff_id);
    const name = (selectedStaff?.name || manualAccount.name).trim();
    const username = (manualAccount.username || generateUsername(name)).trim();
    const password = (manualAccount.password || generateDefaultPassword(name)).trim();
    if (!name || !username || !password) {
      toast.error("أكمل الاسم واسم المستخدم وكلمة المرور");
      return;
    }

    const payload: Record<string, unknown> = {
      staff_id: selectedStaff?.id || null,
      username,
      temporary_password: password,
      password_status: "مؤقتة",
      name,
      staff_name: name,
      role: selectedStaff?.role || manualAccount.role,
      staff_role: selectedStaff?.role || manualAccount.role,
      branch: selectedStaff?.branch || manualAccount.branch,
      branch_id: selectedStaff?.branch_id || null,
      active: true,
      can_login: true,
      visible_in_admin: true,
      permissions: {},
    };
    if (currentUserId) {
      payload.created_by = currentUserId;
      payload.updated_by = currentUserId;
    }

    const { error } = await insertAccountFlexible(payload);
    if (error) {
      toast.error(friendlyError(error));
      return;
    }

    toast.success(`تم إنشاء الحساب: ${username}`);
    await logActivity(
      getSafeCurrentUserId() ?? null,
      user.name || "",
      "إضافة حساب يدوي",
      "حسابات وصلاحيات الفريق",
      name,
      String(payload.branch || ""),
      { username, temporary_password: "***" },
    );
    setShowManualAccount(false);
    setManualAccount({ staff_id: "", name: "", username: "", password: "", role: "صيدلاني", branch: "فرع شكري" });
    refetchAccounts();
  };

  // Function to generate username from Arabic name
  const generateUsername = (name: string): string => {
    if (!name) return `user_${Math.random().toString(36).substr(2, 8)}`;

    // Remove "د/" prefix and convert to lowercase
    let username = name.replace(/^د\/?\s*/i, "dr.");

    // Remove special characters and replace spaces with dots
    username = username
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, ".")
      .toLowerCase();

    // If result is empty, generate random
    if (!username) return `user_${Math.random().toString(36).substr(2, 8)}`;

    return username;
  };

  // Function to generate default password
  const generateDefaultPassword = (name?: string): string => {
    if (name) {
      const shortName = name.split(" ")[0].replace(/[^\w]/g, "").toLowerCase();
      return `Dawaa@${shortName}123`;
    }
    return `Dawaa@123`;
  };

  // Create account for staff member
  const createAccount = async (staffMember: StaffRow) => {
    if (!user) {
      toast.error("يجب تسجيل الدخول أولًا لتنفيذ العملية");
      return;
    }

    try {
      const username = generateUsername(staffMember.name);
      const temporaryPassword = generateDefaultPassword(staffMember.name);

      const accountData: Record<string, unknown> = {
        staff_id: staffMember.id,
        username,
        temporary_password: temporaryPassword,
        password_status: "مؤقتة",
        name: staffMember.name,
        staff_name: staffMember.name,
        role: staffMember.role,
        staff_role: staffMember.role,
        branch: staffMember.branch,
        branch_id: staffMember.branch_id,
        active: true,
        can_login: true,
        visible_in_admin: true,
        permissions: {},
      };

      // Only include audit columns if they exist in the database
      if (currentUserId) {
        accountData.created_by = currentUserId;
        accountData.updated_by = currentUserId;
      }

      const { error } = await insertAccountFlexible(accountData);

      if (error) throw error;

      toast.success(
        `تم إنشاء حساب لـ ${staffMember.name}\nاسم المستخدم: ${username}\nكلمة المرور: ${temporaryPassword}`,
      );
      await logActivity(
        getSafeCurrentUserId() ?? null,
        user.name || "",
        "إنشاء حساب موظف",
        "حسابات وصلاحيات الفريق",
        staffMember.name,
        staffMember.branch,
        { username, temporary_password: "***" },
      );
      refetchAccounts();
    } catch (error) {
      toast.error(friendlyError(error));
    }
  };

  // Update username
  const updateUsername = async (account: StaffAccountRow) => {
    if (!newUsername.trim()) {
      toast.error("اسم المستخدم لا يمكن أن يكون فارغًا");
      return;
    }

    try {
      const updatePayload: Record<string, unknown> = {
        username: newUsername.trim(),
        updated_at: new Date().toISOString(),
      };
      if (currentUserId) updatePayload.updated_by = currentUserId;
      const { error } = await updateAccountFlexible(account.id, updatePayload);

      if (error) throw error;

      toast.success("تم تحديث اسم المستخدم");
      await logActivity(
        getSafeCurrentUserId() ?? null,
        user?.name || "",
        "تعديل اسم المستخدم",
        "حسابات وصلاحيات الفريق",
        accountName(account),
        account.branch || "",
      );
      setEditingUsername(null);
      setNewUsername("");
      refetchAccounts();
    } catch (error) {
      toast.error(friendlyError(error));
    }
  };

  // Update temporary password
  const updateTemporaryPassword = async (account: StaffAccountRow) => {
    if (!newPassword.trim()) {
      toast.error("كلمة المرور لا يمكن أن تكون فارغة");
      return;
    }

    try {
      const updatePayload: Record<string, unknown> = {
        temporary_password: newPassword.trim(),
        password_status: "مؤقتة",
        updated_at: new Date().toISOString(),
      };
      if (currentUserId) updatePayload.updated_by = currentUserId;
      const { error } = await updateAccountFlexible(account.id, updatePayload);

      if (error) throw error;

      toast.success("تم تحديث كلمة المرور المؤقتة");
      await logActivity(
        getSafeCurrentUserId() ?? null,
        user?.name || "",
        "تعديل كلمة المرور المؤقتة",
        "حسابات وصلاحيات الفريق",
        accountName(account),
        account.branch || "",
      );
      setEditingPassword(null);
      setNewPassword("");
      refetchAccounts();
    } catch (error) {
      toast.error(friendlyError(error));
    }
  };

  // Create accounts for all staff without accounts
  const createAllAccounts = async () => {
    if (!user) {
      toast.error("يجب تسجيل الدخول أولًا لتنفيذ العملية");
      return;
    }

    const staffWithoutAccounts = rows.filter(({ account }) => !account);
    if (staffWithoutAccounts.length === 0) {
      toast.info("جميع الموظفين لديهم حسابات بالفعل");
      return;
    }

    const confirmed = window.confirm(
      `هل تريد إنشاء حسابات لـ ${staffWithoutAccounts.length} موظف بدون حساب؟`,
    );
    if (!confirmed) return;

    try {
      let successCount = 0;
      let errorCount = 0;
      const createdAccounts: Array<{
        name: string;
        username: string;
        password: string;
      }> = [];

      for (const { staff: member } of staffWithoutAccounts) {
        const username = generateUsername(member.name);
        const temporaryPassword = generateDefaultPassword(member.name);

        const accountData: Record<string, unknown> = {
          staff_id: member.id,
          username,
          temporary_password: temporaryPassword,
          password_status: "مؤقتة",
          name: member.name,
          staff_name: member.name,
          role: member.role,
          staff_role: member.role,
          branch: member.branch,
          branch_id: member.branch_id,
          active: true,
          can_login: true,
          visible_in_admin: true,
          permissions: {},
        };

        // Only include audit columns if they exist in the database
        if (currentUserId) {
          accountData.created_by = currentUserId;
          accountData.updated_by = currentUserId;
        }

        const { error } = await insertAccountFlexible(accountData);

        if (error) {
          errorCount++;
          console.error(`Error creating account for ${member.name}:`, error);
        } else {
          successCount++;
          createdAccounts.push({
            name: member.name,
            username,
            password: temporaryPassword,
          });
        }
      }

      toast.success(
        `تم إنشاء ${successCount} حساب${errorCount > 0 ? `، فشل ${errorCount}` : ""}`,
      );

      // Log the batch creation
      await logActivity(
        getSafeCurrentUserId() ?? null,
        user.name || "",
        "إنشاء حسابات جماعية",
        "حسابات وصلاحيات الفريق",
        `تم إنشاء ${successCount} حساب`,
        user?.branch || "",
        {
          successCount,
          errorCount,
          accounts: createdAccounts.map((a) => ({
            name: a.name,
            username: a.username,
            password: "***",
          })),
        },
      );

      refetchAccounts();
    } catch (error) {
      toast.error(friendlyError(error));
    }
  };

  const togglePermission = async (account: StaffAccountRow, key: string) => {
    if (!account.id) return;
    if (!user) {
      toast.error("يجب تسجيل الدخول أولًا لتنفيذ العملية");
      return;
    }

    try {
      setSavingId(account.id);
      const permissions = {
        ...(account.permissions || {}),
        [key]: !(account.permissions || {})[key],
      };
      const updatePayload: Record<string, unknown> = {
        permissions,
        updated_at: new Date().toISOString(),
      };
      if (currentUserId) updatePayload.updated_by = currentUserId;
      const { error } = await updateAccountFlexible(account.id, updatePayload);
      setSavingId(null);

      if (error) {
        console.error("[staff permissions]", error);
        toast.error(
          "تعذر حفظ الصلاحيات. تأكد من تشغيل SQL الخاص بحسابات الموظفين.",
        );
        return;
      }

      toast.success("تم حفظ الصلاحيات");
      await logActivity(
        getSafeCurrentUserId() ?? null,
        user.name || "",
        "تعديل صلاحية",
        "حسابات وصلاحيات الفريق",
        `${key} - ${accountName(account)}`,
        account.branch || "",
      );
      refetchAccounts();
    } catch (error) {
      setSavingId(null);
      toast.error(friendlyError(error));
    }
  };

  const resetPassword = async (account: StaffAccountRow) => {
    if (!account.id) return;
    if (!user) {
      toast.error("يجب تسجيل الدخول أولًا لتنفيذ العملية");
      return;
    }

    const nextPassword = window.prompt(
      "اكتب كلمة المرور الجديدة لهذا الحساب",
      account.temporary_password || "123456",
    );
    if (!nextPassword) return;

    try {
      const currentUserProfile = getCurrentUserProfile();
      setSavingId(account.id);
      const updatePayload: Record<string, unknown> = {
        temporary_password: nextPassword,
        password_hash: nextPassword,
        password_status: "مؤقتة",
        updated_at: new Date().toISOString(),
      };
      if (currentUserId) updatePayload.updated_by = currentUserId;
      const { error } = await updateAccountFlexible(account.id, updatePayload);
      setSavingId(null);

      if (error) {
        console.error("[reset staff password]", error);
        toast.error(
          "تعذر تغيير كلمة المرور. شغّل migration حسابات الموظفين أولًا.",
        );
        return;
      }

      toast.success("تم تحديث كلمة المرور");
      await logActivity(
        currentUserProfile.id,
        currentUserProfile.name,
        "تغيير كلمة المرور",
        "حسابات وصلاحيات الفريق",
        accountName(account),
        account.branch || "",
      );
      refetchAccounts();
    } catch (error) {
      setSavingId(null);
      toast.error(friendlyError(error));
    }
  };

  const toggleAccountAccess = async (account: StaffAccountRow) => {
    if (!account.id || !user) return;
    const nextActive = !(account.active !== false && account.can_login !== false);
    const confirmed = window.confirm(
      nextActive
        ? `هل تريد تفعيل حساب ${accountName(account) || account.username}؟`
        : `هل تريد تعطيل حساب ${accountName(account) || account.username}؟`,
    );
    if (!confirmed) return;

    try {
      setSavingId(account.id);
      const updatePayload: Record<string, unknown> = {
        active: nextActive,
        can_login: nextActive,
        updated_at: new Date().toISOString(),
      };
      if (currentUserId) updatePayload.updated_by = currentUserId;
      const { error } = await updateAccountFlexible(account.id, updatePayload);
      setSavingId(null);

      if (error) throw error;

      toast.success(nextActive ? "تم تفعيل الحساب" : "تم تعطيل الحساب");
      await logActivity(
        getSafeCurrentUserId() ?? null,
        user.name || "",
        nextActive ? "تفعيل حساب موظف" : "تعطيل حساب موظف",
        "حسابات وصلاحيات الفريق",
        accountName(account) || account.username || "",
        account.branch || "",
        {
          account_id: account.id,
          username: account.username,
          can_login: nextActive,
        },
      );
      refetchAccounts();
    } catch (error) {
      setSavingId(null);
      toast.error(friendlyError(error));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1">
          <h1 className="text-white text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="text-teal-400" size={24} />
            حسابات وصلاحيات الفريق
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            هنا تراجع اسم المستخدم وكلمة المرور المؤقتة وتحدد صلاحيات كل دكتور
            أو دليفري داخل التطبيق.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowManualAccount(true)}
            className="btn-secondary flex items-center gap-2"
            disabled={!canCreateAccount}
          >
            <UserPlus size={16} /> إضافة حساب
          </button>
          <button
            type="button"
            onClick={createAllAccounts}
            className="btn-primary flex items-center gap-2"
            disabled={!canCreateAccount}
          >
            <UserPlus size={16} /> إنشاء حسابات للجميع
          </button>
          <button
            type="button"
            onClick={refresh}
            className="btn-secondary flex items-center gap-2"
          >
            <RefreshCw size={16} /> تحديث
          </button>
        </div>
      </div>

      {accountError && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-amber-100 text-sm leading-relaxed">
          جدول حسابات الموظفين يحتاج SQL الخاص بالصلاحيات أو سياسات القراءة. بعد
          تشغيله في Supabase اضغط تحديث.
        </div>
      )}


      <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-2xl p-3 flex items-center gap-3">
        <Search size={18} className="text-slate-400" />
        <input
          className="input-dark flex-1"
          value={accountSearch}
          onChange={(e) => setAccountSearch(e.target.value)}
          placeholder="ابحث باسم الموظف أو اسم المستخدم أو الدور أو الفرع..."
        />
        {accountSearch && (
          <button type="button" className="btn-secondary px-3" onClick={() => setAccountSearch("")}>
            مسح
          </button>
        )}
      </div>

      <div className="stat-card overflow-x-auto">
        {staffLoading || accountLoading ? (
          <div className="text-slate-400 p-8 text-center">
            جاري تحميل الحسابات...
          </div>
        ) : !canCreateAccount && !canEditAccount ? (
          <div className="text-slate-400 p-8 text-center">
            ليس لديك صلاحية للوصول إلى هذه الصفحة
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="text-slate-400 p-8 text-center">
            لا توجد أسماء موظفين نشطة في جدول الفريق.
          </div>
        ) : (
          <div className="space-y-4">
            {filteredRows.map(({ staff: item, account }) => (
              <div
                key={item.id}
                className="rounded-2xl border border-[#2d4063] bg-[#16253f]/70 p-4 shadow-sm"
              >
                <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_1.2fr_1fr_auto] gap-4 items-start">
                  <div className="space-y-2">
                    <div className="text-xs text-slate-400">الموظف</div>
                    <Link
                      to={`/staff/${item.id}`}
                      className="inline-flex items-center gap-1 text-white text-lg font-bold hover:text-teal-300 transition-colors"
                    >
                      {item.name}
                      <ExternalLink size={14} />
                    </Link>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-white/5 border border-[#2d4063] px-2 py-1 text-slate-300">
                        {item.role || "بدون دور"}
                      </span>
                      <span className="rounded-full bg-white/5 border border-[#2d4063] px-2 py-1 text-slate-300">
                        {item.branch || "بدون فرع"}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-[#2d4063] bg-[#101d33] p-3">
                      <div className="text-xs text-slate-400 mb-1">اسم المستخدم</div>
                      {account ? (
                        editingUsername === account.id ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={newUsername}
                              onChange={(e) => setNewUsername(e.target.value)}
                              className="input-dark text-sm py-1 px-2 flex-1"
                              placeholder="اسم المستخدم"
                            />
                            <button
                              onClick={() => updateUsername(account)}
                              className="btn-primary px-2 py-1 text-xs"
                            >
                              حفظ
                            </button>
                            <button
                              onClick={() => {
                                setEditingUsername(null);
                                setNewUsername("");
                              }}
                              className="btn-secondary px-2 py-1 text-xs"
                            >
                              إلغاء
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-teal-300 font-mono text-sm">
                              {account.username || "غير محدد"}
                            </span>
                            <button
                              onClick={() => {
                                setEditingUsername(account.id);
                                setNewUsername(account.username || "");
                              }}
                              className="text-slate-400 hover:text-white transition-colors"
                              title="تعديل اسم المستخدم"
                            >
                              <Edit2 size={14} />
                            </button>
                          </div>
                        )
                      ) : (
                        <span className="text-slate-500 text-sm">لا يوجد حساب</span>
                      )}
                    </div>

                    <div className="rounded-xl border border-[#2d4063] bg-[#101d33] p-3">
                      <div className="text-xs text-slate-400 mb-1">كلمة المرور</div>
                      {account ? (
                        editingPassword === account.id ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              className="input-dark text-sm py-1 px-2 flex-1"
                              placeholder="كلمة المرور الجديدة"
                            />
                            <button
                              onClick={() => updateTemporaryPassword(account)}
                              className="btn-primary px-2 py-1 text-xs"
                            >
                              حفظ
                            </button>
                            <button
                              onClick={() => {
                                setEditingPassword(null);
                                setNewPassword("");
                              }}
                              className="btn-secondary px-2 py-1 text-xs"
                            >
                              إلغاء
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-amber-200 font-mono text-sm">
                              {showPassword[account.id]
                                ? account.temporary_password
                                : "••••••••"}
                            </span>
                            <button
                              onClick={() =>
                                setShowPassword({
                                  ...showPassword,
                                  [account.id]: !showPassword[account.id],
                                })
                              }
                              className="text-slate-400 hover:text-white transition-colors"
                              title={showPassword[account.id] ? "إخفاء" : "إظهار"}
                            >
                              {showPassword[account.id] ? (
                                <EyeOff size={14} />
                              ) : (
                                <Eye size={14} />
                              )}
                            </button>
                            <button
                              onClick={() => {
                                setEditingPassword(account.id);
                                setNewPassword(account.temporary_password || "");
                              }}
                              className="text-slate-400 hover:text-white transition-colors"
                              title="تعديل كلمة المرور"
                            >
                              <Edit2 size={14} />
                            </button>
                          </div>
                        )
                      ) : (
                        <span className="text-slate-500 text-sm">غير محفوظة</span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#2d4063] bg-[#101d33] p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-400">الحالة</span>
                      {account ? (
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            account.can_login
                              ? "bg-green-500/15 text-green-400 border border-green-500/25"
                              : "bg-red-500/15 text-red-400 border border-red-500/25"
                          }`}
                        >
                          {account.can_login ? "نشط" : "غير نشط"}
                        </span>
                      ) : (
                        <span className="text-slate-500 text-sm">-</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-400">آخر تعديل</span>
                      <span className="text-xs text-slate-300">
                        {account
                          ? formatDateTime(account.updated_at || account.created_at)
                          : "-"}
                      </span>
                    </div>
                    {account?.password_status && (
                      <div className="text-xs text-slate-400">
                        {account.password_status}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 xl:justify-end">
                    {account ? (
                      <>
                        <button
                          type="button"
                          disabled={savingId === account.id}
                          onClick={() => resetPassword(account)}
                          className="btn-secondary flex items-center gap-2 whitespace-nowrap text-xs"
                        >
                          {savingId === account.id ? (
                            <Save size={14} />
                          ) : (
                            <KeyRound size={14} />
                          )}
                          تغيير
                        </button>
                        <button
                          type="button"
                          disabled={savingId === account.id || !canDisableAccount}
                          onClick={() => toggleAccountAccess(account)}
                          className={`flex items-center gap-2 whitespace-nowrap text-xs ${
                            account.active !== false && account.can_login !== false
                              ? "btn-secondary"
                              : "btn-primary"
                          }`}
                        >
                          <Power size={14} />
                          {account.active !== false && account.can_login !== false
                            ? "تعطيل"
                            : "تفعيل"}
                        </button>
                        {account.staff_id && (
                          <Link
                            to={`/staff/${account.staff_id}`}
                            className="btn-secondary flex items-center gap-2 whitespace-nowrap text-xs"
                          >
                            <ExternalLink size={14} />
                            فتح
                          </Link>
                        )}
                      </>
                    ) : (
                      <button
                        onClick={() => createAccount(item)}
                        className="btn-primary flex items-center gap-2 whitespace-nowrap text-xs"
                      >
                        <UserPlus size={14} />
                        إنشاء حساب
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-4 border-t border-[#2d4063]/70 pt-4">
                  <div className="text-white font-bold mb-3">
                    الصلاحيات
                    <span className="text-slate-400 text-xs font-normal mr-2">
                      اضغط على العلامة لتفعيل أو إيقاف الصلاحية
                    </span>
                  </div>
                  {account ? (
                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                      {PERMISSION_GROUPS.map((group) => (
                        <div key={group.title} className="rounded-xl border border-[#2d4063] bg-white/5 p-3">
                          <div className="text-teal-300 font-bold text-xs mb-2">{group.title}</div>
                          <div className="grid grid-cols-1 gap-2">
                            {group.keys.map((key) => {
                              const enabled = Boolean(account.permissions?.[key]);
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  disabled={savingId === account.id}
                                  onClick={() => togglePermission(account, key)}
                                  className="flex items-center justify-between gap-2 rounded-lg border border-[#2d4063] bg-[#16253f] px-2.5 py-2 text-xs text-slate-200 hover:border-teal-500/40 transition-colors"
                                >
                                  <span>{PERMISSION_LABELS.get(key) || key}</span>
                                  <span className={`h-5 w-10 rounded-full p-0.5 transition-colors ${enabled ? "bg-green-500" : "bg-slate-600"}`}>
                                    <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`} />
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-slate-500 text-sm">
                      أنشئ حسابًا للموظف أولًا حتى تظهر صلاحياته.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showManualAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setShowManualAccount(false)}>
          <div className="w-full max-w-2xl rounded-2xl border border-[#2d4063] bg-[#10213a] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-black text-white">إضافة حساب داخل التطبيق</h2>
              <button type="button" className="btn-secondary px-3 py-2" onClick={() => setShowManualAccount(false)}>إغلاق</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs text-slate-300 space-y-1 md:col-span-2">
                <span>ربط بموظف موجود</span>
                <select className="input-dark" value={manualAccount.staff_id} onChange={(event) => {
                  const selected = staff.find((item) => item.id === event.target.value);
                  setManualAccount((current) => ({
                    ...current,
                    staff_id: event.target.value,
                    name: selected?.name || current.name,
                    role: selected?.role || current.role,
                    branch: selected?.branch || current.branch,
                    username: selected ? generateUsername(selected.name) : current.username,
                    password: selected ? generateDefaultPassword(selected.name) : current.password,
                  }));
                }}>
                  <option value="">بدون ربط مباشر</option>
                  {staff.map((item) => <option key={item.id} value={item.id}>{item.name} - {item.role} - {item.branch}</option>)}
                </select>
              </label>
              <EditField label="اسم صاحب الحساب" value={manualAccount.name} onChange={(value) => setManualAccount((current) => ({ ...current, name: value }))} />
              <EditField label="اسم المستخدم" value={manualAccount.username} onChange={(value) => setManualAccount((current) => ({ ...current, username: value }))} />
              <EditField label="كلمة المرور المؤقتة" value={manualAccount.password} onChange={(value) => setManualAccount((current) => ({ ...current, password: value }))} />
              <EditField label="المسؤولية/الدور" value={manualAccount.role} onChange={(value) => setManualAccount((current) => ({ ...current, role: value }))} />
              <label className="text-xs text-slate-300 space-y-1">
                <span>الفرع</span>
                <select className="input-dark" value={manualAccount.branch} onChange={(event) => setManualAccount((current) => ({ ...current, branch: event.target.value }))}>
                  {["فرع شكري", "فرع الشامي", "كل الفروع"].map((branch) => <option key={branch}>{branch}</option>)}
                </select>
              </label>
            </div>
            <button type="button" className="btn-primary mt-4 w-full" onClick={createManualAccount}>
              إنشاء الحساب
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EditField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-xs text-slate-300 space-y-1">
      <span>{label}</span>
      <input className="input-dark" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
