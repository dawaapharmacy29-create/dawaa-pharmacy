import { supabase } from '@/lib/supabase';

export type DailyReviewInput = {
  branch: string;
  ownerName?: string | null;
  total: number;
  completed: number;
  noAnswer: number;
  scheduled: number;
  needsManager: number;
  purchaseCount: number;
  purchaseAmount: number;
  remainingReason?: string | null;
  managerNotes?: string | null;
  reviewedByStaffId?: string | null;
  reviewedByName?: string | null;
};

const text = (value: unknown) => String(value ?? '').trim();

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export async function saveCustomerServiceDailyReview(input: DailyReviewInput) {
  const total = Math.max(0, Number(input.total || 0));
  const completed = Math.max(0, Number(input.completed || 0));
  const remaining = Math.max(0, total - completed);
  if (remaining > 0 && !text(input.remainingReason)) {
    throw new Error('اكتب سبب واضح للحالات المتبقية قبل حفظ مراجعة اليوم.');
  }

  const payload = {
    review_date: todayKey(),
    branch: text(input.branch),
    owner_name: text(input.ownerName) || null,
    total_count: total,
    completed_count: completed,
    remaining_count: remaining,
    no_answer_count: Math.max(0, Number(input.noAnswer || 0)),
    scheduled_count: Math.max(0, Number(input.scheduled || 0)),
    needs_manager_count: Math.max(0, Number(input.needsManager || 0)),
    purchase_count: Math.max(0, Number(input.purchaseCount || 0)),
    purchase_amount: Math.max(0, Number(input.purchaseAmount || 0)),
    completion_rate: total ? Math.round((completed / total) * 10000) / 100 : 0,
    review_status: remaining ? 'reviewed_with_remaining' : 'completed',
    remaining_reason: text(input.remainingReason) || null,
    manager_notes: text(input.managerNotes) || null,
    reviewed_by_staff_id: text(input.reviewedByStaffId) || null,
    reviewed_by_name: text(input.reviewedByName) || null,
    reviewed_at: new Date().toISOString(),
    metadata: { source: 'customer_service_workspace_v2' },
  };

  const { data, error } = await supabase
    .from('customer_service_daily_reviews')
    .upsert(payload, { onConflict: 'review_date,branch' })
    .select('*')
    .single();

  if (error) {
    if (/does not exist|schema cache|relation .* not found/i.test(error.message)) {
      throw new Error('شغّل migration مراجعة نهاية اليوم أولًا.');
    }
    throw new Error(error.message);
  }

  return data;
}
