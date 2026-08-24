import { useEffect, useState } from 'react';
import { Award, CheckCircle2, Loader2, PackageCheck, PlusCircle, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getCustomerRequestDoctorPointsSummary, type CustomerRequestDoctorPointsSummary } from '../data';

function tierLabel(value?: string | null) {
  if (value === 'senior_doctor') return 'الفئة الأولى';
  if (value === 'mid_doctor') return 'الفئة الثانية';
  if (value === 'assistant') return 'الفئة الثالثة';
  return 'فئة غير محددة';
}

export default function CustomerRequestDoctorPointsCard({ staffId }: { staffId: string }) {
  const [rows, setRows] = useState<CustomerRequestDoctorPointsSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void getCustomerRequestDoctorPointsSummary(staffId)
      .then((data) => { if (!cancelled) setRows(data); })
      .catch((err) => { if (!cancelled) setError((err as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [staffId]);

  const current = rows[0] || null;

  return (
    <section className="rounded-3xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] p-4 shadow-lg" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="flex items-center gap-2 text-base font-black text-[var(--dawaa-theme-heading)]"><Award size={19} className="text-[var(--dawaa-theme-primary)]" /> نقاط طلبات العملاء</div><div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">مصدرها المباشر سجل الحوافز المعتمد، وليست إعادة حساب من الواجهة.</div></div>
        {current ? <div className="rounded-xl bg-[var(--dawaa-theme-accent-soft)] px-3 py-2 text-xs font-black text-[var(--dawaa-theme-primary)]">{tierLabel(current.tier_key)} · دورة {current.month_cycle}</div> : null}
      </div>

      {loading ? <div className="mt-4 flex items-center gap-2 text-sm font-bold text-[var(--dawaa-theme-muted)]"><Loader2 size={16} className="animate-spin" /> جاري تحميل نقاط الطلبات...</div> : null}
      {error ? <div className="mt-4 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-warning-text)]">تعذر تحميل ملخص طلبات العملاء: {error}</div> : null}
      {!loading && !error && !current ? <div className="mt-4 rounded-xl bg-[var(--dawaa-theme-surface-2)] p-4 text-sm font-bold text-[var(--dawaa-theme-muted)]">لا توجد نقاط طلبات عملاء مسجلة لهذا الدكتور حتى الآن.</div> : null}

      {current ? <>
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
          <Metric icon={PlusCircle} label="طلبات مسجلة مؤهلة" value={current.eligible_registered_requests} />
          <Metric icon={PackageCheck} label="طلبات محققة" value={current.achieved_requests} />
          <Metric icon={TrendingUp} label="نسبة التحقيق" value={`${current.achievement_rate.toLocaleString('ar-EG', { maximumFractionDigits: 1 })}%`} />
          <Metric icon={CheckCircle2} label="نقاط التسجيل" value={current.registration_points} />
          <Metric icon={Award} label="إجمالي النقاط" value={current.total_points} highlight />
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2"><div className="rounded-xl bg-[var(--dawaa-theme-surface-2)] p-3 text-xs"><span className="font-bold text-[var(--dawaa-theme-muted)]">نقاط تحقيق الطلبات</span><strong className="mt-1 block text-lg text-[var(--dawaa-status-success-text)]">{current.achievement_points.toLocaleString('ar-EG')} نقطة</strong></div><Link to={`/customer-requests?registrarId=${encodeURIComponent(staffId)}&quick=all`} className="flex items-center justify-center rounded-xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)] p-3 text-xs font-black text-[var(--dawaa-theme-primary)]">فتح طلبات الدكتور وتفاصيلها</Link></div>
      </> : null}
    </section>
  );
}

function Metric({ icon: Icon, label, value, highlight = false }: { icon: typeof Award; label: string; value: number | string; highlight?: boolean }) {
  return <div className={`rounded-2xl border p-3 ${highlight ? 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-accent-soft)]' : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)]'}`}><Icon size={16} className={highlight ? 'text-[var(--dawaa-theme-primary)]' : 'text-[var(--dawaa-theme-muted)]'} /><div className="mt-2 text-[10px] font-black text-[var(--dawaa-theme-muted)]">{label}</div><div className={`mt-1 text-xl font-black ${highlight ? 'text-[var(--dawaa-theme-primary)]' : 'text-[var(--dawaa-theme-heading)]'}`}>{typeof value === 'number' ? value.toLocaleString('ar-EG') : value}</div></div>;
}
