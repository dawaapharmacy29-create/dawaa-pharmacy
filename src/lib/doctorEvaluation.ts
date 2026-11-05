import { buildDawaaRequestHeaders, supabase } from '@/lib/supabase';
import type { LabPersonScore } from '@/lib/evaluationLab/buildCycleScores';
import type { DOCTOR_LEVELS } from '@/lib/evaluationLab/catalog';

// The monthly evaluation (lab engine, current version) for the signed-in staff member, computed by
// the doctor-evaluation-v6 Edge Function. The doctor receives only their own card and their rank.

export type DoctorLevel = (typeof DOCTOR_LEVELS)[number]['key'];

export interface MyEvaluation {
  version: string;
  cycle: { kind: 'running' | 'closed'; start: string; endExclusive: string; fullEndExclusive: string; elapsedDays: number; totalDays: number } | null;
  computedAt?: string;
  me: LabPersonScore | null;
  rank: number | null;
  rankOf: number;
  familyMedian: number | null;
  reason?: string;
}

export async function loadMyEvaluation(cycle: 'running' | 'closed', options: { refresh?: boolean } = {}): Promise<MyEvaluation> {
  const base = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!base || !key) throw new Error('supabase_not_configured');
  const headers = buildDawaaRequestHeaders({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });
  const response = await fetch(`${base}/functions/v1/doctor-evaluation-v6`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ cycle, refresh: options.refresh === true }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(String(body?.error || `http_${response.status}`));
  return body as MyEvaluation;
}

/** Doctor levels set by the general manager in the lab (weight on a shared hour). */
export async function loadDoctorLevels(): Promise<Record<string, DoctorLevel>> {
  const { data, error } = await supabase.from('evaluation_v6_doctor_levels').select('staff_id,level');
  if (error) throw error;
  return Object.fromEntries(((data || []) as Array<{ staff_id: string; level: DoctorLevel }>).map((row) => [row.staff_id, row.level]));
}

export async function saveDoctorLevel(staffId: string, level: DoctorLevel) {
  const { error } = await supabase.rpc('set_evaluation_v6_doctor_level_v1', { p_staff_id: staffId, p_level: level });
  if (error) throw error;
}
