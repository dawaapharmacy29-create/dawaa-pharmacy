import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Boxes, CircleDollarSign, PackageX, Sparkles, UsersRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { SalesIntelligenceCycleScopeV1 } from '@/lib/salesIntelligence/dashboardScopeV1';

type DemandRow = {
  branch: string | null;
  product_id: string;
  product_code: string;
  product_name: string;
  inquiry_opportunities: number;
  unique_customers: number;
  unavailable_count: number;
  accepted_or_later_count: number;
  acceptance_rate: number | null;
};

type LeakageRow = {
  branch: string | null;
  leakage_code: string;
  cases_count: number;
  unique_customers: number;
  unique_products: number;
  staff_attributed_cases: number;
};

type UnresolvedRow = {
  branch: string | null;
  unresolved_type: string;
  unresolved_mentions: number;
  conversations_affected: number;
};

const LEAK_LABELS: Record<string, string> = {
  stock_unavailable: 'عدم توفر الصنف',
  no_alternative: 'عدم حسم بديل',
  price_objection: 'اعتراض على السعر',
  response_delay: 'تأخر الرد',
  closing_gap: 'فجوة في إغلاق البيع',
  customer_no_reply: 'العميل لم يرد',
  recommendation_pending: 'ترشيح بدون حسم',
  delivery_issue: 'مشكلة تنفيذ أو توصيل',
  customer_rejected: 'رفض العميل',
  unknown: 'سبب غير محسوم',
};

const ACTION_HINTS: Record<string, string> = {
  stock_unavailable: 'راجع التوفر والمشتريات والبدائل للصنف الأكثر تكرارًا.',
  no_alternative: 'راجع الحالات التي لم يُعرض فيها بديل واضح بعد عدم التوفر.',
  price_objection: 'راجع الفارق السعري والعروض والبدائل الاقتصادية.',
  response_delay: 'راجع زمن الرد في المحادثات المتأثرة.',
  closing_gap: 'راجع خطوة التأكيد والإغلاق بعد موافقة العميل.',
  customer_no_reply: 'ميّز بين متابعة تستحق إعادة التواصل وحالة انتهت طبيعيًا.',
  recommendation_pending: 'راجع الترشيحات التي لم تصل لقبول أو رفض واضح.',
  delivery_issue: 'راجع سبب التنفيذ أو التوصيل مع الفرع والدليفري.',
  customer_rejected: 'راجع سبب الرفض إن كان متاحًا قبل اقتراح بديل.',
  unknown: 'تحتاج مراجعة QA لتحديد السبب الحقيقي قبل أي إجراء.',
};

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function SalesIntelligenceOpportunityCenterV1({
  cycle,
  branch,
}: {
  cycle: SalesIntelligenceCycleScopeV1;
  branch: string;
}) {
  const [demand, setDemand] = useState<DemandRow[]>([]);
  const [leakage, setLeakage] = useState<LeakageRow[]>([]);
  const [unresolved, setUnresolved] = useState<UnresolvedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceEmpty, setSourceEmpty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);

      let demandQuery = supabase
        .from('whatsapp_product_demand_monthly_v22')
        .select('branch,product_id,product_code,product_name,inquiry_opportunities,unique_customers,unavailable_count,accepted_or_later_count,acceptance_rate')
        .eq('cycle_start', cycle.start)
        .limit(500);

      let leakageQuery = supabase
        .from('whatsapp_sales_leakage_monthly_v22')
        .select('branch,leakage_code,cases_count,unique_customers,unique_products,staff_attributed_cases')
        .eq('cycle_start', cycle.start)
        .limit(200);

      let unresolvedQuery = supabase
        .from('whatsapp_product_demand_unresolved_v22')
        .select('branch,unresolved_type,unresolved_mentions,conversations_affected')
        .eq('cycle_start', cycle.start)
        .limit(200);

      if (branch !== 'all') {
        demandQuery = demandQuery.eq('branch', branch);
        leakageQuery = leakageQuery.eq('branch', branch);
        unresolvedQuery = unresolvedQuery.eq('branch', branch);
      }

      const [demandResult, leakageResult, unresolvedResult] = await Promise.all([
        demandQuery,
        leakageQuery,
        unresolvedQuery,
      ]);

      if (cancelled) return;

      const demandRows = demandResult.error ? [] : ((demandResult.data || []) as DemandRow[]);
      const leakageRows = leakageResult.error ? [] : ((leakageResult.data || []) as LeakageRow[]);
      const unresolvedRows = unresolvedResult.error ? [] : ((unresolvedResult.data || []) as UnresolvedRow[]);

      setDemand(demandRows);
      setLeakage(leakageRows);
      setUnresolved(unresolvedRows);
      setSourceEmpty(!demandRows.length && !leakageRows.length && !unresolvedRows.length);
      setLoading(false);
    }

    void load();
    return () => { cancelled = true; };
  }, [branch, cycle.start]);

  const signals = useMemo(() => {
    const topDemand = [...demand]
      .sort((a, b) => number(b.inquiry_opportunities) - number(a.inquiry_opportunities))
      .slice(0, 5);

    const stockPressure = [...demand]
      .filter((row) => number(row.unavailable_count) > 0)
      .sort((a, b) => number(b.unavailable_count) - number(a.unavailable_count))
      .slice(0, 5);

    const lowConversion = [...demand]
      .filter((row) => number(row.inquiry_opportunities) >= 2)
      .sort((a, b) => number(a.acceptance_rate ?? 0) - number(b.acceptance_rate ?? 0))
      .slice(0, 5);

    const topLeakage = [...leakage]
      .sort((a, b) => number(b.cases_count) - number(a.cases_count))
      .slice(0, 5);

    const unresolvedMentions = unresolved.reduce((sum, row) => sum + number(row.unresolved_mentions), 0);

    return { topDemand, stockPressure, lowConversion, topLeakage, unresolvedMentions };
  }, [demand, leakage, unresolved]);

  if (loading) {
    return <section className="dawaa-card"><div className="dawaa-muted py-8 text-center text-sm">جاري تجهيز أولويات الفرص وفقد البيع...</div></section>;
  }

  if (sourceEmpty) {
    return (
      <section className="dawaa-card">
        <div className="flex items-start gap-3">
          <span className="dawaa-icon-tile h-10 w-10 shrink-0"><Sparkles size={18} /></span>
          <div>
            <div className="font-black">Opportunity Center جاهز — مصدر V22 لم يُملأ بعد</div>
            <div className="dawaa-muted mt-1 text-xs leading-6">
              لا توجد حاليًا صفوف Product Demand / Lost Sales في الدورة المختارة. لذلك لن نعرض أرقام صفر على أنها أداء حقيقي.
              بمجرد اكتمال الـV22 Backfill سيظهر هنا تلقائيًا أكثر الأصناف طلبًا، ضغط عدم التوفر، أسباب فقد البيع، وجودة الربط.
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="dawaa-card" dir="rtl">
      <div>
        <div className="flex items-center gap-2 font-black"><Sparkles size={18} />Opportunity Center</div>
        <div className="dawaa-muted mt-1 text-xs">أولويات تشغيلية من بيانات Product Demand الموثقة، بدون تقدير مالي افتراضي.</div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
          <div className="flex items-center gap-2 font-black"><Boxes size={16} />أكثر الأصناف طلبًا</div>
          <div className="mt-3 space-y-2">
            {signals.topDemand.map((row, index) => (
              <div key={row.product_id + ':' + (row.branch || '')} className="flex items-center justify-between gap-3 border-t border-[var(--dawaa-theme-border)] py-2 text-xs">
                <div><b>{index + 1}. {row.product_name}</b><div className="dawaa-muted mt-1">كود {row.product_code} • {row.unique_customers} عميل</div></div>
                <div className="text-left"><div className="font-black">{number(row.inquiry_opportunities).toLocaleString('ar-EG')} طلب</div><div className="dawaa-muted">قبول {row.acceptance_rate == null ? '—' : number(row.acceptance_rate).toLocaleString('ar-EG') + '٪'}</div></div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
          <div className="flex items-center gap-2 font-black"><AlertTriangle size={16} />أسباب فقد البيع الأعلى</div>
          <div className="mt-3 space-y-2">
            {signals.topLeakage.map((row) => (
              <div key={(row.branch || '') + ':' + row.leakage_code} className="border-t border-[var(--dawaa-theme-border)] py-2 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <b>{LEAK_LABELS[row.leakage_code] || row.leakage_code}</b>
                  <span className="dawaa-badge dawaa-badge--warning">{number(row.cases_count).toLocaleString('ar-EG')} حالة</span>
                </div>
                <div className="dawaa-muted mt-1">{ACTION_HINTS[row.leakage_code] || ACTION_HINTS.unknown}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
          <div className="flex items-center gap-2 font-black"><PackageX size={16} />ضغط عدم التوفر</div>
          <div className="mt-3 space-y-2">
            {signals.stockPressure.length ? signals.stockPressure.map((row) => (
              <div key={row.product_id + ':' + (row.branch || '')} className="flex items-center justify-between gap-3 border-t border-[var(--dawaa-theme-border)] py-2 text-xs">
                <div><b>{row.product_name}</b><div className="dawaa-muted mt-1">{row.branch || 'كل الفروع'}</div></div>
                <div className="font-black">{number(row.unavailable_count).toLocaleString('ar-EG')} عدم توفر</div>
              </div>
            )) : <div className="dawaa-muted py-5 text-center text-xs">لا توجد حالات عدم توفر ضمن البيانات الحالية.</div>}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
          <div className="flex items-center gap-2 font-black"><UsersRound size={16} />فرص تحتاج تحسين الإغلاق</div>
          <div className="mt-3 space-y-2">
            {signals.lowConversion.length ? signals.lowConversion.map((row) => (
              <div key={row.product_id + ':' + (row.branch || '')} className="flex items-center justify-between gap-3 border-t border-[var(--dawaa-theme-border)] py-2 text-xs">
                <div><b>{row.product_name}</b><div className="dawaa-muted mt-1">{number(row.inquiry_opportunities).toLocaleString('ar-EG')} طلب</div></div>
                <div className="font-black">قبول {row.acceptance_rate == null ? '—' : number(row.acceptance_rate).toLocaleString('ar-EG') + '٪'}</div>
              </div>
            )) : <div className="dawaa-muted py-5 text-center text-xs">لا توجد عينة كافية لحساب فرص التحسين حاليًا.</div>}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-[var(--dawaa-theme-soft)] p-3 text-xs"><div className="dawaa-muted">أصناف عليها طلب</div><div className="mt-1 text-lg font-black">{demand.length.toLocaleString('ar-EG')}</div></div>
        <div className="rounded-xl bg-[var(--dawaa-theme-soft)] p-3 text-xs"><div className="dawaa-muted">أسباب فقد مسجلة</div><div className="mt-1 text-lg font-black">{leakage.length.toLocaleString('ar-EG')}</div></div>
        <div className="rounded-xl bg-[var(--dawaa-theme-soft)] p-3 text-xs"><div className="dawaa-muted">عبارات غير محسومة</div><div className="mt-1 text-lg font-black">{signals.unresolvedMentions.toLocaleString('ar-EG')}</div></div>
      </div>

      <div className="dawaa-muted mt-3 flex items-center gap-2 text-[10px]">
        <CircleDollarSign size={12} />
        لا يتم عرض “قيمة مبيعات مفقودة” إلا إذا توفر أساس مالي موثق؛ عدد الفرص وحده لا يتحول تلقائيًا إلى جنيهات.
      </div>
    </section>
  );
}
