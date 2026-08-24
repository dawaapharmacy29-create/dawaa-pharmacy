import { updateDailyQueueItem } from '@/lib/customerServiceDailyExecution';
import { executeFollowupCommand } from '@/lib/customerService/followupCommandService';

export type ContactAttemptType =
  | 'call_no_answer'
  | 'whatsapp_sent'
  | 'phone_off'
  | 'invalid_number'
  | 'callback_requested'
  | 'connected';

export type ContactAttemptInput = {
  followupId: string;
  queueItemId?: string | null;
  attemptType: ContactAttemptType;
  notes?: string | null;
  actorStaffId?: string | null;
  actorName?: string | null;
};

const ATTEMPT_LABELS: Record<ContactAttemptType, string> = {
  call_no_answer: 'اتصال ولم يرد',
  whatsapp_sent: 'تم إرسال واتساب',
  phone_off: 'الهاتف مغلق',
  invalid_number: 'الرقم غير صحيح',
  callback_requested: 'طلب التواصل لاحقًا',
  connected: 'تم التواصل بنجاح',
};

const text = (value: unknown) => String(value ?? '').trim();

export function contactAttemptLabel(type: ContactAttemptType) {
  return ATTEMPT_LABELS[type];
}

export async function recordContactAttempt(input: ContactAttemptInput) {
  if (!text(input.followupId)) throw new Error('معرف المتابعة غير متاح');

  const updated = await executeFollowupCommand({ followupId: input.followupId, command: 'record_attempt', attemptType: input.attemptType, note: input.notes || ATTEMPT_LABELS[input.attemptType] });
  if (input.queueItemId) await updateDailyQueueItem(input.queueItemId, { status: input.attemptType === 'connected' ? 'in_progress' : 'attempted', started: true });
  return { attemptCount: Number(updated?.attempt_count || 0), attemptedAt: String(updated?.last_attempt_at || new Date().toISOString()), label: ATTEMPT_LABELS[input.attemptType] };
}

export type SlaState = 'safe' | 'warning' | 'overdue' | 'completed';

export function getFollowupSla(input: {
  source?: string | null;
  priority?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  completed?: boolean;
}) {
  if (input.completed)
    return { state: 'completed' as SlaState, label: 'مكتمل', limitMinutes: 0, elapsedMinutes: 0 };

  const source = text(input.source).toLowerCase();
  const priority = text(input.priority).toLowerCase();
  let limitMinutes = 120;
  if (/شكوى|complaint|manager|مدير/.test(source) || /عاجل|urgent/.test(priority)) limitMinutes = 15;
  else if (/doctor|دكتور/.test(source)) limitMinutes = 30;
  else if (/yesterday|أمس/.test(source)) limitMinutes = 240;

  const started = input.startedAt ? new Date(input.startedAt).getTime() : 0;
  const created = input.createdAt ? new Date(input.createdAt).getTime() : Date.now();
  const base = Number.isFinite(started) && started > 0 ? started : created;
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - base) / 60000));
  const ratio = limitMinutes ? elapsedMinutes / limitMinutes : 0;
  const state: SlaState = ratio >= 1 ? 'overdue' : ratio >= 0.75 ? 'warning' : 'safe';
  const remaining = Math.max(0, limitMinutes - elapsedMinutes);
  const duration = (minutes: number) => {
    if (minutes < 60) return `${minutes} د`;
    if (minutes < 1440) return `${Math.ceil(minutes / 60)} س`;
    return `${Math.ceil(minutes / 1440)} يوم`;
  };
  const overdueMinutes = Math.max(0, elapsedMinutes - limitMinutes);
  const label =
    state === 'overdue'
      ? overdueMinutes > 10080
        ? 'متأخر أكثر من أسبوع'
        : `متأخر ${duration(overdueMinutes)}`
      : state === 'warning'
        ? `متبقي ${duration(remaining)}`
        : `داخل الوقت · ${duration(remaining)}`;
  return { state, label, limitMinutes, elapsedMinutes };
}
