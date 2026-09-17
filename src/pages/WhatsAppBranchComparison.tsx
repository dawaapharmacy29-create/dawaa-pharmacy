import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Building2, TrendingUp, AlertOctagon } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type BranchRow = {
  branch: string; total_conversations: number; avg_confidence: number;
  conversion_rate_pct: number; followup_required_count: number; lost_opportunities_count: number;
};

export default function WhatsAppBranchComparison() {
  const [rows, setRows] = useState<BranchRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('whatsapp_branch_comparison_v1');
    if (error) toast.error(error.message);
    else setRows((data || []) as BranchRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="dawaa-text space-y-4 p-4" dir="rtl">
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <h1 className="text-xl font-black text-[var(--dawaa-theme-heading)]">مقارنة الفروع في محادثات الواتساب</h1>
        <p className="mt-1 text-sm font-bold text-[var(--dawaa-theme-muted)]">معدل التحويل والفرص الضائعة لكل فرع، محسوبة تلقائيًا من كل المحادثات المحلَّلة.</p>
      </div>

      {loading && <div className="h-40 animate-pulse rounded-2xl bg-[var(--dawaa-theme-surface-2)]" />}

      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.branch} className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Building2 size={18} className="text-[var(--dawaa-theme-primary-strong)]" />
              <h3 className="text-lg font-black text-[var(--dawaa-theme-heading)]">{r.branch}</h3>
              <span className="mr-auto text-xs font-bold text-[var(--dawaa-theme-muted)]">{r.total_conversations} محادثة</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs font-bold">
              <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-2.5">
                <div className="flex items-center justify-center gap-1 text-lg font-black text-emerald-400"><TrendingUp size={14} /> {r.conversion_rate_pct}%</div>
                <div className="text-[var(--dawaa-theme-muted)]">معدل التحويل</div>
              </div>
              <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-2.5">
                <div className="text-lg font-black text-[var(--dawaa-theme-heading)]">{r.avg_confidence}%</div>
                <div className="text-[var(--dawaa-theme-muted)]">ثقة التحليل</div>
              </div>
              <div className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-2.5">
                <div className="flex items-center justify-center gap-1 text-lg font-black text-[var(--dawaa-status-danger-text)]"><AlertOctagon size={14} /> {r.lost_opportunities_count}</div>
                <div className="text-[var(--dawaa-status-danger-text)]">فرص ضائعة</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
