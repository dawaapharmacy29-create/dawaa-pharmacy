import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  ListChecks,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
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

/** «مراجعتي اليومية»: the general manager's daily pass over the pharmacy, in one list. */
export function GmDailyReviewPanel() {
  const [review, setReview] = useState<GmDailyReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
  const issues = ordered.filter((item) => item.state === 'issue');
  const pending = ordered.filter((item) => !item.done && item.state !== 'issue');
  const done = ordered.filter((item) => item.done && item.state !== 'issue');
  const percent = review?.total ? Math.round(done.length / review.total * 100) : 0;

  async function refresh() {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Panel className="overflow-hidden">
      <div className="dawaa-theme-border border-b bg-[var(--dawaa-theme-accent-soft)] p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="dawaa-icon-tile p-3"><ListChecks className="h-6 w-6" /></div>
            <div>
              <h2 className="dawaa-title text-2xl">مراجعتي اليومية</h2>
              <p className="dawaa-caption mt-1 text-sm">
                {review ? `${dayLabel(review.day)} · بيانات امبارح ${dayLabel(review.yesterday)}` : 'متابعة تشغيل الفروع'}
              </p>
            </div>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={refreshing}
            className="dawaa-button dawaa-button--secondary inline-flex items-center gap-2 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            تحديث القائمة
          </button>
        </div>
        {review && (
          <div className="mt-5 space-y-3">
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[
                { label: 'فيه مشكلة', value: issues.length, tone: 'var(--dawaa-status-warning-text)' },
                { label: 'بانتظار المراجعة', value: pending.length, tone: 'var(--dawaa-theme-heading)' },
                { label: 'تمت المراجعة', value: done.length, tone: 'var(--dawaa-status-success-text)' },
              ].map(({ label, value, tone }) => (
                <div key={label} className="dawaa-theme-border rounded-xl border bg-[var(--dawaa-theme-surface)] p-2.5 sm:p-4">
                  <div className="text-xl font-black tabular-nums sm:text-2xl" style={{ color: tone }}>{value.toLocaleString('ar-EG')}</div>
                  <div className="dawaa-caption mt-1 text-xs font-bold">{label}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <div role="progressbar" aria-label="اكتمال المراجعة" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}
                className="dawaa-theme-border h-2 flex-1 overflow-hidden rounded-full border">
                <div className="h-full rounded-full bg-[var(--dawaa-status-success-text)] transition-all" style={{ width: `${percent}%` }} />
              </div>
              <span className="dawaa-caption shrink-0 text-xs font-bold">{done.length.toLocaleString('ar-EG')} من {review.total.toLocaleString('ar-EG')} مكتمل</span>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-5 p-4 sm:p-6">
        {!review && !error && <div role="status" className="dawaa-caption flex items-center gap-2 text-sm"><Loader2 className="h-5 w-5 animate-spin" /> جاري تحميل القائمة</div>}
        {error && <p role="alert" className="text-sm font-bold text-[var(--dawaa-status-danger-text)]">{error}</p>}
        {review && (
          <>
            {[
              { title: 'مشكلات تحتاج متابعة', items: issues },
              { title: 'بانتظار المراجعة', items: pending },
            ].map(({ title, items }) => items.length > 0 && (
              <section key={title} aria-label={title} className="space-y-2">
                <h3 className="dawaa-title text-base">{title}</h3>
                <div className="grid gap-3 xl:grid-cols-2">
                  {items.map((item) => <ReviewRow key={item.key} item={item} onChanged={reload} />)}
                </div>
              </section>
            ))}
            {!issues.length && !pending.length && (
              <p className="flex items-center gap-2 text-sm font-black text-[var(--dawaa-status-success-text)]">
                <CheckCircle2 className="h-5 w-5" /> كل بنود النهارده خلصت
              </p>
            )}
            {done.length > 0 && (
              <details className="dawaa-theme-border rounded-xl border p-3">
                <summary className="cursor-pointer text-sm font-black">بنود تمت مراجعتها ({done.length.toLocaleString('ar-EG')})</summary>
                <div className="mt-3 grid gap-3 xl:grid-cols-2">
                  {done.map((item) => <ReviewRow key={item.key} item={item} onChanged={reload} />)}
                </div>
              </details>
            )}
            <details className="dawaa-theme-border rounded-xl border p-3">
              <summary className="dawaa-caption cursor-pointer text-sm font-bold">سجل آخر ١٤ يوم</summary>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {review.history.map((day) => (
                  <span key={day.day} className={`dawaa-badge rounded-lg px-2 py-1 ${day.marked ? 'dawaa-badge--success' : 'dawaa-theme-border border'}`}>
                    {dayLabel(day.day)} · {day.marked.toLocaleString('ar-EG')} بند
                  </span>
                ))}
              </div>
            </details>
          </>
        )}
      </div>
    </Panel>
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
      className={`dawaa-theme-border rounded-2xl border bg-[var(--dawaa-theme-surface)] p-4 ${item.state === 'issue' ? 'border-[var(--dawaa-status-warning-text)]' : ''}`}
    >
      <div className="flex items-start gap-3">
        {item.state === 'issue' ? (
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[var(--dawaa-status-warning-text)]" />
        ) : item.done ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--dawaa-status-success-text)]" />
        ) : (
          <Circle className="dawaa-caption mt-0.5 h-5 w-5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-base font-black">{label.title}</h4>
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

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {label.app ? (
              <a
                href={label.app.url}
                target="_blank"
                rel="noreferrer"
                className="dawaa-badge dawaa-badge--info inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-black"
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
                    className="dawaa-badge dawaa-badge--success rounded-xl px-3 py-2 text-xs font-black"
                  >
                    راجعت ✓
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setNoteFor(true)}
                  className="dawaa-badge dawaa-badge--warning rounded-xl px-3 py-2 text-xs font-black"
                >
                  فيه مشكلة
                </button>
              </>
            )}
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          </div>

          {noteFor ? (
            <div className="mt-3 flex flex-wrap gap-2">
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
                className="dawaa-badge dawaa-badge--warning rounded-xl px-3 py-2 text-xs font-black disabled:opacity-50"
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
