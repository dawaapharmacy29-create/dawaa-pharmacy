import React from 'react';

export default function MonthlySalesChart({ data }: { data: any[] }) {
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

  const MonthlyTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload || {};
    return (
      <div
        dir="rtl"
        style={{
          background: 'var(--dawaa-chart-tooltip-bg)',
          border: '1px solid var(--dawaa-chart-tooltip-border)',
          borderRadius: 16,
          color: 'var(--dawaa-chart-tooltip-text)',
          padding: '10px 14px',
          boxShadow: 'var(--dawaa-theme-shadow-soft)',
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--dawaa-chart-series-1)' }}>
          إجمالي المبيعات: {Number(point.sales_total || 0).toLocaleString()} جنيه
        </div>
        <div style={{ fontSize: 12, color: 'var(--dawaa-chart-tooltip-muted)', marginTop: 2 }}>
          عدد الفواتير: {Number(point.invoices_count || 0).toLocaleString()}
        </div>
        <div style={{ fontSize: 12, color: 'var(--dawaa-chart-tooltip-muted)', marginTop: 2 }}>
          متوسط الفاتورة: {Number(point.avg_invoice || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} جنيه
        </div>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 12, left: 12, bottom: 0 }}>
        <defs>
          <linearGradient id="monthSales" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--dawaa-chart-series-2)" stopOpacity={0.38} />
            <stop offset="95%" stopColor="var(--dawaa-chart-series-2)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--dawaa-chart-grid)" />
        <XAxis
          dataKey="label"
          tick={{ fill: 'var(--dawaa-chart-axis)', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: 'var(--dawaa-chart-axis)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(value) => `${Math.round(Number(value) / 1000)}K`}
        />
        <Tooltip content={<MonthlyTooltip />} />
        <Legend />
        <Line
          type="monotone"
          dataKey="sales_total"
          stroke="var(--dawaa-chart-series-1)"
          strokeWidth={4}
          dot={{ r: 4, fill: 'var(--dawaa-chart-series-1)', stroke: 'var(--dawaa-theme-surface)' }}
          activeDot={{ r: 6, fill: 'var(--dawaa-chart-series-1)', stroke: 'var(--dawaa-theme-surface)' }}
          name="إجمالي الشهر"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
