import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  EmptyState,
  MiniBox,
  Panel,
  SectionTitle,
} from '@/components/dashboard/DashboardPrimitives';
import {
  loadPaperSerialReport,
  paperSerialRate,
  type PaperSerialReport as Report,
} from '@/lib/customerServiceTasks/morning';

// تقرير المدير العام: كل اللي دخّل فواتير مشتريات، كتب المسلسل بإيده على الفاتورة الورق في كام فاتورة ونسي في كام
// (من مراجعة الصبح بتاعة خدمة العملاء)، والفواتير اللي نسيها، وملحوظات المرتجعات.

const money = (v: number) => v.toLocaleString('ar-EG', { maximumFractionDigits: 2 });
const dayLabel = (d: string) => d.split('-').reverse().slice(0, 2).join('/');

export default function PaperSerialReport({ from, to }: { from: string; to: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      setReport(await loadPaperSerialReport(from, to));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [from, to]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error)
    return (
      <Panel>
        <EmptyState label={error} />
      </Panel>
    );
  if (!report)
    return (
      <div className="flex justify-center p-6">
        <Loader2 className="animate-spin" />
      </div>
    );

  const totals = report.people.reduce(
    (s, p) => ({
      invoices: s.invoices + p.invoices,
      checked: s.checked + p.checked,
      wrote: s.wrote + p.wrote,
      forgot: s.forgot + p.forgot,
    }),
    { invoices: 0, checked: 0, wrote: 0, forgot: 0 }
  );
  const worst = report.people
    .filter((p) => p.forgot > 0)
    .sort(
      (a, b) => b.forgot - a.forgot || (paperSerialRate(a) ?? 100) - (paperSerialRate(b) ?? 100)
    )[0];
  const forgotten = showAll ? report.forgotten : report.forgotten.slice(0, 15);

  return (
    <>
      <Panel>
        <SectionTitle
          title="المسلسل على الفاتورة الورق"
          subtitle="كل اللي دخّل فواتير مشتريات: كتب رقم المسلسل بإيده على الفاتورة ولا نسي · من مراجعة الصبح"
        />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniBox label="فواتير الفترة" value={String(totals.invoices)} tone="blue" />
          <MiniBox
            label="اتراجع فيها المسلسل"
            value={`${totals.checked} / ${totals.invoices}`}
            tone="cyan"
          />
          <MiniBox
            label="مكتوب"
            value={`${totals.wrote}${totals.checked ? ` (${paperSerialRate(totals)}٪)` : ''}`}
            tone="green"
          />
          <MiniBox
            label="مش مكتوب"
            value={String(totals.forgot)}
            tone={totals.forgot ? 'amber' : 'cyan'}
          />
        </div>
        {worst ? (
          <p className="mt-2 text-sm">
            أكتر واحد مابيكتبش المسلسل: <span className="font-black">{worst.name}</span> (
            {worst.forgot} فاتورة من {worst.checked} اتراجعت)
          </p>
        ) : null}
        {report.people.length === 0 ? (
          <EmptyState label="مفيش فواتير مشتريات في الفترة دي" />
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right opacity-70">
                  <th className="p-2">الاسم</th>
                  <th className="p-2">الفرع</th>
                  <th className="p-2">فواتير سجّلها</th>
                  <th className="p-2">اتراجعت</th>
                  <th className="p-2">كتب المسلسل</th>
                  <th className="p-2">نسي</th>
                  <th className="p-2">النسبة</th>
                </tr>
              </thead>
              <tbody>
                {report.people.map((p) => {
                  const rate = paperSerialRate(p);
                  return (
                    <tr key={p.name} className="border-t border-[var(--dawaa-theme-border)]">
                      <td className="p-2 font-black">{p.name}</td>
                      <td className="p-2 text-xs">{p.branches}</td>
                      <td className="p-2">{p.invoices}</td>
                      <td className="p-2">{p.checked}</td>
                      <td className="p-2">{p.wrote}</td>
                      <td
                        className={`p-2 font-black ${p.forgot ? 'text-[var(--dawaa-status-danger-text)]' : ''}`}
                      >
                        {p.forgot}
                      </td>
                      <td className="p-2">{rate == null ? '—' : `${rate}٪`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {report.forgotten.length ? (
        <Panel>
          <SectionTitle
            title="فواتير المسلسل مش مكتوب عليها"
            subtitle={`${report.forgotten.length} فاتورة في الفترة`}
          />
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right opacity-70">
                  <th className="p-2">اليوم</th>
                  <th className="p-2">المخزن · المسلسل</th>
                  <th className="p-2">المورد</th>
                  <th className="p-2">القيمة</th>
                  <th className="p-2">سجّلها</th>
                  <th className="p-2">راجعتها</th>
                </tr>
              </thead>
              <tbody>
                {forgotten.map((f) => (
                  <tr
                    key={`${f.store}|${f.serial}`}
                    className="border-t border-[var(--dawaa-theme-border)]"
                  >
                    <td className="p-2 text-xs">{dayLabel(f.day)}</td>
                    <td className="p-2">
                      <span className="text-xs opacity-70">{f.store}</span>
                      <span className="block font-black">{f.serial}</span>
                    </td>
                    <td className="p-2">{f.supplier}</td>
                    <td className="p-2">{money(f.net)}</td>
                    <td className="p-2 font-bold">{f.who}</td>
                    <td className="p-2 text-xs">{f.by ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.forgotten.length > 15 ? (
            <button className="btn-secondary mt-2 text-xs" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'أقل' : `اعرض الكل (${report.forgotten.length})`}
            </button>
          ) : null}
        </Panel>
      ) : null}

      <Panel>
        <SectionTitle
          title="ملحوظات المرتجعات"
          subtitle="اللي اتكتب على فواتير المشتريات في المراجعة"
        />
        {report.returns.length === 0 ? (
          <EmptyState label="مفيش ملحوظات مرتجعات في الفترة دي" />
        ) : (
          <div className="mt-2 space-y-2">
            {report.returns.map((r) => (
              <div
                key={`${r.store}|${r.serial}`}
                className="rounded-xl border border-[var(--dawaa-theme-border)] p-2 text-sm"
              >
                <div className="flex flex-wrap gap-x-3 text-xs opacity-70">
                  <span>{dayLabel(r.day)}</span>
                  <span>
                    {r.store} · مسلسل {r.serial}
                  </span>
                  <span>{r.supplier}</span>
                  <span>{money(r.net)} ج</span>
                  <span>سجّلها {r.who}</span>
                  {r.by ? <span>كتبتها {r.by}</span> : null}
                </div>
                <p className="mt-1 font-bold">{r.note}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
