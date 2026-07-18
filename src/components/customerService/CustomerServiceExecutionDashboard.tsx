import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, ShieldAlert, TimerReset } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import {
  fetchCustomerServiceExecutionMetrics,
  fetchCustomerServiceQualityIssues,
  recordCustomerServiceEscalation,
  type CustomerServiceExecutionMetric,
  type CustomerServiceQualityIssue,
} from '@/lib/customerServiceExecutionAnalytics';

const ISSUE_LABELS: Record<string, string> = {
  missing_customer_name: 'اسم العميل غير موجود',
  missing_customer_identity: 'لا يوجد كود أو هاتف',
  missing_followup_link: 'منفذ بدون ربط بمتابعة',
  scheduled_without_date: 'مؤجل بدون موعد قادم',
  completed_without_time: 'مكتمل بدون وقت إغلاق',
  stale_open_item: 'حالة مفتوحة من يوم سابق',
};

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function cycleStartKey() {
  const now = new Date();
  const start = now.getDate() >= 26
    ? new Date(now.getFullYear(), now.getMonth(), 26)
    : new Date(now.getFullYear(), now.getMonth() - 1, 26);
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
}

function minutes(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value < 60) return `${Math.round(value)} دقيقة`;
  return `${Math.floor(value / 60)} س ${Math.round(value % 60)} د`;
}

export default function CustomerServiceExecutionDashboard({ branch }: { branch: string }) {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<CustomerServiceExecutionMetric[]>([]);
  const [issues, setIssues] = useState<CustomerServiceQualityIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [issueFilter, setIssueFilter] = useState('all');

  async function load() {
    setLoading(true);
    try {
      const [metricRows, issueRows] = await Promise.all([
        fetchCustomerServiceExecutionMetrics(cycleStartKey(), todayKey(), branch),
        fetchCustomerServiceQualityIssues(branch, 500),
      ]);
      setMetrics(metricRows);
      setIssues(issueRows);
    } catch (error) {
      toast.error((error as Error).message || 'تعذر تحميل تحليلات التنفيذ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [branch]);

  const today = metrics.find((row) => row.queue_date === todayKey()) || null;
  const summary = useMemo(() => {
    const total = metrics.reduce((sum, row) => sum + Number(row.total_count || 0), 0);
    const completed = metrics.reduce((sum, row) => sum + Number(row.completed_count || 0), 0);
    const firstAttemptRows = metrics.filter((row) => row.avg_first_attempt_minutes != null);
    const completionRows = metrics.filter((row) => row.avg_completion_minutes != null);
    return {
      total,
      completed,
      rate: total ? Math.round((completed / total) * 100) : 0,
      avgFirstAttempt: firstAttemptRows.length
        ? firstAttemptRows.reduce((sum, row) => sum + Number(row.avg_first_attempt_minutes || 0), 0) / firstAttemptRows.length
        : null,
      avgCompletion: completionRows.length
        ? completionRows.reduce((sum, row) => sum + Number(row.avg_completion_minutes || 0), 0) / completionRows.length
        : null,
    };
  }, [metrics]);

  const issueTypes = [...new Set(issues.map((row) => row.issue_type))];
  const visibleIssues = issues.filter((row) => issueFilter === 'all' || row.issue_type === issueFilter);

  async function escalate() {
    if (!today) return;
    const remaining = Math.max(0, Number(today.remaining_count || 0));
    const critical = Number(today.needs_manager_count || 0) > 0 || remaining >= 10;
    try {
      const saved = await recordCustomerServiceEscalation({
        branch,
        alertKey: critical ? 'manual_critical_review' : 'manual_progress_review',
        alertLevel: critical ? 'critical' : 'warning',
        alertType: 'manual_manager_escalation',
        title: critical ? 'تصعيد عاجل لقائمة خدمة العملاء' : 'مراجعة تقدم قائمة خدمة العملاء',
        message: `الفرع: ${branch} — مكتمل ${today.completed_count} من ${today.total_count}، متبقي ${remaining}، يحتاج مدير ${today.needs_manager_count}.`,
        total: today.total_count,
        completed: today.completed_count,
        needsManager: today.needs_manager_count,
        metadata: { triggered_by: user?.staff_id || user?.id || null, triggered_by_name: user?.name || null },
      });
      toast.success(saved ? 'تم تسجيل التصعيد وإرساله للمراجعة' : 'سجل التصعيد غير جاهز؛ شغّل الـSQL أولًا');
    } catch (error) {
      toast.error((error as Error).message || 'تعذر تسجيل التصعيد');
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-[#10243d] p-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="text-xs font-black text-teal-300">مراقبة التنفيذ والجودة</div>
          <h2 className="mt-1 text-2xl font-black text-white">تحليل خدمة العملاء — {branch}</h2>
          <p className="mt-1 text-sm font-bold text-slate-400">الدورة الحالية من يوم 26، مع زمن الاستجابة والإغلاق ومشاكل جودة البيانات.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary flex items-center gap-2" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث التحليل</button>
          <button className="btn-primary flex items-center gap-2" onClick={() => void escalate()} disabled={!today}><ShieldAlert size={16} /> تصعيد للمدير</button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="قائمة اليوم" value={today?.total_count ?? 0} icon={Clock3} />
        <Metric label="مكتمل اليوم" value={today?.completed_count ?? 0} icon={CheckCircle2} />
        <Metric label="متبقي اليوم" value={today?.remaining_count ?? 0} icon={AlertTriangle} danger={Boolean(today?.remaining_count)} />
        <Metric label="يحتاج مدير" value={today?.needs_manager_count ?? 0} icon={ShieldAlert} danger={Boolean(today?.needs_manager_count)} />
        <TextMetric label="متوسط أول محاولة" value={minutes(summary.avgFirstAttempt)} icon={TimerReset} />
        <TextMetric label="متوسط الإغلاق" value={minutes(summary.avgCompletion)} icon={Clock3} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
        <div className="stat-card">
          <div className="flex items-center justify-between gap-3"><div><h3 className="text-xl font-black text-white">أداء الدورة الحالية</h3><p className="text-sm font-bold text-slate-400">{summary.completed} مكتمل من {summary.total}</p></div><div className="text-3xl font-black text-teal-200">{summary.rate}%</div></div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-teal-400" style={{ width: `${summary.rate}%` }} /></div>
          <div className="mt-5 max-h-[360px] overflow-auto rounded-2xl border border-white/10">
            <table className="w-full min-w-[620px] text-sm"><thead className="bg-[#173252] text-slate-300"><tr><th className="p-3 text-right">اليوم</th><th className="p-3 text-right">القائمة</th><th className="p-3 text-right">مكتمل</th><th className="p-3 text-right">متبقي</th><th className="p-3 text-right">أول محاولة</th><th className="p-3 text-right">الإغلاق</th></tr></thead><tbody>{metrics.map((row) => <tr key={`${row.queue_date}-${row.branch}`} className="border-t border-white/5 text-slate-200"><td className="p-3">{new Date(`${row.queue_date}T12:00:00`).toLocaleDateString('ar-EG')}</td><td className="p-3">{row.total_count}</td><td className="p-3">{row.completed_count}</td><td className="p-3">{row.remaining_count}</td><td className="p-3">{minutes(row.avg_first_attempt_minutes)}</td><td className="p-3">{minutes(row.avg_completion_minutes)}</td></tr>)}</tbody></table>
            {!metrics.length && <div className="p-6 text-center text-sm font-bold text-slate-400">لا توجد تحليلات بعد. شغّل SQL التحليلات ثم افتح قائمة اليوم.</div>}
          </div>
        </div>

        <div className="stat-card">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-xl font-black text-white">مراقبة جودة البيانات</h3><p className="text-sm font-bold text-slate-400">{visibleIssues.length} مشكلة تحتاج مراجعة</p></div><select className="input-dark" value={issueFilter} onChange={(event) => setIssueFilter(event.target.value)}><option value="all">كل المشكلات</option>{issueTypes.map((type) => <option key={type} value={type}>{ISSUE_LABELS[type] || type}</option>)}</select></div>
          <div className="max-h-[420px] space-y-2 overflow-auto pl-1">{visibleIssues.map((issue) => <div key={issue.id} className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3"><div className="flex items-start justify-between gap-3"><div><div className="font-black text-amber-100">{issue.customer_name || 'عميل بدون اسم'}</div><div className="mt-1 text-xs font-bold text-amber-200/70">{issue.customer_code || 'بدون كود'} · {issue.customer_phone || 'بدون هاتف'} · {new Date(`${issue.queue_date}T12:00:00`).toLocaleDateString('ar-EG')}</div></div><span className="rounded-lg bg-amber-400/15 px-2 py-1 text-xs font-black text-amber-100">{ISSUE_LABELS[issue.issue_type] || issue.issue_type}</span></div></div>)}{!visibleIssues.length && <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-6 text-center font-black text-emerald-100">لا توجد مشكلات مطابقة للفلاتر الحالية.</div>}</div>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value, icon: Icon, danger = false }: { label: string; value: number; icon: typeof Clock3; danger?: boolean }) {
  return <div className={`stat-card ${danger ? 'border-red-400/25 bg-red-500/10' : ''}`}><Icon size={18} className={danger ? 'text-red-300' : 'text-teal-300'} /><div className="mt-3 text-3xl font-black text-white">{value}</div><div className="mt-1 text-xs font-bold text-slate-400">{label}</div></div>;
}

function TextMetric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Clock3 }) {
  return <div className="stat-card"><Icon size={18} className="text-teal-300" /><div className="mt-3 text-xl font-black text-white">{value}</div><div className="mt-1 text-xs font-bold text-slate-400">{label}</div></div>;
}
