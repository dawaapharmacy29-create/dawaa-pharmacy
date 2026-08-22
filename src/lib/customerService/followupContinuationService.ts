import { supabase } from '@/lib/supabase';

export type FollowupContinuationPayload = Record<string, unknown>;

export async function saveFollowupContinuation(
  followupId: string,
  payload: FollowupContinuationPayload
): Promise<Record<string, unknown>> {
  if (!followupId) throw new Error('معرف المتابعة غير موجود');
  const { data, error } = await supabase
    .from('daily_followups')
    .update(payload)
    .eq('id', followupId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return (data || payload) as Record<string, unknown>;
}
