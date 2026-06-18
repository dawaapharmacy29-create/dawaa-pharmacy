import React from "react";
import { ResponsiveContainer, LineChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Line } from "recharts";

export default function DailySalesChart({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 12, left: 12, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
        <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} interval={0} angle={-20} textAnchor="end" height={55} />
        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}K`} />
        <Tooltip formatter={(value: any) => `${Number(value).toLocaleString()} جنيه`} contentStyle={{ background: "#0f172a", border: "1px solid rgba(45,212,191,0.25)", borderRadius: 16, color: "#fff" }} />
        <Legend />
        <Line type="monotone" dataKey="total" stroke="#2dd4bf" strokeWidth={3} dot={{ r: 3, fill: "#2dd4bf" }} activeDot={{ r: 7 }} name="إجمالي اليوم" />
      </LineChart>
    </ResponsiveContainer>
  );
}
