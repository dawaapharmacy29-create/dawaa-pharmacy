import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  PhoneOff,
  RefreshCw,
  ShieldCheck,
  UserRoundX,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { normalizeBranchName } from '@/lib/branch';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { supabase } from '@/lib/supabase';

const ALL_BRANCHES = 'كل الفروع';

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
}

type QualitySummary = {
  open: number;
  missingCode: number;
  missingPhone: number;
  needsManager: number;
};

type AuditRow = {
  id: number;
  followup_id: string;
  action: string;
  actor_name: string | null;
  branch: string | null;
  created_at: string;
};

const EMPTY_SUMMARY: QualitySummary = {
  open: 0,
  missingCode: 0,
  missingPhone: 0,
  needsManager: 0,
};

function validEgyptPhone(value: unknown) {
  const digits = String(value || '').replace(/\D/g, '').replace(/^20(?=1\d{9}$)/, '');
  return /^01[0125]\d{8}$/.test(digits);
}

function actionLabel(value: string) {
  const labels: Record<string, string> = {
    created: 'إنشاء متابعة',
    updated: 'تعديل متابعة',
    completed: 'إكمال متابعة',
    cancelled: 'إلغاء متابعة',
    archived: 'أرشفة متابعة',
    customer_data_corrected: 'تصحيح بيانات عميل',
  };
  return labels[value] || value;
}

export default function CustomerFollowupFinalQualityPanel() {
  const { user } = useAuth();
  const managerView = canViewAllBranches(user);
  const userBranch = normalizeBranchName(user?.branch || '');
  const [branch, setBranch] = useState(managerView ? ALL_BRANCHES : userBranch);
  const [day, setDay] = useState(todayKey());
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<QualitySummary>(EMPTY_SUMMARY);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);

  const branchArg = branch === ALL_BRANCHES ? null : normalizeBranchName(branch);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let followupsQuery = supabase
        .from('daily_followups')
        .select(
          'id,customer_code,customer_phone,phone,needs_manager,status,followup_status,completed_at,cancelled_at,is_hidden,branch',
          { count: 'exact' }
        )
        .eq('is_hidden', false)
        .is('cancelled_at', null)
        .is('completed_at', null)
        .limit(2000);
      if (branchArg) followupsQuery = followupsQuery.eq('branch', branchArg);

      const dayStart = `${day}T00:00:00`;
      const nextDay = new Date(`${day}T00:00:00`);
      nextDay.setDate(nextDay.getDate() + 1);
      let auditQuery = supabase
        .from('customer_followup_audit_log')
        .select('id,followup_id,action,actor_name,branch,created_at')
        .gte('created_at', dayStart)
        .lt('created_at', nextDay.toISOString())
        .order('created_at', { ascending: false })
        .limit(60);
      if (branchArg) auditQuery = auditQuery.eq('branch', branchArg);

      const [followupsResult, auditResult] = await Promise.all([followupsQuery, auditQuery]);
      if (followupsResult.error) throw followupsResult.error;
      if (auditResult.error) throw auditResult.error;

      const rows = (followupsResult.data || []) as Array<{
        customer_code?: string | null;
        customer_phone?: string | null;
        phone?: string | null;
        needs_manager?: boolean | null;
        status?: string | null;
        followup_status?: string | null;
      }>;
      const openRows = rows.filter((row) => {
        const status = String(row.followup_status || row.status || '').trim();
        return !['تم', 'completed', 'تم التواصل', 'ملغي', 'merged_duplicate', 'duplicate_archived'].includes(
          status
        );
      });
      setSummary({
        open: openRows.length,
        missingCode: openRows.filter((row) => !String(row.customer_code || '').trim()).length,
        missingPhone: openRows.filter(
          (row) => !validEgyptPhone(row.customer_phone) && !validEgyptPhone(row.phone)
        ).length,
        needsManager: openRows.filter(
          (row) =>
            Boolean(row.needs_manager) ||
            /يحتاج.*مدير|needs_manager/i.test(`${row.status || ''} ${row.followup_status || ''}`)
        ).length,
      });
      setAuditRows((auditResult.data || []) as AuditRow[]);
    } catch (error) {
      toast.error(`تعذر تحميل المراجعة النهائية: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [branchArg, day]);

  useEffect(() => {
    void load();
  }, [load]);

  const qualityState = useMemo(() => {
    const totalIssues = summary.missingCode + summary.missingPhone;
    if (!totalIssues) return { label: 'جودة البيانات مستقرة', tone: 'text-emerald-300', icon: CheckCircle2 };
    return {
      label: `${totalIssues.toLocaleString('ar-EG')} متابعة تحتاج مراجعة بيانات`,
      tone: 'text-amber-300',
      icon: AlertTriangle,
    };
  }, [summary.missingCode, summary.missingPhone]);

  const QualityIcon = qualityState.icon;

  return (
    <section className="mx-4 mt-4 space-y-4 rounded-3xl border border-cyan-400/20 bg-[#0d2238] p-4 shadow-xl" dir="rtl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xl font-black text-white">
            <ShieldCheck size={22} className="text-cyan-300" />
            المراجعة النهائية لجودة قائمة المتابعات
          </div>
          <p className="mt-1 text-sm font-bold text-slate-400">
            أرقام حية من المتابعات المفتوحة وسجل التعديلات بعد تطبيق الفرع والتاريخ المختارين.
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
          <button type="button" className="btn-secondary flex items-center gap-2" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            تحديث
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="مفتوحة الآن" value={summary.open} icon={ClipboardCheck} />
        <MetricCard label="بدون كود" value={summary.missingCode} icon={UserRoundX} warning={summary.missingCode > 0} />
        <MetricCard label="بدون هاتف صالح" value={summary.missingPhone} icon={PhoneOff} warning={summary.missingPhone > 0} />
        <MetricCard label="تحتاج مديرًا" value={summary.needsManager} icon={AlertTriangle} warning={summary.needsManager > 0} />
      </div>

      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
        <QualityIcon size={19} className={qualityState.tone} />
        <span className={`font-black ${qualityState.tone}`}>{qualityState.label}</span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10">
        <div className="border-b border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black text-white">
          آخر تعديلات اليوم بعد فلتر الفرع
        </div>
        <div className="max-h-80 overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-[#102a44] text-right text-xs font-black text-slate-300">
              <tr>
                <th className="p-3">الوقت</th>
                <th className="p-3">الإجراء</th>
                <th className="p-3">المتابعة</th>
                <th className="p-3">المنفذ</th>
                <th className="p-3">الفرع</th>
              </tr>
            </thead>
            <tbody>
              {auditRows.map((row) => (
                <tr key={row.id} className="border-t border-white/5 text-slate-100">
                  <td className="whitespace-nowrap p-3">{new Date(row.created_at).toLocaleTimeString('ar-EG')}</td>
                  <td className="p-3 font-black">{actionLabel(row.action)}</td>
                  <td className="p-3 font-mono text-xs">{row.followup_id}</td>
                  <td className="p-3">{row.actor_name || 'غير محدد'}</td>
                  <td className="p-3">{row.branch || 'غير محدد'}</td>
                </tr>
              ))}
              {!loading && auditRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center font-bold text-slate-400">
                    لا توجد تعديلات في التاريخ والفرع المحددين
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  warning = false,
}: {
  label: string;
  value: number;
  icon: typeof ClipboardCheck;
  warning?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-black text-slate-400">{label}</span>
        <Icon size={18} className={warning ? 'text-amber-300' : 'text-cyan-300'} />
      </div>
      <div className={`mt-2 text-3xl font-black ${warning ? 'text-amber-200' : 'text-white'}`}>
        {value.toLocaleString('ar-EG')}
      </div>
    </div>
  );
}
