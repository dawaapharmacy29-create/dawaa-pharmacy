import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Loader2, Trophy } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { Panel, SectionTitle, EmptyState, MiniBox } from '@/components/dashboard/DashboardPrimitives';

type CycleRow = {
  branch: string;
  invoice_count: number;
  gross_purchases: number;
  approved_returns: number;
  net_purchases: number;
  avg_invoice_value: number;
};

type LeaderRow = {
  staff_id: string;
  staff_name: string;
  branch: string;
  invoice_count: number;
  total_value: number;
};

function n(value: unknown) {
  const x = Number(value || 0);
  return Number.isFinite(x) ? x : 0;
}

export default function PurchaseCycleReport() {
  const [rows, setRows] = useState<CycleRow[]>([]);
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [cycleDay, setCycleDay] = useState(10);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async (day: number) => {
    setLoading(true);
    setLoadError(false);
    const [reportRes, leaderRes] = await Promise.all([
      supabase.rpc('get_purchase_cycle_report_v2', { p_default_cycle_day: day }),
      supabase.rpc('get_purchase_data_entry_leaderboard_v1', { p_cycle_start_day: day }),
    ]);
    if (reportRes.error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setRows((reportRes.data || []) as CycleRow[]);
    setLeaders(!leaderRes.error ? ((leaderRes.data || []) as LeaderRow[]) : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(cycleDay);
  }, [load, cycleDay]);

  const totalNet = rows.reduce((a, r) => a + n(r.net_purchases), 0);
  const totalInvoices = rows.reduce((a, r) => a + n(r.invoice_count), 0);
  const totalReturns = rows.reduce((a, r) => a + n(r.approved_returns), 0);

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-card dawaa-card--raised">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="dawaa-title text-2xl">تقرير دورة المشتريات</h1>
            <p className="dawaa-caption mt-1 font-bold">إجمالي المشتريات والمرتجعات والصافي لكل فرع خلال الدورة الحالية.</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="dawaa-caption text-xs font-bold">يوم بداية الدورة الافتراضي</label>
            <input
              type="number"
              min={1}
              max={28}
              value={cycleDay}
              onChange={(e) => setCycleDay(Number(e.target.value) || 10)}
              className="dawaa-input w-20 py-2 text-sm font-bold"
            />
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
      ) : loadError ? (
        <EmptyState label="تعذّر تحميل التقرير" error onRetry={() => void load(cycleDay)} />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <MiniBox label="إجمالي عدد الفواتير" value={totalInvoices.toLocaleString('ar-EG')} />
            <MiniBox label="صافي المشتريات (الفرعين)" value={formatCurrency(totalNet)} />
            <MiniBox label="إجمالي المرتجعات المعتمدة" value={formatCurrency(totalReturns)} />
          </div>

          <Panel className="p-4">
            <SectionTitle title="تفصيل حسب الفرع" icon={<BarChart3 size={18} />} />
            {rows.length === 0 ? (
              <EmptyState label="لا توجد بيانات لهذه الدورة" />
            ) : (
              <div className="dawaa-table-shell shadow-none">
                <table className="dawaa-table-semantic min-w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-right">الفرع</th>
                      <th className="text-right">عدد الفواتير</th>
                      <th className="text-right">إجمالي المشتريات</th>
                      <th className="text-right">المرتجعات المعتمدة</th>
                      <th className="text-right">الصافي</th>
                      <th className="text-right">متوسط الفاتورة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.branch}>
                        <td className="font-black">{row.branch}</td>
                        <td>{n(row.invoice_count).toLocaleString('ar-EG')}</td>
                        <td>{formatCurrency(n(row.gross_purchases))}</td>
                        <td>{formatCurrency(n(row.approved_returns))}</td>
                        <td className="font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>
                          {formatCurrency(n(row.net_purchases))}
                        </td>
                        <td>{formatCurrency(n(row.avg_invoice_value))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel className="p-4">
            <SectionTitle title="مين بيسجل أكتر" icon={<Trophy size={18} />} subtitle="ترتيب حسب عدد فواتير المشتريات المسجّلة في الدورة الحالية" />
            {leaders.length === 0 ? (
              <EmptyState label="لا توجد بيانات تسجيل بعد" />
            ) : (
              <div className="space-y-2">
                {leaders
                  .slice()
                  .sort((a, b) => n(b.invoice_count) - n(a.invoice_count))
                  .map((leader, idx) => (
                    <div
                      key={leader.staff_id}
                      className="flex items-center justify-between rounded-xl border p-3"
                      style={{ borderColor: 'var(--dawaa-theme-border)' }}
                    >
                      <div className="flex items-center gap-3">
                        <span className="dawaa-icon-tile h-8 w-8 shrink-0 text-xs font-black">#{idx + 1}</span>
                        <div>
                          <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>{leader.staff_name}</p>
                          <p className="dawaa-caption text-xs font-bold">{leader.branch}</p>
                        </div>
                      </div>
                      <div className="text-left">
                        <p className="font-black">{n(leader.invoice_count).toLocaleString('ar-EG')} فاتورة</p>
                        <p className="dawaa-caption text-xs font-bold">{formatCurrency(n(leader.total_value))}</p>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
