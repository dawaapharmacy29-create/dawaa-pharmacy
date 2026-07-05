import { supabase } from '@/lib/supabase';

export interface SafeStaffAccountRow {
  id: string;
  staff_id?: string | null;
  username?: string | null;
  password_status?: string | null;
  name?: string | null;
  staff_name?: string | null;
  role?: string | null;
  branch?: string | null;
  active?: boolean | null;
  can_login?: boolean | null;
  visible_in_admin?: boolean | null;
  permissions?: Record<string, boolean> | null;
  last_login_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

export async function listStaffAccountsSafe(): Promise<SafeStaffAccountRow[]> {
  const { data, error } = await supabase.rpc('list_staff_accounts_safe');
  if (error) throw error;
  return (data || []) as SafeStaffAccountRow[];
}

export async function resolveStaffAccountSafe(identifier: string): Promise<SafeStaffAccountRow[]> {
  const { data, error } = await supabase.rpc('resolve_staff_account_safe', {
    p_identifier: identifier,
  });
  if (error) return [];
  return (data || []) as SafeStaffAccountRow[];
}

export async function countStaffAccountsWithoutStaffSafe(): Promise<number | null> {
  const { data, error } = await supabase.rpc('count_staff_accounts_without_staff_safe');
  if (error) return null;
  return typeof data === 'number' ? data : null;
}
