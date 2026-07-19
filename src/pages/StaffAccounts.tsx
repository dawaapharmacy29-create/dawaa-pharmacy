import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Edit2,
  KeyRound,
  Power,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { useAuth, getSafeCurrentUserId } from '@/hooks/useAuth';
import { logActivity } from '@/lib/activityLog';
import { BRANCHES } from '@/lib/constants';
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_CATEGORIES,
  ROLES,
  getDefaultPermissionsForRole,
  getRoleLabel,
  mergePermissions,
  normalizeRole,
  type RoleKey,
} from '@/lib/core/permissionSystem';
import { getPresetForRole } from '@/lib/rolePermissionPresets';
import { listStaffAccountsSafe } from '@/lib/staff/staffAccountsApi';

interface StaffRow {
  id: string;
  name: string;
  role: string;
  branch: string;
  branch_id?: string | null;
  status?: string | null;
  active?: boolean | null;
  is_active?: boolean | null;
  deleted_at?: string | null;
  is_deleted?: boolean | null;
}

interface StaffAccountRow {
  id: string;
  staff_id?: string | null;
  username?: string | null;
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

interface EditorState {
  account: StaffAccountRow;
  staff: StaffRow | null;
  name: string;
  username: string;
  pin: string;
  role: RoleKey;
  branch: string;
  active: boolean;
  canLogin: boolean;
  permissions: Record<string, boolean>;
  applySuggestedPermissions: boolean;
}

function missingColumn(message: string) {
  return (
    message.match(/Could not find the ["']([^"']+)["'] column/i)?.[1] ||
    message.match(/column ["']?([^"'\s]+)["']? (?:of relation [^ ]+ )?does not exist/i)?.[1] ||
    null
  );
}

async function updateFlexible(
  table: string,
  id: string,
  payload: Record<string, unknown>
) {
  const next = { ...payload };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await supabase.from(table).update(next).eq('id', id);
    if (!result.error) return result;
    const column = missingColumn(result.error.message);
    if (!column || !(column in next)) return result;
    delete next[column];
  }
  return supabase.from(table).update(next).eq('id', id);
}

async function insertFlexible(table: string, payload: Record<string, unknown>) {
  const next = { ...payload };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await supabase.from(table).insert(next);
    if (!result.error) return result;
    const column = missingColumn(result.error.message);
    if (!column || !(column in next)) return result;
    delete next[column];
  }
  return supabase.from(table).insert(next);
}

function friendlyError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null
        ? String((error as { message?: unknown }).message || JSON.stringify(error))
        : String(error);

  if (/row-level security|permission denied/i.test(message))
    return 'ليس لديك صلاحية لتنفيذ هذا التعديل.';
  if (/unique|duplicate/i.test(message)) return 'اسم المستخدم مستخدم في حساب آخر.';
  if (/4 أرقام|four digit|23514/i.test(message)) return 'الرقم السري يجب أن يكون 4 أرقام فقط.';
  if (/staff_id|هوية الموظف/i.test(message))
    return 'لا يمكن تفعيل الحساب قبل ربطه بموظف أساسي.';
  return message;
}

function accountName(account: StaffAccountRow) {
  return String(account.staff_name || account.name || account.username || 'غير محدد').trim();
}

function generateUsername(name: string) {
  const base = name
    .trim()
    .replace(/^(د\s*\/|دكتور|دكتورة)\s*/i, '')
    .replace(/\s+/g, '.')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .toLowerCase();
  return base || `staff.${Math.floor(1000 + Math.random() * 9000)}`;
}

function generatePin() {
  const blocked = new Set(['0000', '1111', '1234', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999']);
  let pin = '';
  do pin = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  while (blocked.has(pin));
  return pin;
}

function validatePin(pin: string) {
  return /^\d{4}$/.test(pin);
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3" dir="rtl">
      <div className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
        <div className="sticky top-0 z-10 flex justify-end border-b border-slate-800 bg-slate-950/95 p-3 backdrop-blur">
          <button onClick={onClose} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function StaffAccounts() {
  const { canManage, checkPermission } = useAuth();
  const queryClient = useQueryClient();
  const currentUserId = getSafeCurrentUserId();
  const canView = checkPermission('view_staff_accounts') || canManage;
  const canEdit = checkPermission('manage_staff_accounts') || canManage;
  const canEditPermissions = checkPermission('manage_permissions') || canManage;

  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [showMissingOnly, setShowMissingOnly] = useState(false);

  const { data: staffList, loading: staffLoading } = useSupabaseQuery<StaffRow>({
    table: TABLES.staff,
    filters: [{ column: 'is_deleted', operator: 'neq', value: true }],
    orderBy: { column: 'name', ascending: true },
  });

  const {
    data: accounts = [],
    isLoading: accountLoading,
    error: accountError,
  } = useQuery<StaffAccountRow[], Error>({
    queryKey: ['staff-accounts-safe'],
    queryFn: listStaffAccountsSafe,
    enabled: canView,
    staleTime: 30_000,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['staff-accounts-safe'] });
  };

  const rows = useMemo(() => {
    const activeStaff = staffList.filter(
      (staff) => staff.active !== false && staff.is_active !== false && !staff.deleted_at && !staff.is_deleted
    );

    const linked = activeStaff.map((staff) => ({
      staff,
      account: accounts.find((account) => account.staff_id === staff.id) || null,
    }));

    const standalone = accounts
      .filter((account) => !account.staff_id || !activeStaff.some((staff) => staff.id === account.staff_id))
      .map((account) => ({ staff: null as StaffRow | null, account }));

    return [...linked, ...standalone];
  }, [staffList, accounts]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter(({ staff, account }) => {
      if (showMissingOnly && account) return false;
      if (!query) return true;
      return [
        staff?.name,
        staff?.role,
        staff?.branch,
        account?.username,
        account?.role,
        account?.branch,
        accountName(account || ({} as StaffAccountRow)),
      ].some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [rows, search, showMissingOnly]);

  const missingAccounts = rows.filter((row) => row.staff && !row.account).length;
  const activeAccounts = accounts.filter((account) => account.active !== false && account.can_login !== false).length;
  const disabledAccounts = accounts.filter((account) => account.active === false || account.can_login === false).length;

  function openEditor(account: StaffAccountRow, staff: StaffRow | null) {
    const role = normalizeRole(account.role || staff?.role);
    const defaults = getDefaultPermissionsForRole(role);
    setEditor({
      account,
      staff,
      name: accountName(account) || staff?.name || '',
      username: String(account.username || ''),
      pin: '',
      role,
      branch: String(account.branch || staff?.branch || ''),
      active: account.active !== false,
      canLogin: account.can_login !== false,
      permissions: mergePermissions(defaults, account.permissions || {}),
      applySuggestedPermissions: true,
    });
  }

  function changeRole(role: RoleKey) {
    setEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        role,
        permissions: current.applySuggestedPermissions
          ? getDefaultPermissionsForRole(role)
          : current.permissions,
      };
    });
  }

  function togglePermission(key: string) {
    setEditor((current) =>
      current
        ? {
            ...current,
            permissions: { ...current.permissions, [key]: !current.permissions[key] },
          }
        : current
    );
  }

  async function createAccount(staff: StaffRow) {
    if (!canEdit) return toast.error('لا توجد صلاحية لإنشاء الحساب.');
    if (accounts.some((account) => account.staff_id === staff.id))
      return toast.error('هذا الموظف مرتبط بحساب بالفعل. افتح الحساب الحالي بدل إنشاء حساب مكرر.');
    const baseUsername = generateUsername(staff.name);
    let username = baseUsername;
    let suffix = 2;
    while (accounts.some((account) => String(account.username || '').trim().toLowerCase() === username.toLowerCase())) {
      username = `${baseUsername}.${suffix}`;
      suffix += 1;
    }
    const pin = generatePin();
    const role = normalizeRole(staff.role);
    const preset = getPresetForRole(role);
    const permissions = preset?.permissions || getDefaultPermissionsForRole(role);

    const { error } = await insertFlexible(TABLES.staffAccounts, {
      staff_id: staff.id,
      name: staff.name,
      staff_name: staff.name,
      username,
      temporary_password: pin,
      password_hash: pin,
      password_status: 'مؤقتة',
      role,
      branch: staff.branch,
      active: true,
      can_login: true,
      visible_in_admin: true,
      permissions,
      ...(currentUserId ? { created_by: currentUserId } : {}),
    });

    if (error) return toast.error(friendlyError(error));
    toast.success(`تم إنشاء الحساب — ${username} / ${pin}`);
    await logActivity({
      action: 'إنشاء حساب موظف',
      module: 'حسابات وصلاحيات الفريق',
      details: `إنشاء حساب ${staff.name} باسم مستخدم ${username}`,
    });
    refresh();
  }

  async function saveEditor() {
    if (!editor || !canEdit) return;
    const username = editor.username.trim().toLowerCase();
    const name = editor.name.trim();
    const branch = editor.branch.trim();

    if (!name) return toast.error('اسم الموظف مطلوب.');
    if (!username) return toast.error('اسم المستخدم مطلوب.');
    if (!branch && (editor.active || editor.canLogin)) return toast.error('لا يمكن تفعيل حساب بدون فرع أو قسم.');
    if (accounts.some((account) => account.id !== editor.account.id && String(account.username || '').trim().toLowerCase() === username))
      return toast.error('اسم المستخدم مستخدم في حساب آخر. اختر اسمًا مختلفًا.');
    if (editor.account.staff_id && accounts.some((account) => account.id !== editor.account.id && account.staff_id === editor.account.staff_id))
      return toast.error('يوجد حساب آخر مرتبط بنفس الموظف. يجب مراجعة الحساب المكرر أولًا.');
    if (editor.pin && !validatePin(editor.pin))
      return toast.error('الرقم السري يجب أن يكون 4 أرقام فقط.');
    if ((editor.active || editor.canLogin) && !editor.account.staff_id)
      return toast.error('لا يمكن تفعيل حساب غير مربوط بموظف أساسي.');

    const activeGeneralManagers = accounts.filter(
      (account) =>
        account.id !== editor.account.id &&
        normalizeRole(account.role) === 'general_manager' &&
        account.active !== false &&
        account.can_login !== false
    ).length;
    const isCurrentGeneralManager = normalizeRole(editor.account.role) === 'general_manager';
    const removesLastGeneralManager =
      isCurrentGeneralManager &&
      activeGeneralManagers === 0 &&
      (editor.role !== 'general_manager' || !editor.active || !editor.canLogin);
    if (removesLastGeneralManager)
      return toast.error('لا يمكن تعطيل أو تغيير وظيفة آخر مدير عام نشط.');

    setSaving(true);
    const oldStaff = editor.staff
      ? { name: editor.staff.name, role: editor.staff.role, branch: editor.staff.branch }
      : null;

    try {
      if (editor.staff) {
        const staffResult = await updateFlexible(TABLES.staff, editor.staff.id, {
          name,
          role: editor.role,
          branch,
          active: editor.active,
          is_active: editor.active,
          status: editor.active ? 'active' : 'inactive',
        });
        if (staffResult.error) throw staffResult.error;
      }

      const accountPayload: Record<string, unknown> = {
        name,
        staff_name: name,
        username,
        role: editor.role,
        branch,
        active: editor.active,
        can_login: editor.active && editor.canLogin,
        permissions: editor.permissions,
        visible_in_admin: true,
        updated_at: new Date().toISOString(),
        ...(currentUserId ? { updated_by: currentUserId } : {}),
      };

      if (editor.pin) {
        accountPayload.temporary_password = editor.pin;
        accountPayload.password_hash = editor.pin;
        accountPayload.password_status = 'مؤقتة';
      }

      const accountResult = await updateFlexible(
        TABLES.staffAccounts,
        editor.account.id,
        accountPayload
      );
      if (accountResult.error) {
        if (editor.staff && oldStaff) {
          await updateFlexible(TABLES.staff, editor.staff.id, oldStaff);
        }
        throw accountResult.error;
      }

      await logActivity({
        action: 'تعديل حساب موظف',
        module: 'حسابات وصلاحيات الفريق',
        details: `تعديل ${name}: المستخدم=${username}، الوظيفة=${getRoleLabel(editor.role)}، الفرع=${branch}، الحالة=${editor.active ? 'نشط' : 'موقوف'}`,
      });

      toast.success('تم حفظ بيانات الموظف والحساب والصلاحيات بنجاح.');
      setEditor(null);
      await refresh();
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setSaving(false);
    }
  }

  async function quickToggle(account: StaffAccountRow) {
    if (!canEdit) return;
    const disabling = account.active !== false && account.can_login !== false;
    const isLastGeneralManager =
      normalizeRole(account.role) === 'general_manager' &&
      disabling &&
      accounts.filter(
        (item) =>
          item.id !== account.id &&
          normalizeRole(item.role) === 'general_manager' &&
          item.active !== false &&
          item.can_login !== false
      ).length === 0;
    if (isLastGeneralManager) return toast.error('لا يمكن تعطيل آخر مدير عام نشط.');

    const { error } = await updateFlexible(TABLES.staffAccounts, account.id, {
      active: !disabling,
      can_login: !disabling,
      updated_at: new Date().toISOString(),
      ...(currentUserId ? { updated_by: currentUserId } : {}),
    });
    if (error) return toast.error(friendlyError(error));
    toast.success(disabling ? 'تم إيقاف الحساب.' : 'تم تفعيل الحساب.');
    refresh();
  }

  if (!canView) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" dir="rtl">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center text-red-200">
          <ShieldCheck className="mx-auto mb-3" />
          <p className="font-bold">غير مصرح لك بعرض حسابات الفريق.</p>
        </div>
      </div>
    );
  }

  const loading = staffLoading || accountLoading;

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-black text-white">
            <ShieldCheck className="text-teal-400" /> حسابات وصلاحيات الفريق
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            المدير العام يستطيع تعديل بيانات الموظف، اسم المستخدم، الرقم السري، الوظيفة، الفرع، الحالة والصلاحيات.
          </p>
        </div>
        <button onClick={refresh} className="btn-secondary flex items-center gap-2">
          <RefreshCw size={16} /> تحديث
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
          <p className="text-xs text-emerald-200">الحسابات النشطة</p>
          <p className="mt-1 text-3xl font-black text-white">{activeAccounts}</p>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
          <p className="text-xs text-amber-200">الحسابات الموقوفة</p>
          <p className="mt-1 text-3xl font-black text-white">{disabledAccounts}</p>
        </div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
          <p className="text-xs text-red-200">موظفون بدون حساب</p>
          <p className="mt-1 text-3xl font-black text-white">{missingAccounts}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3 md:flex-row">
        <label className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="input w-full pr-10"
            placeholder="ابحث بالاسم أو المستخدم أو الوظيفة أو الفرع"
          />
        </label>
        <button
          onClick={() => setShowMissingOnly((value) => !value)}
          className={showMissingOnly ? 'btn-primary' : 'btn-secondary'}
        >
          موظفون بدون حساب فقط
        </button>
      </div>

      {accountError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-red-200">
          {friendlyError(accountError)}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-slate-400">جاري تحميل الحسابات…</div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {filteredRows.map(({ staff, account }) => {
            const displayName = staff?.name || (account ? accountName(account) : 'غير محدد');
            return (
              <div
                key={account?.id || staff?.id}
                className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-black text-white">{displayName}</h2>
                    <p className="mt-1 text-sm text-slate-400">
                      {getRoleLabel(account?.role || staff?.role)} • {account?.branch || staff?.branch || 'بدون فرع'}
                    </p>
                    {account ? (
                      <p className="mt-2 font-mono text-sm text-teal-300">{account.username || 'بدون اسم مستخدم'}</p>
                    ) : (
                      <p className="mt-2 text-sm font-bold text-red-300">لا يوجد حساب دخول</p>
                    )}
                  </div>
                  {account && (
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${
                        account.active !== false && account.can_login !== false
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-red-500/15 text-red-300'
                      }`}
                    >
                      {account.active !== false && account.can_login !== false ? 'نشط' : 'موقوف'}
                    </span>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {account ? (
                    <>
                      <button
                        disabled={!canEdit}
                        onClick={() => openEditor(account, staff)}
                        className="btn-primary flex items-center gap-2 disabled:opacity-50"
                      >
                        <Edit2 size={16} /> تعديل كامل
                      </button>
                      <button
                        disabled={!canEdit}
                        onClick={() => quickToggle(account)}
                        className="btn-secondary flex items-center gap-2 disabled:opacity-50"
                      >
                        <Power size={16} />
                        {account.active !== false && account.can_login !== false ? 'إيقاف' : 'تفعيل'}
                      </button>
                    </>
                  ) : (
                    <button
                      disabled={!canEdit || !staff}
                      onClick={() => staff && createAccount(staff)}
                      className="btn-primary flex items-center gap-2 disabled:opacity-50"
                    >
                      <UserPlus size={16} /> إنشاء حساب
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editor && (
        <Modal onClose={() => !saving && setEditor(null)}>
          <div className="space-y-6 p-5">
            <div>
              <h2 className="text-xl font-black text-white">تعديل حساب {editor.name}</h2>
              <p className="mt-1 text-sm text-slate-400">
                تغيير الفرع أو الوظيفة لا يشترط تغيير اسم المستخدم أو الرقم السري.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm font-bold text-slate-200">اسم الموظف</span>
                <input
                  className="input w-full"
                  value={editor.name}
                  onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-bold text-slate-200">اسم المستخدم</span>
                <input
                  className="input w-full text-left"
                  dir="ltr"
                  value={editor.username}
                  onChange={(event) => setEditor({ ...editor, username: event.target.value })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-bold text-slate-200">رقم سري جديد — اختياري</span>
                <div className="relative">
                  <KeyRound className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
                  <input
                    className="input w-full pr-10 text-left"
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="4 أرقام"
                    value={editor.pin}
                    onChange={(event) =>
                      setEditor({ ...editor, pin: event.target.value.replace(/\D/g, '').slice(0, 4) })
                    }
                  />
                </div>
              </label>
              <label className="space-y-1">
                <span className="text-sm font-bold text-slate-200">الوظيفة</span>
                <select
                  className="input w-full"
                  value={editor.role}
                  onChange={(event) => changeRole(event.target.value as RoleKey)}
                >
                  {ROLES.map((role) => (
                    <option key={role.key} value={role.key}>{role.labelAr}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 md:col-span-2">
                <span className="text-sm font-bold text-slate-200">الفرع</span>
                <select
                  className="input w-full"
                  value={editor.branch}
                  onChange={(event) => setEditor({ ...editor, branch: event.target.value })}
                >
                  <option value="">اختر الفرع</option>
                  {[...BRANCHES, 'كل الفروع'].filter((value, index, list) => list.indexOf(value) === index).map((branch) => (
                    <option key={branch} value={branch}>{branch}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex items-center justify-between rounded-xl border border-slate-800 p-3">
                <span className="font-bold text-slate-200">الموظف نشط</span>
                <input
                  type="checkbox"
                  checked={editor.active}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      active: event.target.checked,
                      canLogin: event.target.checked ? editor.canLogin : false,
                    })
                  }
                />
              </label>
              <label className="flex items-center justify-between rounded-xl border border-slate-800 p-3">
                <span className="font-bold text-slate-200">مسموح بتسجيل الدخول</span>
                <input
                  type="checkbox"
                  checked={editor.canLogin}
                  disabled={!editor.active}
                  onChange={(event) => setEditor({ ...editor, canLogin: event.target.checked })}
                />
              </label>
            </div>

            <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="font-black text-white">الصلاحيات المقترحة للوظيفة</h3>
                  <p className="text-sm text-slate-400">
                    عند تغيير الوظيفة يمكن تطبيق قالب الصلاحيات المقترح ثم تعديله يدويًا.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <label className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={editor.applySuggestedPermissions}
                      onChange={(event) =>
                        setEditor({ ...editor, applySuggestedPermissions: event.target.checked })
                      }
                    />
                    تطبيق تلقائي عند تغيير الوظيفة
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setEditor({
                        ...editor,
                        permissions: getDefaultPermissionsForRole(editor.role),
                      })
                    }
                    className="btn-secondary"
                  >
                    تطبيق المقترح الآن
                  </button>
                </div>
              </div>
            </div>

            {canEditPermissions && (
              <div className="space-y-3">
                {PERMISSION_CATEGORIES.map((category) => (
                  <div key={category.key} className="rounded-xl border border-slate-800 p-3">
                    <h4 className="mb-3 font-black text-white">{category.label}</h4>
                    <div className="grid gap-2 md:grid-cols-2">
                      {category.permissions.map((permission) => (
                        <label
                          key={permission.key}
                          className="flex items-start gap-2 rounded-lg bg-slate-900/70 p-2 text-sm text-slate-200"
                        >
                          <input
                            type="checkbox"
                            checked={editor.permissions[permission.key] === true}
                            onChange={() => togglePermission(permission.key)}
                          />
                          <span>
                            <span className="font-bold">{permission.label}</span>
                            {permission.description && (
                              <span className="block text-xs text-slate-500">{permission.description}</span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="text-xs text-slate-500">
                  الصلاحيات المعرفة رسميًا: {ALL_PERMISSION_KEYS.length} صلاحية.
                </p>
              </div>
            )}

            <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-slate-800 bg-slate-950 py-4 md:flex-row">
              <button
                onClick={() => setEditor(null)}
                disabled={saving}
                className="btn-secondary flex-1"
              >
                إلغاء
              </button>
              <button
                onClick={saveEditor}
                disabled={saving || !canEdit}
                className="btn-primary flex flex-1 items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving ? <RefreshCw className="animate-spin" size={17} /> : <Save size={17} />}
                حفظ كل التعديلات
              </button>
            </div>
          </div>
        </Modal>
      )}

      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">
        <CheckCircle2 className="ml-2 inline" size={17} />
        الربط بين الموظف والحساب يعتمد على staff_id فقط، ولا توجد مطابقة بالاسم.
      </div>
    </div>
  );
}
