import { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  CircleAlert,
  FileCheck2,
  MessageSquareMore,
  PackageCheck,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { QaCaseListRow } from '@/lib/salesIntelligence/qa/types';

type StaffTruthRow = {
  case_id: string;
  selected_invoice_number: string | null;
  invoice_amount: number | string | null;
  canonical_staff_id: string | null;
  canonical_staff_name: string | null;
  canonical_staff_role: string | null;
  canonical_staff_branch: string | null;
  staff_resolution_status: string;
  is_staff_resolved: boolean;
  item_evidence_available: boolean;
};

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): string {
  return new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(value);
}

function pct(value: number, total: number): string {
  return total ? `${Math.round((value / total) * 100).toLocaleString('ar-EG')}٪` : '0٪';
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  hint: string;
  tone?: 'default' | 'success' | 'warning';
}) {
  const className = tone === 'success'
    ? 'border-emerald-500/25 bg-emerald-500/5'
    : tone === 'warning'
      ? 'border-amber-500/25 bg-amber-500/5'
      : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)]';
  return (
    <div className={`rounded-2xl border p-4 ${className}`}>
      <div className="flex items-center justify-between gap-3"><span className="dawaa-muted text-xs font-bold">{label}</span><Icon size={18} className="dawaa-muted" /></div>
      <div className="dawaa-heading mt-2 text-2xl font-black">{value}</div>
      <div className="dawaa-muted mt-1 text-[11px] leading-5">{hint}</div>
    </div>
  );
}

export default function SalesIntelligenceManagementOverviewV1({ rows }: { rows: QaCaseListRow[] }) {
  const [staffTruth, setStaffTruth] = useState<StaffTruthRow[]>([]);
  const [truthLoading, setTruthLoading] = useState(true);
  const [truthError, setTruthError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setTruthLoading(true);
      const { data, error } = await supabase
        .from('sales_intelligence_invoice_staff_truth_v1')
        .select('case_id,selected_invoice_number,invoice_amount,canonical_staff_id,canonical_staff_name,canonical_staff_role,canonical_staff_branch,staff_resolution_status,is_staff_resolved,item_evidence_available')
        .limit(1000);
      if (cancelled) return;
      if (error) {
        setTruthError(error.message);
        setStaffTruth([]);
      } else {
        setTruthError(null);
        setStaffTruth((data || []) as StaffTruthRow[]);
      }
      setTruthLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const metrics = useMemo(() => {
    const total = rows.length;
    const withInvoice = rows.filter((row) => Boolean(row.selectedInvoiceId)).length;
    const itemReady = rows.filter((row) => row.itemEvidenceReady).length;
    const needsReview = rows.filter((row) => row.needsHumanReview).length;
    const proven = rows.filter((row) => row.saleProofState === 'proven').length;
    const strong = rows.filter((row) => row.saleProofState === 'strongly_supported').length;
    const contradicted = rows.filter((row) => row.saleProofState === 'contradicted').length;
    const officialSales = staffTruth.length;
    const officialRevenue = staffTruth.reduce((sum, row) => sum + number(row.invoice_amount), 0);
    const resolvedStaff = staffTruth.filter((row) => row.is_staff_resolved).length;
    const unresolvedStaff = officialSales - resolvedStaff;
    return { total, withInvoice, itemReady, needsReview, proven, strong, contradicted, officialSales, officialRevenue, resolvedStaff, unresolvedStaff };
  }, [rows, staffTruth]);

  const actions = useMemo(() => {
    const items: Array<{ title: string; detail: string; severity: 'warning' | 'info' }> = [];
    if (metrics.unresolvedStaff) {
      items.push({ title: 'حسم الموظف على الفواتير الرسمية', detail: `${metrics.unresolvedStaff.toLocaleString('ar-EG')} بيع رسمي لم يُنسب لموظف بصورة آمنة.`, severity: 'warning' });
    }
    if (metrics.contradicted) {
      items.push({ title: 'مراجعة الحالات المتناقضة', detail: `${metrics.contradicted.toLocaleString('ar-EG')} حالة بها تعارض في إثبات البيع أو الإسناد.`, severity: 'warning' });
    }
    if (metrics.needsReview) {
      items.push({ title: 'طابور المراجعة البشرية', detail: `${metrics.needsReview.toLocaleString('ar-EG')} حالة تحتاج مراجعة بشرية قبل استخدامها تشغيليًا.`, severity: 'info' });
    }
    const invoiceWithoutItems = Math.max(0, metrics.withInvoice - metrics.itemReady);
    if (invoiceWithoutItems) {
      items.push({ title: 'استكمال أدلة الأصناف', detail: `${invoiceWithoutItems.toLocaleString('ar-EG')} حالة مرتبطة بفاتورة لكن أدلة الأصناف ليست جاهزة بعد.`, severity: 'info' });
    }
    return items.slice(0, 4);
  }, [metrics]);

  const branches = useMemo(() => {
    const map = new Map<string, { cases: number; invoices: number; review: number; proven: number }>();
    for (const row of rows) {
      const key = row.branchNameRaw || 'غير محدد';
      const current = map.get(key) || { cases: 0, invoices: 0, review: 0, proven: 0 };
      current.cases += 1;
      if (row.selectedInvoiceId) current.invoices += 1;
      if (row.needsHumanReview) current.review += 1;
      if (row.saleProofState === 'proven') current.proven += 1;
      map.set(key, current);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].cases - a[1].cases);
  }, [rows]);

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-lg font-black"><TrendingUp size={20} />مركز قيادة ذكاء المبيعات</div>
            <p className="dawaa-muted mt-1 max-w-3xl text-sm leading-6">
              أهم الأرقام والقرارات في شاشة واحدة. التفاصيل التشغيلية والفنية موجودة في تبويبات مستقلة حتى لا تزاحم قرار الإدارة.
            </p>
          </div>
          <div className="dawaa-badge dawaa-badge--success">الحقيقة الرسمية فقط</div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={MessageSquareMore} label="الحالات الحالية" value={metrics.total.toLocaleString('ar-EG')} hint="بعد آخر تحليل معتمد" />
        <MetricCard icon={ReceiptText} label="مرتبطة بفاتورة" value={metrics.withInvoice.toLocaleString('ar-EG')} hint={`${pct(metrics.withInvoice, metrics.total)} من الحالات`} />
        <MetricCard icon={PackageCheck} label="أدلة أصناف متاحة" value={metrics.itemReady.toLocaleString('ar-EG')} hint="يمكن مراجعة الصنف والكمية" tone="success" />
        <MetricCard icon={CircleAlert} label="تحتاج مراجعة" value={metrics.needsReview.toLocaleString('ar-EG')} hint={`${pct(metrics.needsReview, metrics.total)} من الحالات`} tone={metrics.needsReview ? 'warning' : 'success'} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="dawaa-card">
          <div className="flex items-center gap-2 font-black"><Sparkles size={18} />Action Center — ما يحتاج قرار الآن</div>
          <div className="dawaa-muted mt-1 text-xs">الأولوية للحالات التي تمنع اعتماد رقم رسمي أو تقلل جودة الربط.</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {actions.length ? actions.map((action) => (
              <div key={action.title} className={action.severity === 'warning' ? 'rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4' : 'rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-4'}>
                <div className="font-black">{action.title}</div>
                <div className="dawaa-muted mt-1 text-xs leading-5">{action.detail}</div>
              </div>
            )) : (
              <div className="dawaa-empty-state py-8 text-center md:col-span-2">لا توجد أولويات حرجة ظاهرة حاليًا.</div>
            )}
          </div>
        </div>

        <div className="dawaa-card">
          <div className="flex items-center gap-2 font-black"><BadgeCheck size={18} />المبيعات الرسمية</div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div><div className="dawaa-muted text-xs">عدد البيعات</div><div className="dawaa-heading mt-1 text-3xl font-black">{truthLoading ? '…' : metrics.officialSales.toLocaleString('ar-EG')}</div></div>
            <div><div className="dawaa-muted text-xs">القيمة</div><div className="dawaa-heading mt-1 text-2xl font-black">{truthLoading ? '…' : money(metrics.officialRevenue)}</div></div>
          </div>
          <div className="dawaa-muted mt-4 text-[11px] leading-5">
            {metrics.resolvedStaff.toLocaleString('ar-EG')} بيع مرتبط بموظف بصورة آمنة، و{metrics.unresolvedStaff.toLocaleString('ar-EG')} غير محسوم الهوية.
          </div>
          {truthError ? <div className="dawaa-alert dawaa-alert--warning mt-3 text-xs">{truthError}</div> : null}
        </div>
      </section>

      <section className="dawaa-card">
        <div className="flex items-center justify-between gap-3">
          <div><div className="font-black">مسار إثبات البيع</div><div className="dawaa-muted mt-1 text-xs">من المحادثة إلى الفاتورة ثم الإسناد الرسمي.</div></div>
          <FileCheck2 size={20} className="dawaa-muted" />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['كل الحالات', metrics.total, '100٪'],
            ['فاتورة مختارة', metrics.withInvoice, pct(metrics.withInvoice, metrics.total)],
            ['بيع مؤكد', metrics.proven, pct(metrics.proven, metrics.total)],
            ['رسمي للموظف', metrics.officialSales, pct(metrics.officialSales, metrics.total)],
          ].map(([label, value, ratio]) => (
            <div key={String(label)} className="rounded-2xl border border-[var(--dawaa-theme-border)] p-3">
              <div className="dawaa-muted text-[11px]">{label}</div>
              <div className="dawaa-heading mt-1 text-xl font-black">{Number(value).toLocaleString('ar-EG')}</div>
              <div className="dawaa-muted mt-1 text-[10px]">{ratio}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl bg-[var(--dawaa-theme-soft)] p-3 text-xs"><div className="dawaa-muted">مدعوم بقوة</div><div className="mt-1 font-black">{metrics.strong.toLocaleString('ar-EG')}</div></div>
          <div className="rounded-xl bg-[var(--dawaa-theme-soft)] p-3 text-xs"><div className="dawaa-muted">متناقض</div><div className="mt-1 font-black">{metrics.contradicted.toLocaleString('ar-EG')}</div></div>
          <div className="rounded-xl bg-[var(--dawaa-theme-soft)] p-3 text-xs"><div className="dawaa-muted">Staff غير محسوم</div><div className="mt-1 font-black">{metrics.unresolvedStaff.toLocaleString('ar-EG')}</div></div>
        </div>
      </section>

      <section className="dawaa-card overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-[var(--dawaa-theme-border)] p-4 font-black"><ShieldCheck size={18} />صحة البيانات حسب الفرع</div>
        {!branches.length ? <div className="dawaa-muted p-6 text-center text-sm">لا توجد بيانات فروع.</div> : (
          <div className="grid gap-0 md:grid-cols-2">
            {branches.map(([branch, summary]) => (
              <div key={branch} className="border-b border-[var(--dawaa-theme-border)] p-4 md:border-l">
                <div className="flex items-center justify-between gap-3"><div className="dawaa-heading font-black">{branch}</div><div className="dawaa-muted text-xs">{summary.cases.toLocaleString('ar-EG')} حالة</div></div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-xl bg-[var(--dawaa-theme-soft)] p-2"><div className="dawaa-muted">فاتورة</div><div className="mt-1 font-black">{summary.invoices.toLocaleString('ar-EG')}</div></div>
                  <div className="rounded-xl bg-[var(--dawaa-theme-soft)] p-2"><div className="dawaa-muted">بيع مؤكد</div><div className="mt-1 font-black">{summary.proven.toLocaleString('ar-EG')}</div></div>
                  <div className="rounded-xl bg-[var(--dawaa-theme-soft)] p-2"><div className="dawaa-muted">مراجعة</div><div className="mt-1 font-black">{summary.review.toLocaleString('ar-EG')}</div></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
