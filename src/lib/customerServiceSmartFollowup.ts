import { supabase } from '@/lib/supabase';
import { createStaffNotification } from '@/lib/staffNotificationService';

const text = (value: unknown) => String(value ?? '').trim();

function addDays(days: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function suggestSmartFollowupDate(result: string) {
  const value = text(result);
  if (value === 'لم يرد') return addDays(1);
  if (value === 'طلب التواصل لاحقًا') return addDays(3);
  if (value === 'تم الرد ويحتاج طلب' || value === 'طلب صنف' || value === 'طلب توصيل') return addDays(1);
  if (value === 'تم الرد ويوجد شكوى' || value === 'يحتاج متابعة مدير') return addDays(1);
  if (value === 'الرقم غير صحيح') return null;
  return addDays(7);
}

async function activeManagers(branch: string) {
  const { data, error } = await supabase
    .from('staff')
    .select('id,name,role,branch,is_active,active')
    .or('is_active.eq.true,active.eq.true')
    .limit(300);

  if (error) return [] as Array<Record<string, unknown>>;
  return ((data || []) as Array<Record<string, unknown>>).filter((row) => {
    const role = text(row.role).toLowerCase();
    const rowBranch = text(row.branch);
    const manager = /manager|admin|مدير/.test(role);
    return manager && (!rowBranch || rowBranch === branch || /general|branches|customer_service/.test(role));
  });
}

export async function notifyFollowupOutcome(input: {
  followupId: string;
  customerName: string;
  branch: string;
  result: string;
  nextFollowupDate?: string | null;
  requestedByStaffId?: string | null;
  needsManager?: boolean;
  notes?: string | null;
}) {
  const entityId = `${input.followupId}:${text(input.result)}`;
  const actionUrl = `/customer-service?followupId=${encodeURIComponent(input.followupId)}`;

  if (text(input.requestedByStaffId)) {
    await createStaffNotification({
      recipientStaffId: text(input.requestedByStaffId),
      type: 'doctor_followup_result',
      title: `تم تحديث متابعة ${text(input.customerName) || 'العميل'}`,
      message: `النتيجة: ${text(input.result)}${input.nextFollowupDate ? ` — المتابعة القادمة ${input.nextFollowupDate}` : ''}`,
      priority: input.needsManager ? 'high' : 'normal',
      entityType: 'daily_followup',
      entityId,
      actionUrl,
      metadata: { branch: input.branch, notes: input.notes || null },
    });
  }

  if (input.needsManager) {
    const managers = await activeManagers(input.branch);
    await Promise.allSettled(managers.map((manager) => createStaffNotification({
      recipientStaffId: text(manager.id),
      type: 'customer_service_manager_escalation',
      title: `حالة تحتاج تدخل مدير — ${text(input.customerName) || 'عميل'}`,
      message: `${input.branch}: ${text(input.result)}${input.notes ? ` — ${text(input.notes)}` : ''}`,
      priority: 'urgent',
      entityType: 'daily_followup',
      entityId: `${entityId}:manager`,
      actionUrl,
      metadata: { branch: input.branch, nextFollowupDate: input.nextFollowupDate || null },
    })));
  }
}
