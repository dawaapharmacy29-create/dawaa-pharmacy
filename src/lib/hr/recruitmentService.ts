import { supabase } from '@/lib/supabase';

export type Candidate = { id: string; name: string; phone: string | null; position_title: string; target_branch: string; stage: string; staff_id: string | null; created_at: string };
export type CandidateEvent = { id: string; from_stage: string | null; to_stage: string; note: string | null; created_at: string };

async function command<T>(action: string, candidateId: string | null = null, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc('hr_recruitment_v1', { p_action: action, p_candidate_id: candidateId, p_payload: payload });
  if (error) throw new Error(error.message);
  return data as T;
}
export const listCandidates = () => command<Candidate[]>('list');
export const candidateHistory = (id: string) => command<CandidateEvent[]>('history', id);
export const createCandidate = (input: { name: string; phone: string; position_title: string; target_branch: string }) => command<{ id: string }>('create', null, input);
export const advanceCandidate = (id: string, stage: string, note: string, staffId?: string) => command<{ id: string; stage: string }>('advance', id, { stage, note, ...(staffId ? { staff_id: staffId } : {}) });
