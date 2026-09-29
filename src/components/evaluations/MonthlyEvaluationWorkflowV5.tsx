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
  summary: {
    total: number;
    notStarted: number;
    draft: number;
    approved: number;
    needsReapproval: number;
  };
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
  summary,
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
      <div className="border-b p-4" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-base font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
              رحلة التقييم الشهرية
            </div>
            <div className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
              امشِ بالترتيب: راجع البيانات، قيّم المحاور، راجع النقاط والمخالفات، اكتب الخلاصة، ثم اعتمد.
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] font-black">
            <span className="rounded-full border px-3 py-1" style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-text)' }}>
              إجمالي {summary.total}
            </span>
            <span className="rounded-full border px-3 py-1" style={{ borderColor: 'var(--dawaa-status-warning-border)', background: 'var(--dawaa-status-warning-bg)', color: 'var(--dawaa-status-warning-text)' }}>
              مسودة {summary.draft}
            </span>
            <span className="rounded-full border px-3 py-1" style={{ borderColor: 'var(--dawaa-status-success-border)', background: 'var(--dawaa-status-success-bg)', color: 'var(--dawaa-status-success-text)' }}>
              معتمد {summary.approved}
            </span>
            {summary.needsReapproval > 0 ? (
              <span className="rounded-full border px-3 py-1" style={{ borderColor: 'var(--dawaa-status-danger-border)', background: 'var(--dawaa-status-danger-bg)', color: 'var(--dawaa-status-danger-text)' }}>
                إعادة اعتماد {summary.needsReapproval}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-5">
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
              className="rounded-2xl border p-3 text-right transition"
              style={active
                ? { borderColor: 'var(--dawaa-theme-accent-border)', background: 'var(--dawaa-theme-accent-soft)' }
                : { borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-surface)' }}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-xl"
                  style={{ background: active ? 'var(--dawaa-theme-primary)' : 'var(--dawaa-theme-soft)', color: active ? 'var(--dawaa-theme-primary-text)' : 'var(--dawaa-theme-primary-strong)' }}
                >
                  <Icon size={16} />
                </span>
                {ready ? (
                  <CheckCircle2 size={17} style={{ color: 'var(--dawaa-status-success-text)' }} />
                ) : (
                  <Circle size={17} style={{ color: 'var(--dawaa-theme-muted)' }} />
                )}
              </div>
              <div className="mt-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                {step.id}. {step.title}
              </div>
              <div className="mt-1 text-[11px] font-bold" style={{ color: warning ? 'var(--dawaa-status-danger-text)' : 'var(--dawaa-theme-muted)' }}>
                {step.id === 1
                  ? evidenceReady ? 'المصادر جاهزة' : 'راجع المصادر الناقصة'
                  : step.id === 2
                    ? `${completedSections}/${totalSections} محاور مكتملة`
                    : step.id === 3
                      ? warning ? 'توجد مخالفة حرجة' : 'لا توجد قيود حرجة'
                      : step.id === 4
                        ? 'نقاط القوة وخطة التحسين'
                        : !cycleClosed
                          ? 'يفتح بعد يوم 25'
                          : approvalReady
                            ? 'جاهز للمراجعة النهائية'
                            : 'يوجد عناصر ناقصة'}
              </div>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
