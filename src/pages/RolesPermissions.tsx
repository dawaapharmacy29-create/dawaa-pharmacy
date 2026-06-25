import { useMemo, useState } from 'react';
import { ShieldCheck, RefreshCw, UserRound, Save, ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { useAuth, getSafeCurrentUserId } from '@/hooks/useAuth';
import { isActiveStaffFilter } from '@/lib/staffActiveFilter';
import { TABLES } from '@/lib/supabaseTables';
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
}

export default function RolesPermissions() {
  const { user: currentUser, checkPermission } = useAuth();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [previewRole, setPreviewRole] = useState<RoleKey | null>(null);
  const [showComparison, setShowComparison] = useState(false);

  const canEdit = checkPermission('manage_permissions') || checkPermission('manage_roles');
  const canView =
    checkPermission('view_roles_permissions') || checkPermission('view_staff_accounts') || canEdit;

  const { data: staffAccounts, refetch: refetchAccounts } = useSupabaseQuery<StaffAccount>({
    table: TABLES.staffAccounts,
    orderBy: { column: 'name', ascending: true },
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
    const roleDefaults = getDefaultPermissionsForRole(selectedAccount.role);
    return mergePermissions(roleDefaults, selectedAccount.permissions || {}, pendingChanges);
  }, [selectedAccount, pendingChanges]);

  const previewPermissions = useMemo(() => {
    if (!previewRole) return null;
    return getDefaultPermissionsForRole(previewRole);
  }, [previewRole]);

  const suggestedRolePermissions = useMemo(() => {
    if (!selectedAccount) return {};
    return getDefaultPermissionsForRole(selectedAccount.role);
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
        details: `تعديل صلاحيات ${selectedAccount.name} — ${Object.keys(pendingChanges).length} تغيير`,
      });

      toast.success('تم حفظ الصلاحيات بنجاح ✓');
      setPendingChanges({});
      refetchAccounts();
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
            <button
              key={account.id}
              onClick={() => {
                setSelectedAccountId(account.id);
                setPendingChanges({});
                setShowComparison(false);
              }}
              className={`w-full rounded-xl border p-3 text-right transition ${
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
    </div>
  );
}
