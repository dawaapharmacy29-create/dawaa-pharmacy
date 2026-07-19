import { useMemo, useState } from 'react';
import { ShieldCheck, RefreshCw, UserRound, Save, ChevronDown, ChevronUp, ShieldAlert, Download, History, Users } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth, getSafeCurrentUserId } from '@/hooks/useAuth';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import { TABLES } from '@/lib/supabaseTables';
import { listStaffAccountsSafe, type SafeStaffAccountRow } from '@/lib/staff/staffAccountsApi';
import { upsertUserPermission } from '@/services/permissionService';
import {
  ROLES,
  PERMISSION_CATEGORIES,
  getDefaultPermissionsForRole,
  mergePermissions,
  normalizeRole,
  isAdminRole,
  hasPermission,
  getRoleLabel,
  ALL_PERMISSION_KEYS,
  type RoleKey,
} from '@/lib/core/permissionSystem';
import { logActivity } from '@/lib/activityLog';

interface StaffMember {
  id: string;
  name: string;
  role: string;
  branch: string;
  status?: string;
}

export default function RolesPermissions() {
  const { user: currentUser, checkPermission } = useAuth();
  const queryClient = useQueryClient();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [previewRole, setPreviewRole] = useState<RoleKey | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [selectedForBulk, setSelectedForBulk] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);

  const canEdit = checkPermission('manage_permissions') || checkPermission('manage_roles');
  const canView =
    checkPermission('view_roles_permissions') || checkPermission('view_staff_accounts') || canEdit;

  const { data: staffAccounts = [] } = useQuery<SafeStaffAccountRow[], Error>({
    queryKey: ['staff-accounts-safe'],
    queryFn: listStaffAccountsSafe,
    enabled: canView,
    staleTime: 60_000,
  });
  const refetchAccounts = () => queryClient.invalidateQueries({ queryKey: ['staff-accounts-safe'] });

  const { data: permissionHistory = [], isFetching: historyLoading } = useQuery<Array<Record<string, unknown>>, Error>({
    queryKey: ['permission-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(TABLES.activityLog)
        .select('id,action,user_name,details,target_id,old_value,new_value,created_at')
        .eq('module', 'الصلاحيات')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as Array<Record<string, unknown>>;
    },
    enabled: canView,
    staleTime: 30_000,
  });

  const { data: staffList } = useSupabaseQuery<StaffMember>({
    table: TABLES.staff,
    filters: isActiveStaffFilter(),
    orderBy: { column: 'name', ascending: true },
  });

  const selectedAccount = useMemo(
    () => staffAccounts.find((a) => a.id === selectedAccountId) || null,
    [staffAccounts, selectedAccountId]
  );

  // Effective permissions = role defaults + custom overrides + pending changes
  const effectivePermissions = useMemo(() => {
    if (!selectedAccount) return {};
    const roleDefaults = getDefaultPermissionsForRole(selectedAccount.role || 'assistant');
    return mergePermissions(roleDefaults, selectedAccount.permissions || {}, pendingChanges);
  }, [selectedAccount, pendingChanges]);

  const previewPermissions = useMemo(() => {
    if (!previewRole) return null;
    return getDefaultPermissionsForRole(previewRole);
  }, [previewRole]);

  const suggestedRolePermissions = useMemo(() => {
    if (!selectedAccount) return {};
    return getDefaultPermissionsForRole(selectedAccount.role || 'assistant');
  }, [selectedAccount]);

  const roleComparison = useMemo(() => {
    if (!selectedAccount) return { missing: [] as string[], extra: [] as string[] };
    const missing = ALL_PERMISSION_KEYS.filter(
      (key) => suggestedRolePermissions[key] === true && effectivePermissions[key] !== true
    );
    const extra = ALL_PERMISSION_KEYS.filter(
      (key) => suggestedRolePermissions[key] !== true && effectivePermissions[key] === true
    );
    return { missing, extra };
  }, [selectedAccount, suggestedRolePermissions, effectivePermissions]);

  const permissionAudit = useMemo(() => {
    const staffById = new Map((staffList || []).map((item) => [String(item.id), item]));
    const usernameCounts = new Map<string, number>();
    const staffAccountCounts = new Map<string, number>();
    for (const account of staffAccounts) {
      const username = String(account.username || '').trim().toLowerCase();
      if (username) usernameCounts.set(username, (usernameCounts.get(username) || 0) + 1);
      if (account.staff_id) staffAccountCounts.set(account.staff_id, (staffAccountCounts.get(account.staff_id) || 0) + 1);
    }
    const issues = staffAccounts.flatMap((account) => {
      const accountIssues: string[] = [];
      const active = account.active !== false && account.can_login !== false;
      const staffMember = account.staff_id ? staffById.get(account.staff_id) : undefined;
      if (active && !account.staff_id) accountIssues.push('حساب نشط غير مربوط بموظف');
      if (active && !String(account.branch || '').trim()) accountIssues.push('حساب نشط بدون فرع/قسم');
      if (active && !String(account.role || '').trim()) accountIssues.push('حساب نشط بدون وظيفة');
      if (active && Object.keys(account.permissions || {}).length === 0) accountIssues.push('لا توجد صلاحيات مخصصة مسجلة');
      if (account.username && (usernameCounts.get(account.username.trim().toLowerCase()) || 0) > 1) accountIssues.push('اسم مستخدم مكرر');
      if (account.staff_id && (staffAccountCounts.get(account.staff_id) || 0) > 1) accountIssues.push('أكثر من حساب لنفس الموظف');
      if (staffMember && account.branch && staffMember.branch && account.branch !== staffMember.branch) accountIssues.push('فرع الحساب مختلف عن سجل الموظف');
      if (staffMember && normalizeRole(account.role) !== normalizeRole(staffMember.role)) accountIssues.push('وظيفة الحساب مختلفة عن سجل الموظف');
      const defaults = getDefaultPermissionsForRole(account.role);
      const effective = mergePermissions(defaults, account.permissions || {});
      const extraSensitive = PERMISSION_CATEGORIES.flatMap((category) => category.permissions)
        .filter((permission) => permission.sensitive && defaults[permission.key] !== true && effective[permission.key] === true)
        .length;
      if (extraSensitive) accountIssues.push(`${extraSensitive} صلاحية حساسة زائدة عن قالب الوظيفة`);
      return accountIssues.length ? [{ account, issues: accountIssues }] : [];
    });
    return {
      issues,
      activeAccounts: staffAccounts.filter((account) => account.active !== false && account.can_login !== false).length,
      disabledAccounts: staffAccounts.filter((account) => account.active === false || account.can_login === false).length,
      unlinked: issues.filter((item) => item.issues.includes('حساب نشط غير مربوط بموظف')).length,
      crossMismatch: issues.filter((item) => item.issues.some((issue) => issue.includes('مختلف'))).length,
    };
  }, [staffAccounts, staffList]);

  function toggleCategory(key: string) {
    setExpandedCategories((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleTogglePermission(permKey: string, value: boolean) {
    if (!canEdit) return;
    setPendingChanges((prev) => ({ ...prev, [permKey]: value }));
  }

  function handleApplyRolePreset(roleKey: RoleKey) {
    if (!canEdit) return;
    const presetPerms = getDefaultPermissionsForRole(roleKey);
    setPendingChanges(presetPerms);
    toast.info(`تم تطبيق صلاحيات: ${getRoleLabel(roleKey)}`);
  }

  function handleApplySuggestedForCurrentRole() {
    if (!selectedAccount || !canEdit) return;
    setPendingChanges(getDefaultPermissionsForRole(selectedAccount.role));
    setShowComparison(true);
    toast.info(`تم تطبيق القالب المقترح لدور: ${getRoleLabel(selectedAccount.role)}`);
  }

  function toggleBulkAccount(accountId: string) {
    if (!canEdit) return;
    setSelectedForBulk((current) => {
      const next = new Set(current);
      if (next.has(accountId)) next.delete(accountId); else next.add(accountId);
      return next;
    });
  }

  async function applyRoleTemplatesToSelected() {
    if (!canEdit || selectedForBulk.size === 0) return;
    const targets = staffAccounts.filter((account) => selectedForBulk.has(account.id));
    if (!window.confirm(`سيتم استبدال الصلاحيات المخصصة بقالب وظيفة كل حساب لعدد ${targets.length} حساب. هل تريد المتابعة؟`)) return;
    setBulkSaving(true);
    let saved = 0;
    const failed: string[] = [];
    try {
      for (const account of targets) {
        const permissions = getDefaultPermissionsForRole(account.role);
        const { error } = await supabase.from(TABLES.staffAccounts).update({ permissions }).eq('id', account.id);
        if (error) {
          failed.push(account.name || account.username || account.id);
          continue;
        }
        saved += 1;
        await logActivity({
          action: 'تطبيق قالب صلاحيات الوظيفة', module: 'الصلاحيات', target_type: 'staff_account', target_id: account.id,
          user_id: currentUser?.id || null, user_name: currentUser?.name || 'النظام', user_role: currentUser?.role || null,
          branch_name: currentUser?.branch || null,
          details: { summary: `تطبيق قالب ${getRoleLabel(account.role)} على ${account.name || account.username}`, staff_id: account.staff_id },
          old_value: { permissions: account.permissions || {} }, new_value: { permissions }, route_path: '/roles-permissions',
        });
      }
      toast.success(`تم تطبيق القالب على ${saved} حساب${failed.length ? `، وتعذر تحديث ${failed.length}` : ''}`);
      setSelectedForBulk(new Set());
      await Promise.all([refetchAccounts(), queryClient.invalidateQueries({ queryKey: ['permission-history'] })]);
    } finally {
      setBulkSaving(false);
    }
  }

  function exportPermissionAudit() {
    const header = ['اسم الحساب', 'اسم المستخدم', 'الوظيفة', 'الفرع', 'الحالة', 'الملاحظات'];
    const rows = permissionAudit.issues.map(({ account, issues }) => [
      account.name || account.staff_name || '', account.username || '', getRoleLabel(account.role), account.branch || '',
      account.active !== false && account.can_login !== false ? 'نشط' : 'موقوف', issues.join(' | '),
    ]);
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = `\uFEFF${[header, ...rows].map((row) => row.map(escape).join(',')).join('\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `permission-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('تم تصدير تقرير تدقيق الصلاحيات');
  }

  async function handleSave() {
    if (!selectedAccount || !canEdit) return;
    if (Object.keys(pendingChanges).length === 0) {
      toast.info('لا توجد تغييرات لحفظها');
      return;
    }
    setSaving(true);
    try {
      // Merge all permissions
      const roleDefaults = getDefaultPermissionsForRole(selectedAccount.role);
      const merged = mergePermissions(
        roleDefaults,
        selectedAccount.permissions || {},
        pendingChanges
      );

      // Save to staff_accounts
      const { error } = await supabase
        .from(TABLES.staffAccounts)
        .update({ permissions: merged })
        .eq('id', selectedAccount.id);
      if (error) throw error;

      // Also update user_permissions table (per-permission rows)
      for (const [key, value] of Object.entries(pendingChanges)) {
        const adminId = getSafeCurrentUserId();
        await upsertUserPermission(selectedAccount.id, key, value, adminId);
      }

      await logActivity({
        action: 'تعديل الصلاحيات',
        module: 'الصلاحيات',
        target_type: 'staff_account',
        target_id: selectedAccount.id,
        user_id: currentUser?.id || null,
        user_name: currentUser?.name || 'النظام',
        user_role: currentUser?.role || null,
        branch_name: currentUser?.branch || null,
        details: { summary: `تعديل صلاحيات ${selectedAccount.name} — ${Object.keys(pendingChanges).length} تغيير`, staff_id: selectedAccount.staff_id },
        old_value: { permissions: selectedAccount.permissions || {} },
        new_value: { permissions: merged },
        route_path: '/roles-permissions',
      });

      toast.success('تم حفظ الصلاحيات بنجاح ✓');
      setPendingChanges({});
      await Promise.all([refetchAccounts(), queryClient.invalidateQueries({ queryKey: ['permission-history'] })]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'خطأ غير متوقع';
      toast.error(`فشل الحفظ: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  if (!canView) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" dir="rtl">
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-8 text-center text-red-200">
          <ShieldCheck className="mx-auto mb-3 h-10 w-10 opacity-50" />
          <p className="text-lg font-bold">غير مصرح بالوصول</p>
          <p className="mt-1 text-sm opacity-70">ليس لديك صلاحية لعرض إدارة الأدوار.</p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="mx-auto max-w-7xl space-y-6 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-violet-500/20 p-2">
            <ShieldCheck className="h-6 w-6 text-violet-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">إدارة الأدوار والصلاحيات</h1>
            <p className="text-sm text-slate-400">تحكم كامل في ما يستطيع كل موظف فعله</p>
          </div>
        </div>
        {Object.keys(pendingChanges).length > 0 && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-violet-500 disabled:opacity-50"
          >
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            حفظ التغييرات ({Object.keys(pendingChanges).length})
          </button>
        )}
      </div>

      {/* Role Preview Strip */}
      <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-4">
        <p className="mb-3 text-xs font-bold text-slate-400">معاينة صلاحيات الأدوار</p>
        <div className="flex flex-wrap gap-2">
          {ROLES.map((role) => (
            <button
              key={role.key}
              onClick={() => setPreviewRole(previewRole === role.key ? null : role.key)}
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                previewRole === role.key
                  ? 'bg-violet-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {role.labelAr}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-cyan-500/25 bg-slate-900/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-black text-white">تدقيق الحسابات والصلاحيات</h2>
            <p className="text-xs text-slate-400">فحص تلقائي للربط والفرع والوظيفة والتكرار والصلاحيات الحساسة دون حذف أي حساب.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-lg bg-emerald-600/20 px-3 py-2 text-xs font-bold text-emerald-200" onClick={exportPermissionAudit}><Download className="ml-1 inline h-4 w-4" />تصدير CSV</button>
            <button className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200" onClick={() => void refetchAccounts()}>تحديث التدقيق</button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['نشط', permissionAudit.activeAccounts, 'text-emerald-300'],
            ['موقوف', permissionAudit.disabledAccounts, 'text-slate-300'],
            ['يحتاج مراجعة', permissionAudit.issues.length, 'text-amber-300'],
            ['غير مربوط', permissionAudit.unlinked, 'text-rose-300'],
            ['اختلاف فرع/وظيفة', permissionAudit.crossMismatch, 'text-cyan-300'],
          ].map(([label, value, color]) => <div key={String(label)} className="rounded-xl border border-slate-700 bg-slate-950/40 p-3"><div className="text-xs text-slate-400">{label}</div><div className={`mt-1 text-2xl font-black ${color}`}>{value}</div></div>)}
        </div>
        {permissionAudit.issues.length > 0 && (
          <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
            {permissionAudit.issues.map(({ account, issues }) => (
              <button key={account.id} className="w-full rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-right" onClick={() => { setSelectedAccountId(account.id); setShowComparison(true); }}>
                <div className="font-bold text-white">{account.name || account.staff_name || account.username || 'حساب غير مسمى'}</div>
                <div className="mt-1 text-xs font-semibold text-amber-100">{issues.join(' · ')}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {canEdit && (
        <div className="rounded-2xl border border-violet-500/25 bg-violet-500/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><Users className="h-5 w-5 text-violet-300" /><div><h2 className="font-black text-white">تطبيق جماعي آمن</h2><p className="text-xs text-slate-400">حدد الحسابات من القائمة ثم طبّق قالب الوظيفة المسجلة لكل حساب.</p></div></div>
            <button onClick={() => void applyRoleTemplatesToSelected()} disabled={!selectedForBulk.size || bulkSaving} className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-black text-white disabled:opacity-40">{bulkSaving ? 'جاري التطبيق...' : `تطبيق على ${selectedForBulk.size} حساب`}</button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Accounts List */}
        <div className="space-y-2">
          <h2 className="px-1 text-sm font-bold text-slate-400">حسابات الموظفين</h2>
          {staffAccounts.length === 0 && (
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-6 text-center text-sm text-slate-500">
              لا توجد حسابات
            </div>
          )}
          {staffAccounts.map((account) => (
            <div key={account.id} className="flex items-stretch gap-2">
              {canEdit && <input type="checkbox" aria-label={`تحديد ${account.name || account.username}`} checked={selectedForBulk.has(account.id)} onChange={() => toggleBulkAccount(account.id)} className="h-5 w-5 self-center accent-violet-500" />}
              <button
                onClick={() => {
                  setSelectedAccountId(account.id);
                  setPendingChanges({});
                  setShowComparison(false);
                }}
                className={`min-w-0 flex-1 rounded-xl border p-3 text-right transition ${
                  selectedAccountId === account.id
                    ? 'border-violet-500/40 bg-violet-500/10'
                    : 'border-slate-700/40 bg-slate-900/40 hover:border-slate-600/40'
                }`}
              >
                <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-700">
                  <UserRound className="h-4 w-4 text-slate-300" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-bold text-white">{account.name}</p>
                  <p className="truncate text-xs text-slate-400">
                    {getRoleLabel(account.role)} — {account.branch}
                  </p>
                </div>
                {isAdminRole(account.role) && (
                  <span className="mr-auto shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                    مدير عام
                  </span>
                )}
                </div>
              </button>
            </div>
          ))}
        </div>

        {/* Permissions Editor */}
        <div className="lg:col-span-2 space-y-3">
          {!selectedAccount && !previewRole && (
            <div className="flex min-h-64 items-center justify-center rounded-2xl border border-slate-700/50 bg-slate-900/50 text-sm text-slate-500">
              اختر حسابًا لتعديل صلاحياته، أو اضغط على دور للمعاينة
            </div>
          )}

          {(selectedAccount || previewRole) && (
            <>
              {selectedAccount && (
                <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <p className="font-bold text-white">{selectedAccount.name}</p>
                      <p className="text-xs text-slate-400">
                        {getRoleLabel(selectedAccount.role)} — {selectedAccount.branch}
                      </p>
                    </div>
                    <div className="mr-auto flex flex-wrap gap-2">
                      <p className="text-xs text-slate-500">تطبيق قالب دور:</p>
                      {ROLES.slice(0, 8).map((role) => (
                        <button
                          key={role.key}
                          onClick={() => handleApplyRolePreset(role.key)}
                          disabled={!canEdit}
                          className="rounded-lg bg-slate-800 px-2 py-1 text-xs text-slate-300 transition hover:bg-violet-700 disabled:opacity-40"
                        >
                          {role.labelAr}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 rounded-xl border border-slate-700/50 bg-slate-950/30 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="h-4 w-4 text-amber-300" />
                        <div>
                          <p className="text-sm font-bold text-white">مقارنة الدور المقترح</p>
                          <p className="text-xs text-slate-400">
                            ناقص {roleComparison.missing.length} / زائد {roleComparison.extra.length} حسب قالب {getRoleLabel(selectedAccount.role)}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => setShowComparison((value) => !value)}
                          className="rounded-lg bg-slate-800 px-3 py-1 text-xs font-bold text-slate-200 transition hover:bg-slate-700"
                        >
                          {showComparison ? 'إخفاء المقارنة' : 'عرض المقارنة'}
                        </button>
                        <button
                          onClick={handleApplySuggestedForCurrentRole}
                          disabled={!canEdit}
                          className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-bold text-white transition hover:bg-violet-500 disabled:opacity-40"
                        >
                          تطبيق المقترح
                        </button>
                      </div>
                    </div>
                    {showComparison && (
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2">
                          <p className="mb-1 text-xs font-bold text-amber-200">صلاحيات ناقصة</p>
                          <p className="text-xs text-amber-100/80">
                            {roleComparison.missing.slice(0, 12).join('، ') || 'لا يوجد'}
                            {roleComparison.missing.length > 12 ? ' ...' : ''}
                          </p>
                        </div>
                        <div className="rounded-lg border border-sky-500/20 bg-sky-500/10 p-2">
                          <p className="mb-1 text-xs font-bold text-sky-200">صلاحيات زائدة</p>
                          <p className="text-xs text-sky-100/80">
                            {roleComparison.extra.slice(0, 12).join('، ') || 'لا يوجد'}
                            {roleComparison.extra.length > 12 ? ' ...' : ''}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {previewRole && !selectedAccount && (
                <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-3">
                  <p className="text-sm font-bold text-violet-200">
                    معاينة صلاحيات: {getRoleLabel(previewRole)}
                  </p>
                </div>
              )}

              {PERMISSION_CATEGORIES.map((category) => {
                const activePerms = previewRole ? previewPermissions : effectivePermissions;
                const categoryActiveCount = category.permissions.filter(
                  (p) => activePerms?.[p.key] === true
                ).length;
                const isExpanded = expandedCategories[category.key] ?? true;

                return (
                  <div
                    key={category.key}
                    className="rounded-xl border border-slate-700/40 bg-slate-900/50 overflow-hidden"
                  >
                    <button
                      onClick={() => toggleCategory(category.key)}
                      className="flex w-full items-center justify-between gap-3 p-3 text-right hover:bg-slate-800/40"
                    >
                      <span className="font-bold text-slate-200">{category.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                          {categoryActiveCount}/{category.permissions.length}
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-slate-400" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-slate-400" />
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-slate-700/40 p-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          {category.permissions.map((perm) => {
                            const isActive = activePerms?.[perm.key] === true;
                            const isPending = perm.key in pendingChanges;
                            return (
                              <label
                                key={perm.key}
                                className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg p-2 transition ${
                                  isActive
                                    ? 'bg-emerald-500/10 border border-emerald-500/20'
                                    : 'bg-slate-800/40 border border-slate-700/30'
                                } ${perm.sensitive ? 'ring-1 ring-amber-500/20' : ''}`}
                              >
                                <div className="min-w-0">
                                  <p
                                    className={`truncate text-xs font-semibold ${isActive ? 'text-emerald-200' : 'text-slate-400'}`}
                                  >
                                    {perm.label}
                                  </p>
                                  {perm.sensitive && (
                                    <p className="text-[10px] text-amber-400">حساسة</p>
                                  )}
                                  {isPending && (
                                    <p className="text-[10px] text-violet-400">• معلقة</p>
                                  )}
                                </div>
                                <input
                                  type="checkbox"
                                  checked={isActive}
                                  disabled={!canEdit || !selectedAccount || previewRole !== null}
                                  onChange={(e) =>
                                    handleTogglePermission(perm.key, e.target.checked)
                                  }
                                  className="h-4 w-4 shrink-0 accent-violet-500"
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
            </>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2"><History className="h-5 w-5 text-cyan-300" /><div><h2 className="font-black text-white">سجل تغييرات الصلاحيات</h2><p className="text-xs text-slate-400">آخر 100 عملية مع المنفذ والحساب والقيم قبل وبعد التعديل.</p></div></div>
          <button onClick={() => void queryClient.invalidateQueries({ queryKey: ['permission-history'] })} className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200"><RefreshCw className={`ml-1 inline h-4 w-4 ${historyLoading ? 'animate-spin' : ''}`} />تحديث</button>
        </div>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {permissionHistory.length ? permissionHistory.map((entry) => (
            <div key={String(entry.id)} className="rounded-xl border border-slate-700/50 bg-slate-950/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold text-white">{String(entry.action || 'تعديل صلاحيات')}</span><span className="text-xs text-slate-400">{entry.created_at ? new Date(String(entry.created_at)).toLocaleString('ar-EG') : ''}</span></div>
              <div className="mt-1 text-xs text-cyan-100">بواسطة: {String(entry.user_name || 'النظام')}</div>
              <div className="mt-1 text-xs text-slate-300">{typeof entry.details === 'string' ? entry.details : String((entry.details as Record<string, unknown> | null)?.summary || `الحساب: ${entry.target_id || 'غير محدد'}`)}</div>
            </div>
          )) : <div className="rounded-xl border border-slate-700/40 p-6 text-center text-sm text-slate-500">لا توجد تغييرات صلاحيات مسجلة حتى الآن.</div>}
        </div>
      </div>
    </div>
  );
}
