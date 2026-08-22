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
import {
  correctCustomerFollowupData,
  loadFollowupOperationsSnapshot,
  mergeOpenFollowupDuplicates,
  type FollowupAuditRow,
  type FollowupDuplicateGroup,
  type FollowupPerformanceRow,
} from '@/lib/customerService/followupOperationsService';

const ALL_BRANCHES = 'كل الفروع';

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
  const [performance, setPerformance] = useState<FollowupPerformanceRow[]>([]);
  const [duplicates, setDuplicates] = useState<FollowupDuplicateGroup[]>([]);
  const [auditRows, setAuditRows] = useState<FollowupAuditRow[]>([]);
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
      const snapshot = await loadFollowupOperationsSnapshot({
        branch: branch === ALL_BRANCHES ? null : branch,
        day,
      });
      setPerformance(snapshot.performance);
      setDuplicates(snapshot.duplicates);
      setAuditRows(snapshot.auditRows);
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

  async function mergeDuplicates(group: FollowupDuplicateGroup) {
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
      const mergedCount = await mergeOpenFollowupDuplicates({
        canonicalId: group.canonical_id,
        duplicateIds,
        actorStaffId,
        actorName,
      });
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
      const result = await correctCustomerFollowupData({
        followupId: correction.followupId.trim(),
        customerName: correction.name.trim() || null,
        customerCode: correction.code.trim() || null,
        customerPhone: correction.phone.trim() || null,
        branch: correction.branch || null,
        actorStaffId,
        actorName,
        note: correction.note.trim() || 'تصحيح من لوحة خدمة العملاء',
      });
      toast.success(
        `تم تصحيح ${result.followupsUpdated} متابعة وتحديث ${result.customersUpdated} ملف عميل`
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
    <section className="space-y-4 rounded-3xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] p-4 shadow-xl" dir="rtl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xl font-black text-[var(--dawaa-theme-heading)]">
            <ShieldCheck size={22} className="text-[var(--dawaa-theme-primary)]" />
            مركز تشغيل ومراجعة متابعات العملاء
          </div>
          <p className="mt-1 text-sm font-bold text-[var(--dawaa-theme-muted)]">
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
            <div className="input-dark font-black text-[var(--dawaa-theme-primary)]">{userBranch}</div>
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

      <div className="overflow-x-auto rounded-2xl border border-[var(--dawaa-theme-border)]">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--dawaa-theme-surface-2)] text-right text-xs font-black text-[var(--dawaa-theme-muted)]">
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
              <tr key={`${row.responsible_name}-${row.branch}`} className="border-t border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]">
                <td className="p-3 font-black">{row.responsible_name}</td>
                <td className="p-3">{row.branch}</td>
                <td className="p-3">{metric(row.total_count)}</td>
                <td className="p-3 text-[var(--dawaa-status-success-text)]">{metric(row.completed_count)}</td>
                <td className="p-3 text-[var(--dawaa-status-warning-text)]">{metric(row.open_count)}</td>
                <td className="p-3">{metric(row.no_answer_count)}</td>
                <td className="p-3">{metric(row.postponed_count)}</td>
                <td className="p-3 text-[var(--dawaa-status-danger-text)]">{metric(row.manager_count)}</td>
                <td className="p-3">{row.avg_close_hours == null ? 'غير متاح' : `${row.avg_close_hours} س`}</td>
              </tr>
            ))}
            {!loading && performance.length === 0 ? (
              <tr><td colSpan={9} className="p-6 text-center font-bold text-[var(--dawaa-theme-muted)]">لا توجد بيانات في اليوم المحدد</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)]/[0.03] p-4">
          <div className="mb-3 flex items-center gap-2 text-lg font-black text-[var(--dawaa-theme-heading)]">
            <UserRoundCog size={19} className="text-[var(--dawaa-theme-primary)]" />
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

        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)]/[0.03] p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-lg font-black text-[var(--dawaa-theme-heading)]">
              <Merge size={19} className="text-[var(--dawaa-status-warning-text)]" />
              التكرارات المفتوحة
            </div>
            <span className="rounded-full bg-[var(--dawaa-status-warning-bg)] px-3 py-1 text-xs font-black text-[var(--dawaa-status-warning-text)]">{duplicates.length} مجموعة</span>
          </div>
          <div className="max-h-96 space-y-2 overflow-auto">
            {duplicates.map((group) => (
              <div key={`${group.identity_key}-${group.branch}-${group.request_type}`} className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-black text-[var(--dawaa-theme-heading)]">{group.customer_name || 'عميل غير مسجل'}</div>
                    <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">{group.customer_code || 'بدون كود'} · {group.customer_phone || 'بدون هاتف'} · {group.branch}</div>
                    <div className="mt-1 text-xs font-bold text-[var(--dawaa-status-warning-text)]">{group.open_count} متابعات مفتوحة · الأساسية {group.canonical_id}</div>
                  </div>
                  <button type="button" className="btn-secondary text-xs" disabled={!canMerge || mergingKey === group.identity_key} onClick={() => void mergeDuplicates(group)}>
                    {mergingKey === group.identity_key ? 'جارٍ الدمج' : 'مراجعة ودمج'}
                  </button>
                </div>
              </div>
            ))}
            {!loading && duplicates.length === 0 ? <div className="p-6 text-center font-bold text-[var(--dawaa-status-success-text)]">لا توجد تكرارات مفتوحة حاليًا</div> : null}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)]/[0.03] p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-lg font-black text-[var(--dawaa-theme-heading)]">
            <ClipboardCheck size={19} className="text-[var(--dawaa-theme-primary)]" />
            آخر تعديلات المتابعات
          </div>
          <div className="relative">
            <Search size={15} className="absolute right-3 top-3 text-[var(--dawaa-theme-muted)]" />
            <input className="input-dark pr-9" placeholder="بحث في السجل" value={auditSearch} onChange={(event) => setAuditSearch(event.target.value)} />
          </div>
        </div>
        <div className="max-h-96 overflow-auto rounded-xl border border-[var(--dawaa-theme-border)]">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-[var(--dawaa-theme-surface)] text-right text-xs font-black text-[var(--dawaa-theme-muted)]">
              <tr><th className="p-3">الوقت</th><th className="p-3">الإجراء</th><th className="p-3">المتابعة</th><th className="p-3">المنفذ</th><th className="p-3">الفرع</th></tr>
            </thead>
            <tbody>
              {filteredAudit.map((row) => (
                <tr key={row.id} className="border-t border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]">
                  <td className="p-3 whitespace-nowrap">{new Date(row.created_at).toLocaleString('ar-EG')}</td>
                  <td className="p-3 font-black">{actionLabel(row.action)}</td>
                  <td className="p-3 font-mono text-xs">{row.followup_id}</td>
                  <td className="p-3">{row.actor_name || 'غير محدد'}</td>
                  <td className="p-3">{row.branch || 'غير محدد'}</td>
                </tr>
              ))}
              {!loading && filteredAudit.length === 0 ? <tr><td colSpan={5} className="p-6 text-center font-bold text-[var(--dawaa-theme-muted)]">لا توجد تعديلات مطابقة</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Activity }) {
  return (
    <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)]/[0.04] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-black text-[var(--dawaa-theme-muted)]">{label}</div>
        <Icon size={18} className="text-[var(--dawaa-theme-primary)]" />
      </div>
      <div className="mt-2 text-3xl font-black text-[var(--dawaa-theme-heading)]">{value.toLocaleString('ar-EG')}</div>
    </div>
  );
}
