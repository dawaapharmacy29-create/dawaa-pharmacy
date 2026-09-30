import { useEffect, useState } from 'react';
import { CheckCircle2, History, Loader2, RefreshCcw, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Panel, SectionTitle } from '@/components/dashboard/DashboardPrimitives';

type AuditRow = {
  id: string;
  evaluation_id: string;
  action: string;
  actor_name: string | null;
  actor_role: string | null;
  status_before: string | null;
  status_after: string | null;
  score_before: number | null;
  score_after: number | null;
  evidence_ready: boolean;
  multiplier_pct: number | null;
  snapshot: Record<string, unknown> | null;
  created_at: string;
};

const ACTION_LABELS: Record<string, string> = {
  draft_created: 'إنشاء مسودة',
  draft_updated: 'تحديث المسودة',
  approved: 'اعتماد التقييم',
  reapproved: 'إعادة اعتماد التقييم',
  employee_acknowledged: 'اطلاع الموظف على التقييم',
  employee_comment: 'تعليق الموظف على التقييم',
};

export default function MonthlyEvaluationAuditTrailV5({
  actorId,
  staffId,
  cycleLabel,
  refreshKey,
}: {
  actorId: string;
  staffId: string;
  cycleLabel: string;
  refreshKey: number;
}) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!actorId || !staffId || !cycleLabel) return;
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('get_staff_monthly_evaluation_audit_v5', {
          p_actor_id: actorId,
          p_staff_id: staffId,
          p_month: `${cycleLabel}-01`,
        });
        if (error) throw error;
        if (!cancelled) setRows((data || []) as AuditRow[]);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [actorId, cycleLabel, refreshKey, staffId]);

  return (
    <Panel className="p-4">
      <SectionTitle
        title="سجل المراجعة والاعتماد"
        subtitle="كل حفظ أو اعتماد مسجل باسم المسؤول ووقته ودرجته؛ السجل لا يعتمد على ذاكرة المتصفح."
        icon={<History size={18} />}
      />
      {loading ? (
        <div className="py-6 text-center"><Loader2 className="mx-auto animate-spin" size={18} /></div>
      ) : rows.length ? (
        <div className="space-y-2">
          {rows.map((row) => {
            const approved = ['approved', 'reapproved'].includes(row.action);
            const employeeAction = ['employee_acknowledged', 'employee_comment'].includes(row.action);
            const employeeComment = row.action === 'employee_comment' ? String(row.snapshot?.comment || '').trim() : '';
            const finalSnapshotHash = String(row.snapshot?.final_approval_hash || '').trim();
            return (
              <div key={row.id} className="rounded-2xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                    {approved || employeeAction ? <CheckCircle2 size={16} style={{ color: 'var(--dawaa-status-success-text)' }} /> : <Save size={16} style={{ color: 'var(--dawaa-theme-primary-strong)' }} />}
                    {ACTION_LABELS[row.action] || row.action}
                  </div>
                  <div className="text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                    {new Date(row.created_at).toLocaleString('ar-EG')}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>
                  <span>بواسطة: {row.actor_name || 'مسؤول'}</span>
                  <span>الدرجة: {row.score_after == null ? '—' : row.score_after}</span>
                  {row.multiplier_pct != null ? <span>نسبة الأثر: {row.multiplier_pct}%</span> : null}
                  {!employeeAction ? <span>الأدلة: {row.evidence_ready ? 'مكتملة' : 'غير مكتملة'}</span> : null}
                  {finalSnapshotHash ? <span>بصمة النسخة: {finalSnapshotHash.slice(0, 12)}</span> : null}
                </div>
                {employeeComment ? (
                  <div className="mt-2 rounded-xl border px-3 py-2 text-xs font-bold leading-6" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-soft)', color: 'var(--dawaa-theme-text)' }}>
                    {employeeComment}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-2xl border p-3 text-xs font-bold" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-muted)' }}>
          <RefreshCcw size={15} /> لا توجد عمليات محفوظة على هذا التقييم حتى الآن.
        </div>
      )}
    </Panel>
  );
}
