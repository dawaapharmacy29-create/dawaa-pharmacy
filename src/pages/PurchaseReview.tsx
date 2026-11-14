import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { EmptyState, Panel } from '@/components/dashboard/DashboardPrimitives';
import CashPanel from '@/components/purchase-review/CashPanel';
import SupplierLedger from '@/components/purchase-review/SupplierLedger';
import {
  count,
  dayLabel,
  money,
  monthLabel,
  shortBranch,
} from '@/components/purchase-review/shared';
import { loadAccountantReport } from '@/lib/accountantReport';
import { importPurchaseReport, loadPurchaseReview, readEPlusFile } from '@/lib/purchaseReview/api';
import {
  cashPlan,
  monthRange,
  monthSummary,
  supplierBalances,
  uploadFreshness,
  type PurchaseReviewData,
} from '@/lib/purchaseReview/ledger';

// «مراجعة المشتريات»: the ePlus purchase reports of the four stores, read month by month (from the 1st),
// with what we owe every supplier, when it falls due, and how that sits against the cash in the treasury.

type UploadLine = { file: string; ok: boolean; text: string };

export default function PurchaseReview() {
  const [data, setData] = useState<PurchaseReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [monthOffset, setMonthOffset] = useState(0);
  const [treasury, setTreasury] = useState<number | null>(null);
  const [treasuryError, setTreasuryError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadLog, setUploadLog] = useState<UploadLine[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadPurchaseReview(null));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر التحميل');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    loadAccountantReport(null)
      .then((report) =>
        setTreasury(report.vaults.reduce((s, v) => s + (Number(v.balance) || 0), 0))
      )
      .catch((err) => setTreasuryError(err instanceof Error ? err.message : 'الخزنة مش متاحة'));
  }, [load]);

  const today = data?.today || new Date().toISOString().slice(0, 10);
  const range = useMemo(() => monthRange(today, monthOffset), [today, monthOffset]);
  const month = useMemo(() => (data ? monthSummary(data, range) : null), [data, range]);
  const balances = useMemo(() => (data ? supplierBalances(data) : []), [data]);
  const plan = useMemo(() => cashPlan(balances, today), [balances, today]);
  const fresh = useMemo(() => (data ? uploadFreshness(data.uploads, today) : []), [data, today]);
  const supplierName = useMemo(
    () => new Map((data?.suppliers ?? []).map((s) => [s.code, s.name])),
    [data]
  );

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    const log: UploadLine[] = [];
    for (const file of Array.from(files)) {
      try {
        const report = await readEPlusFile(file);
        const result = await importPurchaseReport(report, file.name);
        const sum = report.invoices.reduce((s, i) => s + i.net, 0);
        const off =
          report.reportNet != null &&
          Math.abs(sum - report.reportNet) > Math.max(5, report.reportNet * 0.001);
        log.push({
          file: file.name,
          ok: true,
          text: `${report.store} (${shortBranch(report.branch)}): ${count(result.invoices)} فاتورة من ${dayLabel(result.first_day)} لـ ${dayLabel(result.last_day)} بصافي ${money(result.net)}${off ? ` · ⚠️ إجمالي التقرير ${money(report.reportNet ?? 0)}` : ''}`,
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

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-card dawaa-card--raised">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="dawaa-title text-2xl">مراجعة المشتريات</h1>
            <p className="dawaa-caption mt-1 font-bold">
              مشتريات كل فرع من ePlus · شكري = الإدارة + مخزن د.وائل · الشامي = الفرعية + مخزن
              د.معاذ
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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

        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {fresh.map((s) => (
            <div
              key={s.store}
              className="dawaa-theme-border rounded-xl border px-3 py-2 text-xs font-bold"
              style={{
                background:
                  s.daysBehind == null || s.daysBehind > 1
                    ? 'var(--dawaa-status-warning-bg)'
                    : 'var(--dawaa-theme-surface)',
              }}
            >
              <p className="flex items-center gap-1 font-black">
                <FileSpreadsheet className="h-3.5 w-3.5" /> {s.store}
              </p>
              <p className="dawaa-caption">
                {s.upload
                  ? `لحد ${dayLabel(s.upload.last_day)}${s.daysBehind > 1 ? ` · ناقص ${count(s.daysBehind - 1)} يوم` : ' · محدّث'}`
                  : 'لسه ما اترفعش'}
              </p>
            </div>
          ))}
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
      ) : (
        <>
          <CashPanel plan={plan} treasury={treasury} treasuryError={treasuryError} today={today} />

          {month ? (
            <Panel className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="dawaa-title text-lg">مشتريات {monthLabel(range.from)}</h2>
                  <p className="dawaa-caption text-xs font-bold">
                    من {dayLabel(range.from)} لـ {dayLabel(monthOffset === 0 ? today : range.to)} ·
                    مش محسوب: دواء الشامي ودواء ابو العزم والجرد
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="dawaa-tab text-xs"
                    onClick={() => setMonthOffset((m) => m - 1)}
                    aria-label="الشهر اللي قبله"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className={`dawaa-tab text-xs ${monthOffset === 0 ? 'is-active' : ''}`}
                    onClick={() => setMonthOffset(0)}
                  >
                    الشهر ده
                  </button>
                  <button
                    type="button"
                    className="dawaa-tab text-xs"
                    disabled={monthOffset >= 0}
                    onClick={() => setMonthOffset((m) => Math.min(0, m + 1))}
                    aria-label="الشهر اللي بعده"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {[
                  [
                    'صافي المشتريات',
                    month.total.net,
                    'var(--dawaa-theme-heading)',
                    `${count(month.total.invoices)} فاتورة`,
                  ],
                  [
                    'آجل (علينا)',
                    month.total.credit,
                    'var(--dawaa-status-danger-text)',
                    'بيتدفع في ميعاد كل مورد',
                  ],
                  [
                    'نقدي (اتدفع من الدرج)',
                    month.total.cash,
                    'var(--dawaa-status-success-text)',
                    '',
                  ],
                  [
                    'مستثنى',
                    month.total.excluded,
                    'var(--dawaa-theme-muted, inherit)',
                    'تحويلات ما بينّا وجرد',
                  ],
                ].map(([label, value, color, note]) => (
                  <div
                    key={label as string}
                    className="rounded-2xl p-3"
                    style={{ background: 'var(--dawaa-theme-surface-raised)' }}
                  >
                    <p className="dawaa-caption text-[11px] font-black">{label}</p>
                    <p
                      className="text-2xl font-black tabular-nums"
                      style={{ color: color as string }}
                    >
                      {money(value as number)}
                    </p>
                    {note ? <p className="dawaa-caption text-[11px] font-bold">{note}</p> : null}
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {month.branches.map((b) => {
                  const top = month.suppliers.filter((s) => s.branch === b.branch).slice(0, 5);
                  return (
                    <div
                      key={b.branch}
                      className="rounded-2xl p-3"
                      style={{ background: 'var(--dawaa-theme-surface-raised)' }}
                    >
                      <div className="mb-2 flex items-baseline justify-between gap-2">
                        <p
                          className="text-base font-black"
                          style={{ color: 'var(--dawaa-theme-heading)' }}
                        >
                          {b.branch}
                        </p>
                        <p className="text-lg font-black tabular-nums">{money(b.net)}</p>
                      </div>
                      <table className="w-full text-xs font-bold">
                        <thead className="dawaa-caption">
                          <tr>
                            <th className="text-start">المخزن</th>
                            <th className="text-start">آجل</th>
                            <th className="text-start">نقدي</th>
                            <th className="text-start">مستثنى</th>
                          </tr>
                        </thead>
                        <tbody>
                          {b.stores.map((s) => (
                            <tr key={s.store}>
                              <td className="py-1">{s.store}</td>
                              <td className="tabular-nums">{money(s.credit)}</td>
                              <td className="tabular-nums">{money(s.cash)}</td>
                              <td className="dawaa-caption tabular-nums">{money(s.excluded)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {top.length ? (
                        <div className="mt-3">
                          <p className="dawaa-caption mb-1 text-[11px] font-black">
                            أكبر الموردين الشهر ده
                          </p>
                          {top.map((s) => (
                            <div key={s.code} className="mb-1">
                              <div className="flex justify-between text-[11px] font-bold">
                                <span>{supplierName.get(s.code) ?? s.name}</span>
                                <span className="tabular-nums">{money(s.net)}</span>
                              </div>
                              <div
                                className="h-1.5 overflow-hidden rounded-full"
                                style={{ background: 'var(--dawaa-theme-surface)' }}
                              >
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${b.net ? Math.max(2, (s.net / b.net) * 100) : 0}%`,
                                    background: 'var(--dawaa-status-info-text)',
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </Panel>
          ) : null}

          <SupplierLedger
            balances={balances}
            payments={data.payments}
            today={today}
            onChanged={load}
          />
        </>
      )}
    </div>
  );
}
