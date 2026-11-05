import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ExternalLink, ListChecks, Loader2, TriangleAlert } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import {
  DoneRow,
  MiniBar,
  TONE_ACCENT,
  ToneIcon,
  type DailyItemTone,
} from '@/components/dashboard/DailyListParts';
import {
  GM_REVIEW_LABELS,
  gmReviewErrorMessage,
  loadGmDailyReview,
  loadGmPendingPurchases,
  markGmReviewItem,
  type GmPendingPurchase,
  type GmDailyReview,
  type GmReviewItem,
} from '@/lib/gmDailyReview';
import { gmReviewCard } from '@/lib/gmReviewCard';

const dayLabel = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('ar-EG', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
  });

/** Problems first, then what is still open, then what is done. */
export function gmReviewOrder(items: GmReviewItem[]) {
  const rank = (item: GmReviewItem) => (item.state === 'issue' ? 0 : item.done ? 2 : 1);
  return [...items].sort((a, b) => rank(a) - rank(b));
}

const gmTone = (item: GmReviewItem): DailyItemTone =>
  item.state === 'issue' ? 'issue' : item.done ? 'done' : 'open';

/** Cards shown before «اعرض كمان», so the list stays short on a phone. */
const VISIBLE_CARDS = 3;

/**
 * «مراجعتي اليومية»: the general manager's daily pass over the pharmacy.
 * A bar with «فاضل N من M», two tabs (needs attention / done), and one short card per open item:
 * a status sentence, a chip per branch with its number and one wide button to the place it is worked.
 */
export function GmDailyReviewPanel() {
  const [review, setReview] = useState<GmDailyReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const [showAll, setShowAll] = useState(false);

  const reload = useCallback(async () => {
    try {
      setReview(await loadGmDailyReview());
      setError(null);
    } catch (err) {
      setError(gmReviewErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void reload();
    // Data in the other apps keeps moving (sync every 15 minutes): refresh while the page is open.
    const timer = window.setInterval(() => void reload(), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const ordered = review ? gmReviewOrder(review.items) : [];
  const open = ordered.filter((item) => gmTone(item) !== 'done');
  const done = ordered.filter((item) => gmTone(item) === 'done');
  const visible = showAll ? open : open.slice(0, VISIBLE_CARDS);

  const tabButton = (value: 'open' | 'done', label: string, count: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === value}
      onClick={() => setTab(value)}
      className={`flex-1 rounded-xl px-3 py-2 text-xs font-black transition ${
        tab === value
          ? 'dawaa-theme-heading bg-[var(--dawaa-status-info-bg)] shadow-sm'
          : 'dawaa-caption'
      }`}
    >
      {label} {count}
    </button>
  );

  return (
    <Panel className="p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <div className="dawaa-icon-tile shrink-0 p-2.5">
          <ListChecks className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 className="dawaa-title text-lg">مراجعتي اليومية</h2>
            {review ? (
              <span className="dawaa-caption text-[11px] font-bold">
                {dayLabel(review.day)} · بيانات امبارح
              </span>
            ) : null}
          </div>
          {review ? (
            <>
              <p className="mt-0.5 text-xs font-black">
                {open.length ? `فاضل ${open.length} بنود من ${review.total}` : 'كل البنود خلصت ✓'}
              </p>
              <div className="mt-1.5">
                <MiniBar done={review.done} total={review.total} />
              </div>
            </>
          ) : null}
        </div>
      </div>

      {!review && !error ? (
        <div className="dawaa-caption mt-4 flex items-center gap-2 text-sm font-bold">
          <Loader2 className="h-4 w-4 animate-spin" /> بنجهز المراجعة…
        </div>
      ) : null}
      {error ? (
        <p className="mt-4 text-sm font-bold text-[var(--dawaa-status-danger-text)]">{error}</p>
      ) : null}

      {review ? (
        <>
          <div role="tablist" className="dawaa-theme-border mt-3 flex gap-1 rounded-2xl border p-1">
            {tabButton('open', 'محتاج انتباهك', open.length)}
            {tabButton('done', 'خلص', done.length)}
          </div>

          {tab === 'open' ? (
            <div className="mt-3">
              {open.length ? (
                <div className="grid gap-2 lg:grid-cols-3">
                  {visible.map((item) => (
                    <ReviewCard key={item.key} item={item} onChanged={reload} />
                  ))}
                </div>
              ) : (
                <p className="dawaa-badge dawaa-badge--success rounded-2xl p-3 text-sm font-black">
                  كل بنود النهارده خلصت ✓
                </p>
              )}
              {open.length > VISIBLE_CARDS ? (
                <button
                  type="button"
                  onClick={() => setShowAll((value) => !value)}
                  className="dawaa-theme-border dawaa-caption mt-2 w-full rounded-xl border py-2 text-xs font-black"
                >
                  {showAll ? 'اعرض أقل' : `اعرض ${open.length - VISIBLE_CARDS} كمان`}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="mt-3">
              {done.length ? (
                <ul className="divide-y divide-[var(--dawaa-theme-border,rgba(148,163,184,0.25))]">
                  {done.map((item) => (
                    <FinishedReviewRow key={item.key} item={item} onChanged={reload} />
                  ))}
                </ul>
              ) : (
                <p className="dawaa-caption text-xs font-bold">لسه مفيش بنود خلصت النهارده</p>
              )}
              <p className="dawaa-caption mb-1.5 mt-3 text-[11px] font-bold">آخر ١٤ يوم</p>
              <div className="grid grid-cols-7 gap-1 sm:grid-cols-[repeat(14,minmax(0,1fr))]">
                {review.history.map((day) => (
                  <span
                    key={day.day}
                    title={`${dayLabel(day.day)}: ${day.marked} بند`}
                    className={`dawaa-badge flex flex-col items-center rounded-lg px-1 py-1 text-[11px] font-black ${day.marked ? 'dawaa-badge--success' : 'dawaa-theme-border border opacity-60'}`}
                  >
                    {new Date(`${day.day}T12:00:00`).getDate()}
                    <span className="text-[9px] font-bold">
                      {day.marked ? `${day.marked}✓` : '—'}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}
    </Panel>
  );
}

function FinishedReviewRow({
  item,
  onChanged,
}: {
  item: GmReviewItem;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <DoneRow
      title={GM_REVIEW_LABELS[item.key].title}
      detail={item.state ? `علّمه ${item.marked_by ?? 'انت'}` : 'خلص لوحده من البيانات'}
      busy={busy}
      onUndo={
        item.state
          ? () => {
              setBusy(true);
              void markGmReviewItem(item.key, 'clear')
                .then(onChanged)
                .finally(() => setBusy(false));
            }
          : undefined
      }
    />
  );
}

function ReviewCard({ item, onChanged }: { item: GmReviewItem; onChanged: () => Promise<void> }) {
  const navigate = useNavigate();
  const label = GM_REVIEW_LABELS[item.key];
  const card = gmReviewCard(item);
  const [noteFor, setNoteFor] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setNoteFor(false);
      setNote('');
      setError(null);
      await onChanged();
    } catch (err) {
      setError(gmReviewErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // Inside this app first; the other app only when there is no page here.
  const openPlace = () => {
    if (label.link) navigate(label.link);
    else if (label.app) window.open(label.app.url, '_blank', 'noopener,noreferrer');
  };
  const inlinePurchases = item.key === 'purchases_handover';
  const [showList, setShowList] = useState(false);

  return (
    <div
      className={`dawaa-theme-surface dawaa-theme-border min-w-0 rounded-2xl border p-3 ${TONE_ACCENT[gmTone(item)]}`}
    >
      <div className="flex items-center gap-2">
        <ToneIcon tone={gmTone(item)} className="h-4 w-4" />
        <span className="dawaa-caption min-w-0 flex-1 truncate text-[11px] font-black">
          {label.title}
        </span>
        {label.app ? (
          <span className="dawaa-caption shrink-0 text-[10px] font-bold">من {label.app.name}</span>
        ) : null}
      </div>
      <p className="mt-1 text-sm font-black leading-snug">{card.headline || label.question}</p>

      {card.chips.length ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {card.chips.map((chip) => (
            <div
              key={chip.label}
              className={`min-w-0 rounded-xl px-2.5 py-1.5 ${
                chip.bad ? 'bg-[var(--dawaa-status-danger-bg)]' : 'dawaa-theme-border border'
              }`}
            >
              <p className="dawaa-caption truncate text-[10px] font-black">{chip.label}</p>
              <p
                className={`truncate text-lg font-black leading-tight tabular-nums ${
                  chip.bad ? 'text-[var(--dawaa-status-danger-text)]' : 'dawaa-theme-heading'
                }`}
              >
                {chip.value}
              </p>
              {chip.note ? (
                <p className="dawaa-caption truncate text-[10px] font-bold">{chip.note}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {card.table ? (
        <div className="dawaa-theme-border mt-2 overflow-x-auto rounded-xl border">
          <table className="w-full text-[10px] font-bold">
            <thead className="dawaa-caption">
              <tr>
                {card.table.head.map((cell, index) => (
                  <th key={index} className="whitespace-nowrap px-2 py-1 text-start">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {card.table.rows.map((row) => (
                <tr key={row[0]} className="dawaa-theme-border border-t">
                  {row.map((cell, index) => (
                    <td
                      key={index}
                      className={`whitespace-nowrap px-2 py-1 ${index === 0 ? 'font-black' : ''}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {card.lines?.map((line) => (
        <p
          key={line}
          className={`mt-1 text-[11px] font-bold ${line.startsWith('⚠️') ? 'text-[var(--dawaa-status-warning-text)]' : 'dawaa-caption'}`}
        >
          {line}
        </p>
      ))}
      {card.warning ? (
        <p className="mt-1.5 text-[11px] font-bold text-[var(--dawaa-status-warning-text)]">
          {card.warning}
        </p>
      ) : null}
      {item.note ? (
        <p className="mt-1.5 text-[11px] font-bold">
          📝 {item.note}
          {item.marked_by ? ` — ${item.marked_by}` : ''}
        </p>
      ) : null}

      <div className="mt-2 flex items-center gap-1.5">
        {inlinePurchases ? (
          <button
            type="button"
            onClick={() => setShowList((value) => !value)}
            aria-expanded={showList}
            className="dawaa-badge dawaa-badge--info inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-black"
          >
            {showList ? 'اخفي الفواتير' : 'اعرض الفواتير المستنية'}
          </button>
        ) : label.app || label.link ? (
          <button
            type="button"
            onClick={openPlace}
            className="dawaa-badge dawaa-badge--info inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-black"
          >
            {label.link ? null : <ExternalLink className="h-3.5 w-3.5" />}
            افتح {label.link ? label.title : label.app?.name}
          </button>
        ) : (
          <span className="flex-1" />
        )}
        {item.state ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => markGmReviewItem(item.key, 'clear'))}
            className="dawaa-theme-border dawaa-caption min-h-[40px] rounded-xl border px-3 text-xs font-black"
          >
            تراجع
          </button>
        ) : (
          <>
            {!item.done ? (
              <button
                type="button"
                disabled={busy}
                aria-label="راجعت"
                title="راجعت"
                onClick={() => void run(() => markGmReviewItem(item.key, 'done'))}
                className="dawaa-badge dawaa-badge--success inline-flex h-10 w-10 items-center justify-center rounded-xl"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-5 w-5" />
                )}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              aria-label="فيه مشكلة"
              title="فيه مشكلة"
              onClick={() => setNoteFor((value) => !value)}
              className="dawaa-badge dawaa-badge--warning inline-flex h-10 w-10 items-center justify-center rounded-xl"
            >
              <TriangleAlert className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {inlinePurchases && showList ? <PendingPurchasesList /> : null}
      {noteFor ? (
        <div className="mt-2 flex gap-2">
          <input
            autoFocus
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="المشكلة إيه؟"
            className="dawaa-theme-surface dawaa-theme-border min-w-0 flex-1 rounded-xl border px-3 py-1.5 text-xs font-bold"
          />
          <button
            type="button"
            disabled={busy || !note.trim()}
            onClick={() => void run(() => markGmReviewItem(item.key, 'issue', note))}
            className="dawaa-badge dawaa-badge--warning rounded-xl px-3 py-1 text-xs font-black disabled:opacity-50"
          >
            حفظ
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="mt-1 text-xs font-bold text-[var(--dawaa-status-danger-text)]">{error}</p>
      ) : null}
    </div>
  );
}

const purchaseDay = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('ar-EG', { day: 'numeric', month: 'numeric' });

/** The invoices still «انتظار المراجعة» in دواء وائل, read here so the manager doesn't open the other app. */
function PendingPurchasesList() {
  const [rows, setRows] = useState<GmPendingPurchase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadGmPendingPurchases(200)
      .then((data) => alive && setRows(data))
      .catch(() => alive && setError('تعذّر تحميل الفواتير'));
    return () => {
      alive = false;
    };
  }, []);
  if (error)
    return <p className="mt-2 text-xs font-bold text-[var(--dawaa-status-danger-text)]">{error}</p>;
  if (!rows) return <Loader2 className="dawaa-caption mt-2 h-4 w-4 animate-spin" />;
  if (!rows.length)
    return <p className="dawaa-caption mt-2 text-xs font-bold">مفيش فواتير مستنية</p>;
  return (
    <ul className="dawaa-theme-border mt-2 max-h-72 divide-y divide-[var(--dawaa-theme-border,rgba(148,163,184,0.25))] overflow-y-auto rounded-xl border text-[11px] font-bold">
      {rows.map((row, index) => (
        <li
          key={`${row.system_invoice_number}-${index}`}
          className="flex items-start gap-2 px-2.5 py-1.5"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-black">{row.supplier}</p>
            <p className="dawaa-caption truncate text-[10px]">
              {row.branch.replace(/^فرعs*/, '')} · {purchaseDay(row.invoice_date)}
              {row.supplier_invoice_number ? ` · فاتورة ${row.supplier_invoice_number}` : ''}
              {row.entered_by ? ` · ${row.entered_by}` : ''}
            </p>
          </div>
          <div className="shrink-0 text-end">
            <p className="tabular-nums font-black">
              {Math.round(row.total_value).toLocaleString('ar-EG')} ج
            </p>
            <p
              className={`text-[10px] ${row.days_waiting > 3 ? 'text-[var(--dawaa-status-danger-text)]' : 'dawaa-caption'}`}
            >
              من {row.days_waiting.toLocaleString('ar-EG')} يوم
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
