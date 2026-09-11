import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/utils';
import { Panel, SectionTitle, EmptyState, MiniBox } from '@/components/dashboard/DashboardPrimitives';

const BRANCHES = ['الكل', 'فرع شكري', 'فرع الشامي'] as const;
const SHIFT_LABEL: Record<string, string> = { 'صباحي': 'صباحي', 'مسائي': 'مسائي', 'ليلي': 'ليلي' };

type ShiftRow = {
  id: string;
  branch: string;
  shift_type: string;
  shift_date: string;
  submitted_by: string | null;
  total_sales: number;
  total_expenses: number;
  net_amount: number;
  expenses: { category?: string; amount?: number; description?: string }[];
};

function n(value: unknown) {
  const x = Number(value || 0);
  return Number.isFinite(x) ? x : 0;
}

export default function ShiftHandovers() {
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [branchFilter, setBranchFilter] = useState<(typeof BRANCHES)[number]>('الكل');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const { data, error } = await supabase
      .from('shift_handovers')
      .select('*')
      .order('shift_date', { ascending: false })
      .order('recorded_at', { ascending: false })
      .limit(300);
    if (error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setRows((data || []) as ShiftRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => (branchFilter === 'الكل' ? rows : rows.filter((r) => r.branch === branchFilter)),
    [rows, branchFilter]
  );

  const totals = useMemo(
    () => ({
      count: filtered.length,
      totalSales: filtered.reduce((a, r) => a + n(r.total_sales), 0),
      totalExpenses: filtered.reduce((a, r) => a + n(r.total_expenses), 0),
      totalNet: filtered.reduce((a, r) => a + n(r.net_amount), 0),
    }),
    [filtered]
  );

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-card dawaa-card--raised">
        <h1 className="dawaa-title text-2xl">تسليم الشيفتات</h1>
        <p className="dawaa-caption mt-1 font-bold">
          بيانات حقيقية متزامنة من تسليمات الشيفت المسجّلة في تطبيق DawaaWael.
        </p>
      </section>

      <div className="grid gap-3 md:grid-cols-4">
        <MiniBox label="عدد التسليمات" value={totals.count.toLocaleString('ar-EG')} />
        <MiniBox label="إجمالي المبيعات" value={formatCurrency(totals.totalSales)} />
        <MiniBox label="إجمالي المصروفات" value={formatCurrency(totals.totalExpenses)} tone="amber" />
        <MiniBox label="صافي التسليم" value={formatCurrency(totals.totalNet)} tone="green" />
      </div>

      <Panel className="p-4">
        <SectionTitle title="سجل التسليمات" icon={<Clock size={18} />} />
        <div className="mb-3 flex flex-wrap gap-2">
          {BRANCHES.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBranchFilter(b)}
              className={`dawaa-tab ${branchFilter === b ? 'is-active' : ''}`}
            >
              {b}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
        ) : loadError ? (
          <EmptyState label="تعذّر التحميل" error onRetry={() => void load()} />
        ) : filtered.length === 0 ? (
          <EmptyState label="لا توجد تسليمات مسجلة" />
        ) : (
          <div className="space-y-2">
            {filtered.map((row) => (
              <div key={row.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                      {row.branch} — شيفت {SHIFT_LABEL[row.shift_type] || row.shift_type}
                    </p>
                    <p className="dawaa-caption mt-0.5 text-xs font-bold">
                      {row.shift_date} · بواسطة {row.submitted_by || '-'}
                    </p>
                  </div>
                  <div className="text-left">
                    <p className="font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>
                      {formatCurrency(n(row.net_amount))}
                    </p>
                    <p className="dawaa-caption text-xs font-bold">
                      مبيعات {formatCurrency(n(row.total_sales))} · مصروفات {formatCurrency(n(row.total_expenses))}
                    </p>
                  </div>
                </div>
                {row.expenses?.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {row.expenses.map((e, idx) => (
                      <span key={idx} className="dawaa-badge dawaa-badge--info text-xs font-bold">
                        {e.category || '-'}: {formatCurrency(n(e.amount))}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
