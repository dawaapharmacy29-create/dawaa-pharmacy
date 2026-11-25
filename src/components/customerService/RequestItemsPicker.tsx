import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, Loader2, Minus, Plus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  loadCatalog,
  searchCatalog,
  splitQuantity,
  type CatalogIndex,
  type CatalogItem,
} from '@/lib/customerServiceTasks/productSearch';
import type { RequestItem } from '@/lib/customerServiceTasks/groups';
import { uploadImageToStorage } from '@/lib/storageUpload';

// اختيار أصناف الطلب من كتالوج الأصناف: تكتب جزء من الاسم (عربي أو إنجليزي) أو الكود أو تستخدم * للحروف
// اللي مش متأكدة منها، وتختار بالأسهم و Enter. الكمية بعد الاختيار على طول (أو تكتبها مع الاسم «بانادول x2»).
// لو الصنف مش في الكتالوج يتسجل «صنف جديد»، وأي صنف ممكن يتضافله صورة.

const QUICK = [1, 2, 3, 5];
const money = (n: number | null | undefined) =>
  n == null ? '' : `${Number(n).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج`;

function useCatalog() {
  const [index, setIndex] = useState<CatalogIndex | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadCatalog()
      .then((i) => alive && setIndex(i))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);
  return { index, failed };
}

export default function RequestItemsPicker({
  items,
  onChange,
  autoFocus,
}: {
  items: RequestItem[];
  onChange: (items: RequestItem[]) => void;
  autoFocus?: boolean;
}) {
  const { index, failed } = useCatalog();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const qtyRefs = useRef<Array<HTMLInputElement | null>>([]);
  const focusQty = useRef<number | null>(null);

  const { query, qty: typedQty } = splitQuantity(q);
  const results = useMemo(
    () => (index && query.trim() ? searchCatalog(index, query, 10) : []),
    [index, query]
  );
  const options = query.trim().length >= 2 ? results.length + 1 : 0; // + «صنف جديد»

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (focusQty.current == null) return;
    const el = qtyRefs.current[focusQty.current];
    focusQty.current = null;
    el?.focus();
    el?.select();
  }, [items.length]);

  function add(item: RequestItem) {
    const qty = typedQty ?? item.qty ?? 1;
    // نفس الصنف مرة تانية: الكمية بتزيد بدل ما يتكرر.
    const same = items.findIndex((i) =>
      item.code ? i.code === item.code : !i.code && i.name.trim() === item.name.trim()
    );
    if (same >= 0) {
      const next = items.map((i, n) => (n === same ? { ...i, qty: (i.qty ?? 0) + qty } : i));
      onChange(next);
      setTimeout(() => {
        qtyRefs.current[same]?.focus();
        qtyRefs.current[same]?.select();
      });
    } else {
      focusQty.current = items.length;
      onChange([...items, { ...item, qty }]);
    }
    setQ('');
    setOpen(false);
  }
  const pickCatalog = (c: CatalogItem) =>
    add({ name: c.name, qty: null, code: c.code || null, price: c.price });
  const pickNew = () => {
    const name = query.trim();
    if (name.length >= 2) add({ name, qty: null, new: true });
  };

  const set = (n: number, patch: Partial<RequestItem>) =>
    onChange(items.map((it, i) => (i === n ? { ...it, ...patch } : it)));

  async function attach(n: number, file: File) {
    setUploading(n);
    try {
      const { publicUrl } = await uploadImageToStorage(
        'customer-request-images',
        file,
        'group-requests'
      );
      set(n, { image: publicUrl });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(null);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && options) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % options);
    } else if (e.key === 'ArrowUp' && options) {
      e.preventDefault();
      setActive((a) => (a - 1 + options) % options);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!options) return;
      if (active < results.length) pickCatalog(results[active]);
      else pickNew();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="space-y-2">
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((it, n) => (
            <li
              key={n}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface,white)] p-2"
            >
              {it.image ? (
                <a href={it.image} target="_blank" rel="noreferrer" className="shrink-0">
                  <img src={it.image} alt="" className="h-10 w-10 rounded-lg object-cover" />
                </a>
              ) : null}
              <div className="min-w-[10rem] flex-1 text-sm">
                {it.code || it.new ? (
                  <span className="font-bold" dir="auto">
                    {it.name}
                  </span>
                ) : (
                  <input
                    className="input-field !py-1"
                    value={it.name}
                    onChange={(e) => set(n, { name: e.target.value })}
                    placeholder="الصنف"
                  />
                )}
                <span className="block text-[11px] opacity-70">
                  {it.code ? `كود ${it.code}` : it.new ? 'صنف جديد (مش في الكتالوج)' : 'من الرسالة'}
                  {it.price != null ? ` · ${money(it.price)}` : ''}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="btn-secondary !p-1"
                  aria-label="أقل"
                  onClick={() => set(n, { qty: Math.max(1, (it.qty ?? 1) - 1) })}
                >
                  <Minus size={14} />
                </button>
                <input
                  ref={(el) => {
                    qtyRefs.current[n] = el;
                  }}
                  className={`input-field w-14 !py-1 text-center font-black ${it.qty ? '' : 'border-[var(--dawaa-status-danger-text)]'}`}
                  inputMode="numeric"
                  aria-label="الكمية"
                  value={it.qty ?? ''}
                  placeholder="؟"
                  onChange={(e) => {
                    const v = Number(
                      e.target.value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
                    );
                    set(n, { qty: Number.isFinite(v) && v > 0 ? Math.min(v, 999) : null });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      searchRef.current?.focus();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn-secondary !p-1"
                  aria-label="أكتر"
                  onClick={() => set(n, { qty: (it.qty ?? 0) + 1 })}
                >
                  <Plus size={14} />
                </button>
                {QUICK.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`rounded-lg px-1.5 py-0.5 text-[11px] font-black ${it.qty === k ? 'bg-[var(--dawaa-theme-primary,#0f766e)] text-white' : 'bg-[var(--dawaa-theme-soft)]'}`}
                    onClick={() => set(n, { qty: k })}
                  >
                    {k}
                  </button>
                ))}
              </div>
              <label
                className="btn-secondary inline-flex cursor-pointer items-center gap-1 !px-2 !py-1 text-xs"
                title="صورة للصنف"
              >
                {uploading === n ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ImagePlus size={14} />
                )}
                {it.image ? 'غيّري' : 'صورة'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploading != null}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void attach(n, f);
                  }}
                />
              </label>
              <button
                type="button"
                className="btn-secondary !p-1"
                aria-label="شيل الصنف"
                onClick={() => onChange(items.filter((_, i) => i !== n))}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative">
        <Search size={16} className="absolute top-1/2 right-3 -translate-y-1/2 opacity-50" />
        <input
          ref={searchRef}
          autoFocus={autoFocus}
          className="input-field !pr-9"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
          placeholder={
            failed
              ? 'الأصناف ماتحمّلتش: اكتبي اسم الصنف وEnter'
              : 'ضيفي صنف: الاسم عربي أو إنجليزي أو الكود، و* للحروف اللي مش متأكدة منها (الف*ن*رن)، و x2 للكمية'
          }
        />
        {!index && !failed ? (
          <Loader2
            size={14}
            className="absolute top-1/2 left-3 -translate-y-1/2 animate-spin opacity-60"
          />
        ) : null}
        {open && options ? (
          <ul
            role="listbox"
            className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface,white)] shadow-lg"
          >
            {results.map((c, n) => (
              <li
                key={`${c.code}-${n}`}
                role="option"
                aria-selected={active === n}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${active === n ? 'bg-[var(--dawaa-theme-soft)]' : ''}`}
                onMouseEnter={() => setActive(n)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickCatalog(c);
                }}
              >
                <span className="flex-1 font-bold" dir="auto">
                  {c.name}
                </span>
                <span className="text-[11px] opacity-70">{c.code}</span>
                <span className="w-16 text-left text-[11px] font-bold">{money(c.price)}</span>
              </li>
            ))}
            <li
              role="option"
              aria-selected={active === results.length}
              className={`cursor-pointer border-t border-[var(--dawaa-theme-border)] px-3 py-1.5 text-sm ${active === results.length ? 'bg-[var(--dawaa-theme-soft)]' : ''}`}
              onMouseEnter={() => setActive(results.length)}
              onMouseDown={(e) => {
                e.preventDefault();
                pickNew();
              }}
            >
              <Plus size={14} className="inline" /> صنف جديد: <b>{query.trim()}</b>
              {results.length ? null : (
                <span className="opacity-70"> (مش لاقيينه في الكتالوج)</span>
              )}
            </li>
          </ul>
        ) : null}
      </div>
      {typedQty ? <p className="text-[11px] opacity-70">الكمية: {typedQty}</p> : null}
    </div>
  );
}
