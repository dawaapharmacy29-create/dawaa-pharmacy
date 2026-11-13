import { supabase } from '@/lib/supabase';
import type { GroupChatMessage } from './groupChatRequests';

export const DEFAULT_BRANCH_REQUEST_TARGET = 1000;

export interface FollowupRequestCount { staffId: string; branch: string; requests: number }
export interface SenderMatch { sender: string; staffId: string | null; staffName: string | null }
export interface ImportResult { total: number; inserted: number; unmatchedSenders: string[] }

/** Opens a WhatsApp export, either the .zip or the chat text inside it. */
export async function readChatFile(file: File): Promise<string> {
  if (!/\.zip$/i.test(file.name)) return file.text();
  const { CFB } = await import('xlsx');
  const archive = CFB.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const entry = archive.FileIndex.find((item) => /\.txt$/i.test(item.name) && item.content?.length);
  if (!entry) throw new Error('chat_file_missing');
  return new TextDecoder('utf-8').decode(entry.content as Uint8Array);
}

export async function loadFollowupRequestCounts(start: string, end: string): Promise<FollowupRequestCount[]> {
  const { data, error } = await supabase.rpc('get_doctor_followup_request_counts_v1', { p_start: start, p_end: end });
  if (error) throw error;
  return ((data || []) as { staff_id: string; branch: string; requests: number }[]).map((row) => ({
    staffId: String(row.staff_id),
    branch: row.branch,
    requests: Number(row.requests) || 0,
  }));
}

export async function loadFollowupRequestTargets(): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc('get_doctor_followup_request_targets_v1');
  if (error) throw error;
  return new Map(((data || []) as { branch: string; target: number }[]).map((row) => [row.branch, Number(row.target)]));
}

export async function saveFollowupRequestTarget(branch: string, target: number): Promise<void> {
  const { error } = await supabase.rpc('set_doctor_followup_request_target_v1', { p_branch: branch, p_target: target });
  if (error) throw error;
}

export async function resolveSenders(senders: string[]): Promise<SenderMatch[]> {
  const { data, error } = await supabase.rpc('resolve_followup_request_senders_v1', { p_senders: senders });
  if (error) throw error;
  return ((data || []) as { sender: string; staff_id: string | null; staff_name: string | null }[]).map((row) => ({
    sender: row.sender,
    staffId: row.staff_id,
    staffName: row.staff_name,
  }));
}

export async function linkSender(sender: string, staffId: string): Promise<void> {
  const { error } = await supabase.rpc('link_followup_request_sender_v1', { p_sender: sender, p_staff_id: staffId });
  if (error) throw error;
}

/** `staffId` credits a shared account's message to the doctor it names; a linked sender still wins. */
export async function importFollowupRequests(fileName: string, messages: Array<GroupChatMessage & { staffId?: string | null }>): Promise<ImportResult> {
  const { data, error } = await supabase.rpc('import_doctor_followup_requests_v1', {
    p_file_name: fileName,
    p_rows: messages.map((message) => ({ sender: message.sender, sent_at_local: message.sentAtLocal, body: message.body, staff_id: message.staffId || null })),
  });
  if (error) throw error;
  const result = data as { total: number; inserted: number; unmatched_senders: string[] };
  return { total: result.total, inserted: result.inserted, unmatchedSenders: result.unmatched_senders || [] };
}
