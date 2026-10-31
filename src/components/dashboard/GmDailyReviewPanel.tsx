import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, ExternalLink, ListChecks, Loader2, TriangleAlert } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import {
  GM_REVIEW_LABELS, gmReviewErrorMessage, gmReviewSummary, loadGmDailyReview, markGmReviewItem, setGmReviewLink,
  type GmDailyReview, type GmReviewItem,
} from '@/lib/gmDailyReview';

const dayLabel = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'numeric' });

/** «مراجعتي اليومية»: the general manager's daily pass over the pharmacy, in one list. */
export function GmDailyReviewPanel() {
  const [review, setReview] = useState<GmDailyReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setReview(await loadGmDailyReview());
      setError(null);
    } catch (err) {
      setError(gmReviewErrorMessage(err));
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const percent = review ? Math.round((review.done / Math.max(review.total, 1)) * 100) : 0;

  return (
    <Panel className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="dawaa-icon-tile p-3"><ListChecks className="h-5 w-5" /></div>
          <div>
            <h2 className="dawaa-title text-xl">مراجعتي اليومية</h2>
            <p className="dawaa-caption mt-1 text-xs font-bold">
              {review ? `${dayLabel(review.day)} · بيانات امبارح ${dayLabel(review.yesterday)}` : 'البنود اللي تراجعها كل يوم'}
            </p>
          </div>
        </div>
        {review ? (
          <span className={`dawaa-badge ${review.done === review.total ? 'dawaa-badge--success' : 'dawaa-badge--warning'} rounded-full px-3 py-1 text-sm font-black`}>
            {review.done} من {review.total} · {percent}%
          </span>
        ) : null}
      </div>

      {!review && !error ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
      {error ? <p className="text-sm font-bold text-[var(--dawaa-status-danger-text)]">{error}</p> : null}

      {review ? (
        <>
          <div className="grid gap-2 lg:grid-cols-2">
            {review.items.map((item) => <ReviewRow key={item.key} item={item} onChanged={reload} />)}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-1 text-[11px] font-bold">
            <span className="dawaa-caption">آخر ١٤ يوم:</span>
            {review.history.map((day) => (
              <span key={day.day} title={`${dayLabel(day.day)}: ${day.marked} بند`}
                className={`dawaa-badge rounded-md px-1.5 py-0.5 ${day.marked ? 'dawaa-badge--success' : 'dawaa-theme-border border'}`}>
                {new Date(`${day.day}T12:00:00`).getDate()}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </Panel>
  );
}

function ReviewRow({ item, onChanged }: { item: GmReviewItem; onChanged: () => Promise<void> }) {
  const navigate = useNavigate();
  const label = GM_REVIEW_LABELS[item.key];
  const [noteFor, setNoteFor] = useState(false);
  const [note, setNote] = useState('');
  const [editLink, setEditLink] = useState(false);
  const [link, setLink] = useState(item.url ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setNoteFor(false);
      setEditLink(false);
      setNote('');
      setError(null);
      await onChanged();
    } catch (err) {
      setError(gmReviewErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const external = item.kind === 'external';
  const lines = gmReviewSummary(item);

  return (
    <div className={`dawaa-theme-border rounded-2xl border p-3 ${item.done ? 'opacity-80' : ''}`}>
      <div className="flex items-start gap-3">
        {item.state === 'issue'
          ? <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[var(--dawaa-status-warning-text)]" />
          : item.done
            ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--dawaa-status-success-text)]" />
            : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--dawaa-status-danger-text)]" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-black">{label.title}</span>
            {external ? <span className="dawaa-badge dawaa-badge--info rounded-full px-2 py-0.5 text-[10px] font-black">تطبيق تاني</span> : null}
          </div>
          <p className="dawaa-caption mt-0.5 text-xs font-bold">{label.question}</p>
          {lines.map((line) => <p key={line} className="mt-0.5 text-xs font-bold">{line}</p>)}
          {item.note ? <p className="mt-1 text-xs font-bold">📝 {item.note}{item.marked_by ? ` — ${item.marked_by}` : ''}</p> : null}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {external ? (
              item.url
                ? <a href={item.url} target="_blank" rel="noreferrer" className="dawaa-badge dawaa-badge--info inline-flex items-center gap-1 rounded-xl px-3 py-1 text-xs font-black"><ExternalLink className="h-3 w-3" /> افتح التطبيق</a>
                : null
            ) : label.link ? (
              <button type="button" onClick={() => navigate(label.link!)} className="dawaa-theme-border rounded-xl border px-3 py-1 text-xs font-black">افتح</button>
            ) : null}
            {external ? (
              <button type="button" onClick={() => setEditLink((v) => !v)} className="dawaa-caption text-xs font-black underline">
                {item.url ? 'غيّر الرابط' : 'ضيف رابط التطبيق'}
              </button>
            ) : null}
            {item.state ? (
              <button type="button" disabled={busy} onClick={() => void run(() => markGmReviewItem(item.key, 'clear'))} className="dawaa-caption text-xs font-black underline">تراجع</button>
            ) : (
              <>
                <button type="button" disabled={busy} onClick={() => void run(() => markGmReviewItem(item.key, 'done'))} className="dawaa-badge dawaa-badge--success rounded-xl px-3 py-1 text-xs font-black">راجعت ✓</button>
                <button type="button" disabled={busy} onClick={() => setNoteFor(true)} className="dawaa-badge dawaa-badge--warning rounded-xl px-3 py-1 text-xs font-black">فيه مشكلة</button>
              </>
            )}
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          </div>

          {noteFor ? (
            <div className="mt-2 flex gap-2">
              <input autoFocus value={note} onChange={(event) => setNote(event.target.value)} placeholder="المشكلة إيه؟"
                className="dawaa-theme-surface dawaa-theme-border flex-1 rounded-xl border px-3 py-1.5 text-xs font-bold" />
              <button type="button" disabled={busy || !note.trim()} onClick={() => void run(() => markGmReviewItem(item.key, 'issue', note))}
                className="dawaa-badge dawaa-badge--warning rounded-xl px-3 py-1 text-xs font-black disabled:opacity-50">حفظ</button>
            </div>
          ) : null}
          {editLink && external ? (
            <div className="mt-2 flex gap-2">
              <input dir="ltr" value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://"
                className="dawaa-theme-surface dawaa-theme-border flex-1 rounded-xl border px-3 py-1.5 text-left text-xs font-bold" />
              <button type="button" disabled={busy} onClick={() => void run(() => setGmReviewLink(item.key as 'purchases_handover' | 'delivery', link))}
                className="dawaa-badge dawaa-badge--info rounded-xl px-3 py-1 text-xs font-black">حفظ</button>
            </div>
          ) : null}
          {error ? <p className="mt-1 text-xs font-bold text-[var(--dawaa-status-danger-text)]">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
