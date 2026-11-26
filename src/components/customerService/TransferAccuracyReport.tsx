import { useState } from 'react';
import { Download, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  EmptyState,
  MiniBox,
  Panel,
  SectionTitle,
} from '@/components/dashboard/DashboardPrimitives';
import { loadTransferPeriod, type TransferDay } from '@/lib/customerServiceTasks/morning';
import { LINE_CHECKS } from '@/lib/purchaseReview/invoiceLines';
import {
  exportTransferAccuracy,
  transferAccuracy,
  type TransferAccuracy,
} from '@/lib/purchaseReview/transferAccuracy';

// تقرير دقة التحويلات على فترة: الأكواد المكررة لنفس الصنف، الكميات المختلفة، الدكاترة، والأصناف المشكوك في رصيدها.

const BRANCHES = ['فرع شكري', 'فرع الشامي'];
const cairoToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const qty = (v: number) => v.toLocaleString('ar-EG', { maximumFractionDigits: 2 });
const dm = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

export default function TransferAccuracyReport() {
  const today = cairoToday();
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<TransferAccuracy | null>(null);
  const [view, setView] = useState<'codes' | 'issues' | 'doctors' | 'stock'>('codes');

  async function load() {
    setBusy(true);
    try {
      // الفرع بتاعي الأول؛ ولو أقدر أختار، الفرع التاني كمان عشان التحويلات في الاتجاهين.
      const first = await loadTransferPeriod(from, to, null);
      const days: TransferDay[] = [first];
      if (first.can_pick) {
        const other = BRANCHES.find((b) => b !== first.branch)!;
        days.push(await loadTransferPeriod(from, to, other));
      }
      setReport(transferAccuracy(days));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!report) return;
    const blob = await exportTransferAccuracy(report, `دقة التحويلات من ${from} لحد ${to}`);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `دقة-التحويلات-${from}-${to}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  return (
    <Panel>
      <SectionTitle
        title="دقة التحويلات"
        subtitle="كل تحويل بيتقارن صنف صنف (بيع الفرع اللي بعت قصاد شراء الفرع اللي استلم): أكواد مكررة لنفس الصنف، كميات مختلفة، والدكاترة اللي بيحصل معاهم أخطاء"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <label className="inline-flex items-center gap-1">
          من
          <input
            type="date"
            className="input-field w-auto"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="inline-flex items-center gap-1">
          لحد
          <input
            type="date"
            className="input-field w-auto"
            value={to}
            max={today}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button
          className="btn-primary inline-flex items-center gap-1"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} اعرض
        </button>
        {report ? (
          <button
            className="btn-secondary inline-flex items-center gap-1"
            onClick={() => void download()}
          >
            <Download size={16} /> إكسيل
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-xs opacity-60">أقصى فترة شهرين.</p>

      {report ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <MiniBox label="تحويلات اتربطت" value={String(report.transfers)} tone="blue" />
            <MiniBox label="اتقارنت صنف صنف" value={String(report.compared)} tone="cyan" />
            <MiniBox
              label="فيها أخطاء"
              value={String(report.withIssues)}
              tone={report.withIssues ? 'amber' : 'green'}
            />
            <MiniBox
              label="أكواد مكررة"
              value={String(report.codePairs.length)}
              tone={report.codePairs.length ? 'amber' : 'green'}
            />
            <MiniBox
              label="من غير ربط"
              value={String(report.unpairedPurchases + report.unpairedSales)}
              tone={report.unpairedPurchases + report.unpairedSales ? 'amber' : 'green'}
            />
          </div>
          {report.missingLines ? (
            <div className="mt-2 rounded-xl border border-[var(--dawaa-status-warning-text,#b45309)] bg-[var(--dawaa-status-warning-bg,#fef3c7)] p-2 text-xs text-[var(--dawaa-status-warning-text,#b45309)]">
              <div className="font-black">
                {report.noLines} تحويل ماتقارنش صنف صنف: أصناف فواتير الشراء مش مرفوعة من{' '}
                {dm(report.missingLines.from)} لحد {dm(report.missingLines.to)}.
              </div>
              <div className="mt-0.5">
                ده اللي مخلّي «فيها أخطاء» صفر و«من غير ربط» كبير: من غير الأصناف الربط بيبقى
                بالقيمة بس. الحل: من «مراجعة المشتريات» ارفعوا تقرير «فواتير الشراء» من ePlus متصدّر
                بالأصناف، من {dm(report.missingLines.from)} لحد {dm(report.missingLines.to)} مرة
                واحدة لكل مخزن ({report.missingLines.stores.join('، ')}). الأيام دي بتتبدّل بس ومفيش
                حاجة بتتكرر.
              </div>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            {(
              [
                ['codes', `أكواد مكررة (${report.codePairs.length})`],
                ['issues', `كل الأخطاء (${report.issues.length})`],
                ['doctors', `الدكاترة (${report.doctors.length})`],
                ['stock', `للجرد (${report.suspects.length})`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                className={view === k ? 'btn-primary !py-1' : 'btn-secondary !py-1'}
                onClick={() => setView(k)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-2 max-h-[60vh] overflow-auto">
            {view === 'codes' ? (
              report.codePairs.length ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-right opacity-70">
                      <th className="p-1.5">اتباع بكود</th>
                      <th className="p-1.5">واتشرى بكود</th>
                      <th className="p-1.5">كام مرة</th>
                      <th className="p-1.5">آخر مرة</th>
                      <th className="p-1.5">مين</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.codePairs.map((c) => (
                      <tr
                        key={`${c.saleCode}|${c.purchaseCode}`}
                        className="border-t border-[var(--dawaa-theme-border)] align-top"
                      >
                        <td className="p-1.5" dir="auto">
                          <span className="font-mono font-black">{c.saleCode}</span> {c.saleName}
                        </td>
                        <td className="p-1.5" dir="auto">
                          <span className="font-mono font-black">{c.purchaseCode}</span>{' '}
                          {c.purchaseName}
                        </td>
                        <td className="p-1.5 font-black">{c.times}</td>
                        <td className="p-1.5">{dm(c.lastDay)}</td>
                        <td className="p-1.5">{c.people.join('، ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState label="مفيش أكواد مكررة في الفترة دي" />
              )
            ) : null}

            {view === 'issues' ? (
              report.issues.length ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-right opacity-70">
                      <th className="p-1.5">اليوم</th>
                      <th className="p-1.5">المشكلة</th>
                      <th className="p-1.5">البيع</th>
                      <th className="p-1.5">الشراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.issues.map((i, n) => (
                      <tr key={n} className="border-t border-[var(--dawaa-theme-border)] align-top">
                        <td className="p-1.5 whitespace-nowrap">
                          {dm(i.day)}
                          <span className="block opacity-60">{i.route}</span>
                        </td>
                        <td className="p-1.5 font-black">
                          {LINE_CHECKS[i.check]}
                          {i.check === 'code' && i.qtyDiffers ? ' وكمية مختلفة' : ''}
                        </td>
                        <td className="p-1.5" dir="auto">
                          {i.sale ? (
                            <>
                              <span className="font-mono">{i.sale.code}</span> {i.sale.name} ×{' '}
                              <b>{qty(i.sale.qty)}</b>
                            </>
                          ) : (
                            '—'
                          )}
                          <span className="block opacity-60">
                            فاتورة {i.saleInvoice} · {i.seller}
                          </span>
                        </td>
                        <td className="p-1.5" dir="auto">
                          {i.purchase ? (
                            <>
                              <span className="font-mono">{i.purchase.code}</span> {i.purchase.name}{' '}
                              × <b>{qty(i.purchase.qty)}</b>
                            </>
                          ) : (
                            '—'
                          )}
                          <span className="block opacity-60">
                            مسلسل {i.purchaseSerial} · {i.receiver}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState label="مفيش أخطاء في التحويلات اللي اتقارنت" />
              )
            ) : null}

            {view === 'doctors' ? (
              report.doctors.length ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-right opacity-70">
                      <th className="p-1.5">الاسم</th>
                      <th className="p-1.5">وهو بايع</th>
                      <th className="p-1.5">وهو مستلم</th>
                      <th className="p-1.5">أكواد غلط</th>
                      <th className="p-1.5">كميات مختلفة</th>
                      <th className="p-1.5">صنف في ناحية بس</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.doctors.map((d) => (
                      <tr key={d.name} className="border-t border-[var(--dawaa-theme-border)]">
                        <td className="p-1.5 font-black">{d.name}</td>
                        <td className="p-1.5">
                          {d.soldWithIssues} من {d.sold}
                        </td>
                        <td className="p-1.5">
                          {d.receivedWithIssues} من {d.received}
                        </td>
                        <td className="p-1.5">{d.issues.code ?? 0}</td>
                        <td className="p-1.5">{d.issues.qty ?? 0}</td>
                        <td className="p-1.5">
                          {(d.issues.only_sale ?? 0) + (d.issues.only_purchase ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState label="مفيش دكاترة عندهم أخطاء في الفترة دي" />
              )
            ) : null}

            {view === 'stock' ? (
              report.suspects.length ? (
                <>
                  <p className="mb-1 text-xs opacity-70">
                    الموجب = الرصيد على السيستم غالباً أكتر من الرف، والسالب = أقل. اتأكدوا بالعد.
                  </p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-right opacity-70">
                        <th className="p-1.5">الفرع</th>
                        <th className="p-1.5">الصنف</th>
                        <th className="p-1.5">الرصيد غالباً</th>
                        <th className="p-1.5">عدد الأخطاء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.suspects.map((s) => (
                        <tr
                          key={`${s.branch}|${s.code}`}
                          className="border-t border-[var(--dawaa-theme-border)]"
                        >
                          <td className="p-1.5">{s.branch.replace('فرع ', '')}</td>
                          <td className="p-1.5" dir="auto">
                            <span className="font-mono">{s.code}</span> {s.name}
                          </td>
                          <td className="p-1.5 font-black">
                            {s.offBy > 0
                              ? `زايد ${qty(s.offBy)}`
                              : s.offBy < 0
                                ? `ناقص ${qty(-s.offBy)}`
                                : '—'}
                          </td>
                          <td className="p-1.5">{s.issues}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <EmptyState label="مفيش أصناف مشكوك في رصيدها من التحويلات" />
              )
            ) : null}
          </div>
        </>
      ) : null}
    </Panel>
  );
}
