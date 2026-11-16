import { useState } from 'react';
import { CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import { addSupplierPayment, saveTrackFrom } from '@/lib/purchaseReview/api';
import {
  daysBetween,
  type ReviewIssue,
  type SupplierTerms,
  type TreasuryItem,
  type uploadFreshness,
} from '@/lib/purchaseReview/ledger';
import TreasuryLinks from './TreasuryLinks';
import { count, dayLabel, money, shortBranch } from './shared';

// «محتاج مراجعة»: everything the numbers cannot settle on their own, each with the answer that settles it.

const DISMISSED_KEY = 'purchase-review:dismissed';

export function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]') as string[]);
  } catch {
    return new Set();
  }
}

function saveDismissed(keys: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...keys]));
  } catch {
    // Only a convenience; the issue simply shows again.
  }
}

export default function NeedsReview({
  issues,
  dismissed,
  onDismiss,
  treasuryItems,
  suppliers,
  fresh,
  trackFrom,
  today,
  onChanged,
}: {
  issues: ReviewIssue[];
  dismissed: Set<string>;
  onDismiss: (next: Set<string>) => void;
  treasuryItems: TreasuryItem[];
  suppliers: SupplierTerms[];
  fresh: ReturnType<typeof uploadFreshness>;
  trackFrom: string | null;
  today: string;
  onChanged: () => Promise<void>;
}) {
  const open = issues.filter((i) => !dismissed.has(i.key));
  const stale = fresh.filter((s) => s.daysBehind == null || s.daysBehind > 1);
  const waiting = treasuryItems.filter((i) => !i.link);

  const dismiss = (key: string) => {
    const next = new Set(dismissed);
    next.add(key);
    saveDismissed(next);
    onDismiss(next);
  };

  return (
    <div className="space-y-4">
      {!open.length && !stale.length && !waiting.length ? (
        <Panel className="p-5">
          <p className="flex items-center gap-2 font-black text-[var(--dawaa-status-success-text)]">
            <CheckCircle2 className="h-5 w-5" /> مفيش حاجة مستنياك، الأرقام كلها مفهومة
          </p>
        </Panel>
      ) : null}

      {open.length ? (
        <Panel className="p-4">
          <h2 className="dawaa-title mb-1 text-lg">
            أرقام محتاجة تأكيد منك ({count(open.length)})
          </h2>
          <p className="dawaa-caption mb-3 text-xs font-bold">
            الصفحة مش عارفة تحسمها لوحدها. اختار الإجابة اللي تنطبق، والرقم يتظبط على طول.
          </p>
          <ul className="space-y-2">
            {open.map((i) => (
              <Issue
                key={i.key}
                issue={i}
                trackFrom={trackFrom}
                onDismiss={() => dismiss(i.key)}
                onChanged={onChanged}
              />
            ))}
          </ul>
        </Panel>
      ) : null}

      {waiting.length ? (
        <TreasuryLinks
          items={treasuryItems}
          suppliers={suppliers}
          trackFrom={trackFrom}
          onChanged={onChanged}
        />
      ) : null}

      <Panel className="p-4">
        <h2 className="dawaa-title mb-3 text-lg">الملفات والإعدادات</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {fresh.map((s) => {
            const late = s.daysBehind == null || s.daysBehind > 1;
            return (
              <div
                key={s.store}
                className="dawaa-theme-border rounded-xl border px-3 py-2 text-xs font-bold"
                style={{
                  background: late
                    ? 'var(--dawaa-status-warning-bg)'
                    : 'var(--dawaa-theme-surface)',
                }}
              >
                <p className="flex items-center gap-1 font-black">
                  <FileSpreadsheet className="h-3.5 w-3.5" /> {s.store}
                </p>
                <p className="dawaa-caption">
                  {s.upload
                    ? `لحد ${dayLabel(s.upload.last_day)}${late ? ` · ناقص ${count((s.daysBehind ?? 1) - 1)} يوم` : ' ✓'}`
                    : 'لسه ما اترفعش'}
                </p>
              </div>
            );
          })}
        </div>
        <TrackFrom trackFrom={trackFrom} today={today} onChanged={onChanged} />
      </Panel>
      {!waiting.length && treasuryItems.length ? (
        <TreasuryLinks
          items={treasuryItems}
          suppliers={suppliers}
          trackFrom={trackFrom}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}

function Issue({
  issue: i,
  trackFrom,
  onDismiss,
  onChanged,
}: {
  issue: ReviewIssue;
  trackFrom: string | null;
  onDismiss: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const b = i.balance;
  const run = async (amount: number, paidOn: string, note: string) => {
    setBusy(true);
    try {
      await addSupplierPayment({
        supplier_code: b.code,
        branch: b.branch,
        amount,
        paid_on: paidOn,
        note,
      });
      setError(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر الحفظ');
    } finally {
      setBusy(false);
    }
  };
  const btn = 'dawaa-badge rounded-lg px-2.5 py-1 text-xs font-black';

  return (
    <li
      className="dawaa-theme-border rounded-xl border p-3 text-sm font-bold"
      style={{ background: 'var(--dawaa-theme-surface)', opacity: busy ? 0.6 : 1 }}
    >
      {i.kind === 'credit' ? (
        <>
          <p>
            <span className="font-black">{b.name}</span> ({shortBranch(b.branch)}) طالع{' '}
            <span className="text-[var(--dawaa-status-success-text)]">
              لينا {money(-b.balance)}
            </span>
            : اتدفعله من الخزنة أكتر من فواتيره من {trackFrom ? dayLabel(trackFrom) : 'أول الملفات'}
            .
          </p>
          <p className="dawaa-caption mt-1 text-xs">
            {i.otherBranchOwes > 0.5
              ? `فرع ${b.branch === 'فرع شكري' ? 'الشامي' : 'شكري'} عليه ${money(i.otherBranchOwes)} لنفس المورد، فممكن الدفعة اتسجلت على خزنة الفرع التاني. `
              : ''}
            غالبًا الفلوس دي كانت لفواتير قبل تاريخ المتابعة.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !trackFrom}
              onClick={() => void run(b.balance, trackFrom ?? '', 'رصيد أول المدة')}
              className={`${btn} dawaa-badge--info`}
            >
              دي فلوس قديمة كانت علينا (سجّل رصيد أول المدة {money(-b.balance)})
            </button>
            <button type="button" onClick={onDismiss} className={`${btn} dawaa-badge--neutral`}>
              فعلًا لينا عنده، سيبها
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            <span className="font-black">{b.name}</span> ({shortBranch(b.branch)}): فاتورة{' '}
            {dayLabel(i.bill.from)} ← {dayLabel(i.bill.to)} بـ{' '}
            <span className="text-[var(--dawaa-status-danger-text)]">
              {money(i.bill.remaining)}
            </span>{' '}
            آخر ميعاد ليها كان {dayLabel(i.bill.last)} (من {count(i.late)} يوم) ومفيش ولا دفعة ليها
            في التقارير المجمعة.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(i.bill.remaining, i.bill.due, 'اتدفعت برة الخزنة')}
              className={`${btn} dawaa-badge--success`}
            >
              اتدفعت من برة الخزنة
            </button>
            <button type="button" onClick={onDismiss} className={`${btn} dawaa-badge--neutral`}>
              لسه ماتدفعتش فعلًا
            </button>
          </div>
        </>
      )}
      {error ? (
        <p className="mt-1 text-xs text-[var(--dawaa-status-danger-text)]">{error}</p>
      ) : null}
    </li>
  );
}

function TrackFrom({
  trackFrom,
  today,
  onChanged,
}: {
  trackFrom: string | null;
  today: string;
  onChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(trackFrom ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    try {
      await saveTrackFrom(draft);
      setError(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر الحفظ');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold">
      <span className="font-black">بنتابع المديونية من</span>
      <input
        type="date"
        value={draft}
        max={today}
        onChange={(e) => setDraft(e.target.value)}
        className="dawaa-theme-surface dawaa-theme-border rounded-lg border px-2 py-1 font-bold"
      />
      {draft && draft !== trackFrom ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="dawaa-badge dawaa-badge--info rounded-lg px-2.5 py-1 font-black"
        >
          {busy ? 'بيتحفظ…' : 'احفظ'}
        </button>
      ) : null}
      <span className="dawaa-caption">
        الفواتير اللي ميعادها قبل التاريخ ده بتتحسب اتدفعت
        {trackFrom ? ` (من ${count(daysBetween(trackFrom, today))} يوم)` : ''}
      </span>
      {error ? <span className="text-[var(--dawaa-status-danger-text)]">{error}</span> : null}
    </div>
  );
}
