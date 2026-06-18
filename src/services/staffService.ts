import { supabase } from "@/lib/supabase";
import { logSupabaseError } from "@/lib/supabaseError";
import { TABLES } from "@/lib/supabaseTables";

export interface StaffPayload {
  name: string;
  username?: string;
  phone?: string | null;
  role: string;
  branch: string;
  shift_start?: string | null;
  shift_end?: string | null;
  notes?: string | null;
  status?: string;
  max_points?: number;
  type?: string;
}

export interface StaffAccountPayload {
  staff_id: string;
  username: string;
  temporary_password?: string | null;
  password_hash?: string | null;
  password_status?: string | null;
  name?: string | null;
  staff_name?: string | null;
  role?: string | null;
  staff_role?: string | null;
  branch?: string | null;
  active?: boolean;
  can_login?: boolean;
  visible_in_admin?: boolean;
  permissions?: Record<string, boolean>;
}

function missingColumn(message: string) {
  return (
    message.match(/Could not find the ["']([^"']+)["'] column/i)?.[1] ||
    message.match(/column ["']?([^"'\s]+)["']? (?:of relation [^ ]+ )?does not exist/i)?.[1] ||
    message.match(/record has no field ["']?([^"'\s]+)["']?/i)?.[1] ||
    null
  );
}

function logSaveStaffError(error: { message?: string; details?: string; hint?: string; code?: string }) {
  console.error("Supabase save staff error:", {
    message: error.message,
    details: error.details,
    hint: error.hint,
    code: error.code,
  });
}

async function insertFlexible<T extends Record<string, unknown>>(table: string, payload: T) {
  const next: Record<string, unknown> = { ...payload };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await supabase.from(table).insert(next).select().single();
    if (!result.error) return result;
    logSaveStaffError(result.error);
    const column = missingColumn(result.error.message);
    if (!column || !(column in next)) return result;
    delete next[column];
  }
  const result = await supabase.from(table).insert(next).select().single();
  if (result.error) logSaveStaffError(result.error);
  return result;
}

async function updateFlexible<T extends Record<string, unknown>>(table: string, id: string, payload: T) {
  const next: Record<string, unknown> = { ...payload };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await supabase.from(table).update(next).eq("id", id).select().single();
    if (!result.error) return result;
    logSaveStaffError(result.error);
    const column = missingColumn(result.error.message);
    if (!column || !(column in next)) return result;
    delete next[column];
  }
  const result = await supabase.from(table).update(next).eq("id", id).select().single();
  if (result.error) logSaveStaffError(result.error);
  return result;
}

export async function createStaff(payload: StaffPayload) {
  const result = await insertFlexible(TABLES.staff, payload as unknown as Record<string, unknown>);
  if (result.error) logSupabaseError("create staff", result.error);
  return result;
}

export async function updateStaff(id: string, payload: StaffPayload) {
  const result = await updateFlexible(TABLES.staff, id, payload as unknown as Record<string, unknown>);
  if (result.error) logSupabaseError("update staff", result.error);
  return result;
}

export async function createStaffAccount(payload: StaffAccountPayload) {
  return insertFlexible(TABLES.staffAccounts, payload as unknown as Record<string, unknown>);
}
