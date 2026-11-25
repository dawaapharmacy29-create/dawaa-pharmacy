import {
  LINE_CHECKS,
  compareTransferLines,
  type LineCheck,
  type LineCompare,
} from '@/lib/purchaseReview/invoiceLines';
import type { TransferPurchase, TransferSale } from '@/lib/customerServiceTasks/morning';

// أصناف التحويل صنف صنف: البيع في الفرع اللي بعت قصاد الشراء في الفرع اللي استلم.

const TONE: Record<LineCheck, string> = {
  ok: 'text-[var(--dawaa-status-success-text)]',
  qty: 'text-[var(--dawaa-status-danger-text)]',
  code: 'text-[var(--dawaa-status-warning-text,#b45309)]',
  only_sale: 'text-[var(--dawaa-status-danger-text)]',
  only_purchase: 'text-[var(--dawaa-status-danger-text)]',
};
const qty = (v: number) => v.toLocaleString('ar-EG', { maximumFractionDigits: 2 });

export function compareTransfer(purchase: TransferPurchase, sale: TransferSale): LineCompare[] {
  return compareTransferLines(
    sale.items.map((i) => ({ code: i.code, name: i.name, qty: i.qty, price: i.price })),
    purchase.lines.map((l) => ({ code: l.code, name: l.name, qty: l.qty, price: l.price }))
  );
}

export default function TransferLinesCompare({
  purchase,
  sale,
}: {
  purchase: TransferPurchase;
  sale: TransferSale;
}) {
  if (!purchase.lines.length)
    return (
      <p className="mt-2 text-xs opacity-70">
        أصناف فاتورة الشراء مش مرفوعة، فالمقارنة صنف صنف مش متاحة. ارفعي تقرير المشتريات بالأصناف.
      </p>
    );
  const rows = compareTransfer(purchase, sale);
  const issues = rows.filter((r) => r.check !== 'ok').length;
  return (
    <div className="mt-2 rounded-xl bg-[var(--dawaa-theme-soft)] p-2">
      <div className="mb-1 text-xs font-black">
        {issues ? (
          <span className="text-[var(--dawaa-status-danger-text)]">
            {issues} صنف مش مطابق من {rows.length}
          </span>
        ) : (
          <span className="text-[var(--dawaa-status-success-text)]">
            كل الأصناف مطابقة ({rows.length} صنف)
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-right opacity-70">
              <th className="p-1">الحالة</th>
              <th className="p-1">اتباع من {sale.seller ?? 'الفرع التاني'}</th>
              <th className="p-1">الكمية</th>
              <th className="p-1">اتشرى من {purchase.entered_by ?? 'الفرع'}</th>
              <th className="p-1">الكمية</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, n) => (
              <tr key={n} className="border-t border-[var(--dawaa-theme-border)] align-top">
                <td className={`p-1 font-black whitespace-nowrap ${TONE[r.check]}`}>
                  {LINE_CHECKS[r.check]}
                  {r.check === 'code' && r.qtyDiffers ? ' وكمية مختلفة' : ''}
                </td>
                <td className="p-1" dir="auto">
                  {r.sale ? (
                    <>
                      <span className="font-mono opacity-70">{r.sale.code}</span> {r.sale.name}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="p-1 font-black">{r.sale ? qty(r.sale.qty) : '—'}</td>
                <td className="p-1" dir="auto">
                  {r.purchase ? (
                    <>
                      <span className="font-mono opacity-70">{r.purchase.code}</span>{' '}
                      {r.purchase.name}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="p-1 font-black">{r.purchase ? qty(r.purchase.qty) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
