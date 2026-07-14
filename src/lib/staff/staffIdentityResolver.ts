/**
 * Canonical staff identity resolver.
 *
 * Safety rules:
 * 1) staff_id / account id are authoritative.
 * 2) username is the second-best identifier.
 * 3) name-only matching is accepted only when it produces one unambiguous result.
 * 4) branch is used as a disambiguation hint.
 * 5) no broad aliases are allowed (especially Islam El-Sabaa vs Dr Islam Farouk).
 */

import { supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';
import { normalizeArabicName } from '@/lib/security/userDataScope';
import { resolveStaffAccountSafe } from '@/lib/staff/staffAccountsApi';

export interface ResolvedStaff {
  id: string;
  name: string;
  role?: string | null;
  branch?: string | null;
  username?: string | null;
}

export interface StaffDirectoryRow {
  id?: string | null;
  staff_id?: string | null;
  username?: string | null;
  name?: string | null;
  staff_name?: string | null;
  branch?: string | null;
  role?: string | null;
  status?: string | null;
  active?: boolean | null;
  is_active?: boolean | null;
}

export interface CanonicalStaffResolution {
  input: string;
  canonicalStaffId: string | null;
  routeIdentifier: string;
  staff: ResolvedStaff | null;
  account: {
    id: string;
    staff_id?: string | null;
    username?: string | null;
    name?: string | null;
    staff_name?: string | null;
    role?: string | null;
    branch?: string | null;
    active?: boolean | null;
    can_login?: boolean | null;
  } | null;
  source: 'staff.id' | 'staff_accounts.staff_id' | 'staff_accounts.id' | 'username' | 'name' | 'unresolved';
}

export interface StaffLinkResult {
  route: string;
  href: string;
  fallback: boolean;
  isFallback: boolean;
  toastMessage?: string;
}

export interface StaffIdentityMapEntry {
  staffId: string;
  displayName: string;
  normalizedName: string;
  branch: string;
  username: string;
  role: string;
  isPrimary: boolean;
}

export type StaffIdentityMap = Map<string, StaffIdentityMapEntry>;

const PHARMACIST_ROLE_PATTERN = /صيدلاني|pharmacist|دكتور|doctor/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeStaffName(name: string | null | undefined): string {
  if (!name) return '';
  return normalizeArabicName(String(name).trim());
}

export function normalizeDoctorName(value: unknown): string {
  return normalizeStaffName(String(value ?? ''));
}

function normalizeIdentifier(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizedBranch(value: unknown): string {
  const raw = normalizeIdentifier(value);
  return normalizeBranchName(raw) || raw;
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function isStaffRowActive(row: StaffDirectoryRow): boolean {
  if (row.active === false || row.is_active === false) return false;
  const status = normalizeIdentifier(row.status);
  return !status || status === 'active' || status === 'نشط';
}

function isPrimaryPharmacistRow(row: StaffDirectoryRow): boolean {
  if (!isStaffRowActive(row)) return false;
  const role = normalizeIdentifier(row.role);
  return !role || PHARMACIST_ROLE_PATTERN.test(role);
}

function staffRowId(row: StaffDirectoryRow): string {
  return normalizeIdentifier(row.staff_id || row.id);
}

function staffRowDisplayName(row: StaffDirectoryRow): string {
  return normalizeIdentifier(row.name || row.staff_name || row.username);
}

function makeEntry(row: StaffDirectoryRow): StaffIdentityMapEntry | null {
  const staffId = staffRowId(row);
  if (!staffId) return null;
  const displayName = staffRowDisplayName(row);
  return {
    staffId,
    displayName,
    normalizedName: normalizeDoctorName(displayName),
    branch: normalizedBranch(row.branch),
    username: normalizeIdentifier(row.username),
    role: normalizeIdentifier(row.role),
    isPrimary: isPrimaryPharmacistRow(row),
  };
}

function uniqueByStaffId(rows: StaffDirectoryRow[]): StaffDirectoryRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const id = staffRowId(row);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function exactNameCandidates(name: string, rows: StaffDirectoryRow[]): StaffDirectoryRow[] {
  const normalized = normalizeDoctorName(name);
  if (!normalized) return [];
  return uniqueByStaffId(
    rows.filter(
      (row) =>
        isStaffRowActive(row) &&
        normalizeDoctorName(staffRowDisplayName(row)) === normalized
    )
  );
}

function applyBranchHint(rows: StaffDirectoryRow[], branchHint: unknown): StaffDirectoryRow[] {
  const branch = normalizedBranch(branchHint);
  if (!branch) return rows;
  const matches = rows.filter((row) => normalizedBranch(row.branch) === branch);
  return matches.length ? matches : rows;
}

function resolveUniqueName(
  name: string,
  rows: StaffDirectoryRow[],
  branchHint?: unknown
): StaffDirectoryRow | null {
  const candidates = applyBranchHint(exactNameCandidates(name, rows), branchHint);
  return candidates.length === 1 ? candidates[0] : null;
}

export function buildStaffIdentityMap(staffRows: StaffDirectoryRow[]): StaffIdentityMap {
  const map: StaffIdentityMap = new Map();
  const activeRows = staffRows.filter(isStaffRowActive);

  for (const row of activeRows) {
    const entry = makeEntry(row);
    if (!entry) continue;

    map.set(`id:${entry.staffId}`, entry);
    if (entry.username) {
      map.set(`username:${entry.username.toLowerCase()}`, entry);
    }
  }

  const names = new Map<string, StaffDirectoryRow[]>();
  for (const row of activeRows) {
    const key = normalizeDoctorName(staffRowDisplayName(row));
    if (!key) continue;
    names.set(key, [...(names.get(key) || []), row]);
  }

  for (const [name, candidates] of names) {
    const unique = uniqueByStaffId(candidates);
    if (unique.length !== 1) continue;
    const entry = makeEntry(unique[0]);
    if (entry) map.set(`name:${name}`, entry);
  }

  return map;
}

function readRowValue(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = normalizeIdentifier(row[key]);
    if (value) return value;
  }
  return '';
}

export function resolvePrimaryStaffForDoctor(
  row: Record<string, unknown>,
  staffRows: StaffDirectoryRow[],
  identityMap?: StaffIdentityMap
): StaffIdentityMapEntry | null {
  const map = identityMap || buildStaffIdentityMap(staffRows);

  const staffId = readRowValue(row, [
    'staff_id',
    'reviewed_staff_id',
    'employee_id',
    'doctor_id',
    'seller_id',
    'responsible_staff_id',
  ]);

  if (staffId) {
    const byId = map.get(`id:${staffId}`);
    if (byId) return byId;
    const direct = staffRows.find((item) => staffRowId(item) === staffId);
    return direct ? makeEntry(direct) : null;
  }

  const username = readRowValue(row, [
    'username',
    'staff_username',
    'reviewed_username',
  ]).toLowerCase();

  if (username) {
    const byUsername = map.get(`username:${username}`);
    if (byUsername) return byUsername;
  }

  const rawName = readRowValue(row, [
    'doctor_name',
    'staff_name',
    'employee_name',
    'reviewed_staff_name',
    'seller_name',
    'normalized_seller_name',
    'responsible_doctor_name',
    'responsible_doctor',
  ]);
  if (!rawName) return null;

  const branchHint = readRowValue(row, ['branch', 'branch_name', 'staff_branch']);
  const unique = resolveUniqueName(rawName, staffRows, branchHint);
  return unique ? makeEntry(unique) : null;
}

export function dedupeStaffRows<T extends StaffDirectoryRow>(rows: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const row of rows) {
    const id = staffRowId(row);
    const username = normalizeIdentifier(row.username).toLowerCase();
    const fallback = `${normalizeDoctorName(staffRowDisplayName(row))}|${normalizedBranch(row.branch)}|${normalizeIdentifier(row.role)}`;
    const key = id ? `id:${id}` : username ? `username:${username}` : `row:${fallback}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }

  return result;
}

function matchStaffInDirectory(
  identifier: string,
  staffDirectory: StaffDirectoryRow[],
  branchHint?: unknown
): StaffDirectoryRow | null {
  const value = normalizeIdentifier(identifier);
  if (!value) return null;

  const byId = staffDirectory.filter(
    (row) => isStaffRowActive(row) && (staffRowId(row) === value || normalizeIdentifier(row.id) === value)
  );
  if (byId.length === 1) return byId[0];

  const byUsername = staffDirectory.filter(
    (row) =>
      isStaffRowActive(row) &&
      normalizeIdentifier(row.username).toLowerCase() === value.toLowerCase()
  );
  if (byUsername.length === 1) return byUsername[0];

  return resolveUniqueName(value, staffDirectory, branchHint);
}

export function resolveStaffLink(
  nameOrId: unknown,
  branchOrFallback?: unknown,
  staffDirectory?: StaffDirectoryRow[]
): StaffLinkResult {
  const value = normalizeIdentifier(nameOrId);

  if (staffDirectory?.length && value) {
    const match = matchStaffInDirectory(value, staffDirectory, branchOrFallback);
    if (match) {
      const id = staffRowId(match) || normalizeIdentifier(match.id) || normalizeIdentifier(match.username);
      if (id) {
        const route = `/staff/${encodeURIComponent(id)}`;
        return { route, href: route, fallback: false, isFallback: false };
      }
    }
  }

  const route = value ? `/team?search=${encodeURIComponent(value)}` : '/team';
  return {
    route,
    href: route,
    fallback: true,
    isFallback: true,
    toastMessage: value
      ? 'تعذر تحديد الموظف بشكل فريد، تم فتح بحث الفريق بدلًا منه.'
      : undefined,
  };
}

function staffFromRow(row: Record<string, unknown> | null | undefined): ResolvedStaff | null {
  if (!row) return null;
  const id = normalizeIdentifier(row.id || row.staff_id);
  if (!id) return null;
  return {
    id,
    name: normalizeIdentifier(row.name || row.staff_name || row.username || 'غير محدد'),
    role: (row.role as string | null | undefined) || null,
    branch: (row.branch as string | null | undefined) || null,
    username: (row.username as string | null | undefined) || null,
  };
}

async function fetchStaffById(staffId: string): Promise<ResolvedStaff | null> {
  if (!isUuid(staffId)) return null;
  const { data, error } = await supabase
    .from('staff')
    .select('id,name,staff_name,username,role,branch,active,is_active,status')
    .eq('id', staffId)
    .maybeSingle();
  if (error) return null;
  return staffFromRow(data as Record<string, unknown> | null);
}

async function fetchUniqueStaffByNameOrUsername(
  identifier: string,
  branchHint?: unknown
): Promise<ResolvedStaff | null> {
  const value = normalizeIdentifier(identifier);
  if (!value) return null;

  const { data } = await supabase
    .from('staff')
    .select('id,name,staff_name,username,role,branch,active,is_active,status')
    .limit(500);

  const rows = (data || []) as StaffDirectoryRow[];
  const byUsername = rows.filter(
    (row) =>
      isStaffRowActive(row) &&
      normalizeIdentifier(row.username).toLowerCase() === value.toLowerCase()
  );
  if (byUsername.length === 1) return staffFromRow(byUsername[0] as Record<string, unknown>);

  const match = resolveUniqueName(value, rows, branchHint);
  return match ? staffFromRow(match as Record<string, unknown>) : null;
}

async function fetchAccount(identifier: string) {
  const value = normalizeIdentifier(identifier);
  if (!value) return null;

  const accounts = await resolveStaffAccountSafe(value);
  const exact = accounts.filter((account) => {
    if (account.active === false || account.can_login === false) return false;
    return (
      account.id === value ||
      account.staff_id === value ||
      normalizeIdentifier(account.username).toLowerCase() === value.toLowerCase() ||
      normalizeStaffName(account.name || account.staff_name) === normalizeStaffName(value)
    );
  });

  return exact.length === 1
    ? (exact[0] as CanonicalStaffResolution['account'])
    : null;
}

export async function resolveCanonicalStaffIdentifier(
  identifier: unknown
): Promise<CanonicalStaffResolution> {
  const input = normalizeIdentifier(identifier);
  const unresolved = (): CanonicalStaffResolution => ({
    input,
    canonicalStaffId: null,
    routeIdentifier: input,
    staff: null,
    account: null,
    source: 'unresolved',
  });

  if (!input) return unresolved();

  const directStaff = await fetchStaffById(input);
  if (directStaff) {
    return {
      input,
      canonicalStaffId: directStaff.id,
      routeIdentifier: directStaff.id,
      staff: directStaff,
      account: await fetchAccount(directStaff.id),
      source: 'staff.id',
    };
  }

  const account = await fetchAccount(input);
  if (account) {
    const linkedStaff = account.staff_id ? await fetchStaffById(account.staff_id) : null;
    return {
      input,
      canonicalStaffId: linkedStaff?.id || account.staff_id || null,
      routeIdentifier: linkedStaff?.id || account.staff_id || account.username || account.id,
      staff: linkedStaff,
      account,
      source: account.staff_id
        ? 'staff_accounts.staff_id'
        : input === account.id
          ? 'staff_accounts.id'
          : 'username',
    };
  }

  const uniqueStaff = await fetchUniqueStaffByNameOrUsername(input);
  if (uniqueStaff) {
    return {
      input,
      canonicalStaffId: uniqueStaff.id,
      routeIdentifier: uniqueStaff.id,
      staff: uniqueStaff,
      account: await fetchAccount(uniqueStaff.id),
      source: 'name',
    };
  }

  return unresolved();
}

export function staffProfilePath(row: {
  id?: unknown;
  staff_id?: unknown;
  username?: unknown;
  name?: unknown;
  staff_name?: unknown;
}) {
  const identifier =
    normalizeIdentifier(row.staff_id) ||
    normalizeIdentifier(row.id) ||
    normalizeIdentifier(row.username) ||
    normalizeIdentifier(row.name) ||
    normalizeIdentifier(row.staff_name);
  return identifier ? `/staff/${encodeURIComponent(identifier)}` : '/team';
}

const staffCache = new Map<string, ResolvedStaff | null>();
let allStaff: StaffDirectoryRow[] = [];
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  const { data } = await supabase
    .from('staff')
    .select('id,name,staff_name,username,role,branch,active,is_active,status')
    .limit(500);
  allStaff = (data || []) as StaffDirectoryRow[];
  loaded = true;
}

export async function resolveStaffBySellerName(
  sellerName: string | null | undefined
): Promise<ResolvedStaff | null> {
  const value = normalizeIdentifier(sellerName);
  if (!value) return null;

  const key = normalizeStaffName(value);
  if (staffCache.has(key)) return staffCache.get(key) ?? null;

  await ensureLoaded();
  const match = resolveUniqueName(value, allStaff);
  const resolved = match ? staffFromRow(match as Record<string, unknown>) : null;
  staffCache.set(key, resolved);
  return resolved;
}

export async function getStaffNavigationTarget(sellerName: string): Promise<StaffLinkResult> {
  const staff = await resolveStaffBySellerName(sellerName);
  if (staff) {
    const route = `/staff/${encodeURIComponent(staff.id)}`;
    return { route, href: route, fallback: false, isFallback: false };
  }

  const value = normalizeIdentifier(sellerName);
  const route = value ? `/team?search=${encodeURIComponent(value)}` : '/team';
  return {
    route,
    href: route,
    fallback: true,
    isFallback: true,
    toastMessage: 'تعذر تحديد الموظف بشكل فريد، تم فتح بحث الفريق بدلًا منه.',
  };
}

export function clearStaffCache(): void {
  staffCache.clear();
  allStaff = [];
  loaded = false;
}
