import { supabase } from '@/lib/supabase';

export type FollowupCommand =
  | 'message_sent'
  | 'no_answer'
  | 'replied'
  | 'schedule'
  | 'submit_review'
  | 'approve'
  | 'return_for_completion'
  | 'escalate'
  | 'assign_self';

export type ExecuteFollowupCommandInput = {
  followupId: string;
  command: FollowupCommand;
  note?: string | null;
  nextFollowupDate?: string | null;
  contactChannel?: string | null;
  outcome?: string | null;
  purchaseValue?: number | null;
};

export async function executeFollowupCommand(input: ExecuteFollowupCommandInput) {
  const { data, error } = await supabase.rpc('dawaa_execute_customer_followup_command_v1', {
    p_followup_id: input.followupId,
    p_command: input.command,
    p_note: input.note ?? null,
    p_next_followup_date: input.nextFollowupDate ?? null,
    p_contact_channel: input.contactChannel ?? null,
    p_outcome: input.outcome ?? null,
    p_purchase_value: input.purchaseValue ?? null,
  });
  if (error) throw error;
  return data;
}
