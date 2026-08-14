import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, PackagePlus, Search, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  createProductCatalogItem,
  searchProductsCatalogSmart,
  type CatalogProduct,
  type SmartCatalogProduct,
} from '@/lib/api/productsCatalog';

export default function ProductSmartSearch({
  value,
  onSelect,
  disabled,
}: {
  value: CatalogProduct | null;
  onSelect: (product: CatalogProduct | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SmartCatalogProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [creating, setCreating] = useState(false);

  const displayQuery = useMemo(() => value ? `${value.code} - ${value.name}` : query, [query, value]);

  useEffect(() => {
    if (value || query.trim().length < 1) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        setResults(await searchProductsCatalogSmart(query.trim(), 15));
      } catch (error) {
        toast.error(`تعذر البحث في الأصناف: ${(error as Error).message}`);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, value]);

  const choose = (product: CatalogProduct) => {
    onSelect(product);
    setQuery('');
    setResults([]);
    setShowCreate(false);
  };

  const create = async () => {
    if (!code.trim()) return toast.error('اكتب كود الصنف الجديد');
    if (!name.trim()) return toast.error('اكتب اسم الصنف الجديد');
    setCreating(true);
    try {
      const product = await createProductCatalogItem({
        code,
        name,
        price: price.trim() ? Number(price) : null,
      });
      choose(product);
      setCode('');
      setName('');
      setPrice('');
      toast.success('تمت إضافة الصنف واختياره بالكود المعتمد');
    } catch (error) {
      toast.error(`تعذر إضافة الصنف: ${(error as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  if (value) {
    return (
      <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-black text-emerald-100">
              <ShieldCheck size={16} /> صنف مربوط بكتالوج الأصناف
            </div>
            <div className="mt-2 truncate text-base font-black text-white">{value.name}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs font-bold text-emerald-100/90">
              <span className="rounded-lg bg-black/15 px-2 py-1">الكود المعتمد: {value.code}</span>
              <span className="rounded-lg bg-black/15 px-2 py-1">السعر: {value.price ?? 'غير محدد'} ج</span>
            </div>
            <div className="mt-2 text-[11px] font-bold text-emerald-100/70">اسم الطلب سيتسجل بالاسم المعتمد في قاعدة البيانات، والكود هو هوية الصنف الأساسية.</div>
          </div>
          <button type="button" disabled={disabled} onClick={() => onSelect(null)} className="rounded-xl border border-slate-600 p-2 text-slate-300 hover:bg-slate-800">
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={17} className="absolute left-3 top-3.5 text-slate-400" />
        <input
          className="input-dark pl-9"
          value={displayQuery}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث بكود الصنف أو الاسم حتى لو طريقة الكتابة مختلفة..."
          autoComplete="off"
        />
        {loading && <Loader2 size={16} className="absolute left-10 top-3.5 animate-spin text-cyan-300" />}
      </div>

      {results.length > 0 && (
        <div className="max-h-80 overflow-auto rounded-2xl border border-slate-700 bg-slate-950/95 p-2 shadow-2xl">
          <div className="px-2 pb-2 text-[10px] font-bold text-slate-500">مرتبة حسب قوة تطابق الكود والاسم — اختَر الصنف الصحيح قبل التسجيل</div>
          {results.map((product, index) => (
            <button
              key={product.id || product.code}
              type="button"
              onClick={() => choose(product)}
              className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-right hover:bg-cyan-500/10 ${index === 0 && product.matchScore >= 90 ? 'border border-emerald-400/15 bg-emerald-500/[0.05]' : ''}`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-black text-white">{product.name}</span>{index === 0 && product.matchScore >= 90 && <span className="rounded-lg bg-emerald-500/15 px-2 py-0.5 text-[9px] font-black text-emerald-200">أفضل تطابق</span>}</div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400"><span>كود {product.code}</span><span className={product.matchScore >= 90 ? 'text-emerald-300' : product.matchScore >= 70 ? 'text-amber-300' : 'text-slate-500'}>{product.matchLabel} · {product.matchScore}%</span></div>
              </div>
              <div className="shrink-0 text-xs font-black text-emerald-300">{product.price ?? '—'} ج</div>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setShowCreate((current) => !current);
          if (!name && query.trim()) setName(query.trim());
        }}
        className="inline-flex items-center gap-2 rounded-xl border border-dashed border-cyan-500/40 px-3 py-2 text-xs font-black text-cyan-200 hover:bg-cyan-500/10"
      >
        <PackagePlus size={15} /> بعد التأكد من البحث: الصنف غير موجود؟ إضافة صنف جديد
      </button>

      {showCreate && (
        <div className="grid grid-cols-1 gap-2 rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.05] p-3 md:grid-cols-3">
          <div className="md:col-span-3 rounded-xl border border-amber-400/20 bg-amber-500/[0.06] p-2 text-[11px] font-bold text-amber-100">إضافة صنف جديد تغيّر الكتالوج المشترك. استخدم كود الصنف الحقيقي ولا تنشئ كودًا بديلًا لنفس الصنف.</div>
          <input className="input-dark" value={code} onChange={(event) => setCode(event.target.value)} placeholder="كود الصنف الحقيقي *" />
          <input className="input-dark" value={name} onChange={(event) => setName(event.target.value)} placeholder="الاسم المعتمد للصنف *" />
          <input className="input-dark" type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="السعر (اختياري)" />
          <button type="button" onClick={create} disabled={creating} className="btn-primary md:col-span-3 flex items-center justify-center gap-2">
            {creating ? <Loader2 size={16} className="animate-spin" /> : <PackagePlus size={16} />} إضافة واختيار الصنف
          </button>
        </div>
      )}
    </div>
  );
}
