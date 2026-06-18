import { useMemo, memo } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { formatCurrency } from '@/lib/utils';

interface DoctorPerformanceChartsProps {
  salesRows: Record<string, unknown>[];
  pointsRows: Array<{
    created_at: string;
    points_delta?: number | null;
    points: number;
    type: string;
  }>;
  staffName: string;
}

interface MonthlyData {
  month: string;
  sales: number;
  invoiceCount: number;
  avgInvoice: number;
  rewards: number;
  deductions: number;
}

const DoctorPerformanceCharts = ({
  salesRows,
  pointsRows,
  staffName,
}: DoctorPerformanceChartsProps) => {
  const monthlyData = useMemo(() => {
    const monthlyMap = new Map<string, MonthlyData>();

    // Process sales data
    for (const row of salesRows) {
      const date = new Date(
        (row.invoice_date as string) || (row.created_at as string) || Date.now()
      );
      const monthKey = date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short' });

      const current = monthlyMap.get(monthKey) || {
        month: monthKey,
        sales: 0,
        invoiceCount: 0,
        avgInvoice: 0,
        rewards: 0,
        deductions: 0,
      };

      const amount = Number(row.net_total || row.net_sales || row.sales_total || 0);
      const invoiceCount = Number(row.invoices_count || row.invoice_count || 1);

      current.sales += amount;
      current.invoiceCount += invoiceCount;
      current.avgInvoice = current.invoiceCount > 0 ? current.sales / current.invoiceCount : 0;

      monthlyMap.set(monthKey, current);
    }

    // Process points data
    for (const row of pointsRows) {
      const date = new Date(row.created_at);
      const monthKey = date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short' });

      const current = monthlyMap.get(monthKey);
      if (!current) continue;

      const delta =
        row.points_delta !== null && row.points_delta !== undefined
          ? row.points_delta
          : row.type === 'deduction'
            ? -row.points
            : row.points;

      if (delta > 0) {
        current.rewards += delta;
      } else if (delta < 0) {
        current.deductions += Math.abs(delta);
      }
    }

    // Convert to array and sort by date
    return Array.from(monthlyMap.values())
      .sort((a, b) => {
        const dateA = new Date(a.month);
        const dateB = new Date(b.month);
        return dateA.getTime() - dateB.getTime();
      })
      .slice(-6); // Last 6 months
  }, [salesRows, pointsRows]);

  if (monthlyData.length === 0) {
    return (
      <div className="stat-card p-6 text-center text-slate-400">
        لا توجد بيانات كافية لعرض الرسوم البيانية
      </div>
    );
  }

  const chartConfig = {
    sales: { label: 'المبيعات', color: '#14b8a6' },
    invoiceCount: { label: 'عدد الفواتير', color: '#3b82f6' },
    avgInvoice: { label: 'متوسط الفاتورة', color: '#8b5cf6' },
    rewards: { label: 'المكافآت', color: '#22c55e' },
    deductions: { label: 'الخصومات', color: '#ef4444' },
  };

  return (
    <div className="space-y-6">
      {/* Sales and Invoice Count Chart */}
      <div className="stat-card p-5">
        <h3 className="text-white font-bold text-sm mb-4">
          تطور المبيعات وعدد الفواتير (آخر 6 أشهر)
        </h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d4063" />
              <XAxis
                dataKey="month"
                stroke="#94a3b8"
                fontSize={12}
                tickFormatter={(value) => value}
              />
              <YAxis
                yAxisId="sales"
                stroke="#94a3b8"
                fontSize={12}
                tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
              />
              <YAxis yAxisId="count" orientation="right" stroke="#94a3b8" fontSize={12} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload) return null;
                  return (
                    <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-lg p-3">
                      <div className="text-white font-bold mb-2">{payload[0].payload.month}</div>
                      {payload.map((entry: any) => (
                        <div key={entry.name} className="flex items-center gap-2 text-sm">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: entry.color }}
                          />
                          <span className="text-slate-300">{entry.name}:</span>
                          <span className="text-white font-bold">
                            {entry.name === 'المبيعات' || entry.name === 'متوسط الفاتورة'
                              ? formatCurrency(Number(entry.value))
                              : Number(entry.value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <Legend />
              <Line
                yAxisId="sales"
                type="monotone"
                dataKey="sales"
                stroke="#14b8a6"
                strokeWidth={2}
                name="المبيعات"
                dot={{ fill: '#14b8a6', strokeWidth: 2, r: 4 }}
              />
              <Line
                yAxisId="count"
                type="monotone"
                dataKey="invoiceCount"
                stroke="#3b82f6"
                strokeWidth={2}
                name="عدد الفواتير"
                dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Average Invoice Chart */}
      <div className="stat-card p-5">
        <h3 className="text-white font-bold text-sm mb-4">متوسط قيمة الفاتورة (آخر 6 أشهر)</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d4063" />
              <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
              <YAxis
                stroke="#94a3b8"
                fontSize={12}
                tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload) return null;
                  return (
                    <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-lg p-3">
                      <div className="text-white font-bold mb-2">{payload[0].payload.month}</div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-slate-300">متوسط الفاتورة:</span>
                        <span className="text-white font-bold">
                          {formatCurrency(Number(payload[0].value))}
                        </span>
                      </div>
                    </div>
                  );
                }}
              />
              <Bar
                dataKey="avgInvoice"
                fill="#8b5cf6"
                radius={[4, 4, 0, 0]}
                name="متوسط الفاتورة"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Rewards and Deductions Chart */}
      <div className="stat-card p-5">
        <h3 className="text-white font-bold text-sm mb-4">المكافآت والخصومات (آخر 6 أشهر)</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d4063" />
              <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
              <YAxis stroke="#94a3b8" fontSize={12} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload) return null;
                  return (
                    <div className="bg-[#1B2B4B] border border-[#2d4063] rounded-lg p-3">
                      <div className="text-white font-bold mb-2">{payload[0].payload.month}</div>
                      {payload.map((entry: any) => (
                        <div key={entry.name} className="flex items-center gap-2 text-sm">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: entry.color }}
                          />
                          <span className="text-slate-300">{entry.name}:</span>
                          <span className="text-white font-bold">{Number(entry.value)} نقطة</span>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <Legend />
              <Bar dataKey="rewards" fill="#22c55e" radius={[4, 4, 0, 0]} name="المكافآت" />
              <Bar dataKey="deductions" fill="#ef4444" radius={[4, 4, 0, 0]} name="الخصومات" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default memo(DoctorPerformanceCharts);
