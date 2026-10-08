import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bike, CheckCircle2, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { fetchPayrollCyclePreflight, type PayrollCyclePreflight } from '@/lib/payroll/payrollCyclePreflightService';

const surface = { background: 'var(--dawaa-theme-surface)', borderColor: 'var(--dawaa-theme-border)' };
const surfaceSoft = { background: 'var(--dawaa-theme-bg-soft)', borderColor: 'var(--dawaa-theme-border)' };
const muted = { color: 'var(--dawaa-theme-muted)' };

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border p-3" style={surfaceSoft}>
      <div className="text-[10px] font-black" style={muted}>{label}</div>
      <div className="mt-1 text-xl font-black text-white">{value}</div>
      {hint ? <div className="mt-1 text-[10px] font-bold" style={muted}>{hint}</div> : null}
    </div>
  );
}

export default function PayrollCycleReadinessOverview({
  monthCycle,
  branch,
  onOpenStaffCompensation,
}: {
  monthCycle: string;
  branch?: string | null;
  onOpenStaffCompensation?: (staffId: string) => void;
}) {
  const [data, setData] = useState<PayrollCyclePreflight | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchPayrollCyclePreflight({ monthCycle, branch: branch || null });
      setData(result);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'تعذر تحميل Preflight دورة الرواتب');
    } finally {
      setLoading(false);
    }
  }, [monthCycle, branch]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void fetchPayrollCyclePreflight({ monthCycle, branch: branch || null })
      .then((result) => { if (active) setData(result); })
      .catch((err) => {
        if (!active) return;
        setData(null);
        setError(err instanceof Error ? err.message : 'تعذر تحميل Preflight دورة الرواتب');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [monthCycle, branch]);

  const attentionRows = useMemo(
    () => (data?.rows || []).filter((row) => !row.preflightClear),
    [data]
  );

  if (loading && !data) {
    return <div className="flex items-center justify-center rounded-3xl border p-8" style={surface}><RefreshCw className="animate-spin text-teal-300" /></div>;
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-red-400/30 bg-red-400/5 p-4 text-sm text-red-200">
        تعذر تحميل Preflight دورة الرواتب: {error}
        <button type="button" className="btn-secondary ms-3 !py-1 text-xs" onClick={() => void load()}>إعادة المحاولة</button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <section className="rounded-3xl border p-5" style={surface} dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-teal-200"><ShieldCheck size={18} /> Payroll Cycle Preflight V3</div>
          <div className="mt-1 text-xs font-bold" style={muted}>
            {data.cycleStart} → {data.cycleEnd} · {data.branch || 'كل الفروع'}
          </div>
          <div className="mt-1 text-[10px] font-bold text-amber-200">
            فحص سريع تشغيلي فقط؛ لا يساوي اعتماد الراتب. الإقفال النهائي يحتاج Full Gate + Snapshot + Review لكل موظف.
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary !py-1.5 text-xs">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="إجمالي نطاق الرواتب" value={data.scopeStaffCount.toLocaleString('ar-EG')} />
        <Stat label="Standard" value={data.standardStaffCount.toLocaleString('ar-EG')} hint={`${data.standardPreflightClearCount.toLocaleString('ar-EG')} بدون مانع Preflight واضح`} />
        <Stat label="Delivery Payroll" value={data.deliveryStaffCount.toLocaleString('ar-EG')} hint={`${data.deliveryMappedCount.toLocaleString('ar-EG')}/${data.deliveryStaffCount.toLocaleString('ar-EG')} مربوطين`} />
        <Stat label="Preflight واضح" value={data.preflightClearCount.toLocaleString('ar-EG')} />
        <Stat label="يحتاج متابعة" value={data.preflightAttentionCount.toLocaleString('ar-EG')} hint="قد يحتوي على أكثر من سبب للموظف نفسه" />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-teal-400/20 bg-teal-400/5 p-3">
          <div className="flex items-center gap-2 text-xs font-black text-teal-200"><Bike size={15} /> Delivery Coverage</div>
          <div className="mt-2 text-lg font-black text-white">{data.deliverySnapshotCoveredCount.toLocaleString('ar-EG')} / {data.deliveryStaffCount.toLocaleString('ar-EG')}</div>
          <div className="mt-1 text-[10px]" style={muted}>Snapshots حديثة/موجودة للمسار المالي</div>
        </div>
        <div className="rounded-2xl border p-3" style={surfaceSoft}>
          <div className="text-[10px] font-black" style={muted}>Delivery Snapshots قديمة</div>
          <div className="mt-1 text-lg font-black text-white">{data.deliveryStaleSnapshotCount.toLocaleString('ar-EG')}</div>
        </div>
        <div className="rounded-2xl border p-3" style={surfaceSoft}>
          <div className="text-[10px] font-black" style={muted}>Delivery بدون Policy</div>
          <div className="mt-1 text-lg font-black text-white">{data.deliveryCandidateWithoutPolicyCount.toLocaleString('ar-EG')}</div>
        </div>
        <div className="rounded-2xl border p-3" style={surfaceSoft}>
          <div className="text-[10px] font-black" style={muted}>Delivery Preflight واضح</div>
          <div className="mt-1 text-lg font-black text-white">{data.deliveryPreflightClearCount.toLocaleString('ar-EG')}</div>
        </div>
      </div>

      {data.topIssues.length ? (
        <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-400/5 p-4">
          <div className="flex items-center gap-2 text-xs font-black text-amber-200"><AlertTriangle size={15} /> أهم أسباب المتابعة</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.topIssues.map((issue) => (
              <div key={issue.code} className="rounded-xl border border-amber-400/15 p-3 text-xs">
                <div className="font-black text-white">{issue.label}</div>
                <div className="mt-1 text-amber-200">{issue.affectedStaff.toLocaleString('ar-EG')} موظف</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-xs font-black text-emerald-200"><CheckCircle2 size={16} /> لا توجد موانع Preflight واضحة.</div>
      )}

      {attentionRows.length ? (
        <div className="mt-4">
          <div className="flex items-center gap-2 text-xs font-black text-teal-200"><Users size={15} /> ملفات تحتاج متابعة</div>
          <div className="mt-2 max-h-[360px] space-y-2 overflow-y-auto">
            {attentionRows.map((row) => (
              <div key={row.staffId} className="flex flex-wrap items-center gap-3 rounded-xl border p-3 text-xs" style={surfaceSoft}>
                <div className="min-w-[180px] flex-1"><div className="font-black text-white">{row.staffName}</div><div className="mt-0.5" style={muted}>{row.branch} · {row.route === 'delivery' ? 'Delivery Payroll' : 'Standard Payroll'}</div></div>
                <div className="text-amber-200">{row.issueCodes.length.toLocaleString('ar-EG')} سبب</div>
                {row.route === 'delivery' ? <div style={muted}>Orders pending: {row.ordersPending.toLocaleString('ar-EG')} · Trips pending: {row.tripsPending.toLocaleString('ar-EG')}</div> : null}
                {onOpenStaffCompensation ? <button type="button" className="btn-secondary !py-1 text-[10px]" onClick={() => onOpenStaffCompensation(row.staffId)}>فتح الملف</button> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
