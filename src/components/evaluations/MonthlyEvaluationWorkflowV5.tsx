import { AlertTriangle, CheckCircle2, Circle, Send, Star, UserRound } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';

export type MonthlyEvaluationStep = 1 | 2 | 3 | 4 | 5;

type Props = {
  activeStep: MonthlyEvaluationStep;
  onStepChange: (step: MonthlyEvaluationStep) => void;
  evidenceReady: boolean;
  cycleClosed: boolean;
  completedSections: number;
  totalSections: number;
  hasCriticalGate: boolean;
  approvalReady: boolean;
  status: string;
  requiresPostCycleReapproval: boolean;
  blockers?: string[];
};

const JOURNEY = [
  { id: 1 as const, title: 'الموظف والأدلة', icon: UserRound },
  { id: 2 as const, title: 'التقييم بالأدلة', icon: Star },
  { id: 5 as const, title: 'المراجعة والاعتماد', icon: Send },
];

export default function MonthlyEvaluationWorkflowV5({
  activeStep,
  onStepChange,
  evidenceReady,
  cycleClosed,
  completedSections,
  totalSections,
  hasCriticalGate,
  approvalReady,
  status,
  requiresPostCycleReapproval,
  blockers = [],
}: Props) {
  const visibleStep: 1 | 2 | 5 = activeStep === 1 ? 1 : activeStep === 5 ? 5 : 2;
  const evaluationComplete = totalSections > 0 && completedSections === totalSections;
  const approved = approvalReady && ['sent', 'approved'].includes(status) && !requiresPostCycleReapproval;

  const stateFor = (id: 1 | 2 | 5) => {
    if (id === 1) return { ready: evidenceReady, label: evidenceReady ? 'الأدلة جاهزة' : 'دليل يحتاج مراجعة' };
    if (id === 2) return {
      ready: evaluationComplete,
      label: hasCriticalGate
        ? `${completedSections}/${totalSections} · مخالفة حرجة`
        : `${completedSections}/${totalSections} محور`,
    };
    return {
      ready: approved,
      label: !cycleClosed ? 'بعد إقفال الدورة' : approvalReady ? 'جاهز للاعتماد' : `${blockers.length || 1} ملاحظة`,
    };
  };

  return (
    <Panel className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
        <div>
          <div className="text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>مسار القرار</div>
          <div className="mt-0.5 text-[11px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
            من حقيقة الموظف إلى قرار موثق ثم اعتماد نهائي.
          </div>
        </div>
        {blockers.length ? (
          <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black" style={{ borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-status-warning-bg)', color: 'var(--dawaa-status-warning-text)' }}>
            <AlertTriangle size={12} /> {blockers.length} قبل الاعتماد
          </span>
        ) : null}
      </div>

      <div className="grid gap-0 sm:grid-cols-3">
        {JOURNEY.map((step, index) => {
          const Icon = step.icon;
          const active = visibleStep === step.id;
          const state = stateFor(step.id);
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onStepChange(step.id)}
              className="flex items-center gap-3 border-b px-4 py-3 text-right transition sm:border-b-0 sm:border-l last:sm:border-l-0"
              style={{
                borderColor: 'var(--dawaa-theme-border)',
                background: active ? 'var(--dawaa-theme-accent-soft)' : 'var(--dawaa-theme-surface)',
              }}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border text-xs font-black" style={{
                borderColor: active ? 'var(--dawaa-theme-accent-border)' : 'var(--dawaa-theme-border)',
                background: active ? 'var(--dawaa-theme-primary)' : 'var(--dawaa-theme-soft)',
                color: active ? 'var(--dawaa-theme-primary-text)' : 'var(--dawaa-theme-primary-strong)',
              }}>
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-xs font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                  <Icon size={14} /> {step.title}
                </span>
                <span className="mt-1 block text-[10px] font-bold" style={{ color: step.id === 2 && hasCriticalGate ? 'var(--dawaa-status-danger-text)' : 'var(--dawaa-theme-muted)' }}>
                  {state.label}
                </span>
              </span>
              {state.ready ? <CheckCircle2 size={15} style={{ color: 'var(--dawaa-status-success-text)' }} /> : <Circle size={15} style={{ color: 'var(--dawaa-theme-muted)' }} />}
            </button>
          );
        })}
      </div>

      {visibleStep === 2 ? (
        <div className="flex flex-wrap gap-1.5 border-t px-4 py-2" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-soft)' }}>
          {[
            [2, 'المحاور'],
            [3, hasCriticalGate ? 'النقاط · مخالفة حرجة' : 'النقاط والمخالفات'],
            [4, 'الخلاصة والتطوير'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onStepChange(id as MonthlyEvaluationStep)}
              className="rounded-full border px-2.5 py-1 text-[10px] font-black"
              style={activeStep === id
                ? { borderColor: 'var(--dawaa-theme-accent-border)', background: 'var(--dawaa-theme-surface)', color: 'var(--dawaa-theme-primary-strong)' }
                : { borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-muted)' }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}
