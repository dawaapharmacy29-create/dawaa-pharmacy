import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ExternalLink, ListChecks, Loader2 } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import {
  DoneRow,
  ProgressRing,
  StatusCounters,
  TONE_ACCENT,
  ToneIcon,
  type DailyItemTone,
} from '@/components/dashboard/DailyListParts';
import {
  GM_REVIEW_LABELS,
  gmReviewErrorMessage,
  gmReviewSummary,
  loadGmDailyReview,
  markGmReviewItem,
  type GmDailyReview,
  type GmReviewItem,
} from '@/lib/gmDailyReview';

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

/**
 * «مراجعتي اليومية»: the general manager's daily pass over the pharmacy, in one list.
 * Progress ring and counters on top; problems and open items as cards with a colored edge; finished items
 * folded into one line each; the last 14 days as a strip.
 */
export function GmDailyReviewPanel() {
  const [review, setReview] = useState<GmDailyReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

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
  const issues = ordered.filter((item) => gmTone(item) === 'issue').length;

  return (
    <Panel className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="dawaa-icon-tile shrink-0 p-3">
            <ListChecks className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="dawaa-title text-xl">مراجعتي اليومية</h2>
            <p className="dawaa-caption mt-1 text-xs font-bold">
              {review ? dayLabel(review.day) : 'البنود اللي تراجعها كل يوم'}
            </p>
            {review ? (
              <p className="dawaa-caption text-[11px] font-bold">
                بيانات امبارح {dayLabel(review.yesterday)}
              </p>
            ) : null}
          </div>
        </div>
        {review ? <ProgressRing done={review.done} total={review.total} /> : null}
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
          <div className="mt-4">
            <StatusCounters open={open.length - issues} issues={issues} done={done.length} />
          </div>

          <section className="mt-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="dawaa-theme-heading text-sm font-black">محتاجة انتباهك</h3>
              <p className="dawaa-caption text-[11px] font-bold">
                البند بيخضر لوحده لما بياناته تبقى سليمة · «راجعت» للي البيانات مش شايفاه
              </p>
            </div>
            {open.length ? (
              <div className="grid gap-2 lg:grid-cols-2">
                {open.map((item) => (
                  <ReviewRow key={item.key} item={item} onChanged={reload} />
                ))}
              </div>
            ) : (
              <p className="dawaa-badge dawaa-badge--success rounded-2xl p-3 text-sm font-black">
                كل بنود النهارده خلصت ✓
              </p>
            )}
          </section>

          {done.length ? (
            <section className="dawaa-theme-border mt-3 rounded-2xl border p-3">
              <button
                type="button"
                onClick={() => setShowDone((v) => !v)}
                aria-expanded={showDone}
                className="flex w-full items-center justify-between gap-2 text-start"
              >
                <span className="flex items-center gap-2 text-sm font-black">
                  <ToneIcon tone="done" className="h-4 w-4" />
                  خلصت ({done.length})
                </span>
                <ChevronDown
                  className={`dawaa-caption h-5 w-5 transition-transform ${showDone ? 'rotate-180' : ''}`}
                />
              </button>
              {showDone ? (
                <ul className="mt-1 divide-y divide-[var(--dawaa-theme-border,rgba(148,163,184,0.25))]">
                  {done.map((item) => (
                    <FinishedReviewRow key={item.key} item={item} onChanged={reload} />
                  ))}
                </ul>
              ) : (
                <p className="dawaa-caption mt-1 truncate text-[11px] font-bold">
                  {done.map((item) => GM_REVIEW_LABELS[item.key].title).join(' · ')}
                </p>
              )}
            </section>
          ) : null}

          <div className="mt-4">
            <p className="dawaa-caption mb-1.5 text-[11px] font-bold">آخر ١٤ يوم</p>
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

function ReviewRow({ item, onChanged }: { item: GmReviewItem; onChanged: () => Promise<void> }) {
  const navigate = useNavigate();
  const label = GM_REVIEW_LABELS[item.key];
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

  const lines = gmReviewSummary(item);
  const autoDone = item.done && !item.state;

  return (
    <div
      className={`dawaa-theme-surface dawaa-theme-border rounded-2xl border p-3 ${TONE_ACCENT[gmTone(item)]}`}
    >
      <div className="flex items-start gap-3">
        <ToneIcon tone={gmTone(item)} className="mt-0.5 h-5 w-5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-black">{label.title}</span>
            {label.app ? (
              <span className="dawaa-badge dawaa-badge--info rounded-full px-2 py-0.5 text-[10px] font-black">
                من {label.app.name}
              </span>
            ) : null}
            {autoDone ? (
              <span className="dawaa-badge dawaa-badge--success rounded-full px-2 py-0.5 text-[10px] font-black">
                خلص لوحده من البيانات
              </span>
            ) : null}
            {item.state === 'done' ? (
              <span className="dawaa-caption text-[10px] font-black">
                علّمه {item.marked_by ?? 'انت'}
              </span>
            ) : null}
          </div>
          <p className="dawaa-caption mt-0.5 text-xs font-bold">{label.question}</p>
          {lines.map((line) => (
            <p key={line} className="mt-0.5 text-xs font-bold">
              {line}
            </p>
          ))}
          {item.note ? (
            <p className="mt-1 text-xs font-bold">
              📝 {item.note}
              {item.marked_by ? ` — ${item.marked_by}` : ''}
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {label.app ? (
              <a
                href={label.app.url}
                target="_blank"
                rel="noreferrer"
                className="dawaa-badge dawaa-badge--info inline-flex items-center gap-1 rounded-xl px-3 py-1 text-xs font-black"
              >
                <ExternalLink className="h-3 w-3" /> افتح {label.app.name}
              </a>
            ) : null}
            {label.link ? (
              <button
                type="button"
                onClick={() => navigate(label.link!)}
                className="dawaa-theme-border rounded-xl border px-3 py-1 text-xs font-black"
              >
                افتح
              </button>
            ) : null}
            {item.state ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => markGmReviewItem(item.key, 'clear'))}
                className="dawaa-caption text-xs font-black underline"
              >
                تراجع
              </button>
            ) : (
              <>
                {!item.done ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => markGmReviewItem(item.key, 'done'))}
                    className="dawaa-badge dawaa-badge--success rounded-xl px-3 py-1 text-xs font-black"
                  >
                    راجعت ✓
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setNoteFor(true)}
                  className="dawaa-badge dawaa-badge--warning rounded-xl px-3 py-1 text-xs font-black"
                >
                  فيه مشكلة
                </button>
              </>
            )}
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          </div>

          {noteFor ? (
            <div className="mt-2 flex gap-2">
              <input
                autoFocus
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="المشكلة إيه؟"
                className="dawaa-theme-surface dawaa-theme-border flex-1 rounded-xl border px-3 py-1.5 text-xs font-bold"
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
      </div>
    </div>
  );
}
