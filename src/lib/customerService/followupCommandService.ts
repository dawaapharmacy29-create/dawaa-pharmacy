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
  | 'assign_self'
  | 'continue'
  | 'edit_result'
  | 'reopen'
  | 'assign_branch'
  | 'record_attempt';

export type ExecuteFollowupCommandInput = {
  followupId: string;
  command: FollowupCommand;
  note?: string | null;
  nextFollowupDate?: string | null;
  contactChannel?: string | null;
  outcome?: string | null;
  purchaseValue?: number | null;
  targetBranch?: string | null;
  attemptType?: string | null;
  needsNextFollowup?: boolean | null;
  result?: string | null;
  followupNotes?: string | null;
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
    p_target_branch: input.targetBranch ?? null,
    p_attempt_type: input.attemptType ?? null,
    p_needs_next_followup: input.needsNextFollowup ?? null,
    p_result: input.result ?? null,
    p_followup_notes: input.followupNotes ?? null,
  });
  if (error) throw error;
  return data;
}
