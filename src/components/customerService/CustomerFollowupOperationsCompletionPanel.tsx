import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Merge,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  UserRoundCog,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';

const ALL_BRANCHES = 'كل الفروع';

type PerformanceRow = {
  responsible_name: string;
  branch: string;
  total_count: number;
  completed_count: number;
  open_count: number;
  no_answer_count: number;
  postponed_count: number;
  manager_count: number;
  invalid_phone_count: number;
  avg_close_hours: number | null;
};

type DuplicateGroup = {
  identity_key: string;
  branch: string;
  request_type: string;
  open_count: number;
  canonical_id: string;
  duplicate_ids: string[] | null;
  customer_name: string;
  customer_code: string;
  customer_phone: string;
  newest_at: string;
};

type AuditRow = {
  id: number;
  followup_id: string;
  customer_id: string | null;
  action: string;
  actor_name: string | null;
  branch: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

type CorrectionForm = {
  followupId: string;
  name: string;
  code: string;
  phone: string;
  branch: string;
  note: string;
};

const EMPTY_CORRECTION: CorrectionForm = {
  followupId: '',
  name: '',
  code: '',
  phone: '',
  branch: '',
  note: '',
};

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
}

function actionLabel(value: string) {
  const labels: Record<string, string> = {
    created: 'تم إنشاء المتابعة',
    updated: 'تم تعديل المتابعة',
    completed: 'تم إكمال المتابعة',
    cancelled: 'تم إلغاء المتابعة',
    archived: 'تمت أرشفة المتابعة',
    customer_data_corrected: 'تم تصحيح بيانات العميل',
  };
  return labels[value] || value;
}

function metric(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function CustomerFollowupOperationsCompletionPanel() {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '') || 'فرع الشامي';
  const [branch, setBranch] = useState(managerView ? ALL_BRANCHES : userBranch);
  const [day, setDay] = useState(todayKey());
  const [loading, setLoading] = useState(false);
  const [performance, setPerformance] = useState<PerformanceRow[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [correction, setCorrection] = useState<CorrectionForm>(EMPTY_CORRECTION);
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [mergingKey, setMergingKey] = useState('');

  const actorStaffId = String(user?.staffId || user?.id || '');
  const actorName = String(user?.name || 'مستخدم خدمة العملاء');
  const managerRoles = new Set([
    'customer_service_manager',
    'general_manager',
    'branch_manager',
    'branches_manager',
    'admin',
  ]);
  const canMerge = managerRoles.has(String(user?.role || ''));

  async function loadAll() {
    setLoading(true);
    try {
      const branchArg = branch === ALL_BRANCHES ? null : branch;
      const [performanceResult, duplicateResult, auditResult] = await Promise.all([
        supabase.rpc('customer_followup_daily_performance_v1', {
          p_branch: branchArg,
          p_day: day,
        }),
        supabase.rpc('list_open_followup_duplicate_groups_v1', { p_branch: branchArg }),
        supabase
          .from('customer_followup_audit_log')
          .select('id,followup_id,customer_id,action,actor_name,branch,created_at,metadata')
          .order('created_at', { ascending: false })
          .limit(100),
      ]);
      if (performanceResult.error) throw performanceResult.error;
      if (duplicateResult.error) throw duplicateResult.error;
      if (auditResult.error) throw auditResult.error;
      setPerformance((performanceResult.data || []) as PerformanceRow[]);
      setDuplicates((duplicateResult.data || []) as DuplicateGroup[]);
      setAuditRows((auditResult.data || []) as AuditRow[]);
    } catch (error) {
      toast.error(`تعذر تحميل لوحة التشغيل: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // The branch and day are the only intentional reload inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, day]);

  const totals = useMemo(
    () =>
      performance.reduce(
        (current, row) => ({
          total: current.total + metric(row.total_count),
          completed: current.completed + metric(row.completed_count),
          open: current.open + metric(row.open_count),
          manager: current.manager + metric(row.manager_count),
        }),
        { total: 0, completed: 0, open: 0, manager: 0 }
      ),
    [performance]
  );

  const filteredAudit = useMemo(() => {
    const query = auditSearch.trim().toLowerCase();
    if (!query) return auditRows;
    return auditRows.filter((row) =>
      `${row.followup_id} ${row.customer_id || ''} ${row.actor_name || ''} ${row.branch || ''} ${actionLabel(
        row.action
      )}`
        .toLowerCase()
        .includes(query)
    );
  }, [auditRows, auditSearch]);

  async function mergeDuplicates(group: DuplicateGroup) {
    if (!canMerge) {
      toast.error('دمج التكرارات متاح للمدير فقط');
      return;
    }
    const duplicateIds = group.duplicate_ids || [];
    if (!duplicateIds.length) return;
    if (
      !window.confirm(
        `سيتم الاحتفاظ بالمتابعة ${group.canonical_id} كأساسية وربط ${duplicateIds.length} متابعة مكررة بها. هل تريد المتابعة؟`
      )
    )
      return;
    setMergingKey(group.identity_key);
    try {
      const { data, error } = await supabase.rpc('merge_open_followup_duplicates_v1', {
        p_canonical_id: group.canonical_id,
        p_duplicate_ids: duplicateIds,
        p_actor_staff_id: actorStaffId,
        p_actor_name: actorName,
        p_reason: 'دمج يدوي من لوحة إدارة متابعات العملاء',
      });
      if (error) throw error;
      const mergedCount = Number((data as { merged_count?: number } | null)?.merged_count || 0);
      toast.success(`تم دمج ${mergedCount} متابعة مكررة مع المتابعة الأساسية`);
      await loadAll();
    } catch (error) {
      toast.error(`تعذر دمج التكرارات: ${(error as Error).message}`);
    } finally {
      setMergingKey('');
    }
  }

  async function saveCorrection() {
    if (!correction.followupId.trim()) {
      toast.error('اكتب معرف المتابعة المطلوب تصحيحها');
      return;
    }
    if (!correction.name.trim() && !correction.code.trim() && !correction.phone.trim() && !correction.branch) {
      toast.error('اكتب قيمة واحدة على الأقل للتصحيح');
      return;
    }
    setSavingCorrection(true);
    try {
      const { data, error } = await supabase.rpc('correct_customer_followup_data_v1', {
        p_followup_id: correction.followupId.trim(),
        p_customer_name: correction.name.trim() || null,
        p_customer_code: correction.code.trim() || null,
        p_customer_phone: correction.phone.trim() || null,
        p_branch: correction.branch || null,
        p_actor_staff_id: actorStaffId,
        p_actor_name: actorName,
        p_note: correction.note.trim() || 'تصحيح من لوحة خدمة العملاء',
      });
      if (error) throw error;
      const result = data as { followups_updated?: number; customers_updated?: number } | null;
      toast.success(
        `تم تصحيح ${Number(result?.followups_updated || 0)} متابعة وتحديث ${Number(
          result?.customers_updated || 0
        )} ملف عميل`
      );
      setCorrection(EMPTY_CORRECTION);
      await loadAll();
    } catch (error) {
      toast.error(`تعذر تصحيح البيانات: ${(error as Error).message}`);
    } finally {
      setSavingCorrection(false);
    }
  }

  return (
    <section className="mx-4 mt-4 space-y-4 rounded-3xl border border-cyan-400/20 bg-[#0d2238] p-4 shadow-xl" dir="rtl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xl font-black text-white">
            <ShieldCheck size={22} className="text-cyan-300" />
            مركز تشغيل ومراجعة متابعات العملاء
          </div>
          <p className="mt-1 text-sm font-bold text-slate-400">
            أداء اليوم، تصحيح بيانات العملاء، سجل التعديلات ودمج التكرارات تحت مراجعة الإدارة.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {managerView ? (
            <select className="input-dark" value={branch} onChange={(event) => setBranch(event.target.value)}>
              <option>{ALL_BRANCHES}</option>
              <option>فرع الشامي</option>
              <option>فرع شكري</option>
            </select>
          ) : (
            <div className="input-dark font-black text-cyan-100">{userBranch}</div>
          )}
          <input className="input-dark" type="date" value={day} onChange={(event) => setDay(event.target.value)} />
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void loadAll()} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            تحديث
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="إجمالي متابعات اليوم" value={totals.total} icon={Activity} />
        <Stat label="تم الانتهاء" value={totals.completed} icon={CheckCircle2} />
        <Stat label="مفتوحة الآن" value={totals.open} icon={ClipboardCheck} />
        <Stat label="تحتاج مديرًا" value={totals.manager} icon={AlertTriangle} />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-white/5 text-right text-xs font-black text-slate-300">
            <tr>
              <th className="p-3">المسؤول</th>
              <th className="p-3">الفرع</th>
              <th className="p-3">الإجمالي</th>
              <th className="p-3">مكتمل</th>
              <th className="p-3">مفتوح</th>
              <th className="p-3">لم يرد</th>
              <th className="p-3">مؤجل</th>
              <th className="p-3">يحتاج مدير</th>
              <th className="p-3">متوسط الإغلاق</th>
            </tr>
          </thead>
          <tbody>
            {performance.map((row) => (
              <tr key={`${row.responsible_name}-${row.branch}`} className="border-t border-white/5 text-slate-100">
                <td className="p-3 font-black">{row.responsible_name}</td>
                <td className="p-3">{row.branch}</td>
                <td className="p-3">{metric(row.total_count)}</td>
                <td className="p-3 text-emerald-300">{metric(row.completed_count)}</td>
                <td className="p-3 text-amber-300">{metric(row.open_count)}</td>
                <td className="p-3">{metric(row.no_answer_count)}</td>
                <td className="p-3">{metric(row.postponed_count)}</td>
                <td className="p-3 text-red-300">{metric(row.manager_count)}</td>
                <td className="p-3">{row.avg_close_hours == null ? 'غير متاح' : `${row.avg_close_hours} س`}</td>
              </tr>
            ))}
            {!loading && performance.length === 0 ? (
              <tr><td colSpan={9} className="p-6 text-center font-bold text-slate-400">لا توجد بيانات في اليوم المحدد</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center gap-2 text-lg font-black text-white">
            <UserRoundCog size={19} className="text-cyan-300" />
            تصحيح بيانات العميل
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="input-dark sm:col-span-2" placeholder="معرف المتابعة" value={correction.followupId} onChange={(event) => setCorrection((current) => ({ ...current, followupId: event.target.value }))} />
            <input className="input-dark" placeholder="الاسم المصحح" value={correction.name} onChange={(event) => setCorrection((current) => ({ ...current, name: event.target.value }))} />
            <input className="input-dark" placeholder="الكود المصحح" value={correction.code} onChange={(event) => setCorrection((current) => ({ ...current, code: event.target.value }))} />
            <input className="input-dark" placeholder="الهاتف المصحح" value={correction.phone} onChange={(event) => setCorrection((current) => ({ ...current, phone: event.target.value }))} />
            <select className="input-dark" value={correction.branch} onChange={(event) => setCorrection((current) => ({ ...current, branch: event.target.value }))}>
              <option value="">بدون تغيير الفرع</option>
              <option>فرع الشامي</option>
              <option>فرع شكري</option>
            </select>
            <textarea className="input-dark min-h-24 sm:col-span-2" placeholder="ملاحظات التصحيح" value={correction.note} onChange={(event) => setCorrection((current) => ({ ...current, note: event.target.value }))} />
            <button type="button" className="btn-primary flex items-center justify-center gap-2 sm:col-span-2" onClick={() => void saveCorrection()} disabled={savingCorrection}>
              {savingCorrection ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
              حفظ التصحيح وتحديث المتابعات المفتوحة
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-lg font-black text-white">
              <Merge size={19} className="text-amber-300" />
              التكرارات المفتوحة
            </div>
            <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-black text-amber-200">{duplicates.length} مجموعة</span>
          </div>
          <div className="max-h-96 space-y-2 overflow-auto">
            {duplicates.map((group) => (
              <div key={`${group.identity_key}-${group.branch}-${group.request_type}`} className="rounded-xl border border-white/10 bg-[#102b46] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-black text-white">{group.customer_name || 'عميل غير مسجل'}</div>
                    <div className="mt-1 text-xs font-bold text-slate-400">{group.customer_code || 'بدون كود'} · {group.customer_phone || 'بدون هاتف'} · {group.branch}</div>
                    <div className="mt-1 text-xs font-bold text-amber-200">{group.open_count} متابعات مفتوحة · الأساسية {group.canonical_id}</div>
                  </div>
                  <button type="button" className="btn-secondary text-xs" disabled={!canMerge || mergingKey === group.identity_key} onClick={() => void mergeDuplicates(group)}>
                    {mergingKey === group.identity_key ? 'جارٍ الدمج' : 'مراجعة ودمج'}
                  </button>
                </div>
              </div>
            ))}
            {!loading && duplicates.length === 0 ? <div className="p-6 text-center font-bold text-emerald-300">لا توجد تكرارات مفتوحة حاليًا</div> : null}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-lg font-black text-white">
            <ClipboardCheck size={19} className="text-teal-300" />
            آخر تعديلات المتابعات
          </div>
          <div className="relative">
            <Search size={15} className="absolute right-3 top-3 text-slate-400" />
            <input className="input-dark pr-9" placeholder="بحث في السجل" value={auditSearch} onChange={(event) => setAuditSearch(event.target.value)} />
          </div>
        </div>
        <div className="max-h-96 overflow-auto rounded-xl border border-white/5">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-[#112a44] text-right text-xs font-black text-slate-300">
              <tr><th className="p-3">الوقت</th><th className="p-3">الإجراء</th><th className="p-3">المتابعة</th><th className="p-3">المنفذ</th><th className="p-3">الفرع</th></tr>
            </thead>
            <tbody>
              {filteredAudit.map((row) => (
                <tr key={row.id} className="border-t border-white/5 text-slate-100">
                  <td className="p-3 whitespace-nowrap">{new Date(row.created_at).toLocaleString('ar-EG')}</td>
                  <td className="p-3 font-black">{actionLabel(row.action)}</td>
                  <td className="p-3 font-mono text-xs">{row.followup_id}</td>
                  <td className="p-3">{row.actor_name || 'غير محدد'}</td>
                  <td className="p-3">{row.branch || 'غير محدد'}</td>
                </tr>
              ))}
              {!loading && filteredAudit.length === 0 ? <tr><td colSpan={5} className="p-6 text-center font-bold text-slate-400">لا توجد تعديلات مطابقة</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Activity }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-black text-slate-400">{label}</div>
        <Icon size={18} className="text-cyan-300" />
      </div>
      <div className="mt-2 text-3xl font-black text-white">{value.toLocaleString('ar-EG')}</div>
    </div>
  );
}
