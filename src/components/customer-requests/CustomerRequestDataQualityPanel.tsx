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
    <section className={`mb-4 rounded-2xl border p-4 ${healthy ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)]/[0.06]' : 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]/[0.06]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${healthy ? 'bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]' : 'bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]'}`}>
            {healthy ? <ShieldCheck size={19} /> : <Wrench size={19} />}
          </div>
          <div>
            <div className="font-black text-[var(--dawaa-theme-heading)]">جودة وربط بيانات الطلب</div>
            <div className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">مراجعة العميل والكود والهاتف والفرع وربط الصنف بالكتالوج قبل متابعة التنفيذ.</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {score !== null && <span className={`rounded-full px-3 py-1 text-xs font-black ${score === 100 ? 'bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]' : score >= 70 ? 'bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]' : 'bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]'}`}>جودة {score}%</span>}
          <button type="button" onClick={() => void load()} disabled={loading || saving} className="rounded-xl border border-[var(--dawaa-theme-border)] p-2 text-[var(--dawaa-theme-text)] hover:bg-[var(--dawaa-theme-surface-2)]" title="إعادة الفحص">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 h-24 animate-pulse rounded-xl bg-[var(--dawaa-theme-surface-2)]" />
      ) : (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className={`rounded-xl border p-3 ${customerHealthy ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)]/[0.05]' : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)]'}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><UserRound size={16} className="text-[var(--dawaa-theme-primary)]" /> ربط العميل</div>
              {customerHealthy ? <span className="inline-flex items-center gap-1 text-[11px] font-black text-[var(--dawaa-status-success-text)]"><CheckCircle2 size={13} /> سليم</span> : <span className="inline-flex items-center gap-1 text-[11px] font-black text-[var(--dawaa-status-warning-text)]"><AlertTriangle size={13} /> يحتاج مراجعة</span>}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <Info label="العميل" value={request.customer_name || '—'} />
              <Info label="الكود" value={request.customer_code || '—'} />
              <Info label="الهاتف" value={request.customer_phone || '—'} />
              <Info label="الفرع" value={request.branch || '—'} />
            </div>
            {!!quality?.customerIssues.length && <div className="mt-3 space-y-1">{quality.customerIssues.map((issue) => <div key={issue} className="flex items-start gap-1.5 text-[11px] font-bold text-[var(--dawaa-status-warning-text)]"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{issue}</div>)}</div>}
            {suggestedCustomer && !customerHealthy && (
              <div className="mt-3 rounded-xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-primary)]/[0.06] p-2.5 text-xs">
                <div className="font-black text-[var(--dawaa-theme-primary)]">تطابق مقترح: {suggestedCustomer.name}</div>
                <div className="mt-1 text-[10px] text-[var(--dawaa-theme-muted)]">كود {suggestedCustomer.code || '—'} · {suggestedCustomer.phone || '—'} · {suggestedCustomer.branch || 'فرع غير محدد'}</div>
                <button type="button" disabled={saving} onClick={() => void repairCustomer(suggestedCustomer)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[var(--dawaa-theme-accent-soft)] px-3 py-1.5 text-[11px] font-black text-[var(--dawaa-theme-primary)] hover:bg-[var(--dawaa-theme-accent-soft)]"><Link2 size={13} /> إصلاح الربط المقترح</button>
              </div>
            )}
            {!customerHealthy && <button type="button" onClick={() => setShowCustomerFix((v) => !v)} className="mt-3 text-[11px] font-black text-[var(--dawaa-theme-primary)] hover:text-[var(--dawaa-theme-primary)]">{showCustomerFix ? 'إخفاء البحث اليدوي' : 'اختيار عميل آخر يدويًا'}</button>}
            {showCustomerFix && <div className="mt-3"><CustomerSmartSearch value={manualCustomer} onSelect={setManualCustomer} branchFilter={request.branch || undefined} allowCreate={false} disabled={saving} />{manualCustomer && <button type="button" disabled={saving} onClick={() => void repairCustomer(manualCustomer)} className="btn-primary mt-2 w-full text-xs">تأكيد ربط العميل المختار</button>}</div>}
          </div>

          <div className={`rounded-xl border p-3 ${productHealthy ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)]/[0.05]' : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)]'}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><PackageSearch size={16} className="text-[var(--dawaa-status-info-text)]" /> ربط الصنف</div>
              {productHealthy ? <span className="inline-flex items-center gap-1 text-[11px] font-black text-[var(--dawaa-status-success-text)]"><CheckCircle2 size={13} /> سليم</span> : <span className="inline-flex items-center gap-1 text-[11px] font-black text-[var(--dawaa-status-warning-text)]"><AlertTriangle size={13} /> يحتاج مراجعة</span>}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <Info label="الصنف" value={request.medicine_name || '—'} />
              <Info label="كود الصنف" value={request.product_code || '—'} />
              <Info label="معرّف الكتالوج" value={request.product_id ? 'مربوط' : 'غير مربوط'} />
              <Info label="الكمية" value={String(request.quantity || 1)} />
            </div>
            {!!quality?.productIssues.length && <div className="mt-3 space-y-1">{quality.productIssues.map((issue) => <div key={issue} className="flex items-start gap-1.5 text-[11px] font-bold text-[var(--dawaa-status-warning-text)]"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{issue}</div>)}</div>}
            {suggestedProduct && !productHealthy && (
              <div className="mt-3 rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)]/[0.06] p-2.5 text-xs">
                <div className="font-black text-[var(--dawaa-status-info-text)]">تطابق مقترح: {suggestedProduct.name}</div>
                <div className="mt-1 text-[10px] text-[var(--dawaa-theme-muted)]">كود {suggestedProduct.code} · السعر {suggestedProduct.price ?? '—'} ج</div>
                <button type="button" disabled={saving} onClick={() => void repairProduct(suggestedProduct)} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[var(--dawaa-status-info-bg)] px-3 py-1.5 text-[11px] font-black text-[var(--dawaa-status-info-text)] hover:bg-[var(--dawaa-status-info-bg)]"><Link2 size={13} /> إصلاح ربط الصنف</button>
              </div>
            )}
            {!productHealthy && <button type="button" onClick={() => setShowProductFix((v) => !v)} className="mt-3 text-[11px] font-black text-[var(--dawaa-status-info-text)] hover:text-[var(--dawaa-status-info-text)]">{showProductFix ? 'إخفاء البحث اليدوي' : 'اختيار الصنف الصحيح يدويًا'}</button>}
            {showProductFix && <div className="mt-3"><ProductSmartSearch value={manualProduct} onSelect={setManualProduct} disabled={saving} />{manualProduct && <button type="button" disabled={saving} onClick={() => void repairProduct(manualProduct)} className="btn-primary mt-2 w-full text-xs">تأكيد ربط الصنف المختار</button>}</div>}
          </div>
        </div>
      )}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-[var(--dawaa-theme-surface)] px-2.5 py-2"><div className="text-[9px] font-bold text-[var(--dawaa-theme-muted)]">{label}</div><div className="mt-0.5 truncate font-black text-[var(--dawaa-theme-heading)]" title={value}>{value}</div></div>;
}
