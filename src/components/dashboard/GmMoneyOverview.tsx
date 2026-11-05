import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Loader2, ShoppingCart, Wallet } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import { loadAccountantReport, type AccountantVault } from '@/lib/accountantReport';
import {
  cycleRange,
  loadGmPurchasesSummary,
  purchasesTotals,
  type GmPurchasesSummary,
} from '@/lib/gmPurchasesSummary';

// Top of the GM / executive dashboard: the treasury total from «التقارير المجمعة» and the net purchases of
// the «دواء وائل» purchases app for any period, each split per branch.

const money = (value: number) => Math.round(value).toLocaleString('ar-EG');

const cairoToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());

const shortDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('ar-EG', { day: 'numeric', month: 'numeric' });

const syncLabel = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('ar-EG', {
        timeZone: 'Africa/Cairo',
        day: 'numeric',
        month: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'غير معروف';

const VAULT_LABEL: Record<string, string> = { shamy: 'الشامي', shokry: 'شكري' };
const branchShort = (branch: string) => branch.replace(/^فرع\s*/, '');

function BranchChip({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="dawaa-theme-border dawaa-theme-surface min-w-0 rounded-xl border px-3 py-2">
      <p className="dawaa-caption truncate text-[11px] font-black">{label}</p>
      <p className="dawaa-theme-heading mt-0.5 truncate text-lg font-black tabular-nums">
        {money(value)}
      </p>
      {note ? <p className="dawaa-caption truncate text-[10px] font-bold">{note}</p> : null}
    </div>
  );
}

function Treasury() {
  const [vaults, setVaults] = useState<AccountantVault[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadAccountantReport(null)
      .then((report) => alive && setVaults(report.vaults || []))
      .catch(
        (err) => alive && setError(err instanceof Error ? err.message : 'تعذّر تحميل الخزينة')
      );
    return () => {
      alive = false;
    };
  }, []);

  const total = (vaults || []).reduce((sum, vault) => sum + (Number(vault.balance) || 0), 0);
  const lastDate = (vaults || [])
    .map((vault) => vault.last_date)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <section className="min-w-0">
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-[var(--dawaa-status-info-text)]" />
        <h3 className="dawaa-theme-heading text-sm font-black">إجمالي الخزينة</h3>
      </div>
      {error ? (
        <p className="mt-2 text-xs font-bold text-[var(--dawaa-status-danger-text)]">{error}</p>
      ) : !vaults ? (
        <Loader2 className="dawaa-caption mt-3 h-4 w-4 animate-spin" />
      ) : (
        <>
          <p className="dawaa-theme-heading mt-1 text-3xl font-black tabular-nums">
            {money(total)} <span className="dawaa-caption text-xs font-black">ج</span>
          </p>
          <p className="dawaa-caption text-[11px] font-bold">
            الأرصدة الحالية من التقارير المجمعة
            {lastDate ? ` · آخر حركة ${shortDate(lastDate)}` : ''}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {vaults.map((vault) => (
              <BranchChip
                key={vault.code}
                label={VAULT_LABEL[vault.code] || vault.name}
                value={Number(vault.balance) || 0}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Purchases() {
  const today = cairoToday();
  const current = useMemo(() => cycleRange(today, 0), [today]);
  const previous = useMemo(() => cycleRange(today, -1), [today]);
  const [range, setRange] = useState(current);
  const [summary, setSummary] = useState<GmPurchasesSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const load = useCallback(async (from: string, to: string) => {
    if (!from || !to) return;
    setLoading(true);
    try {
      setSummary(await loadGmPurchasesSummary(from, to));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر تحميل المشتريات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range.from, range.to);
  }, [load, range.from, range.to]);

  const totals = summary ? purchasesTotals(summary.branches) : null;
  const isRange = (other: { from: string; to: string }) =>
    range.from === other.from && range.to === other.to;
  const quick = (label: string, value: { from: string; to: string }) => (
    <button
      type="button"
      onClick={() => setRange(value)}
      aria-pressed={isRange(value)}
      className={`rounded-full px-3 py-1 text-[11px] font-black ${
        isRange(value)
          ? 'dawaa-theme-heading bg-[var(--dawaa-status-info-bg)] shadow-sm'
          : 'dawaa-caption dawaa-theme-border border'
      }`}
    >
      {label}
    </button>
  );

  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-[var(--dawaa-status-info-text)]" />
          <h3 className="dawaa-theme-heading text-sm font-black">صافي المشتريات</h3>
          {loading ? <Loader2 className="dawaa-caption h-3.5 w-3.5 animate-spin" /> : null}
        </div>
        <div className="flex gap-1.5">
          {quick('الدورة دي', current)}
          {quick('اللي فاتت', previous)}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-black">
        <label className="dawaa-caption flex items-center gap-1">
          من
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(event) => setRange((prev) => ({ ...prev, from: event.target.value }))}
            className="dawaa-theme-border dawaa-theme-surface rounded-lg border px-2 py-1 text-xs"
          />
        </label>
        <label className="dawaa-caption flex items-center gap-1">
          لحد
          <input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(event) => setRange((prev) => ({ ...prev, to: event.target.value }))}
            className="dawaa-theme-border dawaa-theme-surface rounded-lg border px-2 py-1 text-xs"
          />
        </label>
      </div>

      {error ? (
        <p className="mt-2 text-xs font-bold text-[var(--dawaa-status-danger-text)]">{error}</p>
      ) : null}
      {summary && totals ? (
        <>
          <p className="dawaa-theme-heading mt-2 text-3xl font-black tabular-nums">
            {money(totals.net)} <span className="dawaa-caption text-xs font-black">ج</span>
          </p>
          <p className="dawaa-caption text-[11px] font-bold">
            {shortDate(summary.from)} ← {shortDate(summary.to)} · بعد شيل التحويلات والمستثنى
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {summary.branches.map((row) => (
              <BranchChip
                key={row.branch}
                label={branchShort(row.branch)}
                value={row.net}
                note={`${row.invoices.toLocaleString('ar-EG')} فاتورة`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowDetails((value) => !value)}
            aria-expanded={showDetails}
            className="dawaa-caption mt-2 flex items-center gap-1 text-[11px] font-black"
          >
            الحسبة بالتفصيل
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showDetails ? 'rotate-180' : ''}`}
            />
          </button>
          {showDetails ? (
            <div className="dawaa-theme-border mt-1 overflow-x-auto rounded-xl border">
              <table className="w-full text-[11px] font-bold">
                <thead className="dawaa-caption">
                  <tr>
                    <th className="px-2 py-1.5 text-start">الفرع</th>
                    <th className="px-2 py-1.5 text-start">الإجمالي</th>
                    <th className="px-2 py-1.5 text-start">− تحويلات</th>
                    <th className="px-2 py-1.5 text-start">− مستثنى</th>
                    <th className="px-2 py-1.5 text-start">= الصافي</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {summary.branches.map((row) => (
                    <tr key={row.branch} className="dawaa-theme-border border-t">
                      <td className="px-2 py-1.5">{branchShort(row.branch)}</td>
                      <td className="px-2 py-1.5">{money(row.gross)}</td>
                      <td className="px-2 py-1.5">{money(row.transfers)}</td>
                      <td className="px-2 py-1.5">{money(row.excluded)}</td>
                      <td className="dawaa-theme-heading px-2 py-1.5 font-black">
                        {money(row.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="dawaa-caption dawaa-theme-border border-t px-2 py-1.5 text-[10px] font-bold">
                الموردين المستثنيين:{' '}
                {summary.excluded_suppliers.length ? summary.excluded_suppliers.join('، ') : 'مفيش'}
                {' · '}آخر مزامنة مع تطبيق المشتريات {syncLabel(summary.synced_at)}
              </p>
            </div>
          ) : null}
        </>
      ) : !error ? (
        <Loader2 className="dawaa-caption mt-3 h-4 w-4 animate-spin" />
      ) : null}
    </section>
  );
}

/** «الفلوس»: treasury total and net purchases for the period, each per branch. GM and executive only. */
export function GmMoneyOverview() {
  return (
    <Panel className="p-4 sm:p-5">
      <div className="grid gap-5 lg:grid-cols-2 lg:gap-8">
        <Treasury />
        <Purchases />
      </div>
    </Panel>
  );
}
