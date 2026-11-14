import { useMemo, useState } from 'react';
import { Link2 } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import { linkTreasuryItem } from '@/lib/purchaseReview/api';
import {
  PURCHASE_BRANCHES,
  type SupplierTerms,
  type TreasuryItem,
} from '@/lib/purchaseReview/ledger';
import { count, dayLabel, money, shortBranch } from './shared';

// «التقارير المجمعة» ↔ suppliers: cash out of خزنة شكري / خزنة الشامي under «شركات» or «مخازن» is paid to the
// supplier its item is linked to, for that branch. Each item is linked once and every payment under it
// follows; items that are not suppliers (settlements between branches…) are marked «مش مورد».

export default function TreasuryLinks({
  items,
  suppliers,
  trackFrom,
  onChanged,
}: {
  items: TreasuryItem[];
  suppliers: SupplierTerms[];
  trackFrom: string | null;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const options = useMemo(
    () =>
      suppliers
        .filter((s) => !s.excluded)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'ar')),
    [suppliers]
  );
  const names = useMemo(() => new Map(suppliers.map((s) => [s.code, s.name])), [suppliers]);

  const waiting = items.filter((i) => !i.link);
  const linked = items.filter((i) => i.link?.supplier_code);
  const ignored = items.filter((i) => i.link?.ignored);
  const linkedTotal = linked.reduce((s, i) => s + i.total, 0);
  const waitingTotal = waiting.reduce((s, i) => s + i.total, 0);
  const suggested = waiting.filter((i) => i.suggestion);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
      setError(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر الربط');
    } finally {
      setBusy(null);
    }
  };

  const shown = showAll ? items : waiting;

  return (
    <Panel className="p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="dawaa-title flex items-center gap-2 text-lg">
            <Link2 className="h-5 w-5 text-[var(--dawaa-status-info-text)]" /> دفعات الموردين من
            التقارير المجمعة
          </h2>
          <p className="dawaa-caption text-xs font-bold">
            الصادر من خزنة شكري وخزنة الشامي على «شركات» و«مخازن»
            {trackFrom ? ` من ${dayLabel(trackFrom)}` : ''} بيتخصم من المورد المربوط في نفس الفرع
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-black">
          <span className="dawaa-badge dawaa-badge--success">
            متربط {money(linkedTotal)} ({count(linked.length)})
          </span>
          {waiting.length ? (
            <span className="dawaa-badge dawaa-badge--warning">
              مستني ربط {money(waitingTotal)} ({count(waiting.length)})
            </span>
          ) : null}
          {ignored.length ? (
            <span className="dawaa-badge dawaa-badge--neutral">
              مش مورد {count(ignored.length)}
            </span>
          ) : null}
        </div>
      </div>

      {suggested.length ? (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void run('all', async () => {
              for (const i of suggested)
                await linkTreasuryItem(i.category, i.suggestion?.code ?? null);
            })
          }
          className="dawaa-badge dawaa-badge--info mb-3 rounded-lg px-3 py-1.5 text-xs font-black"
        >
          {busy === 'all'
            ? 'بيتربط…'
            : `اربط المقترح (${count(suggested.length)}): ${suggested
                .slice(0, 3)
                .map((i) => `${i.category} ← ${i.suggestion?.name}`)
                .join('، ')}${suggested.length > 3 ? '…' : ''}`}
        </button>
      ) : null}
      {error ? (
        <p className="mb-2 text-xs font-bold text-[var(--dawaa-status-danger-text)]">{error}</p>
      ) : null}

      {shown.length ? (
        <ul className="space-y-1.5">
          {shown.map((i) => (
            <li
              key={i.category}
              className="dawaa-theme-border flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-bold"
              style={{
                background: !i.link
                  ? 'var(--dawaa-status-warning-bg)'
                  : 'var(--dawaa-theme-surface)',
                opacity: busy === i.category ? 0.6 : 1,
              }}
            >
              <span className="min-w-0">
                <span className="font-black">{i.category}</span>{' '}
                <span className="tabular-nums">{money(i.total)}</span>
                <span className="dawaa-caption">
                  {' '}
                  · {count(i.count)} مرة · آخرها {dayLabel(i.last)} ·{' '}
                  {PURCHASE_BRANCHES.filter((b) => i.branches[b])
                    .map((b) => `${shortBranch(b)} ${money(i.branches[b] ?? 0)}`)
                    .join(' · ')}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <select
                  value={i.link?.ignored ? '__ignored' : (i.link?.supplier_code ?? '')}
                  disabled={busy !== null}
                  onChange={(e) => {
                    const v = e.target.value;
                    void run(i.category, () =>
                      v === '__ignored'
                        ? linkTreasuryItem(i.category, null, true)
                        : linkTreasuryItem(i.category, v || null, false)
                    );
                  }}
                  className="dawaa-theme-border max-w-[14rem] rounded-lg border px-2 py-1 font-bold"
                  style={{
                    background: 'var(--dawaa-theme-surface-raised)',
                    color: 'var(--dawaa-theme-heading)',
                  }}
                >
                  <option value="">
                    {i.suggestion ? `مقترح: ${i.suggestion.name}؟` : '— اختار المورد —'}
                  </option>
                  <option value="__ignored">مش مورد (متتحسبش)</option>
                  {options.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
                {!i.link && i.suggestion ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(i.category, () =>
                        linkTreasuryItem(i.category, i.suggestion?.code ?? null)
                      )
                    }
                    className="dawaa-badge dawaa-badge--info rounded-lg px-2 py-1 font-black"
                  >
                    اربط
                  </button>
                ) : null}
                {i.link?.supplier_code ? (
                  <span className="dawaa-caption">← {names.get(i.link.supplier_code)}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dawaa-caption text-xs font-bold">كل الصادر للموردين متربط ✓</p>
      )}
      {items.length > waiting.length ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="dawaa-tab mt-2 text-xs"
        >
          {showAll
            ? 'اللي مستني ربط بس'
            : `اعرض المتربط كمان (${count(items.length - waiting.length)})`}
        </button>
      ) : null}
    </Panel>
  );
}
