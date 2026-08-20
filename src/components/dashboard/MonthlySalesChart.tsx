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

  if (!R) return <div className="h-full flex items-center justify-center">جاري تحميل الرسم...</div>;

  const { ResponsiveContainer, LineChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Line } = R;

  const MonthlyTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload || {};
    return (
      <div
        dir="rtl"
        style={{
          background: '#0f172a',
          border: '1px solid rgba(45,212,191,0.25)',
          borderRadius: 16,
          color: '#fff',
          padding: '10px 14px',
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 12, color: '#5eead4' }}>
          إجمالي المبيعات: {Number(point.sales_total || 0).toLocaleString()} جنيه
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
          عدد الفواتير: {Number(point.invoices_count || 0).toLocaleString()}
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
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
            <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.45} />
            <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
        <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}K`} />
        <Tooltip content={<MonthlyTooltip />} />
        <Legend />
        <Line type="monotone" dataKey="sales_total" stroke="#2dd4bf" strokeWidth={4} dot={{ r: 4 }} name="إجمالي الشهر" />
      </LineChart>
    </ResponsiveContainer>
  );
}
