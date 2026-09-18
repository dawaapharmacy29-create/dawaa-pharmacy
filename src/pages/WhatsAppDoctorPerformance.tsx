import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { TrendingUp, AlertTriangle, MessageSquareText } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type DoctorPerformanceRow = {
  staff_name: string;
  total_conversations: number;
  avg_confidence: number;
  sale_intent_count: number;
  conversion_rate_pct: number;
  followup_required_count: number;
  needs_review_count: number;
  top_weaknesses: { flag: string; count: number }[];
};

function conversionColor(pct: number) {
  if (pct >= 40) return 'text-emerald-400';
  if (pct >= 20) return 'text-amber-400';
  return 'text-red-400';
}

export default function WhatsAppDoctorPerformance() {
  const [rows, setRows] = useState<DoctorPerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('whatsapp_doctor_performance_v1');
    if (error) toast.error(error.message);
    else setRows((data || []) as DoctorPerformanceRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="dawaa-text space-y-4 p-4" dir="rtl">
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <h1 className="text-xl font-black text-[var(--dawaa-theme-heading)]">أداء الدكاترة في محادثات الواتساب</h1>
        <p className="mt-1 text-sm font-bold text-[var(--dawaa-theme-muted)]">معدل التحويل ونقاط الضعف الأكثر تكرارًا، محسوبة تلقائيًا من كل المحادثات المحلَّلة — بدون أي تقييم بشري.</p>
      </div>

      {loading && <div className="h-32 animate-pulse rounded-2xl bg-[var(--dawaa-theme-surface-2)]" />}
      {!loading && !rows.length && (
        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-8 text-center text-sm font-bold text-[var(--dawaa-theme-muted)]">
          لسه مفيش محادثات كفاية اتحللت لعرض تحليل الأداء. حلّل شوية محادثات الأول من صفحة المراقبة التلقائية أو المحلل اليدوي.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div key={r.staff_name} className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-black text-[var(--dawaa-theme-heading)]">{r.staff_name}</h3>
              <span className="flex items-center gap-1 text-xs font-bold text-[var(--dawaa-theme-muted)]"><MessageSquareText size={13} /> {r.total_conversations} محادثة</span>
            </div>

            <div className="mb-3 flex items-center gap-2">
              <TrendingUp size={16} className={conversionColor(r.conversion_rate_pct)} />
              <span className={`text-2xl font-black ${conversionColor(r.conversion_rate_pct)}`}>{r.conversion_rate_pct}%</span>
              <span className="text-xs font-bold text-[var(--dawaa-theme-muted)]">معدل التحويل ({r.sale_intent_count} فرصة بيع)</span>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2 text-xs font-bold">
              <div className="rounded-lg border border-[var(--dawaa-theme-border)] p-2 text-center">
                <div className="text-[var(--dawaa-theme-heading)] font-black">{r.avg_confidence}%</div>
                <div className="text-[var(--dawaa-theme-muted)]">متوسط ثقة التحليل</div>
              </div>
              <div className="rounded-lg border border-[var(--dawaa-theme-border)] p-2 text-center">
                <div className="text-[var(--dawaa-theme-heading)] font-black">{r.followup_required_count}</div>
                <div className="text-[var(--dawaa-theme-muted)]">تحتاج متابعة</div>
              </div>
            </div>

            {!!r.top_weaknesses?.length && (
              <div>
                <div className="mb-1 flex items-center gap-1 text-xs font-black text-[var(--dawaa-status-warning-text)]"><AlertTriangle size={12} /> أكثر نقاط الضعف تكرارًا</div>
                <div className="space-y-1">
                  {r.top_weaknesses.map((w, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg bg-[var(--dawaa-theme-surface-2)] px-2 py-1 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">
                      <span>{w.flag}</span>
                      <span className="font-black text-[var(--dawaa-theme-heading)]">{w.count}×</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
