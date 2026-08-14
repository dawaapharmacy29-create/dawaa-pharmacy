import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, UsersRound, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { normalizePhone, searchCustomers, type CustomerSearchResult } from '@/lib/customerSearch';
import { searchProductsCatalog, linkCustomerRequestProduct, type CatalogProduct } from '@/lib/api/productsCatalog';
import { repairCustomerRequestCustomer } from '@/lib/api/customerRequestDataQuality';
import type { QualityCenterRequest, QualityIssueKey } from '@/lib/api/customerRequestQualityCenter';

type Row = { request: QualityCenterRequest; issues: QualityIssueKey[] };
type Group = {
  id: string;
  kind: 'customer' | 'product';
  key: string;
  label: string;
  rows: Row[];
};

type CandidateState = {
  status: 'idle' | 'loading' | 'ready' | 'blocked' | 'done';
  customer?: CustomerSearchResult | null;
  product?: CatalogProduct | null;
  reason?: string;
};

function normalizeCode(value: unknown) {
  return String(value ?? '').trim().replace(/\.0$/, '').toUpperCase();
}

function buildGroups(rows: Row[]): Group[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const request = row.request;
    const needsCustomer = row.issues.some((issue) => ['customer_link', 'customer_code', 'phone'].includes(issue));
    const customerCode = String(request.customer_code || '').trim();
    const phone = normalizePhone(request.customer_phone);
    if (needsCustomer && (customerCode || phone)) {
      const stableKey = customerCode ? `code:${customerCode}` : `phone:${phone}`;
      const id = `customer:${stableKey}`;
      const existing = groups.get(id) || { id, kind: 'customer' as const, key: customerCode || phone, label: customerCode ? `كود العميل ${customerCode}` : `هاتف ${phone}`, rows: [] };
      existing.rows.push(row);
      groups.set(id, existing);
    }

    const productCode = normalizeCode(request.product_code);
    const needsProduct = row.issues.some((issue) => ['product_link', 'product_code'].includes(issue));
    if (needsProduct && productCode) {
      const id = `product:${productCode}`;
      const existing = groups.get(id) || { id, kind: 'product' as const, key: productCode, label: `كود الصنف ${productCode}`, rows: [] };
      existing.rows.push(row);
      groups.set(id, existing);
    }
  }
  return [...groups.values()].filter((group) => group.rows.length >= 2).sort((a, b) => b.rows.length - a.rows.length);
}

async function runInBatches<T>(items: T[], worker: (item: T) => Promise<unknown>, batchSize = 6) {
  let success = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(worker));
    success += results.filter((result) => result.status === 'fulfilled').length;
    failed += results.filter((result) => result.status === 'rejected').length;
  }
  return { success, failed };
}

export default function CustomerRequestBulkRepairPanel({ rows, onChanged }: { rows: Row[]; onChanged: () => void }) {
  const groups = useMemo(() => buildGroups(rows), [rows]);
  const [states, setStates] = useState<Record<string, CandidateState>>({});
  const [applying, setApplying] = useState<string>('');

  if (!groups.length) return null;

  const resolveGroup = async (group: Group) => {
    setStates((prev) => ({ ...prev, [group.id]: { status: 'loading' } }));
    try {
      if (group.kind === 'customer') {
        const results = await searchCustomers(group.key, 20);
        const normalizedPhoneKey = normalizePhone(group.key);
        const exact = results.filter((customer) =>
          String(customer.code || '').trim() === group.key ||
          (normalizedPhoneKey && normalizePhone(customer.phone) === normalizedPhoneKey)
        );
        const uniqueById = [...new Map(exact.map((item) => [item.id, item])).values()];
        if (uniqueById.length !== 1) {
          setStates((prev) => ({ ...prev, [group.id]: { status: 'blocked', reason: uniqueById.length ? 'يوجد أكثر من عميل مطابق؛ راجع الطلبات فرديًا.' : 'لم يتم العثور على تطابق تام للعميل.' } }));
          return;
        }
        const candidate = uniqueById[0];
        const branchConflict = group.rows.some(({ request }) => request.branch && candidate.branch && request.branch !== candidate.branch);
        if (branchConflict) {
          setStates((prev) => ({ ...prev, [group.id]: { status: 'blocked', customer: candidate, reason: `تعارض فرع: بعض الطلبات لا تتبع فرع العميل ${candidate.branch}.` } }));
          return;
        }
        setStates((prev) => ({ ...prev, [group.id]: { status: 'ready', customer: candidate } }));
        return;
      }

      const products = await searchProductsCatalog(group.key, 20);
      const exact = products.filter((product) => normalizeCode(product.code) === normalizeCode(group.key));
      const unique = [...new Map(exact.map((item) => [item.id || item.code, item])).values()];
      if (unique.length !== 1 || !unique[0]?.id) {
        setStates((prev) => ({ ...prev, [group.id]: { status: 'blocked', reason: unique.length ? 'يوجد أكثر من صنف مطابق للكود؛ راجع يدويًا.' : 'لا يوجد تطابق تام لهذا الكود في الكتالوج.' } }));
        return;
      }
      setStates((prev) => ({ ...prev, [group.id]: { status: 'ready', product: unique[0] } }));
    } catch (error) {
      setStates((prev) => ({ ...prev, [group.id]: { status: 'blocked', reason: (error as Error).message } }));
    }
  };

  const applyGroup = async (group: Group) => {
    const state = states[group.id];
    if (state?.status !== 'ready') return;
    setApplying(group.id);
    try {
      const result = group.kind === 'customer' && state.customer
        ? await runInBatches(group.rows, ({ request }) => repairCustomerRequestCustomer(request.id, state.customer!, true))
        : group.kind === 'product' && state.product?.id
          ? await runInBatches(group.rows, ({ request }) => linkCustomerRequestProduct(request.id, state.product!.id!))
          : { success: 0, failed: group.rows.length };

      if (result.success) toast.success(`تم إصلاح ${result.success.toLocaleString('ar-EG')} طلب`);
      if (result.failed) toast.error(`تعذر إصلاح ${result.failed.toLocaleString('ar-EG')} طلب`);
      setStates((prev) => ({ ...prev, [group.id]: { ...prev[group.id], status: result.failed ? 'blocked' : 'done', reason: result.failed ? 'تم إصلاح جزء من المجموعة، والباقي يحتاج مراجعة.' : undefined } }));
      onChanged();
    } finally {
      setApplying('');
    }
  };

  return (
    <section className="rounded-2xl border border-cyan-400/20 bg-cyan-500/[0.05] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-black text-white"><Sparkles size={17} className="text-cyan-300" /> إصلاح جماعي ذكي</div>
          <div className="mt-1 text-xs text-slate-400">مجموعات متكررة يمكن مراجعتها مرة واحدة. لا يتم التطبيق إلا بعد تطابق تام وآمن.</div>
        </div>
        <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-black text-cyan-200">{groups.length.toLocaleString('ar-EG')} مجموعة</span>
      </div>

      <div className="mt-4 space-y-2">
        {groups.slice(0, 20).map((group) => {
          const state = states[group.id] || { status: 'idle' as const };
          const busy = applying === group.id;
          return (
            <div key={group.id} className="rounded-xl border border-slate-700 bg-slate-950/55 p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {group.kind === 'customer' ? <UsersRound size={15} className="text-cyan-300" /> : <PackageCheck size={15} className="text-violet-300" />}
                    <span className="font-black text-white">{group.label}</span>
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-black text-slate-300">{group.rows.length.toLocaleString('ar-EG')} طلب</span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-slate-500">
                    {group.rows.slice(0, 3).map(({ request }) => request.customer_name || request.medicine_name || request.id).join(' · ')}{group.rows.length > 3 ? ' …' : ''}
                  </div>
                  {state.status === 'ready' && (
                    <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2 py-1 text-[11px] font-black text-emerald-200"><CheckCircle2 size={12} /> تطابق مؤكد: {state.customer?.name || state.product?.name}</div>
                  )}
                  {state.status === 'blocked' && (
                    <div className="mt-2 flex items-start gap-1.5 text-[11px] font-bold text-amber-200"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{state.reason}</div>
                  )}
                  {state.status === 'done' && <div className="mt-2 text-[11px] font-black text-emerald-300">تم إصلاح المجموعة بنجاح.</div>}
                </div>
                <div className="flex shrink-0 gap-2">
                  {(state.status === 'idle' || state.status === 'blocked') && (
                    <button type="button" onClick={() => void resolveGroup(group)} disabled={busy} className="h-9 rounded-xl border border-slate-700 px-3 text-xs font-black text-slate-200 hover:bg-slate-900">تحليل التطابق</button>
                  )}
                  {state.status === 'loading' && <span className="inline-flex h-9 items-center gap-2 px-3 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" /> فحص</span>}
                  {state.status === 'ready' && (
                    <button type="button" onClick={() => void applyGroup(group)} disabled={busy} className="h-9 rounded-xl bg-emerald-500/15 px-3 text-xs font-black text-emerald-100 hover:bg-emerald-500/25">{busy ? 'جاري الإصلاح…' : `إصلاح ${group.rows.length.toLocaleString('ar-EG')} طلب`}</button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
