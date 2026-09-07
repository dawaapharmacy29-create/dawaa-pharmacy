import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  Fingerprint,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

type DiagnosticData = {
  generated_at?: string;
  biometrics?: {
    diagnosis?: string;
    action?: string;
    agent_age_minutes?: number | null;
    watermark_age_minutes?: number | null;
    ingestion_age_minutes?: number | null;
    mapping_rate?: number | null;
    total_events?: number | null;
    unmapped_events?: number | null;
  };
  purchase_invoices?: {
    last_reconcile_at?: string | null;
    last_run_status?: string | null;
    last_run_error?: string | null;
  };
  customer_orders?: {
    pending?: number | null;
    failed?: number | null;
    diagnosis?: string | null;
  };
};

const diagnosisLabels: Record<string, string> = {
  agent_never_connected: 'برنامج الربط لم يتصل من قبل',
  agent_offline: 'برنامج الربط غير متصل',
  watermark_missing: 'علامة تقدم المزامنة غير موجودة',
  watermark_stalled: 'علامة تقدم المزامنة متوقفة',
  ingestion_stalled: 'استقبال سجلات البصمة متوقف',
  mapping_attention: 'ربط البصمات بالموظفين يحتاج مراجعة',
  healthy: 'سليم',
  healthy_or_idle: 'سليم أو لا توجد حركة جديدة',
  failed_events: 'توجد سجلات فاشلة',
  backlog: 'توجد سجلات معلقة',
};

function formatDate(value?: string | null) {
  if (!value) return 'غير مسجل';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'غير مسجل';
  return date.toLocaleString('ar-EG', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Africa/Cairo',
  });
}

function formatMinutes(value?: number | null) {
  if (value == null) return 'غير مسجل';
  if (value < 1) return 'أقل من دقيقة';
  if (value < 60) return `${Math.round(value)} دقيقة`;
  return `${(value / 60).toFixed(1)} ساعة`;
}

function number(value?: number | null) {
  return Number(value || 0).toLocaleString('ar-EG');
}

function StatusBadge({ healthy, label }: { healthy: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-black ${
        healthy
          ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]'
          : 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]'
      }`}
    >
      {healthy ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
      {label}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft p-3">
      <div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{label}</div>
      <div className="mt-1 text-sm font-black text-[var(--dawaa-theme-heading)]">{value}</div>
    </div>
  );
}

export default function SystemIntegrations() {
  const [data, setData] = useState<DiagnosticData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: result, error: requestError } = await supabase.rpc('integration_sync_diagnostics_v1');
      if (requestError) throw requestError;
      setData((result || {}) as DiagnosticData);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'تعذر تحميل تشخيص المزامنات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const biometrics = data?.biometrics;
  const purchases = data?.purchase_invoices;
  const customers = data?.customer_orders;

  const biometricHealthy = biometrics?.diagnosis === 'healthy';
  const customerHealthy = customers?.diagnosis === 'healthy_or_idle';
  const purchaseHealthy = Boolean(purchases?.last_reconcile_at) && !purchases?.last_run_error;

  const overallHealthy = useMemo(
    () => biometricHealthy && customerHealthy && purchaseHealthy,
    [biometricHealthy, customerHealthy, purchaseHealthy]
  );

  return (
    <div className="space-y-4" dir="rtl">
      <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[var(--dawaa-theme-heading)]">
              <Activity size={22} />
              <h1 className="text-xl font-black">مركز المزامنة والتكاملات</h1>
            </div>
            <p className="mt-2 max-w-3xl text-sm font-bold leading-7 text-[var(--dawaa-theme-muted)]">
              متابعة حالة ربط طلبات العملاء وفواتير المشتريات والبصمات، مع تحديد سبب المشكلة والإجراء المطلوب بصورة واضحة.
            </p>
            {data?.generated_at ? (
              <div className="mt-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">
                آخر فحص: {formatDate(data.generated_at)}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge healthy={overallHealthy} label={overallHealthy ? 'كل المسارات سليمة' : 'توجد مسارات تحتاج متابعة'} />
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="dawaa-button dawaa-button--primary disabled:opacity-60"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              تحديث الحالة
            </button>
          </div>
        </div>
        {error ? (
          <div className="mt-4 rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3 text-sm font-black text-[var(--dawaa-status-danger-text)]">
            تعذر تحميل مركز المزامنة: {error}
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <article className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft p-2"><Fingerprint size={22} /></span>
              <div>
                <h2 className="font-black text-[var(--dawaa-theme-heading)]">البصمات</h2>
                <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">ربط جهاز البصمة بالحضور</p>
              </div>
            </div>
            <StatusBadge healthy={biometricHealthy} label={diagnosisLabels[biometrics?.diagnosis || ''] || 'غير محدد'} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Metric label="آخر اتصال لبرنامج الربط" value={formatMinutes(biometrics?.agent_age_minutes)} />
            <Metric label="عمر علامة تقدم المزامنة" value={formatMinutes(biometrics?.watermark_age_minutes)} />
            <Metric label="آخر استقبال لسجلات البصمة" value={formatMinutes(biometrics?.ingestion_age_minutes)} />
            <Metric label="نسبة ربط البصمات بالموظفين" value={`${Number(biometrics?.mapping_rate || 0).toFixed(1)}%`} />
            <Metric label="إجمالي سجلات البصمة" value={number(biometrics?.total_events)} />
            <Metric label="سجلات غير مرتبطة بموظف" value={number(biometrics?.unmapped_events)} />
          </div>
          <div className="mt-3 rounded-xl dawaa-surface-soft p-3 text-xs font-bold leading-6 text-[var(--dawaa-theme-muted)]">
            <div className="mb-1 font-black text-[var(--dawaa-theme-heading)]">الإجراء المطلوب</div>
            {biometrics?.action || 'جاري تحديد الإجراء المطلوب.'}
          </div>
        </article>

        <article className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft p-2"><ShoppingCart size={22} /></span>
              <div>
                <h2 className="font-black text-[var(--dawaa-theme-heading)]">طلبات العملاء</h2>
                <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">استقبال الطلبات ومعالجتها</p>
              </div>
            </div>
            <StatusBadge healthy={customerHealthy} label={diagnosisLabels[customers?.diagnosis || ''] || 'غير محدد'} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Metric label="طلبات معلقة" value={number(customers?.pending)} />
            <Metric label="طلبات فشلت معالجتها" value={number(customers?.failed)} />
          </div>
          <div className="mt-3 rounded-xl dawaa-surface-soft p-3 text-xs font-bold leading-6 text-[var(--dawaa-theme-muted)]">
            لا نعتبر عدم وجود طلبات جديدة عطلًا. يظهر التنبيه فقط عند وجود طلبات معلقة أو فاشلة تحتاج تدخلًا.
          </div>
        </article>

        <article className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft p-2"><Database size={22} /></span>
              <div>
                <h2 className="font-black text-[var(--dawaa-theme-heading)]">فواتير المشتريات</h2>
                <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">مطابقة الفواتير ومراجعة آخر تشغيل</p>
              </div>
            </div>
            <StatusBadge healthy={purchaseHealthy} label={purchaseHealthy ? 'سليم' : 'يحتاج مراجعة'} />
          </div>
          <div className="mt-4 grid gap-2">
            <Metric label="آخر تشغيل للمطابقة" value={formatDate(purchases?.last_reconcile_at)} />
            <Metric label="حالة آخر تشغيل" value={purchases?.last_run_status ? 'تم تسجيل الحالة' : 'غير مسجلة'} />
          </div>
          <div className="mt-3 rounded-xl dawaa-surface-soft p-3 text-xs font-bold leading-6 text-[var(--dawaa-theme-muted)]">
            {purchases?.last_run_error ? `آخر خطأ مسجل: ${purchases.last_run_error}` : 'لا يوجد خطأ مسجل في آخر تشغيل.'}
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5" size={20} />
          <div>
            <h2 className="font-black text-[var(--dawaa-theme-heading)]">قاعدة العرض باللغة العربية</h2>
            <p className="mt-1 text-sm font-bold leading-7 text-[var(--dawaa-theme-muted)]">
              كل المسميات والإرشادات وحالات التشغيل الظاهرة للمستخدم في هذه الصفحة عربية. تبقى الأسماء التقنية الداخلية مخفية ولا تظهر إلا في سجلات التطوير عند الحاجة.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
