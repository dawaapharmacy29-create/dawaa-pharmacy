import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { loadInvoiceLines, type InvoiceLine } from '@/lib/purchaseReview/invoiceLines';

// تفاصيل فاتورة الشراء صنف صنف (من تقرير المشتريات لما يترفع بالأصناف).

const money = (v: number) => v.toLocaleString('ar-EG', { maximumFractionDigits: 2 });

export default function InvoiceLinesTable({ store, serial }: { store: string; serial: string }) {
  const [lines, setLines] = useState<InvoiceLine[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    loadInvoiceLines(store, serial)
      .then((l) => live && setLines(l))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [store, serial]);

  if (error) return <p className="p-2 text-xs text-[var(--dawaa-status-danger-text)]">{error}</p>;
  if (!lines)
    return (
      <div className="flex justify-center p-3">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  if (!lines.length)
    return (
      <p className="p-2 text-xs opacity-70">
        أصناف الفاتورة دي مش مرفوعة. صدّري تقرير «فواتير الشراء» من ePlus بالأصناف وارفعيه،
        والتفاصيل هتظهر هنا.
      </p>
    );

  const sum = (k: keyof InvoiceLine) => lines.reduce((t, l) => t + Number(l[k] || 0), 0);
  const buy = sum('buy_total');
  const sell = sum('sell_total');
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-right opacity-70">
            <th className="p-1.5">الكود</th>
            <th className="p-1.5">الصنف</th>
            <th className="p-1.5">الكمية</th>
            <th className="p-1.5">بونص</th>
            <th className="p-1.5">مرتجع</th>
            <th className="p-1.5">سعر الشراء</th>
            <th className="p-1.5">سعر البيع</th>
            <th className="p-1.5">إجمالي الشراء</th>
            <th className="p-1.5">إجمالي البيع</th>
            <th className="p-1.5">الربح</th>
            <th className="p-1.5">الصلاحية</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.line_no} className="border-t border-[var(--dawaa-theme-border)]">
              <td className="p-1.5 font-mono">{l.code}</td>
              <td className="p-1.5 font-bold" dir="auto">
                {l.name}
              </td>
              <td className="p-1.5 font-black">{money(l.qty)}</td>
              <td className="p-1.5">{l.bonus ? money(l.bonus) : '—'}</td>
              <td
                className={`p-1.5 ${l.return_qty ? 'font-black text-[var(--dawaa-status-danger-text)]' : ''}`}
              >
                {l.return_qty ? money(l.return_qty) : '—'}
              </td>
              <td className="p-1.5">{money(l.buy_price)}</td>
              <td className="p-1.5">{money(l.sell_price)}</td>
              <td className="p-1.5">{money(l.buy_total)}</td>
              <td className="p-1.5">{money(l.sell_total)}</td>
              <td
                className={`p-1.5 ${l.profit_pct < 0 ? 'font-black text-[var(--dawaa-status-danger-text)]' : ''}`}
              >
                {money(l.profit_pct)}٪
              </td>
              <td className="p-1.5 whitespace-nowrap">{l.expiry ?? '—'}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-[var(--dawaa-theme-border)] font-black">
            <td className="p-1.5" colSpan={2}>
              الإجمالي · {lines.length} صنف
            </td>
            <td className="p-1.5">{money(sum('qty'))}</td>
            <td className="p-1.5">{money(sum('bonus'))}</td>
            <td className="p-1.5">{money(sum('return_qty'))}</td>
            <td className="p-1.5" colSpan={2}></td>
            <td className="p-1.5">{money(buy)}</td>
            <td className="p-1.5">{money(sell)}</td>
            <td className="p-1.5">{sell ? money(((sell - buy) / sell) * 100) : 0}٪</td>
            <td className="p-1.5"></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
