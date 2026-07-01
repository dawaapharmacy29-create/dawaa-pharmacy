import { useMemo, useState, type ReactNode } from 'react';
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
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Link2,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { logActivity } from '@/lib/activityLog';
import { Link } from 'react-router-dom';
import { BRANCHES } from '@/lib/constants';
import { useAuth, getCurrentUserProfile, getSafeCurrentUserId } from '@/hooks/useAuth';
import {
  PERMISSION_CATEGORIES,
  ROLES,
  getDefaultPermissionsForRole,
  mergePermissions,
  normalizeRole,
  isAdminRole,
  getRoleLabel,
  ALL_PERMISSION_KEYS,
  type RoleKey,
} from '@/lib/core/permissionSystem';
import { getPresetForRole } from '@/lib/rolePermissionPresets';
import { staffProfilePath } from '@/lib/staff/staffIdentityResolver';

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
  branch?: string | null;
  active?: boolean | null;
  can_login?: boolean | null;
  visible_in_admin?: boolean | null;
  permissions?: Record<string, boolean> | null;
  last_login_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────
function missingColumn(msg: string) {
  return (
    msg.match(/Could not find the ["']([^"']+)["'] column/i)?.[1] ||
    msg.match(/column ["']?([^"'\s]+)["']? (?:of relation [^ ]+ )?does not exist/i)?.[1] ||
    null
  );
}

function AuditTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: 'emerald' | 'amber' | 'red' | 'violet';
}) {
  const tones = {
    emerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
    amber: 'border-amber-500/25 bg-amber-500/10 text-amber-200',
    red: 'border-red-500/25 bg-red-500/10 text-red-200',
    violet: 'border-violet-500/25 bg-violet-500/10 text-violet-200',
  };
  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span>{icon}</span>
        <span className="text-2xl font-black">{value}</span>
      </div>
      <p className="text-xs font-bold">{label}</p>
    </div>
  );
}

function AuditPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-[#101d33] p-3">
      <h3 className="mb-2 text-sm font-bold text-slate-200">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function AuditRow({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/40 bg-slate-950/30 p-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-white">{title || '-'}</p>
        {subtitle && <p className="truncate text-xs text-slate-400">{subtitle}</p>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

async function updateAccountFlexible(id: string, payload: Record<string, unknown>) {
  const next = { ...payload };
  for (let i = 0; i < 8; i++) {
    const res = await supabase.from(TABLES.staffAccounts).update(next).eq('id', id);
    if (!res.error) return res;
    const col = missingColumn(res.error.message);
    if (!col || !(col in next)) return res;
    delete next[col];
  }
  return supabase.from(TABLES.staffAccounts).update(next).eq('id', id);
}

async function insertAccountFlexible(payload: Record<string, unknown>) {
  const next = { ...payload };
  for (let i = 0; i < 8; i++) {
    const res = await supabase.from(TABLES.staffAccounts).insert(next);
    if (!res.error) return res;
    const col = missingColumn(res.error.message);
    if (!col || !(col in next)) return res;
    delete next[col];
  }
  return supabase.from(TABLES.staffAccounts).insert(next);
}

function friendlyError(err: unknown): string {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null
        ? (err as Record<string, unknown>).message?.toString() || JSON.stringify(err)
        : String(err);
  if (msg.includes('row-level security') || msg.includes('permission denied'))
    return 'ليس لديك صلاحية لتنفيذ هذا. تأكد من صلاحيات الحساب.';
  if (msg.includes('unique') || msg.includes('duplicate'))
    return 'يوجد حساب بهذا الاسم أو اسم المستخدم مسبقًا.';
  if (msg.includes('not null') || msg.includes('null value')) return 'هناك حقل مطلوب فارغ.';
  return `خطأ: ${msg}`;
}

function accountDisplayName(a: StaffAccountRow) {
  return (a.staff_name || a.name || a.username || '').trim();
}

function generateUsername(name: string) {
  return (
    name
      .trim()
      .replace(/^(د\/|دكتور|دكتورة)\s*/i, '')
      .replace(/[أإآ]/g, 'a')
      .replace(/ع/g, 'a')
      .replace(/[بپ]/g, 'b')
      .replace(/ت/g, 't')
      .replace(/[جچ]/g, 'j')
      .replace(/[حه]/g, 'h')
      .replace(/[دذ]/g, 'd')
      .replace(/[رز]/g, 'r')
      .replace(/[سص]/g, 's')
      .replace(/[شض]/g, 'sh')
      .replace(/[طظ]/g, 't')
      .replace(/[فق]/g, 'f')
      .replace(/ك/g, 'k')
      .replace(/ل/g, 'l')
      .replace(/م/g, 'm')
      .replace(/ن/g, 'n')
      .replace(/و/g, 'w')
      .replace(/ي/g, 'y')
      .replace(/[\s-]+/g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '')
      .toLowerCase()
      .slice(0, 30) || 'user'
  );
}

function generateDefaultPassword() {
  return 'Dawaa' + Math.floor(1000 + Math.random() * 9000);
}

function formatDateTime(v?: string | null) {
  if (!v) return '-';
  try {
    return new Date(v).toLocaleString('ar-EG');
  } catch {
    return v;
  }
}

function normalizeTextKey(value?: string | null) {
  return String(value || '')
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizedRoleKnown(role?: string | null) {
  const value = String(role || '').trim();
  if (!value) return false;
  return ROLES.some((item) => item.key === value) || normalizeRole(value) !== 'assistant' || value === 'assistant';
}

function permissionDiff(
  current: Record<string, boolean>,
  suggested: Record<string, boolean>
) {
  const missing = ALL_PERMISSION_KEYS.filter((key) => suggested[key] === true && current[key] !== true);
  const extra = ALL_PERMISSION_KEYS.filter((key) => suggested[key] !== true && current[key] === true);
  return { missing, extra };
}

// ─── Component ────────────────────────────────────────────────
export default function StaffAccounts() {
  const { user, canManage, checkPermission } = useAuth();
  const currentUserId = getSafeCurrentUserId();
  const currentRole = normalizeRole(user?.role);

  const canViewAccounts = checkPermission('view_staff_accounts') || canManage;
  const canCreateAccount = checkPermission('manage_staff_accounts') || canManage;
  const canEditAccount = checkPermission('manage_staff_accounts') || canManage;
  const canRevealPasswords = isAdminRole(currentRole) || checkPermission('manage_staff_accounts');
  const canEditPerms = checkPermission('manage_permissions') || canManage;

  const [accountSearch, setAccountSearch] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
  const [editingUsername, setEditingUsername] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState('');
  const [editingPassword, setEditingPassword] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [localPerms, setLocalPerms] = useState<Record<string, Record<string, boolean>>>({});
  const [expandedPerms, setExpandedPerms] = useState<Record<string, boolean>>({});
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [showManualAccount, setShowManualAccount] = useState(false);
  const [manualAccount, setManualAccount] = useState({
    name: '',
    role: 'assistant' as RoleKey,
    branch: '',
    username: '',
    password: '',
  });

  // ─── Data ─────────────────────────────────────────────────
  const { data: staffList, loading: staffLoading } = useSupabaseQuery<StaffRow>({
    table: TABLES.staff,
    filters: [{ column: 'is_deleted', operator: 'neq', value: true }],
    orderBy: { column: 'name', ascending: true },
  });

  const {
    data: staffAccounts,
    loading: accountLoading,
    error: accountError,
    refetch: refetchAccounts,
  } = useSupabaseQuery<StaffAccountRow>({
    table: TABLES.staffAccounts,
    orderBy: { column: 'name', ascending: true },
  });

  const refresh = () => refetchAccounts();

  // Match staff rows with their accounts
  const rows = useMemo(() => {
    return staffList
      .filter((s) => s.active !== false && !s.deleted_at && !s.is_deleted)
      .map((s) => ({
        staff: s,
        account: staffAccounts.find((a) => a.staff_id === s.id || a.name === s.name),
      }));
  }, [staffList, staffAccounts]);

  // Standalone accounts (no matching staff)
  const standaloneAccounts = useMemo(
    () => staffAccounts.filter((a) => !rows.some((r) => r.account?.id === a.id)),
    [staffAccounts, rows]
  );

  const filteredRows = useMemo(() => {
    if (!accountSearch.trim()) return rows;
    const q = accountSearch.toLowerCase();
    return rows.filter(({ staff, account }) =>
      [staff.name, staff.role, staff.branch, account?.username, account?.role].some((v) =>
        v?.toLowerCase().includes(q)
      )
    );
  }, [rows, accountSearch]);

  // ─── Permission helpers ───────────────────────────────────
  function getEffectivePerms(account: StaffAccountRow): Record<string, boolean> {
    const roleDefaults = getDefaultPermissionsForRole(account.role || 'assistant');
    return mergePermissions(roleDefaults, account.permissions || {}, localPerms[account.id] || {});
  }

  const accountAudit = useMemo(() => {
    const usernameGroups = new Map<string, StaffAccountRow[]>();
    staffAccounts.forEach((account) => {
      const key = normalizeTextKey(account.username);
      if (!key) return;
      usernameGroups.set(key, [...(usernameGroups.get(key) || []), account]);
    });

    const staffByName = new Map(staffList.map((staff) => [normalizeTextKey(staff.name), staff]));
    const staffWithoutAccount = rows.filter(({ account }) => !account).map(({ staff }) => staff);
    const duplicateUsernames = [...usernameGroups.values()].filter((group) => group.length > 1);
    const unlinkedAccounts = staffAccounts
      .filter((account) => !account.staff_id)
      .map((account) => ({
        account,
        match: staffByName.get(normalizeTextKey(accountDisplayName(account))) || null,
      }));
    const riskyAccounts = staffAccounts.filter((account) => {
      const effective = getEffectivePerms(account);
      return (
        (effective.manage_permissions || effective.manage_staff_accounts || effective.delete_user) &&
        !isAdminRole(account.role)
      );
    });
    const missingPermissionAccounts = staffAccounts
      .map((account) => {
        const suggested = getDefaultPermissionsForRole(account.role || 'assistant');
        const diff = permissionDiff(getEffectivePerms(account), suggested);
        return { account, ...diff };
      })
      .filter((item) => item.missing.length > 0 || item.extra.length > 0);
    const unknownRoleAccounts = staffAccounts.filter((account) => !normalizedRoleKnown(account.role));
    const invalidBranchAccounts = staffAccounts.filter((account) => {
      const branch = String(account.branch || '').trim();
      return branch && !BRANCHES.includes(branch as (typeof BRANCHES)[number]) && branch !== 'كل الفروع';
    });
    const goodCount =
      staffAccounts.length -
      new Set([
        ...staffWithoutAccount.map((staff) => `staff:${staff.id}`),
        ...duplicateUsernames.flatMap((group) => group.map((account) => `account:${account.id}`)),
        ...unlinkedAccounts.map(({ account }) => `account:${account.id}`),
        ...riskyAccounts.map((account) => `account:${account.id}`),
        ...missingPermissionAccounts.map(({ account }) => `account:${account.id}`),
        ...unknownRoleAccounts.map((account) => `account:${account.id}`),
        ...invalidBranchAccounts.map((account) => `account:${account.id}`),
      ]).size;

    return {
      goodCount: Math.max(0, goodCount),
      staffWithoutAccount,
      duplicateUsernames,
      unlinkedAccounts,
      riskyAccounts,
      missingPermissionAccounts,
      unknownRoleAccounts,
      invalidBranchAccounts,
    };
  }, [staffAccounts, staffList, rows, localPerms]);

  function toggleCategory(accountId: string, catKey: string) {
    setExpandedCategories((p) => ({
      ...p,
      [`${accountId}-${catKey}`]: !p[`${accountId}-${catKey}`],
    }));
  }

  const applyRolePreset = (account: StaffAccountRow, roleKey: RoleKey) => {
    const perms = getDefaultPermissionsForRole(roleKey);
    setLocalPerms((prev) => ({ ...prev, [account.id]: perms }));
    toast.info(`تم تطبيق قالب: ${getRoleLabel(roleKey)}`);
  };

  const persistPermissions = async (
    account: StaffAccountRow,
    permissions: Record<string, boolean>
  ) => {
    if (!account.id) return;
    setSavingId(account.id);
    try {
      const { error } = await updateAccountFlexible(account.id, {
        permissions,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      setLocalPerms((prev) => {
        const n = { ...prev };
        delete n[account.id];
        return n;
      });
      toast.success('تم حفظ الصلاحيات ✓');
      await logActivity({
        action: 'تعديل الصلاحيات',
        module: 'حسابات وصلاحيات الفريق',
        details: `تعديل صلاحيات ${accountDisplayName(account)}`,
      });
      refetchAccounts();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSavingId(null);
    }
  };

  const togglePermission = async (account: StaffAccountRow, key: string) => {
    if (!account.id || !canEditPerms) return;
    const effective = getEffectivePerms(account);
    const newPerms = { ...effective, [key]: !effective[key] };
    setLocalPerms((prev) => ({ ...prev, [account.id]: newPerms }));
  };

  const savePermissions = (account: StaffAccountRow) => {
    const effective = getEffectivePerms(account);
    persistPermissions(account, effective);
  };

  const linkAccountToStaff = async (account: StaffAccountRow, staff: StaffRow) => {
    if (!canEditAccount) return;
    setSavingId(account.id);
    try {
      const { error } = await updateAccountFlexible(account.id, {
        staff_id: staff.id,
        name: staff.name,
        staff_name: staff.name,
        role: account.role || staff.role,
        branch: account.branch || staff.branch,
        updated_at: new Date().toISOString(),
        ...(currentUserId ? { updated_by: currentUserId } : {}),
      });
      if (error) throw error;
      toast.success('تم ربط الحساب بالموظف');
      refetchAccounts();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setSavingId(null);
    }
  };

  const applySuggestedPermissions = async (account: StaffAccountRow) => {
    if (!canEditPerms) return;
    const suggested = getDefaultPermissionsForRole(account.role || 'assistant');
    await persistPermissions(account, suggested);
  };

  // ─── Account actions ─────────────────────────────────────
  const createStaffAccount = async (staff: StaffRow) => {
    if (!canCreateAccount) return toast.error('لا توجد صلاحية لإنشاء الحساب');
    const username = generateUsername(staff.name);
    const password = generateDefaultPassword();
    const preset = getPresetForRole(staff.role);
    const perms = preset ? preset.permissions : getDefaultPermissionsForRole(staff.role);
    const { error } = await insertAccountFlexible({
      staff_id: staff.id,
      name: staff.name,
      staff_name: staff.name,
      username,
      password_hash: password,
      role: staff.role,
      branch: staff.branch,
      active: true,
      can_login: true,
      visible_in_admin: true,
      permissions: perms,
      password_status: 'مؤقتة',
      ...(currentUserId ? { created_by: currentUserId } : {}),
    });
    if (error) return toast.error(friendlyError(error));
    toast.success(`تم إنشاء حساب: ${username} / ${password}`);
    refetchAccounts();
  };

  const createManualAccount = async () => {
    const { name, role, branch, username: u, password: p } = manualAccount;
    const username = (u || generateUsername(name)).trim();
    const password = (p || generateDefaultPassword()).trim();
    if (!name || !username || !password)
      return toast.error('أكمل الاسم واسم المستخدم وكلمة المرور');
    const preset = getPresetForRole(role);
    const perms = preset ? preset.permissions : getDefaultPermissionsForRole(role);
    const { error } = await insertAccountFlexible({
      name,
      staff_name: name,
      username,
      password_hash: password,
      role,
      branch,
      active: true,
      can_login: true,
      visible_in_admin: true,
      permissions: perms,
      password_status: 'مؤقتة',
      ...(currentUserId ? { created_by: currentUserId } : {}),
    });
    if (error) return toast.error(friendlyError(error));
    toast.success('تم إنشاء الحساب ✓');
    setShowManualAccount(false);
    setManualAccount({ name: '', role: 'assistant', branch: '', username: '', password: '' });
    refetchAccounts();
  };

  const createAllAccounts = async () => {
    const missing = rows.filter(({ account }) => !account);
    if (!missing.length) return toast.info('جميع الموظفين لديهم حسابات');
    if (!confirm(`إنشاء حسابات لـ ${missing.length} موظف؟`)) return;
    let ok = 0,
      fail = 0;
    for (const { staff: s } of missing) {
      const { error } = await insertAccountFlexible({
        staff_id: s.id,
        name: s.name,
        staff_name: s.name,
        username: generateUsername(s.name),
        password_hash: generateDefaultPassword(),
        role: s.role,
        branch: s.branch,
        active: true,
        can_login: true,
        visible_in_admin: true,
        permissions: getDefaultPermissionsForRole(s.role),
        password_status: 'مؤقتة',
      });
      error ? fail++ : ok++;
    }
    toast.success(`تم إنشاء ${ok} حساب${fail ? ` — فشل ${fail}` : ''}`);
    refetchAccounts();
  };

  const toggleAccountStatus = async (account: StaffAccountRow) => {
    if (!canEditAccount) return;
    const { error } = await updateAccountFlexible(account.id, {
      active: !account.active,
      can_login: !account.active,
      updated_at: new Date().toISOString(),
    });
    if (error) return toast.error(friendlyError(error));
    toast.success(account.active ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب');
    refetchAccounts();
  };

  const updateUsername = async (account: StaffAccountRow) => {
    if (!newUsername.trim()) return toast.error('اسم المستخدم لا يمكن أن يكون فارغًا');
    const { error } = await updateAccountFlexible(account.id, {
      username: newUsername.trim(),
      updated_at: new Date().toISOString(),
      ...(currentUserId ? { updated_by: currentUserId } : {}),
    });
    if (error) return toast.error(friendlyError(error));
    toast.success('تم تحديث اسم المستخدم');
    setEditingUsername(null);
    setNewUsername('');
    refetchAccounts();
  };

  const updatePassword = async (account: StaffAccountRow) => {
    if (!newPassword.trim()) return toast.error('كلمة المرور لا يمكن أن تكون فارغة');
    const { error } = await updateAccountFlexible(account.id, {
      password_hash: newPassword.trim(),
      password_status: 'مؤقتة',
      updated_at: new Date().toISOString(),
      ...(currentUserId ? { updated_by: currentUserId } : {}),
    });
    if (error) return toast.error(friendlyError(error));
    toast.success('تم تحديث كلمة المرور');
    setEditingPassword(null);
    setNewPassword('');
    refetchAccounts();
  };

  if (!canViewAccounts) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" dir="rtl">
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-8 text-center text-red-200">
          <ShieldCheck className="mx-auto mb-3 h-10 w-10 opacity-50" />
          <p className="text-lg font-bold">غير مصرح بالوصول</p>
          <p className="mt-1 text-sm opacity-70">ليس لديك صلاحية عرض حسابات الفريق.</p>
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────
  return (
    <div dir="rtl" className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <ShieldCheck className="text-teal-400" size={24} />
            حسابات وصلاحيات الفريق
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            راجع اسم المستخدم وكلمة المرور وحدد صلاحيات كل موظف داخل التطبيق
          </p>
        </div>
        <div className="flex gap-2">
          {canCreateAccount && (
            <>
              <button
                onClick={() => setShowManualAccount(true)}
                className="btn-secondary flex items-center gap-2"
              >
                <UserPlus size={16} /> إضافة حساب
              </button>
              <button onClick={createAllAccounts} className="btn-primary flex items-center gap-2">
                <UserPlus size={16} /> إنشاء للجميع
              </button>
            </>
          )}
          <button onClick={refresh} className="btn-secondary flex items-center gap-2">
            <RefreshCw size={16} /> تحديث
          </button>
        </div>
      </div>

      {accountError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          تعذر تحميل جدول الحسابات. تأكد من تشغيل ملف SQL في Supabase ثم اضغط تحديث.
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-3 rounded-xl border border-[#2d4063] bg-[#1B2B4B] p-3">
        <Search size={18} className="text-slate-400" />
        <input
          className="input-dark flex-1"
          value={accountSearch}
          onChange={(e) => setAccountSearch(e.target.value)}
          placeholder="ابحث بالاسم أو اسم المستخدم أو الدور أو الفرع..."
        />
        {accountSearch && (
          <button className="btn-secondary px-3" onClick={() => setAccountSearch('')}>
            مسح
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-[#2d4063] bg-[#16253f]/80 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-white">
              <ShieldAlert size={20} className="text-amber-300" />
              مراجعة الحسابات والصلاحيات
            </h2>
            <p className="text-sm text-slate-400">
              فحص سريع للحسابات الناقصة، المكررة، غير المربوطة، والصلاحيات المختلفة عن قالب الدور.
            </p>
          </div>
          <Link to="/roles-permissions" className="btn-secondary flex items-center gap-2">
            <KeyRound size={16} /> مصفوفة الصلاحيات
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AuditTile icon={<CheckCircle2 size={18} />} label="حسابات سليمة" value={accountAudit.goodCount} tone="emerald" />
          <AuditTile icon={<UserPlus size={18} />} label="موظفون بلا حساب" value={accountAudit.staffWithoutAccount.length} tone="amber" />
          <AuditTile icon={<AlertTriangle size={18} />} label="أسماء مستخدم مكررة" value={accountAudit.duplicateUsernames.length} tone="red" />
          <AuditTile icon={<ShieldAlert size={18} />} label="صلاحيات تحتاج مراجعة" value={accountAudit.missingPermissionAccounts.length + accountAudit.riskyAccounts.length} tone="violet" />
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {accountAudit.staffWithoutAccount.length > 0 && (
            <AuditPanel title="موظفون بدون حساب دخول">
              {accountAudit.staffWithoutAccount.slice(0, 6).map((staff) => (
                <AuditRow key={staff.id} title={staff.name} subtitle={`${getRoleLabel(staff.role)} — ${staff.branch || 'بدون فرع'}`}>
                  <button
                    onClick={() => createStaffAccount(staff)}
                    disabled={!canCreateAccount}
                    className="btn-primary px-3 py-1 text-xs"
                  >
                    إنشاء حساب
                  </button>
                </AuditRow>
              ))}
            </AuditPanel>
          )}

          {accountAudit.unlinkedAccounts.some((item) => item.match) && (
            <AuditPanel title="حسابات غير مربوطة بموظف">
              {accountAudit.unlinkedAccounts
                .filter((item) => item.match)
                .slice(0, 6)
                .map(({ account, match }) => (
                  <AuditRow
                    key={account.id}
                    title={accountDisplayName(account)}
                    subtitle={`مطابقة محتملة: ${match?.name || '-'} — ${account.username || '-'}`}
                  >
                    {match && (
                      <button
                        onClick={() => linkAccountToStaff(account, match)}
                        disabled={!canEditAccount || savingId === account.id}
                        className="btn-secondary flex items-center gap-1 px-3 py-1 text-xs"
                      >
                        <Link2 size={12} /> ربط
                      </button>
                    )}
                  </AuditRow>
                ))}
            </AuditPanel>
          )}

          {accountAudit.duplicateUsernames.length > 0 && (
            <AuditPanel title="أسماء مستخدم مكررة">
              {accountAudit.duplicateUsernames.slice(0, 5).map((group) => (
                <AuditRow
                  key={group.map((account) => account.id).join('-')}
                  title={group[0].username || 'بدون اسم مستخدم'}
                  subtitle={group.map((account) => accountDisplayName(account)).join('، ')}
                />
              ))}
            </AuditPanel>
          )}

          {accountAudit.missingPermissionAccounts.length > 0 && (
            <AuditPanel title="مقارنة الصلاحيات بقالب الدور">
              {accountAudit.missingPermissionAccounts.slice(0, 6).map(({ account, missing, extra }) => (
                <AuditRow
                  key={account.id}
                  title={accountDisplayName(account)}
                  subtitle={`ناقص ${missing.length} / زائد ${extra.length} — ${getRoleLabel(account.role)}`}
                >
                  <button
                    onClick={() => applySuggestedPermissions(account)}
                    disabled={!canEditPerms || savingId === account.id}
                    className="btn-secondary px-3 py-1 text-xs"
                  >
                    تطبيق المقترح
                  </button>
                </AuditRow>
              ))}
            </AuditPanel>
          )}

          {accountAudit.riskyAccounts.length > 0 && (
            <AuditPanel title="صلاحيات حساسة على أدوار غير إدارية">
              {accountAudit.riskyAccounts.slice(0, 6).map((account) => (
                <AuditRow
                  key={account.id}
                  title={accountDisplayName(account)}
                  subtitle={`${getRoleLabel(account.role)} — راجع manage_permissions / manage_staff_accounts`}
                />
              ))}
            </AuditPanel>
          )}
        </div>
      </div>

      {/* Manual Account Modal */}
      {showManualAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" dir="rtl">
          <div className="w-full max-w-md rounded-2xl border border-[#2d4063] bg-[#0f1e38] p-6 shadow-2xl">
            <h2 className="mb-4 text-lg font-bold text-white">إضافة حساب يدوي</h2>
            <div className="space-y-3">
              <input
                className="input-dark w-full"
                placeholder="الاسم الكامل *"
                value={manualAccount.name}
                onChange={(e) => setManualAccount((p) => ({ ...p, name: e.target.value }))}
              />
              <select
                className="input-dark w-full"
                value={manualAccount.role}
                onChange={(e) =>
                  setManualAccount((p) => ({ ...p, role: e.target.value as RoleKey }))
                }
              >
                {ROLES.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.labelAr}
                  </option>
                ))}
              </select>
              <input
                className="input-dark w-full"
                placeholder="الفرع"
                value={manualAccount.branch}
                onChange={(e) => setManualAccount((p) => ({ ...p, branch: e.target.value }))}
              />
              <input
                className="input-dark w-full"
                placeholder="اسم المستخدم (اختياري — سيُولَّد تلقائيًا)"
                value={manualAccount.username}
                onChange={(e) => setManualAccount((p) => ({ ...p, username: e.target.value }))}
              />
              <input
                className="input-dark w-full"
                placeholder="كلمة المرور (اختياري — ستُولَّد تلقائيًا)"
                value={manualAccount.password}
                onChange={(e) => setManualAccount((p) => ({ ...p, password: e.target.value }))}
              />
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={createManualAccount} className="btn-primary flex-1">
                إنشاء الحساب
              </button>
              <button onClick={() => setShowManualAccount(false)} className="btn-secondary flex-1">
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Staff / Accounts List */}
      {staffLoading || accountLoading ? (
        <div className="p-8 text-center text-slate-400">جاري التحميل...</div>
      ) : filteredRows.length === 0 ? (
        <div className="p-8 text-center text-slate-400">لا توجد نتائج</div>
      ) : (
        <div className="space-y-4">
          {filteredRows.map(({ staff: member, account }) => {
            const hasLocalChanges = !!localPerms[account?.id || ''];
            const effectivePerms = account ? getEffectivePerms(account) : {};
            const isExpanded = expandedPerms[account?.id || member.id] || false;

            return (
              <div
                key={member.id}
                className="rounded-2xl border border-[#2d4063] bg-[#16253f]/70 p-4 shadow-sm"
              >
                {/* Staff info row */}
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1.2fr_1fr_auto] items-start">
                  {/* Name / role / branch */}
                  <div className="space-y-2">
                    <div className="text-xs text-slate-400">الموظف</div>
                    <Link
                      to={staffProfilePath({
                        id: member.id,
                        staff_id: account?.staff_id,
                        username: account?.username,
                        name: member.name,
                      })}
                      className="inline-flex items-center gap-1 text-lg font-bold text-white transition hover:text-teal-300"
                    >
                      {member.name} <ExternalLink size={14} />
                    </Link>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full border border-[#2d4063] bg-white/5 px-2 py-1 text-slate-300">
                        {getRoleLabel(member.role)}
                      </span>
                      <span className="rounded-full border border-[#2d4063] bg-white/5 px-2 py-1 text-slate-300">
                        {member.branch || 'بدون فرع'}
                      </span>
                    </div>
                  </div>

                  {/* Username + Password */}
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {/* Username */}
                    <div className="rounded-xl border border-[#2d4063] bg-[#101d33] p-3">
                      <div className="mb-1 text-xs text-slate-400">اسم المستخدم</div>
                      {account ? (
                        editingUsername === account.id ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={newUsername}
                              onChange={(e) => setNewUsername(e.target.value)}
                              className="input-dark flex-1 px-2 py-1 text-sm"
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
                                setNewUsername('');
                              }}
                              className="btn-secondary px-2 py-1 text-xs"
                            >
                              إلغاء
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-teal-300">
                              {account.username || 'غير محدد'}
                            </span>
                            {canEditAccount && (
                              <button
                                onClick={() => {
                                  setEditingUsername(account.id);
                                  setNewUsername(account.username || '');
                                }}
                                className="text-slate-400 transition hover:text-white"
                                title="تعديل"
                              >
                                <Edit2 size={14} />
                              </button>
                            )}
                          </div>
                        )
                      ) : (
                        <span className="text-sm text-slate-500">لا يوجد حساب</span>
                      )}
                    </div>

                    {/* Password */}
                    <div className="rounded-xl border border-[#2d4063] bg-[#101d33] p-3">
                      <div className="mb-1 text-xs text-slate-400">كلمة المرور</div>
                      {account && canRevealPasswords ? (
                        editingPassword === account.id ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              className="input-dark flex-1 px-2 py-1 text-sm"
                              placeholder="كلمة مرور جديدة"
                            />
                            <button
                              onClick={() => updatePassword(account)}
                              className="btn-primary px-2 py-1 text-xs"
                            >
                              حفظ
                            </button>
                            <button
                              onClick={() => {
                                setEditingPassword(null);
                                setNewPassword('');
                              }}
                              className="btn-secondary px-2 py-1 text-xs"
                            >
                              إلغاء
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-slate-300">
                              {showPassword[account.id]
                                ? account.temporary_password || '—'
                                : '••••••••'}
                            </span>
                            <button
                              onClick={() =>
                                setShowPassword((p) => ({ ...p, [account.id]: !p[account.id] }))
                              }
                              className="text-slate-400 transition hover:text-white"
                            >
                              {showPassword[account.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                            <button
                              onClick={() => {
                                setEditingPassword(account.id);
                                setNewPassword(account.temporary_password || '');
                              }}
                              className="text-slate-400 transition hover:text-white"
                            >
                              <Edit2 size={14} />
                            </button>
                          </div>
                        )
                      ) : account ? (
                        <span className="text-sm text-slate-500">••••••••</span>
                      ) : null}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2">
                    {!account && canCreateAccount && (
                      <button
                        onClick={() => createStaffAccount(member)}
                        className="btn-primary flex items-center gap-1 text-sm"
                      >
                        <UserPlus size={14} /> إنشاء حساب
                      </button>
                    )}
                    {account && (
                      <>
                        <button
                          onClick={() => toggleAccountStatus(account)}
                          disabled={!canEditAccount}
                          className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-sm font-bold transition ${
                            account.active
                              ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                              : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                          } disabled:opacity-40`}
                        >
                          <Power size={14} /> {account.active ? 'تعطيل' : 'تفعيل'}
                        </button>
                        <button
                          onClick={() =>
                            setExpandedPerms((p) => ({ ...p, [account.id]: !p[account.id] }))
                          }
                          className="btn-secondary flex items-center gap-1 text-sm"
                        >
                          <KeyRound size={14} />
                          {isExpanded ? 'إخفاء الصلاحيات' : 'الصلاحيات'}
                          {hasLocalChanges && (
                            <span className="h-2 w-2 rounded-full bg-amber-400" />
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Permissions panel */}
                {account && isExpanded && (
                  <div className="mt-4 space-y-3 border-t border-[#2d4063] pt-4">
                    {/* Role preset buttons */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-400">تطبيق قالب دور:</span>
                      {ROLES.slice(0, 9).map((role) => (
                        <button
                          key={role.key}
                          onClick={() => canEditPerms && applyRolePreset(account, role.key)}
                          disabled={!canEditPerms}
                          className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-300 transition hover:bg-violet-700 disabled:opacity-40"
                        >
                          {role.labelAr}
                        </button>
                      ))}
                      {hasLocalChanges && (
                        <button
                          onClick={() => savePermissions(account)}
                          disabled={savingId === account.id}
                          className="mr-auto flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                        >
                          {savingId === account.id ? (
                            <RefreshCw size={14} className="animate-spin" />
                          ) : (
                            <Save size={14} />
                          )}
                          حفظ التغييرات
                        </button>
                      )}
                    </div>

                    {/* Permission categories */}
                    {PERMISSION_CATEGORIES.map((cat) => {
                      const catKey = `${account.id}-${cat.key}`;
                      const isCatExpanded = expandedCategories[catKey] ?? true;
                      const activeCount = cat.permissions.filter(
                        (p) => effectivePerms[p.key] === true
                      ).length;

                      return (
                        <div
                          key={cat.key}
                          className="rounded-xl border border-slate-700/40 bg-slate-900/50 overflow-hidden"
                        >
                          <button
                            onClick={() => toggleCategory(account.id, cat.key)}
                            className="flex w-full items-center justify-between gap-3 p-3 text-right hover:bg-slate-800/40"
                          >
                            <span className="text-sm font-bold text-slate-200">{cat.label}</span>
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                                {activeCount}/{cat.permissions.length}
                              </span>
                              {isCatExpanded ? (
                                <ChevronUp size={14} className="text-slate-400" />
                              ) : (
                                <ChevronDown size={14} className="text-slate-400" />
                              )}
                            </div>
                          </button>
                          {isCatExpanded && (
                            <div className="border-t border-slate-700/40 p-3">
                              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                {cat.permissions.map((perm) => {
                                  const isOn = effectivePerms[perm.key] === true;
                                  return (
                                    <label
                                      key={perm.key}
                                      className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border p-2 transition ${
                                        isOn
                                          ? 'border-emerald-500/20 bg-emerald-500/10'
                                          : 'border-slate-700/30 bg-slate-800/40'
                                      } ${perm.sensitive ? 'ring-1 ring-amber-500/20' : ''}`}
                                    >
                                      <div className="min-w-0">
                                        <p
                                          className={`truncate text-xs font-semibold ${isOn ? 'text-emerald-200' : 'text-slate-400'}`}
                                        >
                                          {perm.label}
                                        </p>
                                        {perm.sensitive && (
                                          <p className="text-[10px] text-amber-400">حساسة</p>
                                        )}
                                      </div>
                                      <input
                                        type="checkbox"
                                        checked={isOn}
                                        disabled={!canEditPerms}
                                        onChange={() => togglePermission(account, perm.key)}
                                        className="h-4 w-4 shrink-0 accent-emerald-500"
                                      />
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Standalone accounts (no matching staff member) */}
          {standaloneAccounts.length > 0 && (
            <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
              <h3 className="mb-3 text-sm font-bold text-violet-300">
                حسابات مستقلة ({standaloneAccounts.length}) — لا تتطابق مع موظف نشط
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {standaloneAccounts.map((account) => (
                  <div
                    key={account.id}
                    className="rounded-xl border border-[#2d4063] bg-[#101d33] p-3"
                  >
                    <p className="font-bold text-white">{accountDisplayName(account)}</p>
                    <p className="text-xs text-slate-400">
                      {getRoleLabel(account.role)} — {account.branch}
                    </p>
                    <p className="mt-1 font-mono text-xs text-teal-300">{account.username}</p>
                    <p className="text-[10px] text-slate-500 mt-1">
                      آخر دخول: {formatDateTime(account.last_login_at)}
                    </p>
                    <div className="mt-2 flex gap-1">
                      <button
                        onClick={() => toggleAccountStatus(account)}
                        disabled={!canEditAccount}
                        className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold ${
                          account.active
                            ? 'bg-red-500/20 text-red-300'
                            : 'bg-emerald-500/20 text-emerald-300'
                        } disabled:opacity-40`}
                      >
                        <Power size={12} /> {account.active ? 'تعطيل' : 'تفعيل'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
