import { normalizeBranchName } from '@/lib/branch';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type StaffDirectoryIdentity = {
  id: string | null;
  name: string | null;
  branch: string | null;
  role: string | null;
  active: boolean;
  source: 'staff' | 'staff_account' | 'alias';
};

type Row = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? '').trim();
}

function read(row: Row, keys: string[], fallback: unknown = null) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function identityFromRow(
  row: Row,
  idKeys: string[],
  nameKeys: string[],
  source: StaffDirectoryIdentity['source']
): StaffDirectoryIdentity {
  return {
    id: text(read(row, idKeys, '')) || null,
    name: text(read(row, nameKeys, '')) || null,
    branch: normalizeBranchName(read(row, ['branch', 'branch_name'], null)) || null,
    role: text(read(row, ['role', 'staff_role', 'job_title'], '')) || null,
    active:
      read(row, ['active'], true) !== false &&
      read(row, ['is_active'], true) !== false &&
      read(row, ['can_login'], true) !== false,
    source,
  };
}

function uniqueBaseIdentities(rows: StaffDirectoryIdentity[]) {
  const byId = new Map<string, StaffDirectoryIdentity>();
  const withoutId = new Map<string, StaffDirectoryIdentity>();

  for (const row of rows) {
    if (row.id) {
      const existing = byId.get(row.id);
      // Canonical staff rows outrank account-directory fallbacks.
      if (!existing || (existing.source !== 'staff' && row.source === 'staff')) byId.set(row.id, row);
      continue;
    }
    const key = `${row.name || ''}|${row.branch || ''}|${row.role || ''}`;
    if (!withoutId.has(key)) withoutId.set(key, row);
  }

  return [...byId.values(), ...withoutId.values()];
}

/**
 * Canonical staff-directory read model.
 *
 * This boundary owns the knowledge that staff identity currently spans:
 * - staff (canonical employee record)
 * - get_staff_accounts_directory RPC (login/account directory)
 * - staff_identity_aliases (legacy/import aliases)
 *
 * Consumers should not independently merge these three sources.
 */
export async function readStaffDirectory(): Promise<StaffDirectoryIdentity[]> {
  if (!isSupabaseConfigured) return [];

  const [staffResult, accountResult, aliasResult] = await Promise.all([
    supabase.from('staff').select('id,name,branch,role,active,is_active').limit(800),
    supabase.rpc('get_staff_accounts_directory'),
    supabase
      .from('staff_identity_aliases')
      .select('staff_id,alias_name,active,confidence,priority')
      .eq('active', true)
      .limit(2000),
  ]);

  if (staffResult.error && accountResult.error) return [];

  const staffRows = staffResult.error
    ? []
    : ((staffResult.data ?? []) as Row[]).map((row) => identityFromRow(row, ['id'], ['name'], 'staff'));
  const accountRows = accountResult.error
    ? []
    : ((accountResult.data ?? []) as Row[]).map((row) =>
        identityFromRow(row, ['staff_id'], ['staff_name', 'name'], 'staff_account')
      );

  const baseRows = uniqueBaseIdentities([...staffRows, ...accountRows]);
  const byId = new Map(baseRows.filter((row) => row.id).map((row) => [row.id as string, row]));

  const aliases = aliasResult.error
    ? []
    : ((aliasResult.data ?? []) as Row[])
        .map((alias) => {
          const base = byId.get(text(alias.staff_id));
          const aliasName = text(alias.alias_name);
          if (!base || !aliasName || base.active === false) return null;
          return { ...base, name: aliasName, source: 'alias' as const };
        })
        .filter((row): row is StaffDirectoryIdentity => Boolean(row));

  return [...baseRows, ...aliases];
}
