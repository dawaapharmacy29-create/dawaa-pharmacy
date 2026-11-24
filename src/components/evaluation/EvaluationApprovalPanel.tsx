import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { LabPersonScore } from '@/lib/evaluationLab/buildCycleScores';
import { approveEvaluationCycle, buildApprovalRows, listEvaluationApprovals, monthCycleOf } from '@/lib/evaluationLab/cycleApproval';

const egp = (value: number) => `${Math.round(value).toLocaleString('ar-EG')} ج`;

/** Owner decision 2026-11-24: the payroll manager approves the doctors' evaluation once per cycle and payroll pays it. */
export function EvaluationApprovalPanel({ cycleStart, running, scores }: { cycleStart: string; running: boolean; scores: LabPersonScore[] }) {
  const monthCycle = monthCycleOf(cycleStart);
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const saved = useQuery({ queryKey: ['evaluation-approvals', monthCycle], queryFn: () => listEvaluationApprovals(monthCycle), staleTime: 60_000 });
  const rows = buildApprovalRows(scores);
  const total = rows.reduce((sum, row) => sum + row.performance_egp + row.bonus_egp + row.star_egp, 0);
  const savedTotal = (saved.data || []).reduce((sum, row) => sum + Number(row.performance_egp) + Number(row.bonus_egp) + Number(row.star_egp), 0);
  const last = (saved.data || []).map((row) => row.approved_at).sort().at(-1);

  const approve = async () => {
    if (!rows.length) return;
    const ok = window.confirm(`اعتماد تقييم ${rows.length.toLocaleString('ar-EG')} دكتور لدورة ${monthCycle}؟\nإجمالي الحوافز ${egp(total)} هيدخل كشف المرتب بدل حافز النقاط.`
      + (running ? '\nالدورة لسه شغالة: اعتمد تاني بعد ما تقفل عشان الأرقام تبقى نهائية.' : ''));
    if (!ok) return;
    setBusy(true);
    try {
      const result = await approveEvaluationCycle(monthCycle, rows);
      toast.success(`اتعتمد تقييم ${result.saved.toLocaleString('ar-EG')} دكتور${result.skipped_finalized ? `، و${result.skipped_finalized} مرتبهم مقفول ماتغيرش` : ''}. حافز القائمة: ${result.list_rows} صنف.`);
      await client.invalidateQueries({ queryKey: ['evaluation-approvals', monthCycle] });
    } catch (error) {
      toast.error(`تعذر الاعتماد: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dawaa-card dawaa-surface rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-base font-black text-[var(--dawaa-theme-heading)]"><BadgeCheck size={18} /> اعتماد تقييم الدكاترة لمرتب {monthCycle}</div>
          <div className="dawaa-theme-muted mt-1 text-xs font-bold leading-6">
            {saved.data?.length
              ? `معتمد لـ ${saved.data.length.toLocaleString('ar-EG')} دكتور (${egp(savedTotal)}) · آخر اعتماد ${new Date(last as string).toLocaleString('ar-EG')} بواسطة ${saved.data[0]?.approved_by_name || '—'}`
              : 'لسه مااتعتمدش: كشف المرتب شغال على حافز النقاط القديم.'}
            {' '}الحالي في المختبر: {rows.length.toLocaleString('ar-EG')} دكتور · {egp(total)}.
            {running ? ' الدورة لسه شغالة، الأرقام متوقعة لآخرها.' : ''}
          </div>
        </div>
        <button type="button" disabled={busy || !rows.length} onClick={() => void approve()}
          className="rounded-xl bg-[var(--dawaa-theme-primary)] px-4 py-2 text-sm font-black text-[var(--dawaa-theme-primary-text)] disabled:opacity-50">
          {busy ? 'جاري الاعتماد…' : saved.data?.length ? 'تحديث الاعتماد' : 'اعتماد تقييم الدكاترة للدورة'}
        </button>
      </div>
    </section>
  );
}
