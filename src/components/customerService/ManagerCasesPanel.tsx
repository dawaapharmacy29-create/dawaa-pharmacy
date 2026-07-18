import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import {
  listManagerCases,
  updateManagerCase,
  type CustomerServiceManagerCase,
  type ManagerCaseStatus,
} from '@/lib/customerServiceManagerCases';

const STATUS_LABELS: Record<ManagerCaseStatus, string> = {
  open: 'مفتوحة',
  accepted: 'تم الاستلام',
  returned: 'أعيدت للمسؤول',
  in_progress: 'جارٍ الحل',
  resolved: 'تم الحل',
  closed: 'مغلقة',
};

const SEVERITY_LABELS: Record<string, string> = {
  low: 'منخفضة', medium: 'متوسطة', high: 'مرتفعة', critical: 'حرجة',
};

export default function ManagerCasesPanel({ branch }: { branch: string }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<CustomerServiceManagerCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<ManagerCaseStatus | 'all'>('all');
  const [selected, setSelected] = useState<CustomerServiceManagerCase | null>(null);
  const [decision, setDecision] = useState('');
  const [resolution, setResolution] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [compensationType, setCompensationType] = useState('');
  const [compensationAmount, setCompensationAmount] = useState('0');
  const [satisfaction, setSatisfaction] = useState('');

  async function load() {
    setLoading(true);
    try {
      const data = await listManagerCases(branch, status);
      setRows(data);
      setSelected((current) => current ? data.find((row) => row.id === current.id) || null : data[0] || null);
    } catch (error) {
      toast.error(`تعذر تحميل حالات المدير: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [branch, status]);

  const summary = useMemo(() => ({
    open: rows.filter((row) => row.status === 'open').length,
    active: rows.filter((row) => ['accepted', 'in_progress', 'returned'].includes(row.status)).length,
    critical: rows.filter((row) => row.severity === 'critical' && !['resolved', 'closed'].includes(row.status)).length,
    overdue: rows.filter((row) => row.due_at && new Date(row.due_at).getTime() < Date.now() && !['resolved', 'closed'].includes(row.status)).length,
  }), [rows]);

  async function save(nextStatus: ManagerCaseStatus) {
    if (!selected) return;
    if ((nextStatus === 'resolved' || nextStatus === 'closed') && !resolution.trim()) {
      toast.error('اكتب تفاصيل الحل قبل إغلاق الحالة');
      return;
    }
    try {
      await updateManagerCase({
        id: selected.id,
        status: nextStatus,
        managerDecision: decision,
        resolutionNotes: resolution,
        rootCause,
        compensationType,
        compensationAmount: Number(compensationAmount || 0),
        customerSatisfactionAfter: satisfaction,
        actorStaffId: (user as { staff_id?: string })?.staff_id || user?.id || null,
        actorName: user?.name || null,
      });
      toast.success(nextStatus === 'resolved' || nextStatus === 'closed' ? 'تم حفظ الحل وإغلاق الحالة' : 'تم حفظ قرار المدير');
      setDecision(''); setResolution(''); setRootCause(''); setCompensationType(''); setCompensationAmount('0'); setSatisfaction('');
      await load();
    } catch (error) {
      toast.error(`تعذر حفظ القرار: ${(error as Error).message}`);
    }
  }

  return <section className="space-y-4" dir="rtl">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card icon={ShieldAlert} label="مفتوحة" value={summary.open} />
      <Card icon={Clock3} label="قيد المعالجة" value={summary.active} />
      <Card icon={AlertTriangle} label="حرجة" value={summary.critical} />
      <Card icon={AlertTriangle} label="متأخرة" value={summary.overdue} />
    </div>

    <div className="stat-card">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div><h2 className="text-2xl font-black text-white">مركز تدخل المدير والشكاوى</h2><p className="text-sm font-bold text-slate-400">استلام الحالة، تسجيل القرار، السبب الجذري، التعويض ورضا العميل بعد الحل.</p></div>
        <div className="flex gap-2"><select className="input-dark" value={status} onChange={(event) => setStatus(event.target.value as ManagerCaseStatus | 'all')}><option value="all">كل الحالات</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="btn-secondary flex items-center gap-2" onClick={() => void load()}><RefreshCw size={16} /> تحديث</button></div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(300px,.8fr)_minmax(0,1.2fr)]">
        <div className="max-h-[650px] space-y-2 overflow-y-auto">{loading ? <Empty text="جاري تحميل الحالات..." /> : rows.map((row) => <button key={row.id} onClick={() => setSelected(row)} className={`w-full rounded-2xl border p-3 text-right ${selected?.id === row.id ? 'border-amber-300/50 bg-amber-500/15' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}><div className="flex items-start justify-between gap-2"><div><div className="font-black text-white">{row.customer_name}</div><div className="text-xs text-slate-400">{row.customer_code || 'بدون كود'} · {row.branch}</div></div><span className="rounded-lg bg-white/10 px-2 py-1 text-xs font-black text-amber-100">{SEVERITY_LABELS[row.severity]}</span></div><div className="mt-2 text-xs font-bold text-slate-300">{row.escalation_reason}</div><div className="mt-2 text-xs text-slate-500">{STATUS_LABELS[row.status]} · {new Date(row.created_at).toLocaleString('ar-EG')}</div></button>)}{!loading && !rows.length && <Empty text="لا توجد حالات تدخل مدير في الفلتر الحالي." />}</div>

        <div className="stat-card min-h-[500px]">{selected ? <div className="space-y-4"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-2xl font-black text-white">{selected.customer_name}</h3><span className="rounded-lg bg-amber-500/15 px-2 py-1 text-xs font-black text-amber-100">{STATUS_LABELS[selected.status]}</span><span className="rounded-lg bg-red-500/15 px-2 py-1 text-xs font-black text-red-100">{SEVERITY_LABELS[selected.severity]}</span></div><p className="mt-1 text-sm text-slate-400">{selected.customer_code || 'بدون كود'} · {selected.customer_phone || 'بدون هاتف'} · {selected.branch}</p></div><Info label="سبب التصعيد" value={selected.escalation_reason} /><div className="grid gap-3 sm:grid-cols-2"><Info label="نوع الحالة" value={selected.case_type} /><Info label="تصنيف الشكوى" value={selected.complaint_category || 'غير محدد'} /><Info label="الأثر على العميل" value={selected.customer_impact || 'غير مسجل'} /><Info label="الإجراء المطلوب" value={selected.requested_action || 'غير محدد'} /></div><textarea className="input-dark min-h-24" placeholder="قرار المدير" value={decision} onChange={(event) => setDecision(event.target.value)} /><textarea className="input-dark min-h-24" placeholder="تفاصيل الحل" value={resolution} onChange={(event) => setResolution(event.target.value)} /><textarea className="input-dark min-h-20" placeholder="السبب الجذري للمشكلة" value={rootCause} onChange={(event) => setRootCause(event.target.value)} /><div className="grid gap-3 sm:grid-cols-3"><input className="input-dark" placeholder="نوع التعويض" value={compensationType} onChange={(event) => setCompensationType(event.target.value)} /><input className="input-dark" type="number" min="0" placeholder="قيمة التعويض" value={compensationAmount} onChange={(event) => setCompensationAmount(event.target.value)} /><input className="input-dark" placeholder="رضا العميل بعد الحل" value={satisfaction} onChange={(event) => setSatisfaction(event.target.value)} /></div><div className="flex flex-wrap gap-2"><button className="btn-secondary" onClick={() => void save('accepted')}>استلام الحالة</button><button className="btn-secondary" onClick={() => void save('in_progress')}>بدء الحل</button><button className="btn-secondary" onClick={() => void save('returned')}>إعادتها للمسؤول</button><button className="btn-primary flex items-center gap-2" onClick={() => void save('resolved')}><CheckCircle2 size={16} /> تم الحل</button></div></div> : <Empty text="اختر حالة لعرض تفاصيلها وقرار المدير." />}</div>
      </div>
    </div>
  </section>;
}

function Card({ icon: Icon, label, value }: { icon: typeof AlertTriangle; label: string; value: number }) { return <div className="stat-card"><div className="flex items-center justify-between"><div><div className="text-xs font-black text-slate-400">{label}</div><div className="mt-2 text-3xl font-black text-white">{value}</div></div><Icon className="text-amber-300" size={24} /></div></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/10 bg-white/5 p-3"><div className="text-xs font-black text-slate-500">{label}</div><div className="mt-1 text-sm font-bold leading-6 text-slate-200">{value}</div></div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-xl border border-white/10 bg-white/5 p-5 text-center text-sm font-bold text-slate-400">{text}</div>; }
