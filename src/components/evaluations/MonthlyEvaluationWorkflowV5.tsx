import {
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Database,
  Send,
  ShieldAlert,
  Star,
} from 'lucide-react';
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
};

const STEPS = [
  { id: 1 as const, title: 'بيانات الدورة', short: 'البيانات', icon: Database },
  { id: 2 as const, title: 'تقييم المحاور', short: 'التقييم', icon: Star },
  { id: 3 as const, title: 'النقاط والمخالفات', short: 'النقاط', icon: ShieldAlert },
  { id: 4 as const, title: 'الخلاصة والتطوير', short: 'الخلاصة', icon: ClipboardCheck },
  { id: 5 as const, title: 'المراجعة والاعتماد', short: 'الاعتماد', icon: Send },
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
}: Props) {
  const stepReady: Record<MonthlyEvaluationStep, boolean> = {
    1: evidenceReady,
    2: totalSections > 0 && completedSections === totalSections,
    3: true,
    4: true,
    5: approvalReady && ['sent', 'approved'].includes(status) && !requiresPostCycleReapproval,
  };

  return (
    <Panel className="overflow-hidden p-0">
      <div className="border-b px-3 py-2.5" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
        <div className="text-sm font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
          خطوات التقييم
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="flex min-w-max gap-1.5 p-2">
          {STEPS.map((step) => {
            const Icon = step.icon;
            const active = activeStep === step.id;
            const ready = stepReady[step.id];
            const warning = step.id === 3 && hasCriticalGate;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => onStepChange(step.id)}
                className="flex min-w-[150px] items-center gap-2 rounded-xl border px-3 py-2 text-right transition"
                style={active
                  ? { borderColor: 'var(--dawaa-theme-accent-border)', background: 'var(--dawaa-theme-accent-soft)' }
                  : { borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: active ? 'var(--dawaa-theme-primary)' : 'var(--dawaa-theme-soft)', color: active ? 'var(--dawaa-theme-primary-text)' : 'var(--dawaa-theme-primary-strong)' }}
                >
                  <Icon size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                    {step.id}. {step.short}
                  </span>
                  <span className="mt-0.5 block text-[10px] font-bold" style={{ color: warning ? 'var(--dawaa-status-danger-text)' : 'var(--dawaa-theme-muted)' }}>
                    {step.id === 1
                      ? evidenceReady ? 'البيانات جاهزة' : 'راجع البيانات'
                      : step.id === 2
                        ? `${completedSections}/${totalSections}`
                        : step.id === 3
                          ? warning ? 'مخالفة حرجة' : 'النقاط'
                          : step.id === 4
                            ? 'الخلاصة'
                            : !cycleClosed
                              ? 'بعد يوم 25'
                              : approvalReady
                                ? 'جاهز'
                                : 'ناقص'}
                  </span>
                </span>
                {ready ? (
                  <CheckCircle2 size={15} style={{ color: 'var(--dawaa-status-success-text)' }} />
                ) : (
                  <Circle size={15} style={{ color: 'var(--dawaa-theme-muted)' }} />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
