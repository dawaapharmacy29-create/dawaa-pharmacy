import { useState } from 'react';
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
const EDGE: Record<LineCheck, string> = {
  ok: 'border-r-[var(--dawaa-status-success-text)]',
  qty: 'border-r-[var(--dawaa-status-danger-text)]',
  code: 'border-r-[var(--dawaa-status-warning-text,#b45309)]',
  only_sale: 'border-r-[var(--dawaa-status-danger-text)]',
  only_purchase: 'border-r-[var(--dawaa-status-danger-text)]',
};
const qty = (v: number) => v.toLocaleString('ar-EG', { maximumFractionDigits: 2 });

/** The sale's items against the items of every purchase it was received as. */
export function compareTransfer(purchases: TransferPurchase[], sale: TransferSale): LineCompare[] {
  return compareTransferLines(
    sale.items.map((i) => ({ code: i.code, name: i.name, qty: i.qty, price: i.price })),
    purchases.flatMap((p) =>
      p.lines.map((l) => ({ code: l.code, name: l.name, qty: l.qty, price: l.price }))
    )
  );
}

export default function TransferLinesCompare({
  purchases,
  sale,
  onlyIssues = false,
}: {
  purchases: TransferPurchase[];
  sale: TransferSale;
  /** Show only the lines that differ, with a button for the rest. */
  onlyIssues?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  if (purchases.some((p) => !p.lines.length))
    return (
      <p className="mt-2 text-xs opacity-70">
        أصناف فاتورة الشراء مش مرفوعة، فالمقارنة صنف صنف مش متاحة. ارفعي تقرير المشتريات بالأصناف.
      </p>
    );
  const rows = compareTransfer(purchases, sale);
  const issues = rows.filter((r) => r.check !== 'ok').length;
  const saleBy = sale.seller ?? 'الفرع التاني';
  const buyBy = [...new Set(purchases.map((p) => p.entered_by ?? 'الفرع'))].join(' و');
  const visible = onlyIssues && issues && !showAll ? rows.filter((r) => r.check !== 'ok') : rows;
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
        {visible.length < rows.length ? (
          <button
            type="button"
            className="mr-2 underline decoration-dotted opacity-70"
            onClick={() => setShowAll(true)}
          >
            عرض الـ {rows.length - visible.length} صنف المطابقين
          </button>
        ) : null}
      </div>
      <ul className="space-y-1.5">
        {visible.map((r, n) => {
          const sameCode = r.sale && r.purchase && r.sale.code === r.purchase.code;
          return (
            <li
              key={n}
              className={`rounded-lg border-r-4 bg-[var(--dawaa-theme-surface)] px-2.5 py-2 ${EDGE[r.check]}`}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 flex-1 text-sm font-black break-words" dir="auto">
                  {(r.sale ?? r.purchase)!.name}
                </span>
                <span className={`text-[11px] font-black whitespace-nowrap ${TONE[r.check]}`}>
                  {LINE_CHECKS[r.check]}
                  {r.check === 'code' && r.qtyDiffers ? ' وكمية مختلفة' : ''}
                </span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
                <Side
                  title={`بيع ${saleBy}`}
                  line={r.sale}
                  showName={!sameCode && !!r.purchase && r.sale?.name !== r.purchase.name}
                  warn={r.check !== 'ok'}
                />
                <Side
                  title={`شراء ${buyBy}`}
                  line={r.purchase}
                  showName={!sameCode && !!r.sale && r.sale.name !== r.purchase?.name}
                  warn={r.check !== 'ok'}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One side of an item: its code and quantity, big enough to read at a glance. */
function Side({
  title,
  line,
  showName,
  warn,
}: {
  title: string;
  line: { code: string; name: string; qty: number } | null;
  showName: boolean;
  warn: boolean;
}) {
  return (
    <div className="rounded-md bg-[var(--dawaa-theme-soft)] px-2 py-1">
      <div className="text-[10px] font-bold opacity-60">{title}</div>
      {line ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-md px-1.5 text-sm font-black ${
                warn
                  ? 'bg-[var(--dawaa-status-danger-bg,#fee2e2)] text-[var(--dawaa-status-danger-text)]'
                  : 'bg-[var(--dawaa-theme-surface)]'
              }`}
            >
              × {qty(line.qty)}
            </span>
            <span className="font-mono text-[11px] opacity-70">كود {line.code}</span>
          </div>
          {showName ? (
            <div className="mt-0.5 break-words opacity-80" dir="auto">
              {line.name}
            </div>
          ) : null}
        </>
      ) : (
        <div className="font-black text-[var(--dawaa-status-danger-text)]">مش موجود</div>
      )}
    </div>
  );
}
