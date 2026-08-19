import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type DeficitSummary = {
  sessions_last_30d: number;
  deficit_value_30d: number;
  deficit_value_month: number;
  items_with_deficit_30d: number;
  last_session_date: string | null;
};

export default function BranchStockDeficitCard({ branch }: { branch: string }) {
  const [data, setData] = useState<DeficitSummary | null>(null);

  useEffect(() => {
    if (!branch) return;
    void supabase.rpc('get_branch_stock_deficit_summary', { p_branch: branch }).then(({ data: result }) => {
      setData(result as DeficitSummary);
    });
  }, [branch]);

  if (!data) return null;

  const hasRecentSession = data.last_session_date && new Date(data.last_session_date) >= new Date(Date.now() - 30 * 86400000);

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
      <div className="flex items-center gap-2 text-rose-300">
        <AlertTriangle size={18} />
        <span className="font-black">عجز الرصيد — {branch}</span>
      </div>
      {!hasRecentSession ? (
        <p className="mt-2 text-xs font-bold text-amber-300">
          آخر جرد مسجّل: {data.last_session_date || 'لا يوجد جرد مسجّل خالص'}. من غير جرد منتظم، رقم العجز مش هيبان.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl bg-black/20 p-2.5 text-center">
            <p className="text-lg font-black text-rose-300">{data.deficit_value_30d.toLocaleString('ar-EG')} ج</p>
            <p className="text-[10px] font-bold text-slate-400">عجز آخر 30 يوم</p>
          </div>
          <div className="rounded-xl bg-black/20 p-2.5 text-center">
            <p className="text-lg font-black text-rose-300">{data.deficit_value_month.toLocaleString('ar-EG')} ج</p>
            <p className="text-[10px] font-bold text-slate-400">عجز الشهر الحالي</p>
          </div>
          <div className="rounded-xl bg-black/20 p-2.5 text-center">
            <p className="text-lg font-black text-white">{data.items_with_deficit_30d}</p>
            <p className="text-[10px] font-bold text-slate-400">صنف فيه عجز</p>
          </div>
          <div className="rounded-xl bg-black/20 p-2.5 text-center">
            <p className="text-lg font-black text-white">{data.sessions_last_30d}</p>
            <p className="text-[10px] font-bold text-slate-400">جرد اتعمل هذا الشهر</p>
          </div>
        </div>
      )}
    </div>
  );
}
