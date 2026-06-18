import React from 'react';

export default function CustomerSegmentBars({ rows }: { rows: any[] }) {
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
    return <div className="h-full flex items-center justify-center">جاري تحميل الرسم...</div>;
  }

  const { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar } = R;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 0, right: 12, left: 12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip formatter={(value: any, name: any) => [Number(value).toLocaleString('ar-EG'), name]} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="veryImportant" name="مهم جدًا" stackId="segments" fill="#8b5cf6" />
        <Bar dataKey="important" name="مهم" stackId="segments" fill="#f59e0b" />
        <Bar dataKey="medium" name="متوسط" stackId="segments" fill="#3b82f6" />
        <Bar dataKey="normal" name="عادي" stackId="segments" fill="#64748b" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
