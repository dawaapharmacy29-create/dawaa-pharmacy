import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';

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

const STAFF_ACCOUNT_SELECTS = [
  'id,staff_id,username,password_status,name,staff_name,role,branch,active,can_login,visible_in_admin,permissions,last_login_at,updated_at,created_at',
  'id,staff_id,username,name,staff_name,role,branch,active,can_login,permissions,last_login_at,updated_at,created_at',
  'id,staff_id,username,name,role,branch,active,can_login,permissions,updated_at,created_at',
  'id,username,name,role,branch,active,can_login,permissions,updated_at,created_at',
  '*',
];

function normalizeAccount(row: Record<string, unknown>): SafeStaffAccountRow {
  return {
    id: String(row.id || ''),
    staff_id: (row.staff_id as string | null | undefined) ?? null,
    username: (row.username as string | null | undefined) ?? null,
    password_status: (row.password_status as string | null | undefined) ?? null,
    name: (row.name as string | null | undefined) ?? null,
    staff_name: (row.staff_name as string | null | undefined) ?? (row.name as string | null | undefined) ?? null,
    role: (row.role as string | null | undefined) ?? null,
    branch: (row.branch as string | null | undefined) ?? null,
    active: (row.active as boolean | null | undefined) ?? (row.is_active as boolean | null | undefined) ?? null,
    can_login: (row.can_login as boolean | null | undefined) ?? null,
    visible_in_admin: (row.visible_in_admin as boolean | null | undefined) ?? true,
    permissions: (row.permissions as Record<string, boolean> | null | undefined) ?? null,
    last_login_at: (row.last_login_at as string | null | undefined) ?? null,
    updated_at: (row.updated_at as string | null | undefined) ?? null,
    created_at: (row.created_at as string | null | undefined) ?? null,
  };
}

async function listStaffAccountsDirect(): Promise<SafeStaffAccountRow[]> {
  let lastError: unknown = null;
  for (const select of STAFF_ACCOUNT_SELECTS) {
    const { data, error } = await supabase
      .from(TABLES.staffAccounts)
      .select(select)
      .order('created_at', { ascending: false, nullsFirst: false });
    if (!error) return ((data || []) as Record<string, unknown>[]).map(normalizeAccount).filter((row) => row.id);
    lastError = error;
  }
  throw lastError;
}

export async function listStaffAccountsSafe(): Promise<SafeStaffAccountRow[]> {
  try {
    const { data, error } = await supabase.rpc('list_staff_accounts_safe');
    if (!error && Array.isArray(data) && data.length > 0) return data as SafeStaffAccountRow[];
  } catch {
    // Direct fallback below keeps the admin screen useful if the RPC is missing/stale.
  }
  return listStaffAccountsDirect();
}

export async function resolveStaffAccountSafe(identifier: string): Promise<SafeStaffAccountRow[]> {
  const term = identifier.trim();
  try {
    const { data, error } = await supabase.rpc('resolve_staff_account_safe', {
      p_identifier: term,
    });
    if (!error && Array.isArray(data) && data.length > 0) return data as SafeStaffAccountRow[];
  } catch {
    // Fall back to direct lookup.
  }
  if (!term) return [];
  const { data } = await supabase
    .from(TABLES.staffAccounts)
    .select('*')
    .or(`username.ilike.%${term}%,name.ilike.%${term}%,staff_name.ilike.%${term}%`)
    .limit(20);
  return ((data || []) as Record<string, unknown>[]).map(normalizeAccount).filter((row) => row.id);
}

export async function countStaffAccountsWithoutStaffSafe(): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc('count_staff_accounts_without_staff_safe');
    if (!error && typeof data === 'number') return data;
  } catch {
    // Fallback below.
  }
  const { count, error } = await supabase
    .from(TABLES.staffAccounts)
    .select('id', { count: 'exact', head: true })
    .is('staff_id', null);
  if (error) return null;
  return count ?? null;
}
