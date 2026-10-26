import { normalizeBranchName } from '@/lib/branch';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type StaffDirectoryIdentity = {
  id: string | null;
  name: string | null;
  branch: string | null;
  role: string | null;
  type?: string | null;
  username: string | null;
  status: string | null;
  active: boolean;
  source: 'staff' | 'staff_account' | 'alias';
  normalizedAlias?: string | null;
  accountId?: string | null;
};

type Row = Record<string, unknown>;
let inFlightDirectoryRead: Promise<StaffDirectoryIdentity[]> | null = null;

/** Current employee identity by canonical staff ID; never a name/account fallback. */
export async function readStaffIdentityById(staffId: string) {
  const { data, error } = await supabase.from('staff').select('name,role').eq('id', staffId).maybeSingle();
  if (error) throw error;
  return data as { name: string | null; role: string | null } | null;
}

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
    type: text(read(row, ['type'], '')) || null,
    username: text(read(row, ['username'], '')) || null,
    status: text(read(row, ['status'], '')) || null,
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
      if (!existing || (existing.source !== 'staff' && row.source === 'staff')) byId.set(row.id, row);
      continue;
    }
    const key = `${row.name || ''}|${row.branch || ''}|${row.role || ''}|${row.username || ''}`;
    if (!withoutId.has(key)) withoutId.set(key, row);
  }

  return [...byId.values(), ...withoutId.values()];
}

/**
 * Loads the canonical staff directory through the given Supabase client. The browser uses the
 * shared session client (readStaffDirectory below); server-side analysis passes its own service
 * client so it reads the SAME three sources through the SAME mapping — never a second directory.
 * Throws when neither staff nor account rows can be read (never a silent empty directory).
 */
export async function loadStaffDirectoryFrom(
  client: any,
  options: { requireComplete?: boolean } = {}
): Promise<StaffDirectoryIdentity[]> {
  const [staffResult, accountResult, aliasResult] = await Promise.all([
    client.from('staff').select('id,name,username,branch,role,type,status,active,is_active').limit(800),
    client.rpc('get_staff_accounts_directory'),
    client
      .from('staff_identity_aliases')
      .select('staff_id,alias_name,normalized_alias,active,confidence,priority')
      .eq('active', true)
      .limit(2000),
  ]);

  // Canonical analysis must not persist an unresolved/unique identity from a
  // partially unavailable directory. Compatibility readers keep their old policy.
  if (options.requireComplete) {
    const failed = [
      ['staff', staffResult.error],
      ['accounts', accountResult.error],
      ['aliases', aliasResult.error],
    ].filter(([, error]) => Boolean(error));
    if (failed.length) {
      throw new Error(`staff_directory_incomplete: ${failed.map(([source]) => source).join(',')}`);
    }
    // At the bounded read cap we cannot prove the directory is complete or a name
    // is unique. Refuse canonical analysis rather than hide a competing identity.
    if ((staffResult.data?.length ?? 0) >= 800 || (aliasResult.data?.length ?? 0) >= 2000) {
      throw new Error('staff_directory_incomplete: read_limit_reached');
    }
  }

  if (staffResult.error && accountResult.error) {
    throw new Error(
      `تعذر تحميل دليل الموظفين: ${staffResult.error.message}; ${accountResult.error.message}`
    );
  }

  const staffRows = staffResult.error
    ? []
    : ((staffResult.data ?? []) as Row[]).map((row) => identityFromRow(row, ['id'], ['name'], 'staff'));
  const accountRows = accountResult.error
    ? []
    : ((accountResult.data ?? []) as Row[]).map((row) =>
        identityFromRow(row, ['staff_id'], ['staff_name', 'name'], 'staff_account')
      );

  // Complete identity decisions cannot manufacture a person from an orphan login.
  const baseRows = options.requireComplete ? staffRows : uniqueBaseIdentities([...staffRows, ...accountRows]);
  const byId = new Map(baseRows.filter((row) => row.id).map((row) => [row.id as string, row]));
  const accountEvidence = options.requireComplete && !accountResult.error
    ? ((accountResult.data ?? []) as Row[]).flatMap((raw) => {
        const row = identityFromRow(raw, ['staff_id'], ['staff_name', 'name'], 'staff_account');
        const base = byId.get(row.id || '');
        if (!base || !row.active || !base.active) return [];
        return [{ ...row, branch: base.branch, accountId: text(raw.account_id || raw.id) || null }];
      })
    : [];

  const aliases: StaffDirectoryIdentity[] = aliasResult.error
    ? []
    : ((aliasResult.data ?? []) as Row[]).flatMap((alias) => {
        const base = byId.get(text(alias.staff_id));
        const aliasName = text(alias.alias_name);
        if (!aliasName) return [];
        if (!options.requireComplete && (!base || base.active === false)) return [];
        // Retired/orphan claims remain blockers for live name-only attribution.
        return [{ ...(base || { id: text(alias.staff_id) || null, branch: null, role: null, username: null, status: null, active: false }),
          name: aliasName, normalizedAlias: text(alias.normalized_alias) || null, source: 'alias' as const }];
      });

  return [...baseRows, ...accountEvidence, ...aliases];
}

/**
 * Canonical staff-directory read model.
 *
 * This boundary owns the knowledge that staff identity currently spans staff,
 * the safe account directory RPC, and legacy/import aliases.
 * Concurrent consumers share one in-flight load so a complex page cannot issue
 * the same three directory requests repeatedly during a single render wave.
 * No completed-result cache is retained, preserving fresh RLS/session semantics.
 */
export async function readStaffDirectory(options: { requireComplete?: boolean } = {}): Promise<StaffDirectoryIdentity[]> {
  if (options.requireComplete) {
    if (!isSupabaseConfigured) throw new Error('staff_directory_incomplete: not_configured');
    return loadStaffDirectoryFrom(supabase, options);
  }
  if (!isSupabaseConfigured) return [];
  if (inFlightDirectoryRead) return inFlightDirectoryRead;

  const load = loadStaffDirectoryFrom(supabase).finally(() => {
    if (inFlightDirectoryRead === load) inFlightDirectoryRead = null;
  });
  inFlightDirectoryRead = load;
  return load;
}
