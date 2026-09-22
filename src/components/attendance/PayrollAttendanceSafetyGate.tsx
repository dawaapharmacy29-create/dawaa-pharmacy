import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { getPayrollFinalizationGate, type PayrollFinalizationGate } from '@/lib/hr/workforceService';

export default function PayrollAttendanceSafetyGate({ staffId, monthCycle }: { staffId: string; monthCycle: string }) {
  const [gate, setGate] = useState<PayrollFinalizationGate | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!staffId || !monthCycle) return;
    setLoading(true);
    try {
      setGate(await getPayrollFinalizationGate(staffId, monthCycle));
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
            بوابة الإقفال المالي للمرتب
          </div>
          <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
            {gate.ready
              ? 'Attendance Truth وPolicy V3 والأوفر تايم والـdrift سليمة لهذه الدورة، ويمكن الانتقال لخطوة الاعتماد المالي.'
              : 'الإقفال المالي محجوب حتى يتم إغلاق موانع Attendance Truth وPolicy Engine والأوفر تايم أدناه.'}
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

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="أيام Policy مفحوصة" value={gate.policy_validation.checked_days} />
        <Metric label="V2/V3 mismatch" value={gate.policy_validation.effective_status_changes} warn={gate.policy_validation.effective_status_changes > 0} />
        <Metric label="V3 materialized" value={gate.policy_validation.v3_materialized_days} />
        <Metric label="V3 pending" value={gate.policy_validation.v3_pending_days} warn={gate.policy_validation.v3_pending_days > 0} />
      </div>

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
        القاعدة: الإقفال المالي لا يعتمد على زر الواجهة. الـBackend يعيد فحص Attendance Truth + V2/V3 + OT + Financial Drift + هوية الفرع قبل اعتبار الدورة جاهزة.
      </div>
    </section>
  );
}


function Metric({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={warn
      ? 'rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-theme-surface)] p-3'
      : 'rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3'}>
      <div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">{label}</div>
      <div className="mt-1 text-lg font-black text-[var(--dawaa-theme-heading)]">{value.toLocaleString('ar-EG')}</div>
    </div>
  );
}
