import { useEffect, useState } from 'react';
import { Bike, RefreshCw } from 'lucide-react';
import { getEmployeePayrollStatementV1, type EmployeePayrollStatementV1 } from '@/lib/payroll/payrollStatementService';

const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const money = (value: unknown) => num(value).toLocaleString('ar-EG', { maximumFractionDigits: 2 }) + ' ج.م';

function read(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  return (obj as Record<string, unknown>)[key];
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3">
      <div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{label}</div>
      <div className="mt-1 text-lg font-black text-[var(--dawaa-theme-heading)]">{value}</div>
      {hint ? <div className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{hint}</div> : null}
    </div>
  );
}

export default function DeliveryPayrollBreakdownPanel({ staffId, monthCycle }: { staffId: string; monthCycle: string }) {
  const [statement, setStatement] = useState<EmployeePayrollStatementV1 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    if (!staffId || !monthCycle) return;
    setLoading(true);
    setError('');
    try {
      setStatement(await getEmployeePayrollStatementV1(staffId, monthCycle));
    } catch (e) {
      setStatement(null);
      setError(e instanceof Error ? e.message : 'تعذر تحميل تفاصيل راتب الدليفري');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [staffId, monthCycle]);

  if (!statement?.delivery_mode) return null;

  const financial = statement.financial;
  const breakdown = financial.delivery_breakdown || {};
  const preview = (breakdown.preview || statement.delivery_preview || {}) as Record<string, unknown>;
  const classification = (breakdown.classification || statement.delivery_classification || {}) as Record<string, unknown>;
  const classInfo = (read(classification, 'classification') || {}) as Record<string, unknown>;
  const rates = (read(preview, 'rates') || read(classification, 'rates') || {}) as Record<string, unknown>;
  const activity = (breakdown.activity || read(preview, 'delivery_activity') || {}) as Record<string, unknown>;
  const attendance = (read(classification, 'attendance') || {}) as Record<string, unknown>;
  const discipline = (read(classification, 'discipline') || {}) as Record<string, unknown>;
  const evidence = (read(preview, 'delivery_attendance_evidence') || {}) as Record<string, unknown>;
  const evalPct = read(rates, 'monthly_evaluation_multiplier_pct');
  const classLabel = String(read(classInfo, 'display_name') || read(classInfo, 'discipline_band_ar') || 'غير نهائي');
  const tenureLabel = String(read(classInfo, 'tenure_band_ar') || '-');

  return (
    <section className="rounded-3xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-4 shadow-sm" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-teal-200"><Bike size={18} /> تفاصيل راتب الدليفري</div>
          <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
            الحضور والخصومات من Payroll · الأوردرات والمشاوير من تطبيق الدليفري · السعر من مصفوفة التصنيف فقط
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary !py-1.5 text-xs">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      {error ? <div className="mt-3 rounded-xl border p-3 text-xs font-bold">{error}</div> : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="التصنيف" value={classLabel} hint={'الفئة: ' + tenureLabel} />
        <Card label="أيام الحضور المعتمدة" value={num(read(attendance, 'attended_days')).toLocaleString('ar-EG')} hint={'الحد الأدنى: ' + num(read(attendance, 'minimum_attended_days')).toLocaleString('ar-EG')} />
        <Card label="دقائق الانضباط" value={num(read(discipline, 'classification_minutes')).toLocaleString('ar-EG') + ' د'} hint={'كريديت ملتزم ' + num(read(discipline, 'committed_credit_minutes')).toLocaleString('ar-EG') + ' د · عادي ' + num(read(discipline, 'regular_credit_minutes')).toLocaleString('ar-EG') + ' د'} />
        <Card label="التقييم الشهري" value={evalPct == null ? 'غير معتمد' : num(evalPct).toLocaleString('ar-EG') + '%'} hint={'سقف الحافز: ' + money(read(rates, 'monthly_incentive_cap'))} />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Card label="سعر الساعة" value={money(read(rates, 'hourly_rate'))} />
        <Card label="سعر الأوردر" value={money(read(rates, 'order_rate'))} />
        <Card label="سعر المشوار" value={money(read(rates, 'trip_rate'))} />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="الأوردرات المحتسبة" value={num(read(activity, 'orders_counted')).toLocaleString('ar-EG')} hint={'الإجمالي ' + num(read(activity, 'orders_total')).toLocaleString('ar-EG') + ' · معلق ' + num(read(activity, 'orders_pending')).toLocaleString('ar-EG')} />
        <Card label="المشاوير المعتمدة" value={num(read(activity, 'trips_approved')).toLocaleString('ar-EG')} hint={'الإجمالي ' + num(read(activity, 'trips_total')).toLocaleString('ar-EG') + ' · معلق ' + num(read(activity, 'trips_pending')).toLocaleString('ar-EG')} />
        <Card label="وحدات المشاوير المحتسبة" value={num(read(activity, 'trip_weighted_units')).toLocaleString('ar-EG')} />
        <Card label="حضور تطبيق الدليفري — Evidence فقط" value={num(read(evidence, 'app_attendance_days')).toLocaleString('ar-EG') + ' يوم'} hint={'Payroll canonical: ' + num(read(evidence, 'payroll_worked_days')).toLocaleString('ar-EG') + ' يوم'} />
      </div>

      <div className="mt-3 rounded-2xl border border-teal-400/20 bg-teal-400/5 p-3">
        <div className="text-xs font-black text-teal-200">المكونات المالية للدليفري — بدون Double Counting</div>
        <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div>أساس الساعات: <b>{money(breakdown.base_salary)}</b></div>
          <div>الأوردرات: <b>{money(breakdown.order_pay)}</b></div>
          <div>المشاوير: <b>{money(breakdown.trip_pay)}</b></div>
          <div>Overtime: <b>{money(breakdown.approved_overtime)}</b></div>
          <div>الحافز الشهري: <b>{money(breakdown.monthly_incentive)}</b></div>
          <div>الحافز الربع سنوي: <b>{money(breakdown.quarterly_incentive)}</b></div>
          <div>الإجمالي التشغيلي + الحوافز: <b>{money(breakdown.operational_and_incentive_total)}</b></div>
          <div>صافي المعاينة: <b>{money(financial.display_net_salary)}</b></div>
        </div>
        <div className="mt-2 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">
          تطبيق الدليفري لا يحدد أسعار الراتب. أي نشاط غير محسوم أو تقييم غير معتمد أو فرق حضور يظهر كمانع/تحذير قبل الإقفال ولا يتحول تلقائيًا إلى مبلغ.
        </div>
      </div>
    </section>
  );
}
