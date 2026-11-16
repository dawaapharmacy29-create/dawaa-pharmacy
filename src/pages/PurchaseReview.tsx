import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw, Search, Upload } from 'lucide-react';
import { EmptyState, Panel } from '@/components/dashboard/DashboardPrimitives';
import MonthPurchases from '@/components/purchase-review/MonthPurchases';
import NeedsReview, { readDismissed } from '@/components/purchase-review/NeedsReview';
import PayNow from '@/components/purchase-review/PayNow';
import PurchaseSearch from '@/components/purchase-review/PurchaseSearch';
import SupplierLedger from '@/components/purchase-review/SupplierLedger';
import { count, dayLabel, money, shortBranch } from '@/components/purchase-review/shared';
import { loadAccountantReport } from '@/lib/accountantReport';
import { importPurchaseReport, loadPurchaseReview, readEPlusFile } from '@/lib/purchaseReview/api';
import { fillSupplierCodes } from '@/lib/purchaseReview/ePlusReport';
import {
  allPayments,
  cashPlan,
  normalizeName,
  payList,
  reviewIssues,
  supplierBalances,
  treasuryItems,
  uploadFreshness,
  type PurchaseReviewData,
} from '@/lib/purchaseReview/ledger';

// «مراجعة المشتريات»: the ePlus purchase reports of the four stores against the supplier payments in the
// treasury reports. Four tabs, one question each: what to pay now, where each supplier stands, what we
// bought, and what needs the owner's answer.

type Tab = 'pay' | 'suppliers' | 'month' | 'review';
type UploadLine = { file: string; ok: boolean; text: string };

export default function PurchaseReview() {
  const [data, setData] = useState<PurchaseReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFrom, setLoadFrom] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('pay');
  const [query, setQuery] = useState('');
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);
  const [treasury, setTreasury] = useState<number | null>(null);
  const [treasuryError, setTreasuryError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadLog, setUploadLog] = useState<UploadLine[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadPurchaseReview(loadFrom));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر التحميل');
    } finally {
      setLoading(false);
    }
  }, [loadFrom]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    loadAccountantReport(null)
      .then((report) =>
        setTreasury(report.vaults.reduce((s, v) => s + (Number(v.balance) || 0), 0))
      )
      .catch((err) => setTreasuryError(err instanceof Error ? err.message : 'الخزنة مش متاحة'));
  }, []);

  const today = data?.today || new Date().toISOString().slice(0, 10);
  const balances = useMemo(() => (data ? supplierBalances(data) : []), [data]);
  const plan = useMemo(() => cashPlan(balances, today), [balances, today]);
  const pay = useMemo(() => payList(balances, today), [balances, today]);
  const issues = useMemo(() => reviewIssues(balances, today), [balances, today]);
  const payments = useMemo(() => (data ? allPayments(data) : []), [data]);
  const links = useMemo(() => (data ? treasuryItems(data) : []), [data]);
  const fresh = useMemo(() => (data ? uploadFreshness(data.uploads, today) : []), [data, today]);
  const stale = fresh.filter((s) => s.daysBehind == null || s.daysBehind > 1);
  const toReview =
    issues.filter((i) => !dismissed.has(i.key)).length +
    links.filter((i) => !i.link).length +
    stale.length;
  const needFrom = useCallback(
    (from: string) => setLoadFrom((f) => (f && f <= from ? f : from)),
    []
  );

  const openSupplier = (code: string) => {
    setQuery('');
    setOpenCode(code);
    setTab('suppliers');
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    const log: UploadLine[] = [];
    for (const file of Array.from(files)) {
      try {
        // A report grouped by supplier has names only: take the codes from the suppliers we know.
        const { report, unknown } = fillSupplierCodes(
          await readEPlusFile(file),
          data?.suppliers ?? [],
          (name) => normalizeName(name, false)
        );
        const result = await importPurchaseReport(report, file.name);
        const sum = report.invoices.reduce((s, i) => s + i.net, 0);
        const off =
          report.reportNet != null &&
          Math.abs(sum - report.reportNet) > Math.max(5, report.reportNet * 0.001);
        log.push({
          file: file.name,
          ok: true,
          text: `${report.store} (${shortBranch(report.branch)}): ${count(result.invoices)} فاتورة لحد ${dayLabel(result.last_day)}${off ? ` · ⚠️ إجمالي التقرير ${money(report.reportNet ?? 0)}` : ''}${unknown.length ? ` · مورد جديد من غير كود: ${unknown.join('، ')}` : ''}`,
        });
      } catch (err) {
        log.push({
          file: file.name,
          ok: false,
          text: err instanceof Error ? err.message : 'تعذّر رفع الملف',
        });
      }
      setUploadLog([...log]);
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = '';
    await load();
  };

  const lastDay = fresh.reduce<string | null>(
    (m, s) => (s.upload && (!m || s.upload.last_day < m) ? s.upload.last_day : m),
    null
  );
  const TABS: [Tab, string, number?][] = [
    ['pay', 'المطلوب دفعه'],
    ['suppliers', 'الموردين'],
    ['month', 'مشتريات الشهر'],
    ['review', 'محتاج مراجعة', toReview],
  ];

  return (
    <div className="space-y-4" dir="rtl">
      <section className="dawaa-card dawaa-card--raised">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="dawaa-title text-2xl">مراجعة المشتريات</h1>
            <p className="dawaa-caption mt-1 text-xs font-bold">
              {lastDay ? `فواتير ePlus لحد ${dayLabel(lastDay)}` : 'لسه مفيش ملفات'}
              {stale.length ? ` · ${count(stale.length)} مخزن ناقصه أيام` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xls"
              multiple
              hidden
              onChange={(e) => void onFiles(e.target.files)}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
              className="dawaa-badge dawaa-badge--info gap-1 rounded-xl px-3 py-2 text-sm font-black"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              ارفع ملفات ePlus
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="dawaa-tab text-xs"
              aria-label="تحديث"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        {uploadLog.length ? (
          <ul className="mt-3 space-y-1 text-xs font-bold">
            {uploadLog.map((l) => (
              <li
                key={l.file}
                style={{
                  color: l.ok
                    ? 'var(--dawaa-status-success-text)'
                    : 'var(--dawaa-status-danger-text)',
                }}
              >
                {l.ok ? '✓' : '✗'} {l.file}: {l.text}
              </li>
            ))}
          </ul>
        ) : null}

        {data?.lines.length ? (
          <nav className="mt-4 flex flex-wrap gap-1.5">
            {TABS.map(([t, label, badge]) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`dawaa-tab text-sm ${tab === t ? 'is-active' : ''}`}
              >
                {label}
                {badge ? (
                  <span className="dawaa-badge dawaa-badge--warning ms-1 px-1.5 text-[10px]">
                    {count(badge)}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        ) : null}
      </section>

      {error ? (
        <Panel className="p-4">
          <p className="font-black text-[var(--dawaa-status-danger-text)]">{error}</p>
        </Panel>
      ) : !data ? (
        <Panel className="p-6">
          <Loader2 className="mx-auto h-6 w-6 animate-spin" />
        </Panel>
      ) : !data.lines.length ? (
        <Panel className="p-6">
          <EmptyState label="ارفع ملفات المشتريات من ePlus للمخازن الأربعة عشان الأرقام تظهر" />
        </Panel>
      ) : tab === 'pay' ? (
        <PayNow
          plan={plan}
          items={pay}
          treasury={treasury}
          treasuryError={treasuryError}
          today={today}
          onOpenSupplier={openSupplier}
        />
      ) : tab === 'suppliers' ? (
        <div className="space-y-3">
          <label className="dawaa-theme-surface dawaa-theme-border flex items-center gap-2 rounded-xl border px-3 py-2">
            <Search className="h-4 w-4 shrink-0 opacity-60" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="دوّر باسم المورد أو كوده، أو برقم فاتورة"
              className="w-full bg-transparent text-sm font-bold outline-none"
            />
          </label>
          <SupplierLedger
            balances={balances}
            payments={payments}
            today={today}
            trackFrom={data.track_from ?? null}
            query={query}
            openCode={openCode}
            onOpen={setOpenCode}
            onChanged={load}
          />
          <PurchaseSearch query={query} onChanged={load} />
        </div>
      ) : tab === 'month' ? (
        <MonthPurchases data={data} today={today} onNeedFrom={needFrom} />
      ) : (
        <NeedsReview
          issues={issues}
          dismissed={dismissed}
          onDismiss={setDismissed}
          treasuryItems={links}
          suppliers={data.suppliers}
          fresh={fresh}
          trackFrom={data.track_from ?? null}
          today={today}
          onChanged={load}
        />
      )}
    </div>
  );
}
