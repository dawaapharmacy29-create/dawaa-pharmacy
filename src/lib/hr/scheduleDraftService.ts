import { supabase } from '@/lib/supabase';

export type ScheduleDraftRow = {
  id?: string;
  day_name: string;
  shift_start: string | null;
  shift_end: string | null;
  is_off: boolean;
  is_day_off?: boolean;
  notes?: string | null;
  sort_order: number;
};

export type ScheduleDraft = {
  id: string;
  staff_id: string;
  staff_name: string;
  branch: string | null;
  role: string | null;
  effective_from: string;
  status: 'draft' | 'validated' | 'published' | 'cancelled';
  note: string | null;
  validation: {
    valid?: boolean;
    errors?: Array<{ code?: string; label?: string; count?: number }>;
    warnings?: Array<{ code?: string; label?: string; count?: number }>;
    rows?: number;
    working_days?: number;
    off_days?: number;
  };
  rows: ScheduleDraftRow[];
  created_at: string;
  validated_at: string | null;
  published_at: string | null;
};

export type ScheduleSeed = {
  staff_id: string;
  staff_name: string;
  branch: string | null;
  role: string | null;
  effective_from: string;
  rows: ScheduleDraftRow[];
};

export async function getScheduleDraftSeed(staffId: string, effectiveFrom: string): Promise<ScheduleSeed> {
  const { data, error } = await supabase.rpc('schedule_draft_seed_v1', {
    p_staff_id: staffId,
    p_effective_from: effectiveFrom,
  });
  if (error) throw new Error(error.message);
  return data as ScheduleSeed;
}

export async function createScheduleDraft(args: {
  staffId: string;
  effectiveFrom: string;
  rows: ScheduleDraftRow[];
  note?: string | null;
}) {
  const { data, error } = await supabase.rpc('create_schedule_draft_v1', {
    p_staff_id: args.staffId,
    p_effective_from: args.effectiveFrom,
    p_rows: args.rows,
    p_note: args.note || null,
  });
  if (error) throw new Error(error.message);
  return data as { draft_id: string; status: string; staff_id: string; effective_from: string };
}

export async function updateScheduleDraft(draftId: string, rows: ScheduleDraftRow[], note?: string | null) {
  const { data, error } = await supabase.rpc('update_schedule_draft_v1', {
    p_draft_id: draftId,
    p_rows: rows,
    p_note: note || null,
  });
  if (error) throw new Error(error.message);
  return data as { success: boolean; draft_id: string; status: string };
}

export async function validateScheduleDraft(draftId: string) {
  const { data, error } = await supabase.rpc('validate_schedule_draft_v1', { p_draft_id: draftId });
  if (error) throw new Error(error.message);
  return data as {
    draft_id: string;
    valid: boolean;
    errors: Array<{ code?: string; label?: string; count?: number }>;
    warnings: Array<{ code?: string; label?: string; count?: number }>;
    rows: number;
    working_days: number;
    off_days: number;
  };
}

export async function publishScheduleDraft(draftId: string, note?: string | null) {
  const { data, error } = await supabase.rpc('publish_schedule_draft_v1', {
    p_draft_id: draftId,
    p_note: note || null,
  });
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

export async function cancelScheduleDraft(draftId: string, note?: string | null) {
  const { data, error } = await supabase.rpc('cancel_schedule_draft_v1', {
    p_draft_id: draftId,
    p_note: note || null,
  });
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

export async function listScheduleDrafts(args: {
  branch?: string | null;
  status?: string | null;
  limit?: number;
} = {}): Promise<ScheduleDraft[]> {
  const { data, error } = await supabase.rpc('list_schedule_drafts_v1', {
    p_branch: args.branch || null,
    p_status: args.status || null,
    p_limit: args.limit ?? 100,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as ScheduleDraft[] : [];
}
