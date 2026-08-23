import React from 'react';

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
  const [R, setR] = React.useState<any>(null);

  React.useEffect(() => {
    let mounted = true;
    import('recharts').then((m) => {
      if (mounted) setR(m);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!R) {
    return <div className="dawaa-caption flex h-full items-center justify-center">جاري تحميل الرسم...</div>;
  }

  const { ResponsiveContainer, LineChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Line } = R;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 12, left: 12, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--dawaa-chart-grid)" />
        <XAxis
          dataKey="label"
          tick={{ fill: 'var(--dawaa-chart-axis)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          interval={0}
          angle={-20}
          textAnchor="end"
          height={55}
        />
        <YAxis
          tick={{ fill: 'var(--dawaa-chart-axis)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(value) =>
            moneyMetric && Number(value) >= 1000
              ? `${Math.round(Number(value) / 1000)}K`
              : Number(value).toLocaleString('ar-EG')
          }
        />
        <Tooltip
          formatter={(value) => `${Math.round(Number(value)).toLocaleString('ar-EG')} ${config.unit}`}
          contentStyle={{
            background: 'var(--dawaa-chart-tooltip-bg)',
            border: '1px solid var(--dawaa-chart-tooltip-border)',
            borderRadius: 16,
            color: 'var(--dawaa-chart-tooltip-text)',
            boxShadow: 'var(--dawaa-theme-shadow-soft)',
          }}
          labelStyle={{ color: 'var(--dawaa-chart-tooltip-text)' }}
          itemStyle={{ color: 'var(--dawaa-chart-tooltip-muted)' }}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey={config.keys[0]}
          stroke="var(--dawaa-chart-series-1)"
          strokeWidth={3}
          dot={{ r: 3, fill: 'var(--dawaa-chart-series-1)' }}
          activeDot={{ r: 7 }}
          name="إجمالي اليوم"
          connectNulls
        />
        <Line
          type="monotone"
          dataKey={config.keys[1]}
          stroke="var(--dawaa-chart-series-2)"
          strokeWidth={2.5}
          dot={{ r: 2.5, fill: 'var(--dawaa-chart-series-2)' }}
          activeDot={{ r: 6 }}
          name="فرع شكري"
          connectNulls
        />
        <Line
          type="monotone"
          dataKey={config.keys[2]}
          stroke="var(--dawaa-chart-series-3)"
          strokeWidth={2.5}
          dot={{ r: 2.5, fill: 'var(--dawaa-chart-series-3)' }}
          activeDot={{ r: 6 }}
          name="فرع الشامي"
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
