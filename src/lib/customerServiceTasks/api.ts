import { supabase } from '@/supabaseClient';
import type { DoctorCase, TaskUpdate } from './tasks';

// The page reads and writes only through these RPCs; each checks the customer_service_daily_tasks permission keys.

export type DailyTask = {
  id: string;
  queue_date: string;
  branch: string;
  source: string;
  priority: string;
  customer_code: string | null;
  customer_name: string;
  customer_phone: string | null;
  reason: string | null;
  attempt_no: number;
  assigned_staff_id: string | null;
  assigned_name: string | null;
  result: string | null;
  result_label: string | null;
  result_note: string | null;
  next_followup_date: string | null;
  last_contact: string | null;
  /** The sheet's answers (codes; see tasks.ts) and the customer's context, from dawaa_cs_daily_tasks_list_v2. */
  contact_channel?: string | null;
  reach?: string | null;
  outcome?: string | null;
  reason_code?: string | null;
  followup_choice?: string | null;
  last_purchase_date?: string | null;
  last_purchase_amount?: number | null;
  avg_invoice?: number | null;
  invoices_150?: number | null;
  last_followup_date?: string | null;
  last_followup_by?: string | null;
  /** The coupon offered on this task (see OFFER_CHOICES), from dawaa_cs_daily_tasks_list_v3. */
  offer?: string | null;
};

export type TaskMember = {
  staff_account_id: string;
  name: string | null;
  on_leave: boolean;
  /** The branch she works this month (null = helps both); the branches swap every month. */
  branch?: string | null;
  next_month_branch?: string | null;
  has_permission?: boolean;
};
export type TaskSettings = {
  big_invoice_min: number;
  daily_cap: number;
  can_manage: boolean;
  me: string;
  members: TaskMember[];
  candidates: Array<{ staff_account_id: string; name: string; branch: string | null }> | null;
};
export type BuildResult = {
  date: string;
  counts: Record<string, number>;
  members: number;
  pooled?: boolean;
  branches?: Record<string, { cap: number; members: string[] }>;
  yesterday_invoices: number;
};
export type SubmitResult = {
  updated: number;
  added: number;
  coupons?: number;
  skipped: Array<{ id?: string; code?: string; why: string }>;
};
export type Overview = {
  members: Array<{
    name: string;
    staff_account_id: string | null;
    tasks: number;
    done: number;
    reached?: number;
    will_buy?: number;
    no_answer: number;
    complaints: number;
    bought_after: number;
  }>;
  by_source: Array<{ source: string; tasks: number; done: number; reached?: number }>;
  outcomes?: Array<{ outcome: string; n: number }>;
  reasons?: Array<{ reason_code: string; source: string; n: number }>;
  complaints: Array<{
    queue_date: string;
    branch: string;
    customer_code: string | null;
    customer_name: string;
    customer_phone: string | null;
    result_note: string | null;
    reason_code?: string | null;
    by_name: string | null;
  }>;
  upcoming: Array<{ day: string; n: number }>;
  chat_exports: Array<{ day: string; branch: string; n: number }>;
};

function fail(message: string): Error {
  return new Error(message || 'حصلت مشكلة في الاتصال، جرّب تاني');
}

export async function loadTaskSettings(): Promise<TaskSettings> {
  const { data, error } = await supabase.rpc('dawaa_cs_daily_tasks_settings_v1');
  if (error) throw fail(error.message);
  return data as TaskSettings;
}

export async function saveTaskSettings(
  bigInvoiceMin: number,
  dailyCap: number,
  members: TaskMember[]
): Promise<void> {
  const { error } = await supabase.rpc('dawaa_cs_daily_tasks_settings_save_v1', {
    p_big_invoice_min: bigInvoiceMin,
    p_daily_cap: dailyCap,
    p_members: members.map((m) => ({
      staff_account_id: m.staff_account_id,
      on_leave: m.on_leave,
      branch: m.branch ?? null,
    })),
  });
  if (error) throw fail(error.message);
}

export async function buildTodayTasks(): Promise<BuildResult> {
  const { data, error } = await supabase.rpc('dawaa_cs_daily_tasks_build_v1', { p_date: null });
  if (error) throw fail(error.message);
  return data as BuildResult;
}

export async function listTasks(
  day: string,
  opts: { staffAccountId?: string | null; all?: boolean } = {}
): Promise<DailyTask[]> {
  const { data, error } = await supabase.rpc('dawaa_cs_daily_tasks_list_v3', {
    p_date: day,
    p_staff_account_id: opts.staffAccountId ?? null,
    p_all: Boolean(opts.all),
  });
  if (error) throw fail(error.message);
  return (data ?? []) as DailyTask[];
}

export async function submitSheet(
  updates: TaskUpdate[],
  cases: DoctorCase[]
): Promise<SubmitResult> {
  const rows = [
    ...updates.map((u) => ({
      id: u.id,
      result: u.result ?? null,
      channel: u.channel ?? null,
      reach: u.reach ?? null,
      outcome: u.outcome ?? null,
      reason_code: u.reason_code ?? null,
      followup: u.followup ?? null,
      offer: u.offer ?? null,
      note: u.note,
      next_date: u.next_date,
    })),
    ...cases.map((c) => ({ ...c, id: null })),
  ];
  const { data, error } = await supabase.rpc('dawaa_cs_daily_tasks_submit_v1', { p_rows: rows });
  if (error) throw fail(error.message);
  return data as SubmitResult;
}

export async function loadOverview(from: string, to: string): Promise<Overview> {
  const { data, error } = await supabase.rpc('dawaa_cs_daily_tasks_overview_v1', {
    p_from: from,
    p_to: to,
  });
  if (error) throw fail(error.message);
  return data as Overview;
}

/** One member's standing in the cycle; p_* are the points of each item (see the competition migration). */
export type CompetitionMember = {
  staff_account_id: string;
  name: string | null;
  branch: string;
  score: number;
  eligible: boolean;
  p_returned: number;
  p_new: number;
  p_uplift: number;
  p_credit: number;
  p_work: number;
  t_returned: number;
  t_new: number;
  reached_back: number;
  returned: number;
  new_n: number;
  new_back: number;
  uplift: number;
  uplift_pending: number;
  spent_more: number;
  coupon_cost: number;
  coupon_extra: number;
  coupons_issued: number;
  coupons_used: number;
  budget_use: number;
  tasks: number;
  done: number;
  answered_n: number;
  completion: number;
  work_days: number;
  upload_rate: number;
  reason_rate: number;
};
export type CompetitionBranch = {
  branch: string;
  budget: number;
  cap: number;
  days: number;
  used: number;
  active: number;
  remaining: number;
  issued: number;
  used_n: number;
  review_n: number;
  extra: number;
};
export type Coupon = {
  id: string;
  branch: string;
  customer_code: string;
  customer_name: string | null;
  kind: 'amount' | 'free_delivery';
  amount: number;
  issued_on: string;
  expires_on: string;
  issued_by_name: string | null;
  status: 'active' | 'used' | 'review' | 'expired' | 'cancelled' | 'free_delivery';
  used_on: string | null;
  used_discount: number | null;
  used_net: number | null;
  extra: number;
};
export type Competition = {
  cycle_start: string;
  cycle_end: string;
  as_of: string;
  can_manage: boolean;
  targets: { uplift: number; roi: number; completion: number };
  members: CompetitionMember[];
  branches: CompetitionBranch[];
  team: Array<{ branch: string; now: number; start: number }>;
  coupons: Coupon[] | null;
};

export async function loadCompetition(cycleStart: string | null): Promise<Competition> {
  const { data, error } = await supabase.rpc('dawaa_cs_competition_v1', { p_cycle_start: cycleStart });
  if (error) throw fail(error.message);
  return data as Competition;
}

export async function markCoupon(id: string, status: 'used' | 'not_used' | 'cancelled' | null): Promise<void> {
  const { error } = await supabase.rpc('dawaa_cs_coupon_mark_v1', { p_id: id, p_status: status });
  if (error) throw fail(error.message);
}

export async function saveCreditSettings(budget: number, cap: number, days: number): Promise<void> {
  const { error } = await supabase.rpc('dawaa_cs_credit_settings_save_v1', {
    p_budget: budget,
    p_cap: cap,
    p_days: days,
  });
  if (error) throw fail(error.message);
}
