import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Undo2 } from 'lucide-react';
import { EmptyState, Panel, SectionTitle } from '@/components/dashboard/DashboardPrimitives';
import { supabase } from '@/supabaseClient';

// مرتجعات التحويلات (صاحب الصيدلية 2026-11-26): المرتجع بيتعمل على بي كونكت على فاتورة بيع التحويل نفسها (كود 170 أو 10)،
// فبيظهر «كمية مرتجعة» على سطر الصنف في ملف أصناف المبيعات. هنا كل سطر اترجع: من أنهي فرع لأنهي فرع، الصنف، كام اتبعت
// وكام رجع وبكام، عشان البنت تتأكد إن الفرع التاني عمل مرتجع مشتريات بنفس الكمية.

type TransferReturn = {
  from_branch: string;
  to_branch: string;
  day: string;
  invoice: string;
  line: number;
  code: string;
  name: string;
  qty: number;
  returned: number;
  unit_price: number | null;
  value: number | null;
};

const cairoToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const n = (v: number | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('ar-EG', { maximumFractionDigits: 2 });

export default function TransferReturns({ branch }: { branch: string | null }) {
  const today = cairoToday();
  const [from, setFrom] = useState(addDays(today, -60));
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<TransferReturn[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    const { data, error: e } = await supabase.rpc('dawaa_cs_transfer_returns_v1', {
      p_from: from,
      p_to: to,
      p_branch: branch,
    });
    if (e) setError(e.message || 'تعذّر تحميل المرتجعات');
    else setRows((data ?? []) as TransferReturn[]);
    setBusy(false);
  }, [from, to, branch]);
  useEffect(() => {
    void load();
  }, [load]);

  const total = (rows ?? []).reduce((t, r) => t + (r.value ?? 0), 0);

  return (
    <Panel>
      <SectionTitle
        icon={<Undo2 size={18} />}
        title="مرتجعات التحويلات"
        subtitle="الأصناف اللي اترجعت على فاتورة بيع التحويل في بي كونكت. اتأكدي إن الفرع اللي استلم عمل مرتجع مشتريات بنفس الكمية."
      />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <label className="inline-flex items-center gap-1 font-bold">
          من
          <input
            type="date"
            className="input-field !w-auto"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="inline-flex items-center gap-1 font-bold">
          لـ
          <input
            type="date"
            className="input-field !w-auto"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button
          className="btn-secondary inline-flex items-center gap-1"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} تحديث
        </button>
        {rows?.length ? (
          <span className="text-xs font-bold">
            {rows.length} سطر مرتجع · {n(Math.round(total))} ج
          </span>
        ) : null}
      </div>
      {error ? (
        <EmptyState label={error} />
      ) : !rows ? (
        <div className="flex justify-center p-4">
          <Loader2 className="animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState label="مفيش مرتجعات على التحويلات في الفترة دي" />
      ) : (
        <div className="mt-2 overflow-x-auto rounded-xl border border-[var(--dawaa-theme-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--dawaa-theme-soft)] text-xs">
              <tr className="text-right">
                <th className="p-2">اليوم</th>
                <th className="p-2">من ← لـ</th>
                <th className="p-2">فاتورة التحويل</th>
                <th className="p-2">الصنف</th>
                <th className="p-2">اتبعت</th>
                <th className="p-2">رجع</th>
                <th className="p-2">القيمة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.invoice}-${r.line}`}
                  className="border-t border-[var(--dawaa-theme-border)]"
                >
                  <td className="p-2 text-xs whitespace-nowrap">
                    {r.day.slice(8, 10)}/{r.day.slice(5, 7)}
                  </td>
                  <td className="p-2 text-xs whitespace-nowrap">
                    {r.from_branch.replace('فرع ', '')} ← {r.to_branch.replace('فرع ', '')}
                  </td>
                  <td className="p-2 font-bold">{r.invoice}</td>
                  <td className="p-2">
                    <span dir="auto">{r.name}</span>{' '}
                    <span className="text-xs opacity-60">({r.code})</span>
                  </td>
                  <td className="p-2">{n(r.qty)}</td>
                  <td className="p-2 font-black text-[var(--dawaa-status-danger-text)]">
                    {n(r.returned)}
                    {r.returned >= r.qty ? (
                      <span className="mr-1 text-[10px] font-bold">(كله)</span>
                    ) : null}
                  </td>
                  <td className="p-2">{n(r.value)} ج</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
