import React from 'react';

export default function MonthlyRegistrationsChart({ rows }: { rows: any[] }) {
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

  const { ResponsiveContainer, LineChart, CartesianGrid, XAxis, YAxis, Tooltip, Line } = R;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 0, right: 12, left: 12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip formatter={(value: any) => [Number(value).toLocaleString('ar-EG'), 'عملاء مسجلين']} />
        <Line type="monotone" dataKey="registeredCustomers" name="عملاء مسجلين" stroke="#0f766e" strokeWidth={3} dot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
