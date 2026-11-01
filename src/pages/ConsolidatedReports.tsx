import { useCallback, useEffect, useMemo, useState } from 'react';
import { Landmark, ListOrdered, Loader2, PieChart } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { Panel, SectionTitle, EmptyState, MiniBox } from '@/components/dashboard/DashboardPrimitives';
import {
  accountantSyncStale, categoryBreakdown, loadAccountantReport, type AccountantReport,
} from '@/lib/accountantReport';

const ALL = 'all';
const TX_LIMIT = 200;

const monthLabel = (value: string) =>
  new Date(`${value}-15T12:00:00`).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
const dayLabel = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'numeric' });
const timeLabel = (value: string | null) =>
  value ? new Date(value).toLocaleString('ar-EG', { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';
const signed = (value: number) => ({ color: value < 0 ? 'var(--dawaa-status-danger-text)' : 'var(--dawaa-status-success-text)' });

export default function ConsolidatedReports() {
  const [report, setReport] = useState<AccountantReport | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [vault, setVault] = useState<string>(ALL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (target: string | null) => {
    setLoading(true);
    setError('');
    try {
      setReport(await loadAccountantReport(target));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر التحميل');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(month);
  }, [load, month]);

  const vaults = report?.vaults ?? [];
  const totalBalance = vaults.reduce((a, v) => a + Number(v.balance), 0);
  const breakdown = useMemo(
    () => categoryBreakdown(report?.transactions ?? [], vault === ALL ? null : vault),
    [report, vault]
  );
  const movements = useMemo(
    () => (report?.transactions ?? []).filter((t) => vault === ALL || t.vault_code === vault),
    [report, vault]
  );
  const vaultName = (code: string) => vaults.find((v) => v.code === code)?.name ?? code;

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-card dawaa-card--raised">
        <h1 className="dawaa-title text-2xl">التقارير المجمعة</h1>
        <p className="dawaa-caption mt-1 font-bold">
          دفتر الخزن الثلاثة من تطبيق دواء بيلز · بيتزامن كل 15 دقيقة · آخر مزامنة {timeLabel(report?.synced_at ?? null)}
        </p>
        {report && accountantSyncStale(report.synced_at) ? (
          <div className="dawaa-alert dawaa-alert--danger mt-2 text-sm font-bold">
            ⚠️ المزامنة مع دواء بيلز متوقفة{report.last_error ? `: ${report.last_error.slice(0, 120)}` : ''}
          </div>
        ) : null}
      </section>

      {loading && !report ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
      ) : error ? (
        <EmptyState label={error} error onRetry={() => void load(month)} />
      ) : report ? (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setVault(ALL)} className={`dawaa-tab ${vault === ALL ? 'is-active' : ''}`}>
              كل الخزن
            </button>
            {vaults.map((v) => (
              <button key={v.code} type="button" onClick={() => setVault(v.code)} className={`dawaa-tab ${vault === v.code ? 'is-active' : ''}`}>
                {v.name}
              </button>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <Panel className="p-4">
              <p className="dawaa-caption text-xs font-bold">إجمالي الخزنة المجمعة</p>
              <p className="mt-1 text-2xl font-black" style={signed(totalBalance)}>{formatCurrency(totalBalance)}</p>
            </Panel>
            {vaults.map((v) => (
              <Panel key={v.code} className="p-4">
                <p className="dawaa-caption text-xs font-bold">{v.name}</p>
                <p className="mt-1 text-2xl font-black" style={signed(Number(v.balance))}>{formatCurrency(Number(v.balance))}</p>
                <p className="dawaa-caption mt-1 text-xs font-bold">
                  وارد {formatCurrency(Number(v.incoming))} · صادر {formatCurrency(Number(v.outgoing))}
                </p>
                <p className="dawaa-caption text-xs font-bold">
                  أول المدة {formatCurrency(Number(v.opening_balance))} · آخر حركة {v.last_date ? dayLabel(v.last_date) : '-'}
                </p>
              </Panel>
            ))}
          </div>

          <Panel className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle title="التوزيع الشهري حسب التصنيف" icon={<PieChart size={18} />} />
              <select className="dawaa-input" value={report.month} onChange={(e) => setMonth(e.target.value)}>
                {(report.months.length ? report.months : [report.month]).map((m) => (
                  <option key={m} value={m}>{monthLabel(m)}</option>
                ))}
              </select>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <MiniBox label="الوارد" value={formatCurrency(breakdown.total.incoming)} tone="green" />
              <MiniBox label="الصادر" value={formatCurrency(breakdown.total.outgoing)} tone="amber" />
              <MiniBox label="الفرق" value={formatCurrency(breakdown.total.diff)} />
            </div>
            {breakdown.rows.length ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm font-bold">
                  <thead>
                    <tr className="dawaa-caption text-xs">
                      <th className="p-2 text-right">التصنيف</th>
                      <th className="p-2">الوارد</th>
                      <th className="p-2">الصادر</th>
                      <th className="p-2">الفرق</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.rows.map((r) => (
                      <tr key={r.classification} className="border-t text-center" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                        <td className="p-2 text-right">{r.classification}</td>
                        <td className="p-2">{formatCurrency(r.incoming)}</td>
                        <td className="p-2">{formatCurrency(r.outgoing)}</td>
                        <td className="p-2" style={signed(r.diff)}>{formatCurrency(r.diff)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState label="مفيش حركات في الشهر ده" />
            )}
          </Panel>

          <Panel className="p-4">
            <SectionTitle title={`حركات ${monthLabel(report.month)}`} icon={<ListOrdered size={18} />} />
            {movements.length ? (
              <div className="space-y-1">
                {movements.slice(0, TX_LIMIT).map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 text-xs font-bold"
                    style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                    <span>
                      {dayLabel(t.date)} · {vault === ALL ? `${vaultName(t.vault_code)} · ` : ''}{t.classification}
                      {t.description ? ` · ${t.description}` : ''}
                      {t.created_by_name ? <span className="dawaa-caption"> — {t.created_by_name}</span> : null}
                    </span>
                    <span style={signed(t.direction === 'in' ? 1 : -1)}>
                      {t.direction === 'in' ? '+' : '−'}{formatCurrency(Number(t.amount))}
                    </span>
                  </div>
                ))}
                {movements.length > TX_LIMIT ? (
                  <p className="dawaa-caption pt-2 text-xs font-bold">ظاهر أحدث {TX_LIMIT} من {movements.length} حركة</p>
                ) : null}
              </div>
            ) : (
              <EmptyState label="مفيش حركات" />
            )}
          </Panel>

          <p className="dawaa-caption flex items-center gap-1 text-xs font-bold">
            <Landmark size={14} /> الرصيد = رصيد أول المدة + الوارد − الصادر (من غير الحركات الملغية)، زي تطبيق دواء بيلز بالظبط.
          </p>
        </>
      ) : null}
    </div>
  );
}
