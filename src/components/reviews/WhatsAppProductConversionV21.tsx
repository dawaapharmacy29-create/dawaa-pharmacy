import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, CircleDollarSign, PackageCheck, ReceiptText, ShoppingCart, TriangleAlert } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type CycleRow = Record<string, any>;
type GapRow = Record<string, any>;

function currentCycle(today = new Date()) {
  const year = today.getFullYear();
  const month = today.getMonth();
  const start = today.getDate() >= 26 ? new Date(year, month, 26) : new Date(year, month - 1, 26);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 25);
  const ymd = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { start: ymd(start), end: ymd(end) };
}

const pct = (value: unknown) => value == null ? '—' : `${Number(value).toFixed(1)}%`;
const money = (value: unknown) => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج`;

const gapLabel: Record<string, string> = {
  product_verified: 'الصنف مثبت في الفاتورة',
  invoice_has_no_item_proof: 'الفاتورة مؤكدة لكن تفاصيل الصنف غير متاحة',
  accepted_waiting_order_or_invoice: 'العميل وافق — ننتظر تأكيد الأوردر/الفاتورة',
  order_confirmed_waiting_invoice: 'الأوردر متأكد — ننتظر الفاتورة',
  waiting_invoice: 'بانتظار الفاتورة',
  open_opportunity: 'فرصة مفتوحة',
};

export default function WhatsAppProductConversionV21({ onOpenSource }: { onOpenSource?: (sourceId: string) => void }) {
  const cycle = useMemo(() => currentCycle(), []);
  const [rows, setRows] = useState<CycleRow[]>([]);
  const [gaps, setGaps] = useState<GapRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setError(null);
      const [cycleResult, gapResult] = await Promise.all([
        supabase.from('whatsapp_product_conversion_cycle_v21').select('*').eq('cycle_start', cycle.start).order('opportunities', { ascending: false }).limit(200),
        supabase.from('whatsapp_product_conversion_gap_v21').select('*').neq('sale_verified_scope', 'product').order('updated_at', { ascending: false }).limit(100),
      ]);
      if (cancelled) return;
      const firstError = cycleResult.error || gapResult.error;
      if (firstError) { setError(firstError.message); setRows([]); setGaps([]); }
      else { setRows(cycleResult.data || []); setGaps(gapResult.data || []); }
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [cycle.start]);

  const totals = useMemo(() => rows.reduce((acc, row) => ({
    opportunities: acc.opportunities + Number(row.opportunities || 0),
    conversationVerified: acc.conversationVerified + Number(row.conversation_verified || 0),
    productVerified: acc.productVerified + Number(row.product_verified || 0),
    productRevenue: acc.productRevenue + Number(row.verified_product_revenue || 0),
  }), { opportunities: 0, conversationVerified: 0, productVerified: 0, productRevenue: 0 }), [rows]);

  const conversationRate = totals.opportunities ? 100 * totals.conversationVerified / totals.opportunities : null;
  const productRate = totals.opportunities ? 100 * totals.productVerified / totals.opportunities : null;
  const proofGap = Math.max(0, totals.conversationVerified - totals.productVerified);

  return (
    <section className="dawaa-card dawaa-card--raised p-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 font-black text-white"><PackageCheck size={18}/>Product Conversion Legacy V21</div>
          <div className="mt-1 max-w-4xl text-xs leading-5 text-slate-400">عرض Legacy مبني على whatsapp_sales_opportunities_v17. قيمة Conversation verified التاريخية قد تكون ناتجة عن مطابقة فاتورة آلية قديمة وليست Sale Proof رسميًا. إثبات الصنف نفسه غير متاح حاليًا بدون Line Items.</div>
        </div>
        <div className="text-[10px] text-slate-500">الدورة الحالية: {cycle.start} → {cycle.end}</div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <Metric icon={ShoppingCart} label="كل الفرص" value={totals.opportunities} />
        <Metric icon={ReceiptText} label="مطابقة فاتورة Legacy" value={totals.conversationVerified} />
        <Metric icon={PackageCheck} label="الصنف مثبت ببند فاتورة" value={totals.productVerified} />
        <Metric icon={BadgeCheck} label="Legacy Conversation Match %" value={pct(conversationRate)} />
        <Metric icon={BadgeCheck} label="Product Proof %" value={pct(productRate)} />
        <Metric icon={CircleDollarSign} label="إيراد أصناف مثبت" value={money(totals.productRevenue)} />
      </div>

      {proofGap > 0 ? <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/5 p-3 text-xs leading-5 text-amber-100"><b>{proofGap.toLocaleString('ar-EG')}</b> حالة Legacy عندها مطابقة فاتورة على مستوى المحادثة لكن لا يوجد دليل Line Item يثبت الصنف بعينه. لا تعتبر هذه الحالات بيعًا موثقًا رسميًا.</div> : null}
      {loading ? <div className="mt-4 text-sm text-slate-500">جاري تحميل Conversion الموثق...</div> : null}
      {error ? <div className="mt-4 rounded-xl border border-rose-400/20 bg-rose-500/5 p-3 text-xs text-rose-200">تعذر تحميل بيانات Product Conversion: {error}</div> : null}

      {!loading && !error && rows.length ? (
        <div className="mt-4 space-y-2">
          <div className="text-xs font-black text-slate-200">حسب الدكتور — الدورة الحالية</div>
          {rows.map((row, index) => (
            <div key={`${row.staff_id || row.staff_name || 'unknown'}-${index}`} className="rounded-2xl border border-slate-800 bg-slate-950/25 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-white">{row.staff_name || 'موظف غير محدد'}</b><span className="text-[10px] text-slate-500">{row.branch || '—'}</span></div>
              <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3 xl:grid-cols-7">
                <K label="فرص" value={row.opportunities || 0}/><K label="ترشيح+" value={row.recommendations_or_later || 0}/><K label="قبول+" value={row.accepted_or_later || 0}/>
                <K label="Legacy invoice match" value={row.conversation_verified || 0}/><K label="Product line proof" value={row.product_verified || 0}/>
                <K label="Legacy match %" value={pct(row.conversation_conversion_rate)}/><K label="Product proof %" value={pct(row.product_conversion_rate)}/>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!loading && !error ? (
        <div className="mt-5">
          <div className="flex items-center gap-2 text-xs font-black text-slate-200"><TriangleAlert size={15}/>أحدث فجوات الإثبات</div>
          {!gaps.length ? <div className="mt-2 text-xs text-slate-500">لا توجد فرص معلقة ظاهرة حاليًا.</div> : (
            <div className="mt-2 space-y-2">
              {gaps.slice(0, 20).map((row) => (
                <button key={row.opportunity_id} type="button" onClick={() => row.root_source_id && onOpenSource?.(String(row.root_source_id))} className="w-full rounded-xl border border-slate-800 bg-slate-950/25 p-3 text-right hover:border-slate-600">
                  <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-xs text-white">{row.customer_name || row.customer_code || 'عميل غير محدد'} · {row.product_name || row.product_code || 'صنف غير محدد'}</b><span className="text-[10px] text-amber-200">{gapLabel[String(row.verification_gap)] || row.verification_gap || 'فرصة مفتوحة'}</span></div>
                  <div className="mt-1 text-[10px] text-slate-500">{row.attributed_staff_name || 'موظف غير محدد'} · {row.branch || '—'}{row.matched_invoice_number ? ` · فاتورة ${row.matched_invoice_number}` : ''}</div>
                  {row.next_action ? <div className="mt-1 text-[11px] text-slate-300">التالي: {row.next_action}</div> : null}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-3 text-[10px] leading-5 text-slate-500">هذا القسم Legacy للمقارنة التاريخية فقط. invoice_match_status=verified لا يساوي Sale Proof موثق. Product proof يتطلب بند فاتورة فعلي، وهو غير متاح حاليًا في sales_invoice_items_v21.</div>
    </section>
  );
}

function Metric({ icon: Icon, label, value }: { icon: any; label: string; value: any }) { return <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-3"><div className="flex items-center gap-2 text-[10px] text-slate-500"><Icon size={14}/>{label}</div><div className="mt-1 text-lg font-black text-white">{value}</div></div>; }
function K({ label, value }: { label: string; value: any }) { return <div><div className="text-[10px] text-slate-500">{label}</div><div className="mt-0.5 font-black text-slate-100">{value}</div></div>; }
