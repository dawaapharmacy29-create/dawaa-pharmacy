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
};

export type TaskMember = {
  staff_account_id: string;
  name: string | null;
  on_leave: boolean;
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
  yesterday_invoices: number;
};
export type SubmitResult = {
  updated: number;
  added: number;
  skipped: Array<{ id?: string; code?: string; why: string }>;
};
export type Overview = {
  members: Array<{
    name: string;
    staff_account_id: string | null;
    tasks: number;
    done: number;
    no_answer: number;
    complaints: number;
    bought_after: number;
  }>;
  by_source: Array<{ source: string; tasks: number; done: number }>;
  complaints: Array<{
    queue_date: string;
    branch: string;
    customer_code: string | null;
    customer_name: string;
    customer_phone: string | null;
    result_note: string | null;
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
    p_members: members.map((m) => ({ staff_account_id: m.staff_account_id, on_leave: m.on_leave })),
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
  const { data, error } = await supabase.rpc('dawaa_cs_daily_tasks_list_v1', {
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
    ...updates.map((u) => ({ id: u.id, result: u.result, note: u.note, next_date: u.next_date })),
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
