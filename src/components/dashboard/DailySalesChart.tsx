import {
  ResponsiveContainer,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Line,
} from 'recharts';

export type DailyChartMetric = 'sales' | 'average' | 'invoices';

export type DailyChartRow = {
  label: string;
  totalSales: number;
  totalInvoices: number;
  totalAverage: number;
  shokrySales: number;
  shokryInvoices: number;
  shokryAverage: number;
  shamySales: number;
  shamyInvoices: number;
  shamyAverage: number;
};

const metricConfig: Record<DailyChartMetric, { keys: [string, string, string]; unit: string }> = {
  sales: { keys: ['totalSales', 'shokrySales', 'shamySales'], unit: 'جنيه' },
  average: { keys: ['totalAverage', 'shokryAverage', 'shamyAverage'], unit: 'جنيه' },
  invoices: { keys: ['totalInvoices', 'shokryInvoices', 'shamyInvoices'], unit: 'فاتورة' },
};

export default function DailySalesChart({
  data,
  metric = 'sales',
}: {
  data: DailyChartRow[];
  metric?: DailyChartMetric;
}) {
  const config = metricConfig[metric];
  const moneyMetric = metric !== 'invoices';
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 12, left: 12, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
        <XAxis
          dataKey="label"
          tick={{ fill: '#94a3b8', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          interval={0}
          angle={-20}
          textAnchor="end"
          height={55}
        />
        <YAxis
          tick={{ fill: '#94a3b8', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(value) =>
            moneyMetric && Number(value) >= 1000
              ? `${Math.round(Number(value) / 1000)}K`
              : Number(value).toLocaleString('ar-EG')
          }
        />
        <Tooltip
          formatter={(value) =>
            `${Math.round(Number(value)).toLocaleString('ar-EG')} ${config.unit}`
          }
          contentStyle={{
            background: '#0f172a',
            border: '1px solid rgba(45,212,191,0.25)',
            borderRadius: 16,
            color: '#fff',
          }}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey={config.keys[0]}
          stroke="#2dd4bf"
          strokeWidth={3}
          dot={{ r: 3, fill: '#2dd4bf' }}
          activeDot={{ r: 7 }}
          name="إجمالي اليوم"
          connectNulls
        />
        <Line
          type="monotone"
          dataKey={config.keys[1]}
          stroke="#38bdf8"
          strokeWidth={2.5}
          dot={{ r: 2.5, fill: '#38bdf8' }}
          activeDot={{ r: 6 }}
          name="فرع شكري"
          connectNulls
        />
        <Line
          type="monotone"
          dataKey={config.keys[2]}
          stroke="#8b5cf6"
          strokeWidth={2.5}
          dot={{ r: 2.5, fill: '#8b5cf6' }}
          activeDot={{ r: 6 }}
          name="فرع الشامي"
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
