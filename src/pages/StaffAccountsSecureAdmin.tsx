import { useMemo, useState } from 'react';
import { Download, Edit2, KeyRound, Power, RefreshCw, Save, Search, ShieldCheck, UserPlus, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery';
import { useAuth, getSafeCurrentUserId } from '@/hooks/useAuth';
import { listStaffAccountsSafe, type SafeStaffAccountRow } from '@/lib/staff/staffAccountsApi';
import { BRANCHES } from '@/lib/constants';
import { ROLES, getRoleLabel, normalizeRole, type RoleKey } from '@/lib/core/permissionSystem';
import { logActivity } from '@/lib/activityLog';

interface StaffRow {
  id: string;
  name: string;
  role: string;
  branch: string;
  active?: boolean | null;
  is_active?: boolean | null;
  deleted_at?: string | null;
  is_deleted?: boolean | null;
}

type Account = SafeStaffAccountRow;

type IssuedCredential = {
  accountId: string;
  staffName: string;
  username: string;
  pin: string;
  role: string;
  branch: string;
  issuedAt: string;
};

type Editor = {
  account: Account;
  staff: StaffRow | null;
  name: string;
  username: string;
  pin: string;
  role: RoleKey;
  branch: string;
  active: boolean;
  canLogin: boolean;
};

function missingColumn(message: string) {
  return message.match(/Could not find the ["']([^"']+)["'] column/i)?.[1]
    || message.match(/column ["']?([^"'\s]+)["']? (?:of relation [^ ]+ )?does not exist/i)?.[1]
    || null;
}

async function updateFlexible(table: string, id: string, payload: Record<string, unknown>) {
  const next = { ...payload };
  for (let attempt = 0; attempt < 12; attempt += 1) {
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
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await supabase.from(table).insert(next);
    if (!result.error) return result;
    const column = missingColumn(result.error.message);
    if (!column || !(column in next)) return result;
    delete next[column];
  }
  return supabase.from(table).insert(next);
}

function generatePin() {
  const blocked = new Set(['0000', '1111', '1234', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999']);
  let pin = '';
  do pin = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  while (blocked.has(pin));
  return pin;
}

function generateUsername(name: string) {
  const base = name.trim().replace(/^(د\s*\/|دكتور|دكتورة)\s*/i, '').replace(/\s+/g, '.').replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase();
  return base || `staff.${Math.floor(1000 + Math.random() * 9000)}`;
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message || error);
  if (/row-level security|permission denied/i.test(message)) return 'ليس لديك صلاحية لتنفيذ هذا التعديل.';
  if (/unique|duplicate/i.test(message)) return 'اسم المستخدم مستخدم في حساب آخر.';
  if (/staff_id/i.test(message)) return 'لا يمكن تفعيل الحساب قبل ربطه بموظف أساسي.';
  return message;
}

export default function StaffAccountsSecureAdmin() {
  const { canManage, checkPermission } = useAuth();
  const queryClient = useQueryClient();
  const currentUserId = getSafeCurrentUserId();
  const canView = checkPermission('view_staff_accounts') || canManage;
  const canEdit = checkPermission('manage_staff_accounts') || canManage;
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [issued, setIssued] = useState<IssuedCredential[]>([]);
  const [lastIssued, setLastIssued] = useState<IssuedCredential | null>(null);

  const { data: staffList, loading: staffLoading } = useSupabaseQuery<StaffRow>({
    table: TABLES.staff,
    filters: [{ column: 'is_deleted', operator: 'neq', value: true }],
    orderBy: { column: 'name', ascending: true },
  });

  const { data: accounts = [], isLoading: accountLoading, error } = useQuery<Account[], Error>({
    queryKey: ['staff-accounts-safe'],
    queryFn: listStaffAccountsSafe,
    enabled: canView,
    staleTime: 30_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['staff-accounts-safe'] });

  const rows = useMemo(() => {
    const staff = staffList.filter((item) => item.active !== false && item.is_active !== false && !item.deleted_at && !item.is_deleted);
    const linked = staff.map((item) => ({ staff: item, account: accounts.find((account) => account.staff_id === item.id) || null }));
    const standalone = accounts.filter((account) => !account.staff_id || !staff.some((item) => item.id === account.staff_id)).map((account) => ({ staff: null as StaffRow | null, account }));
    return [...linked, ...standalone];
  }, [accounts, staffList]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(({ staff, account }) => [staff?.name, staff?.role, staff?.branch, account?.username, account?.name, account?.staff_name, account?.role, account?.branch].some((value) => String(value || '').toLowerCase().includes(q)));
  }, [rows, search]);

  function rememberCredential(value: IssuedCredential) {
    setIssued((current) => [value, ...current.filter((item) => item.accountId !== value.accountId)]);
    setLastIssued(value);
  }

  async function createAccount(staff: StaffRow) {
    if (!canEdit) return;
    let username = generateUsername(staff.name);
    let suffix = 2;
    while (accounts.some((item) => String(item.username || '').toLowerCase() === username.toLowerCase())) username = `${generateUsername(staff.name)}.${suffix++}`;
    const pin = generatePin();
    const { error: insertError } = await insertFlexible(TABLES.staffAccounts, {
      staff_id: staff.id,
      name: staff.name,
      staff_name: staff.name,
      username,
      temporary_password: pin,
      password_hash: pin,
      password_status: 'مؤقتة',
      role: normalizeRole(staff.role),
      branch: staff.branch,
      active: true,
      can_login: true,
      visible_in_admin: true,
      ...(currentUserId ? { created_by: currentUserId } : {}),
    });
    if (insertError) return toast.error(friendlyError(insertError));
    rememberCredential({ accountId: staff.id, staffName: staff.name, username, pin, role: getRoleLabel(staff.role), branch: staff.branch, issuedAt: new Date().toISOString() });
    await logActivity({ action: 'إنشاء حساب موظف', module: 'حسابات وصلاحيات الفريق', details: `إنشاء حساب ${staff.name} باسم مستخدم ${username}` });
    toast.success('تم إنشاء الحساب وإصدار رقم سري مؤقت.');
    await refresh();
  }

  function openEditor(account: Account, staff: StaffRow | null) {
    setEditor({
      account,
      staff,
      name: String(account.staff_name || account.name || staff?.name || ''),
      username: String(account.username || ''),
      pin: '',
      role: normalizeRole(account.role || staff?.role),
      branch: String(account.branch || staff?.branch || ''),
      active: account.active !== false,
      canLogin: account.can_login !== false,
    });
  }

  async function saveEditor() {
    if (!editor || !canEdit) return;
    const name = editor.name.trim();
    const username = editor.username.trim().toLowerCase();
    const branch = editor.branch.trim();
    if (!name || !username || !branch) return toast.error('الاسم واسم المستخدم والفرع مطلوبة.');
    if (editor.pin && !/^\d{4}$/.test(editor.pin)) return toast.error('الرقم السري يجب أن يكون 4 أرقام.');
    if (accounts.some((item) => item.id !== editor.account.id && String(item.username || '').toLowerCase() === username)) return toast.error('اسم المستخدم مستخدم في حساب آخر.');

    setSaving(true);
    try {
      if (editor.staff) {
        const staffResult = await updateFlexible(TABLES.staff, editor.staff.id, { name, role: editor.role, branch, active: editor.active, is_active: editor.active, status: editor.active ? 'active' : 'inactive' });
        if (staffResult.error) throw staffResult.error;
      }
      const payload: Record<string, unknown> = {
        name,
        staff_name: name,
        username,
        role: editor.role,
        branch,
        active: editor.active,
        can_login: editor.active && editor.canLogin,
        visible_in_admin: true,
        updated_at: new Date().toISOString(),
        ...(currentUserId ? { updated_by: currentUserId } : {}),
      };
      if (editor.pin) Object.assign(payload, { temporary_password: editor.pin, password_hash: editor.pin, password_status: 'مؤقتة' });
      const accountResult = await updateFlexible(TABLES.staffAccounts, editor.account.id, payload);
      if (accountResult.error) throw accountResult.error;
      if (editor.pin) rememberCredential({ accountId: editor.account.id, staffName: name, username, pin: editor.pin, role: getRoleLabel(editor.role), branch, issuedAt: new Date().toISOString() });
      await logActivity({ action: editor.pin ? 'تعديل حساب وإعادة تعيين الرقم السري' : 'تعديل حساب موظف', module: 'حسابات وصلاحيات الفريق', details: `تعديل ${name}: المستخدم=${username}، الفرع=${branch}، الحالة=${editor.active ? 'نشط' : 'موقوف'}` });
      toast.success(editor.pin ? 'تم الحفظ وإصدار الرقم السري الجديد.' : 'تم حفظ التعديلات.');
      setEditor(null);
      await refresh();
    } catch (saveError) {
      toast.error(friendlyError(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function toggleAccount(account: Account) {
    if (!canEdit) return;
    const enabled = account.active !== false && account.can_login !== false;
    const { error: toggleError } = await updateFlexible(TABLES.staffAccounts, account.id, { active: !enabled, can_login: !enabled, updated_at: new Date().toISOString(), ...(currentUserId ? { updated_by: currentUserId } : {}) });
    if (toggleError) return toast.error(friendlyError(toggleError));
    toast.success(enabled ? 'تم إيقاف الحساب.' : 'تم تفعيل الحساب.');
    await refresh();
  }

  async function exportIssued() {
    if (!issued.length) return toast.error('لا توجد أرقام سرية جديدة صادرة في الجلسة الحالية.');
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.json_to_sheet(issued.map((item) => ({ 'اسم الموظف': item.staffName, 'اسم المستخدم': item.username, 'الرقم السري المؤقت': item.pin, 'الوظيفة': item.role, 'الفرع': item.branch, 'وقت الإصدار': new Date(item.issuedAt).toLocaleString('ar-EG') })));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'الحسابات المؤقتة');
    XLSX.writeFile(book, `staff-temporary-credentials-${new Date().toISOString().slice(0, 10)}.xlsx`);
    await logActivity({ action: 'تصدير بيانات دخول مؤقتة', module: 'حسابات وصلاحيات الفريق', details: `تصدير ${issued.length} حسابًا تم إنشاء أو إعادة تعيين أرقامها في الجلسة الحالية فقط` });
  }

  if (!canView) return <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center text-red-200" dir="rtl">غير مصرح لك بعرض حسابات الفريق.</div>;

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex-1"><h1 className="flex items-center gap-2 text-2xl font-black text-white"><ShieldCheck className="text-teal-400" /> حسابات وصلاحيات الفريق</h1><p className="mt-1 text-sm text-slate-400">عرض وتعديل الحسابات، تغيير الفرع والوظيفة، إيقاف الدخول، وإعادة تعيين رقم سري يظهر مرة واحدة.</p></div>
        <button onClick={() => refresh()} className="btn-secondary flex items-center gap-2"><RefreshCw size={16} /> تحديث</button>
        <button onClick={exportIssued} disabled={!issued.length} className="btn-primary flex items-center gap-2 disabled:opacity-50"><Download size={16} /> تصدير المؤقت ({issued.length})</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4"><p className="text-xs text-emerald-200">الحسابات النشطة</p><p className="mt-1 text-3xl font-black text-white">{accounts.filter((a) => a.active !== false && a.can_login !== false).length}</p></div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4"><p className="text-xs text-amber-200">الحسابات الموقوفة</p><p className="mt-1 text-3xl font-black text-white">{accounts.filter((a) => a.active === false || a.can_login === false).length}</p></div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4"><p className="text-xs text-red-200">موظفون بدون حساب</p><p className="mt-1 text-3xl font-black text-white">{rows.filter((r) => r.staff && !r.account).length}</p></div>
      </div>

      <label className="relative block"><Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} className="input w-full pr-10" placeholder="ابحث بالاسم أو اسم المستخدم أو الوظيفة أو الفرع" /></label>
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-red-200">{friendlyError(error)}</div>}

      {staffLoading || accountLoading ? <div className="py-16 text-center text-slate-400">جاري تحميل الحسابات…</div> : <div className="grid gap-3 xl:grid-cols-2">{filtered.map(({ staff, account }) => <div key={account?.id || staff?.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-black text-white">{staff?.name || account?.staff_name || account?.name || 'غير محدد'}</h2><p className="mt-1 text-sm text-slate-400">{getRoleLabel(account?.role || staff?.role)} • {account?.branch || staff?.branch || 'بدون فرع'}</p><p className="mt-2 font-mono text-sm text-teal-300">{account?.username || 'لا يوجد حساب دخول'}</p></div>{account && <span className={`rounded-full px-3 py-1 text-xs font-bold ${account.active !== false && account.can_login !== false ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>{account.active !== false && account.can_login !== false ? 'نشط' : 'موقوف'}</span>}</div><div className="mt-4 flex flex-wrap gap-2">{account ? <><button disabled={!canEdit} onClick={() => openEditor(account, staff)} className="btn-primary flex items-center gap-2"><Edit2 size={16} /> تعديل كامل</button><button disabled={!canEdit} onClick={() => toggleAccount(account)} className="btn-secondary flex items-center gap-2"><Power size={16} /> {account.active !== false && account.can_login !== false ? 'إيقاف' : 'تفعيل'}</button></> : <button disabled={!canEdit || !staff} onClick={() => staff && createAccount(staff)} className="btn-primary flex items-center gap-2"><UserPlus size={16} /> إنشاء حساب</button>}</div></div>)}</div>}

      {editor && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3"><div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-5"><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-black text-white">تعديل حساب {editor.name}</h2><button onClick={() => setEditor(null)}><X className="text-slate-300" /></button></div><div className="grid gap-4 md:grid-cols-2"><label className="space-y-1"><span className="text-sm font-bold text-slate-200">اسم الموظف</span><input className="input w-full" value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} /></label><label className="space-y-1"><span className="text-sm font-bold text-slate-200">اسم المستخدم</span><input dir="ltr" className="input w-full text-left" value={editor.username} onChange={(e) => setEditor({ ...editor, username: e.target.value })} /></label><label className="space-y-1"><span className="text-sm font-bold text-slate-200">رقم سري جديد — اختياري</span><div className="relative"><KeyRound className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} /><input dir="ltr" inputMode="numeric" maxLength={4} className="input w-full pr-10 text-left" placeholder="4 أرقام" value={editor.pin} onChange={(e) => setEditor({ ...editor, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })} /></div></label><label className="space-y-1"><span className="text-sm font-bold text-slate-200">الوظيفة</span><select className="input w-full" value={editor.role} onChange={(e) => setEditor({ ...editor, role: e.target.value as RoleKey })}>{ROLES.map((r) => <option key={r.key} value={r.key}>{r.labelAr}</option>)}</select></label><label className="space-y-1 md:col-span-2"><span className="text-sm font-bold text-slate-200">الفرع</span><select className="input w-full" value={editor.branch} onChange={(e) => setEditor({ ...editor, branch: e.target.value })}><option value="">اختر الفرع</option>{[...BRANCHES, 'كل الفروع'].filter((v, i, a) => a.indexOf(v) === i).map((b) => <option key={b} value={b}>{b}</option>)}</select></label><label className="flex items-center justify-between rounded-xl border border-slate-800 p-3"><span className="font-bold text-slate-200">الموظف نشط</span><input type="checkbox" checked={editor.active} onChange={(e) => setEditor({ ...editor, active: e.target.checked, canLogin: e.target.checked ? editor.canLogin : false })} /></label><label className="flex items-center justify-between rounded-xl border border-slate-800 p-3"><span className="font-bold text-slate-200">مسموح بتسجيل الدخول</span><input type="checkbox" checked={editor.canLogin} disabled={!editor.active} onChange={(e) => setEditor({ ...editor, canLogin: e.target.checked })} /></label></div><div className="mt-6 flex gap-2"><button onClick={() => setEditor(null)} className="btn-secondary flex-1">إلغاء</button><button onClick={saveEditor} disabled={saving || !canEdit} className="btn-primary flex flex-1 items-center justify-center gap-2"><Save size={17} /> {saving ? 'جاري الحفظ…' : 'حفظ التعديلات'}</button></div></div></div>}

      {lastIssued && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-3"><div className="w-full max-w-md rounded-2xl border border-amber-400/30 bg-slate-950 p-6 text-center"><KeyRound className="mx-auto text-amber-300" size={36} /><h2 className="mt-3 text-xl font-black text-white">بيانات الدخول الجديدة</h2><p className="mt-2 text-sm text-slate-400">ستظهر الآن فقط. احفظها أو صدّرها قبل إغلاق الجلسة.</p><div className="mt-5 rounded-xl bg-slate-900 p-4 text-left" dir="ltr"><p className="font-mono text-lg text-teal-300">Username: {lastIssued.username}</p><p className="mt-2 font-mono text-2xl font-black text-amber-300">PIN: {lastIssued.pin}</p></div><button onClick={() => setLastIssued(null)} className="btn-primary mt-5 w-full">تم الحفظ</button></div></div>}
    </div>
  );
}
