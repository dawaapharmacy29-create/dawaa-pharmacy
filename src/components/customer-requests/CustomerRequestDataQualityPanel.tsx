import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Link2, Loader2, PackageSearch, RefreshCw, ShieldCheck, UserRound, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import CustomerSmartSearch from '@/components/CustomerSmartSearch';
import ProductSmartSearch from '@/components/ProductSmartSearch';
import type { CustomerSearchResult } from '@/lib/customerSearch';
import type { CustomerRequest } from '@/lib/api/customerRequests';
import { linkCustomerRequestProduct, type CatalogProduct } from '@/lib/api/productsCatalog';
import {
  inspectCustomerRequestDataQuality,
  refreshCustomerRequest,
  repairCustomerRequestCustomer,
  type RequestDataQuality,
} from '@/lib/api/customerRequestDataQuality';

type RequestWithProduct = CustomerRequest & {
  product_id?: string | null;
  product_code?: string | null;
  product_price?: number | null;
};

export default function CustomerRequestDataQualityPanel({
  request,
  onUpdated,
}: {
  request: RequestWithProduct;
  onUpdated: (request: RequestWithProduct) => void;
}) {
  const [quality, setQuality] = useState<RequestDataQuality | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [manualCustomer, setManualCustomer] = useState<CustomerSearchResult | null>(null);
  const [manualProduct, setManualProduct] = useState<CatalogProduct | null>(null);
  const [showCustomerFix, setShowCustomerFix] = useState(false);
  const [showProductFix, setShowProductFix] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setQuality(await inspectCustomerRequestDataQuality(request));
    } catch (error) {
      toast.error(`تعذر فحص جودة بيانات الطلب: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setManualCustomer(null);
    setManualProduct(null);
    setShowCustomerFix(false);
    setShowProductFix(false);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id, request.updated_at, request.customer_id, request.customer_code, request.customer_phone, request.product_id, request.product_code]);

  const totalIssues = (quality?.customerIssues.length || 0) + (quality?.productIssues.length || 0);
  const healthy = !loading && totalIssues === 0;
  const customerHealthy = !quality?.customerIssues.length;
  const productHealthy = !quality?.productIssues.length;

  const suggestedCustomer = quality?.customerCandidate || null;
  const suggestedProduct = quality?.productCandidate || null;
  const selectedCustomer = manualCustomer || suggestedCustomer;
  const selectedProduct = manualProduct || suggestedProduct;

  const repairCustomer = async (customer: CustomerSearchResult) => {
    setSaving(true);
    try {
      const updated = await repairCustomerRequestCustomer(request.id, customer, true);
      onUpdated(updated as RequestWithProduct);
      toast.success('تم إصلاح ربط العميل وتحديث الكود والهاتف');
      setShowCustomerFix(false);
    } catch (error) {
      toast.error(`تعذر إصلاح ربط العميل: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const repairProduct = async (product: CatalogProduct) => {
    if (!product.id) return toast.error('الصنف المختار لا يحتوي على معرّف صالح');
    setSaving(true);
    try {
      await linkCustomerRequestProduct(request.id, product.id);
      const updated = await refreshCustomerRequest(request.id);
      onUpdated(updated as RequestWithProduct);
      toast.success('تم ربط الطلب بالصنف الصحيح في الكتالوج');
      setShowProductFix(false);
    } catch (error) {
      toast.error(`تعذر إصلاح ربط الصنف: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const score = useMemo(() => {
    if (loading) return null;
    const checks = [
      Boolean(request.customer_id),
      Boolean(String(request.customer_code || '').trim()),
      Boolean(String(request.customer_phone || '').trim()),
      Boolean(String(request.branch || '').trim()),
      Boolean(request.product_id),
      Boolean(String(request.product_code || '').trim()),
      Boolean(String(request.medicine_name || '').trim()),
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [loading, request]);

  return (
    <section className={`mb-4 rounded-2xl border p-4 ${healthy ? 'border-emerald-400/25 bg-emerald-500/[0.06]' : 'border-amber-400/25 bg-amber-500/[0.06]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${healthy ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-200'}`}>
            {healthy ? <ShieldCheck size={19} /> : <Wrench size={19} />}
          </div>
          <div>
            <div className="font-black text-white">جودة وربط بيانات الطلب</div>
            <div className="mt-1 text-xs text-slate-400">مراجعة العميل والكود والهاتف والفرع وربط الصنف بالكتالوج قبل متابعة التنفيذ.</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {score !== null && <span className={`rounded-full px-3 py-1 text-xs font-black ${score === 100 ? 'bg-emerald-500/15 text-emerald-200' : score >= 70 ? 'bg-amber-500/15 text-amber-200' : 'bg-red-500/15 text-red-200'}`}>جودة {score}%</span>}
          <button type="button" onClick={() => void load()} disabled={loading || saving} className="rounded-xl border border-slate-600 p-2 text-slate-300 hover:bg-slate-800" title="إعادة الفحص">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 h-24 animate-pulse rounded-xl bg-slate-800/60" />
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className={`rounded-xl border p-3 ${customerHealthy ? 'border-emerald-400/20 bg-emerald-500/[0.05]' : 'border-slate-700 bg-slate-950/35'}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-black text-white"><UserRound size={16} className="text-cyan-300" /> ربط العميل</div>
              {customerHealthy ? <span className="inline-flex items-center gap-1 text-[11px] font-black text-emerald-300"><CheckCircle2 size={13} /> سليم</span> : <span className="inline-flex items-center gap-1 text-[11px] font-black text-amber-200"><AlertTriangle size={13} /> يحتاج مراجعة</span>}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <Info label="العميل" value={request.customer_name || '—'} />
              <Info label="الكود" value={request.customer_code || '—'} />
              <Info label="الهاتف" value={request.customer_phone || '—'} />
              <Info label="الفرع" value={request.branch || '—'} />
            </div>
            {!!quality?.customerIssues.length && <div className="mt-3 space-y-1">{quality.customerIssues.map((issue) => <div key={issue} className="flex items-start gap-1.5 text-[11px] font-bold text-amber-200"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{issue}</div>)}</div>}
            {suggestedCustomer && !customerHealthy && (
              <div className="mt-3 rounded-xl border border-cyan-400/20 bg-cyan-500/[0.06] p-2.5 text-xs">
                <div className="font-black text-cyan-100">تطابق مقترح: {suggestedCustomer.name}</div>
                <div className="mt-1 text-[10px] text-slate-400">كود {suggestedCustomer.code || '—'} · {suggestedCustomer.phone || '—'} · {suggestedCustomer.branch || 'فرع غير محدد'}</div>
                <button type="button" disabled={saving} onClick={() => void repairCustomer(suggestedCustomer)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-cyan-500/15 px-3 py-1.5 text-[11px] font-black text-cyan-100 hover:bg-cyan-500/25"><Link2 size={13} /> إصلاح الربط المقترح</button>
              </div>
            )}
            {!customerHealthy && <button type="button" onClick={() => setShowCustomerFix((v) => !v)} className="mt-3 text-[11px] font-black text-cyan-200 hover:text-cyan-100">{showCustomerFix ? 'إخفاء البحث اليدوي' : 'اختيار عميل آخر يدويًا'}</button>}
            {showCustomerFix && <div className="mt-3"><CustomerSmartSearch value={manualCustomer} onSelect={setManualCustomer} branchFilter={request.branch || undefined} allowCreate={false} disabled={saving} />{manualCustomer && <button type="button" disabled={saving} onClick={() => void repairCustomer(manualCustomer)} className="btn-primary mt-2 w-full text-xs">تأكيد ربط العميل المختار</button>}</div>}
          </div>

          <div className={`rounded-xl border p-3 ${productHealthy ? 'border-emerald-400/20 bg-emerald-500/[0.05]' : 'border-slate-700 bg-slate-950/35'}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-black text-white"><PackageSearch size={16} className="text-violet-300" /> ربط الصنف</div>
              {productHealthy ? <span className="inline-flex items-center gap-1 text-[11px] font-black text-emerald-300"><CheckCircle2 size={13} /> سليم</span> : <span className="inline-flex items-center gap-1 text-[11px] font-black text-amber-200"><AlertTriangle size={13} /> يحتاج مراجعة</span>}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <Info label="الصنف" value={request.medicine_name || '—'} />
              <Info label="كود الصنف" value={request.product_code || '—'} />
              <Info label="معرّف الكتالوج" value={request.product_id ? 'مربوط' : 'غير مربوط'} />
              <Info label="الكمية" value={String(request.quantity || 1)} />
            </div>
            {!!quality?.productIssues.length && <div className="mt-3 space-y-1">{quality.productIssues.map((issue) => <div key={issue} className="flex items-start gap-1.5 text-[11px] font-bold text-amber-200"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{issue}</div>)}</div>}
            {suggestedProduct && !productHealthy && (
              <div className="mt-3 rounded-xl border border-violet-400/20 bg-violet-500/[0.06] p-2.5 text-xs">
                <div className="font-black text-violet-100">تطابق مقترح: {suggestedProduct.name}</div>
                <div className="mt-1 text-[10px] text-slate-400">كود {suggestedProduct.code} · السعر {suggestedProduct.price ?? '—'} ج</div>
                <button type="button" disabled={saving} onClick={() => void repairProduct(suggestedProduct)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-violet-500/15 px-3 py-1.5 text-[11px] font-black text-violet-100 hover:bg-violet-500/25"><Link2 size={13} /> إصلاح ربط الصنف</button>
              </div>
            )}
            {!productHealthy && <button type="button" onClick={() => setShowProductFix((v) => !v)} className="mt-3 text-[11px] font-black text-violet-200 hover:text-violet-100">{showProductFix ? 'إخفاء البحث اليدوي' : 'اختيار الصنف الصحيح يدويًا'}</button>}
            {showProductFix && <div className="mt-3"><ProductSmartSearch value={manualProduct} onSelect={setManualProduct} disabled={saving} />{manualProduct && <button type="button" disabled={saving} onClick={() => void repairProduct(manualProduct)} className="btn-primary mt-2 w-full text-xs">تأكيد ربط الصنف المختار</button>}</div>}
          </div>
        </div>
      )}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-slate-900/50 px-2.5 py-2"><div className="text-[9px] font-bold text-slate-500">{label}</div><div className="mt-0.5 truncate font-black text-slate-200" title={value}>{value}</div></div>;
}
