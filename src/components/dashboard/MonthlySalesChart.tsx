import React from "react";
import { ResponsiveContainer, LineChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Line } from "recharts";

export default function MonthlySalesChart({ data }: { data: any[] }) {
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
        <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}K`} />
        <Tooltip formatter={(value: any) => `${Number(value).toLocaleString()} جنيه`} contentStyle={{ background: "#0f172a", border: "1px solid rgba(45,212,191,0.25)", borderRadius: 16, color: "#fff" }} />
        <Legend />
        <Line type="monotone" dataKey="sales_total" stroke="#2dd4bf" strokeWidth={4} dot={{ r: 4 }} name="إجمالي الشهر" />
      </LineChart>
    </ResponsiveContainer>
  );
}
