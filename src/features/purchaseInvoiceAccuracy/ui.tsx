import { AlertTriangle, CheckCircle2, ThumbsDown, type LucideIcon } from 'lucide-react';
import type { Outcome, StaffReportRow, StaffStatus } from './types';

export type OutcomeUiConfig = {
  label: string;
  points: number;
  color: string;
  bg: string;
  borderColor: string;
  icon: LucideIcon;
};

export const OUTCOME_CONFIG: Record<Outcome, OutcomeUiConfig> = {
  correct: {
    label: 'إدخال صحيح',
    points: 2,
    color: 'var(--dawaa-status-success-text)',
    bg: 'var(--dawaa-status-success-bg)',
    borderColor: 'var(--dawaa-status-success-border)',
    icon: CheckCircle2,
  },
  mixup_unregistered: {
    label: 'لغبطة أو عدم تسجيل',
    points: -1,
    color: 'var(--dawaa-status-warning-text)',
    bg: 'var(--dawaa-status-warning-bg)',
    borderColor: 'var(--dawaa-status-warning-border)',
    icon: AlertTriangle,
  },
  negligence: {
    label: 'إهمال',
    points: -2,
    color: 'var(--dawaa-status-danger-text)',
    bg: 'var(--dawaa-status-danger-bg)',
    borderColor: 'var(--dawaa-status-danger-border)',
    icon: ThumbsDown,
  },
  customer_problem: {
    label: 'سبب مشكلة مع عميل',
    points: -4,
    color: 'var(--dawaa-status-danger-text)',
    bg: 'var(--dawaa-status-danger-bg)',
    borderColor: 'var(--dawaa-status-danger-border)',
    icon: ThumbsDown,
  },
};

export const OUTCOME_ORDER: Outcome[] = ['correct', 'mixup_unregistered', 'negligence', 'customer_problem'];

const STATUS_UI: Record<StaffStatus, { label: string; color: string; bg: string }> = {
  insufficient_sample: {
    label: 'عينة غير كافية',
    color: 'var(--dawaa-theme-muted)',
    bg: 'var(--dawaa-theme-soft)',
  },
  excellent: {
    label: 'ممتاز',
    color: 'var(--dawaa-status-success-text)',
    bg: 'var(--dawaa-status-success-bg)',
  },
  very_good: {
    label: 'جيد جدًا',
    color: 'var(--dawaa-theme-primary)',
    bg: 'var(--dawaa-theme-soft)',
  },
  follow_up: {
    label: 'يحتاج متابعة',
    color: 'var(--dawaa-status-warning-text)',
    bg: 'var(--dawaa-status-warning-bg)',
  },
  operational_risk: {
    label: 'خطر تشغيلي',
    color: 'var(--dawaa-status-danger-text)',
    bg: 'var(--dawaa-status-danger-bg)',
  },
};

export function getStaffStatus(row: StaffReportRow) {
  if (row.reviewed_count < 5) return STATUS_UI.insufficient_sample;
  const severe = row.negligence_count + row.customer_problem_count;
  if (row.accuracy_rate >= 95 && severe === 0) return STATUS_UI.excellent;
  if (row.accuracy_rate >= 85 && severe <= 1) return STATUS_UI.very_good;
  if (row.accuracy_rate >= 70 && severe <= 2) return STATUS_UI.follow_up;
  return STATUS_UI.operational_risk;
}
