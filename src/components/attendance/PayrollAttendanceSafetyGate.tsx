import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { getPayrollSafetyGate, type PayrollSafetyGate } from '@/lib/hr/workforceService';

export default function PayrollAttendanceSafetyGate({ staffId, monthCycle }: { staffId: string; monthCycle: string }) {
  const [gate, setGate] = useState<PayrollSafetyGate | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!staffId || !monthCycle) return;
    setLoading(true);
    try {
      setGate(await getPayrollSafetyGate(staffId, monthCycle));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر فحص جاهزية الحضور للمرتب');
      setGate(null);
    } finally {
      setLoading(false);
    }
  }, [monthCycle, staffId]);

  useEffect(() => { void load(); }, [load]);

  if (!gate) {
    return (
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-black text-[var(--dawaa-theme-muted)]">Payroll Safety Gate</div>
          <button onClick={() => void load()} className="btn-secondary !px-2"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        <div className="mt-2 text-sm font-bold text-[var(--dawaa-theme-muted)]">لم يتم تحميل فحص الجاهزية بعد.</div>
      </div>
    );
  }

  return (
    <section className={`rounded-2xl border p-4 ${gate.ready
      ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)]'
      : 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]">
            {gate.ready ? <CheckCircle2 size={18} /> : <ShieldCheck size={18} />}
            بوابة أمان المرتب
          </div>
          <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
            {gate.ready
              ? 'الحضور والأوفر تايم والـdrift لا تحتوي حاليًا على مانع نهائي لهذه الدورة.'
              : 'لا تعتمد المرتب النهائي قبل إغلاق الموانع أدناه.'}
          </p>
        </div>
        <button onClick={() => void load()} className="btn-secondary"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> إعادة الفحص</button>
      </div>

      {!!gate.blockers.length && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {gate.blockers.map((item) => (
            <div key={item.code} className="rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-theme-surface)] p-3 text-xs font-bold">
              <div className="flex items-center gap-2 text-[var(--dawaa-status-warning-text)]"><AlertTriangle size={14} /> {item.label}</div>
              {item.count != null && <div className="mt-1 text-[var(--dawaa-theme-muted)]">العدد: {item.count.toLocaleString('ar-EG')}</div>}
              {item.hours != null && <div className="mt-1 text-[var(--dawaa-theme-muted)]">الساعات: {Number(item.hours).toFixed(2)}</div>}
            </div>
          ))}
        </div>
      )}

      {!!gate.warnings.length && (
        <div className="mt-3 space-y-2">
          {gate.warnings.map((item) => (
            <div key={item.code} className="rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-info-text)]">
              {item.label}{item.count != null ? ` · ${item.count.toLocaleString('ar-EG')}` : ''}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
        القاعدة: base payable hours = ساعات الحضور المعتمدة بحد أقصى ساعات الجدول، والـOT المعتمد منفصل. لا يوجد خصم تأخير مزدوج.
      </div>
    </section>
  );
}
