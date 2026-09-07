import { supabase } from '@/lib/supabase';

export type ChecklistReviewRow = {
  id: string;
  staff_id: string;
  branch: string;
  completed: boolean;
  photo_url: string | null;
  staff_note: string | null;
  submitted_at: string | null;
  review_status: 'pending' | 'approved' | 'rejected';
  reviewer_note: string | null;
  staff_daily_checklist_items: {
    title: string;
    description: string | null;
    requires_photo: boolean;
    time_slot: string;
    operation_category?: string | null;
  } | null;
  staff: { name: string; role: string } | null;
};

export type DailyRatingCard = {
  staff_id: string;
  staff_name: string;
  staff_role: string;
  branch: string;
  rating_date: string;
  required_items: number;
  submitted_items: number;
  reviewed_items: number;
  approved_items: number;
  rejected_items: number;
  pending_items: number;
  max_stars: number;
  rating_ready: boolean;
  rating_id: string | null;
  stars: number | null;
  score_pct: number | null;
  points_delta: number | null;
  manager_note: string | null;
  rated_by_name: string | null;
  updated_at: string | null;
};

export type CleaningCycleManagerSummary = {
  staff_id: string;
  staff_name: string;
  branch: string;
  month_cycle: string;
  cycle_start: string;
  cycle_end: string;
  rated_days: number;
  avg_stars: number;
  total_star_points: number;
  checklist_days: number;
  fully_reviewed_days: number;
  submitted_items: number;
  approved_items: number;
  rejected_items: number;
  pending_items: number;
  timing_attention_count: number;
  rating_coverage_pct: number;
  on_time_pct: number;
};

export type InventoryWeeklyProgressCard = {
  staff_id: string;
  staff_name: string;
  staff_role: string;
  branch: string;
  week_start: string;
  week_end: string;
  scheduled_workdays: number;
  elapsed_workdays: number;
  responsibility_count: number;
  session_count: number;
  total_items: number;
  counted_items: number;
  remaining_items: number;
  counted_today: number;
  discrepancy_items: number;
  unresolved_discrepancies: number;
  reviewed_discrepancies: number;
  progress_pct: number;
  expected_progress_pct: number;
  plan_state: 'missing_session' | 'missing_list' | 'ready_not_started' | 'in_progress' | 'completed';
  pace_state: 'not_measurable' | 'behind' | 'on_track' | 'ahead' | 'completed';
};

export type BranchChecklistDashboard = {
  rows: ChecklistReviewRow[];
  cleaningRatings: DailyRatingCard[];
  operationsRatings: DailyRatingCard[];
  cleaningCycle: Record<string, CleaningCycleManagerSummary>;
  inventoryProgress: InventoryWeeklyProgressCard[];
};

function numericCard(raw: Record<string, unknown>): DailyRatingCard {
  return {
    staff_id: String(raw.staff_id || ''),
    staff_name: String(raw.staff_name || ''),
    staff_role: String(raw.staff_role || ''),
    branch: String(raw.branch || ''),
    rating_date: String(raw.rating_date || ''),
    required_items: Number(raw.required_items || 0),
    submitted_items: Number(raw.submitted_items || 0),
    reviewed_items: Number(raw.reviewed_items || 0),
    approved_items: Number(raw.approved_items || 0),
    rejected_items: Number(raw.rejected_items || 0),
    pending_items: Number(raw.pending_items || 0),
    max_stars: Number(raw.max_stars || 0),
    rating_ready: Boolean(raw.rating_ready),
    rating_id: raw.rating_id == null ? null : String(raw.rating_id),
    stars: raw.stars == null ? null : Number(raw.stars),
    score_pct: raw.score_pct == null ? null : Number(raw.score_pct),
    points_delta: raw.points_delta == null ? null : Number(raw.points_delta),
    manager_note: raw.manager_note == null ? null : String(raw.manager_note),
    rated_by_name: raw.rated_by_name == null ? null : String(raw.rated_by_name),
    updated_at: raw.updated_at == null ? null : String(raw.updated_at),
  };
}

function inventoryProgressCard(raw: Record<string, unknown>): InventoryWeeklyProgressCard {
  return {
    staff_id: String(raw.staff_id || ''),
    staff_name: String(raw.staff_name || ''),
    staff_role: String(raw.staff_role || ''),
    branch: String(raw.branch || ''),
    week_start: String(raw.week_start || ''),
    week_end: String(raw.week_end || ''),
    scheduled_workdays: Number(raw.scheduled_workdays || 0),
    elapsed_workdays: Number(raw.elapsed_workdays || 0),
    responsibility_count: Number(raw.responsibility_count || 0),
    session_count: Number(raw.session_count || 0),
    total_items: Number(raw.total_items || 0),
    counted_items: Number(raw.counted_items || 0),
    remaining_items: Number(raw.remaining_items || 0),
    counted_today: Number(raw.counted_today || 0),
    discrepancy_items: Number(raw.discrepancy_items || 0),
    unresolved_discrepancies: Number(raw.unresolved_discrepancies || 0),
    reviewed_discrepancies: Number(raw.reviewed_discrepancies || 0),
    progress_pct: Number(raw.progress_pct || 0),
    expected_progress_pct: Number(raw.expected_progress_pct || 0),
    plan_state: String(raw.plan_state || 'missing_session') as InventoryWeeklyProgressCard['plan_state'],
    pace_state: String(raw.pace_state || 'not_measurable') as InventoryWeeklyProgressCard['pace_state'],
  };
}

export async function loadBranchChecklistDashboard(params: {
  branch: string;
  allBranches: boolean;
  date: string;
}): Promise<BranchChecklistDashboard> {
  const { branch, allBranches, date } = params;

  let checklistQuery = supabase
    .from('staff_daily_checklist_submissions')
    .select(
      'id, staff_id, branch, completed, photo_url, staff_note, submitted_at, review_status, reviewer_note, staff_daily_checklist_items(title, description, requires_photo, time_slot, operation_category), staff:staff!staff_daily_checklist_submissions_staff_id_fkey(name, role)'
    )
    .eq('submission_date', date)
    .eq('completed', true)
    .order('branch', { ascending: true })
    .order('created_at', { ascending: true });

  if (!allBranches) checklistQuery = checklistQuery.eq('branch', branch);

  const [checklistResult, cleaningResult, operationsResult, cycleResult, inventoryResult] = await Promise.all([
    checklistQuery,
    supabase.rpc('get_cleaning_daily_rating_cards_v2', {
      p_rating_date: date,
      p_branch: allBranches ? null : branch,
    }),
    supabase.rpc('get_branch_operations_daily_rating_cards_v1', {
      p_rating_date: date,
      p_branch: allBranches ? null : branch,
    }),
    supabase.rpc('get_cleaning_cycle_manager_summary_v1', {
      p_month_cycle: null,
      p_branch: allBranches ? null : branch,
    }),
    supabase.rpc('get_branch_inventory_weekly_progress_v1', {
      p_anchor_date: date,
      p_branch: allBranches ? null : branch,
    }),
  ]);

  if (checklistResult.error) throw checklistResult.error;
  if (cleaningResult.error) throw cleaningResult.error;
  if (operationsResult.error) throw operationsResult.error;
  if (cycleResult.error) throw cycleResult.error;
  if (inventoryResult.error) throw inventoryResult.error;

  const cleaningCycle: Record<string, CleaningCycleManagerSummary> = {};
  for (const raw of (cycleResult.data || []) as Record<string, unknown>[]) {
    const row: CleaningCycleManagerSummary = {
      staff_id: String(raw.staff_id || ''),
      staff_name: String(raw.staff_name || ''),
      branch: String(raw.branch || ''),
      month_cycle: String(raw.month_cycle || ''),
      cycle_start: String(raw.cycle_start || ''),
      cycle_end: String(raw.cycle_end || ''),
      rated_days: Number(raw.rated_days || 0),
      avg_stars: Number(raw.avg_stars || 0),
      total_star_points: Number(raw.total_star_points || 0),
      checklist_days: Number(raw.checklist_days || 0),
      fully_reviewed_days: Number(raw.fully_reviewed_days || 0),
      submitted_items: Number(raw.submitted_items || 0),
      approved_items: Number(raw.approved_items || 0),
      rejected_items: Number(raw.rejected_items || 0),
      pending_items: Number(raw.pending_items || 0),
      timing_attention_count: Number(raw.timing_attention_count || 0),
      rating_coverage_pct: Number(raw.rating_coverage_pct || 0),
      on_time_pct: Number(raw.on_time_pct || 0),
    };
    if (row.staff_id) cleaningCycle[row.staff_id] = row;
  }

  return {
    rows: (checklistResult.data || []) as unknown as ChecklistReviewRow[],
    cleaningRatings: ((cleaningResult.data || []) as Record<string, unknown>[]).map(numericCard),
    operationsRatings: ((operationsResult.data || []) as Record<string, unknown>[]).map(numericCard),
    cleaningCycle,
    inventoryProgress: ((inventoryResult.data || []) as Record<string, unknown>[]).map(inventoryProgressCard),
  };
}

export async function reviewChecklistSubmission(params: {
  submissionId: string;
  status: 'approved' | 'rejected';
  reviewerNote?: string | null;
}) {
  const { error } = await supabase.rpc('review_staff_daily_checklist_v1', {
    p_submission_id: params.submissionId,
    p_status: params.status,
    p_reviewer_note: params.reviewerNote || null,
  });
  if (error) throw error;
}

export async function rateCleaningDay(params: {
  staffId: string;
  stars: number;
  managerNote?: string | null;
  date: string;
}) {
  const { error } = await supabase.rpc('rate_cleaning_staff_day_v1', {
    p_staff_id: params.staffId,
    p_stars: params.stars,
    p_manager_note: params.managerNote || null,
    p_rating_date: params.date,
  });
  if (error) throw error;
}

export async function rateOperationsDay(params: {
  staffId: string;
  stars: number;
  managerNote?: string | null;
  date: string;
}) {
  const { error } = await supabase.rpc('rate_branch_operations_staff_day_v1', {
    p_staff_id: params.staffId,
    p_stars: params.stars,
    p_manager_note: params.managerNote || null,
    p_rating_date: params.date,
  });
  if (error) throw error;
}
