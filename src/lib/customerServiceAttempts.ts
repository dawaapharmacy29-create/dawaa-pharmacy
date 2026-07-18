import { supabase } from '@/lib/supabase';
import { appendFollowupEvent, updateDailyQueueItem } from '@/lib/customerServiceDailyExecution';

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
const missingColumn = (message: string) => /column .* does not exist|schema cache/i.test(message);

export function contactAttemptLabel(type: ContactAttemptType) {
  return ATTEMPT_LABELS[type];
}

export async function recordContactAttempt(input: ContactAttemptInput) {
  if (!text(input.followupId)) throw new Error('معرف المتابعة غير متاح');

  const now = new Date().toISOString();
  const current = await supabase
    .from('daily_followups')
    .select('attempt_count,first_attempt_at')
    .eq('id', input.followupId)
    .maybeSingle();

  const attemptCount = Math.max(0, Number(current.data?.attempt_count || 0)) + 1;
  const payload: Record<string, unknown> = {
    attempt_count: attemptCount,
    last_attempt_at: now,
    updated_at: now,
  };
  if (!current.data?.first_attempt_at) payload.first_attempt_at = now;

  const updated = await supabase.from('daily_followups').update(payload).eq('id', input.followupId);
  if (updated.error && !missingColumn(updated.error.message)) throw new Error(updated.error.message);

  await Promise.allSettled([
    appendFollowupEvent({
      followupId: input.followupId,
      queueItemId: input.queueItemId || null,
      eventType: 'contact_attempt',
      status: input.attemptType,
      actorStaffId: input.actorStaffId || null,
      actorName: input.actorName || null,
      notes: input.notes || ATTEMPT_LABELS[input.attemptType],
      metadata: {
        attempt_type: input.attemptType,
        attempt_label: ATTEMPT_LABELS[input.attemptType],
        attempt_number: attemptCount,
      },
    }),
    input.queueItemId
      ? updateDailyQueueItem(input.queueItemId, { status: input.attemptType === 'connected' ? 'in_progress' : 'attempted', started: true })
      : Promise.resolve(),
  ]);

  return { attemptCount, attemptedAt: now, label: ATTEMPT_LABELS[input.attemptType] };
}

export type SlaState = 'safe' | 'warning' | 'overdue' | 'completed';

export function getFollowupSla(input: {
  source?: string | null;
  priority?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  completed?: boolean;
}) {
  if (input.completed) return { state: 'completed' as SlaState, label: 'مكتمل', limitMinutes: 0, elapsedMinutes: 0 };

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
  const label = state === 'overdue' ? `متأخر ${elapsedMinutes - limitMinutes} د` : state === 'warning' ? `متبقي ${remaining} د` : `داخل الوقت · ${remaining} د`;
  return { state, label, limitMinutes, elapsedMinutes };
}
