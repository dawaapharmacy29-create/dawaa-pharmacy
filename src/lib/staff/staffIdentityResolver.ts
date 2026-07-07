/**
 * staffIdentityResolver.ts
 * Resolves staff profiles from seller/doctor names.
 * Supports both sync (staffDirectory) and async (Supabase) lookups.
 */

import { supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { normalizeArabicName } from '@/lib/security/userDataScope';
import { resolveStaffAccountSafe } from '@/lib/staff/staffAccountsApi';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResolvedStaff {
  id: string;
  name: string;
  role?: string | null;
  branch?: string | null;
  username?: string | null;
}

/** Subset of staff row used in the dashboard */
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
  /** Route string — use with navigate() */
  route: string;
  /** Alias for route — use in href */
  href: string;
  /** True when we couldn't find an exact match */
  fallback: boolean;
  /** Alias for fallback */
  isFallback: boolean;
  /** Toast message to show when fallback=true */
  toastMessage?: string;
}

// ─── Name normalization ───────────────────────────────────────────────────────

/**
 * Strips Arabic diacritics, doctor prefixes, and lowercases for fuzzy matching.
 */
export function normalizeStaffName(name: string | null | undefined): string {
  if (!name) return '';
  return normalizeArabicName(String(name).trim());
}

/** Normalized doctor name key (without د/ prefix) for grouping and deduplication. */
export function normalizeDoctorName(value: unknown): string {
  const normalized = normalizeStaffName(String(value ?? ''));
  if (!normalized) return '';
  return normalized;
}

const PHARMACIST_ROLE_PATTERN = /صيدلاني|pharmacist|دكتور|doctor/i;

function isStaffRowActive(row: StaffDirectoryRow): boolean {
  if (row.active === false || row.is_active === false) return false;
  const status = String(row.status ?? '').trim();
  if (status && !['active', 'نشط', ''].includes(status)) return false;
  return true;
}

function isPrimaryPharmacistRow(row: StaffDirectoryRow): boolean {
  if (!isStaffRowActive(row)) return false;
  const role = String(row.role ?? '').trim();
  if (!role) return true;
  return PHARMACIST_ROLE_PATTERN.test(role);
}

function staffRowId(row: StaffDirectoryRow): string {
  return String(row.staff_id || row.id || '').trim();
}

function staffRowDisplayName(row: StaffDirectoryRow): string {
  return String(row.name || row.staff_name || row.username || '').trim();
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

const DOCTOR_ALIAS_GROUPS: string[][] = [
  ['eslam', 'islam', 'اسلام', 'اسلام فاروق', 'د اسلام', 'د/ اسلام'],
];

function expandDoctorAliasKeys(normalized: string): string[] {
  const keys = new Set<string>([normalized]);
  for (const group of DOCTOR_ALIAS_GROUPS) {
    const normalizedGroup = group.map((item) => normalizeDoctorName(item)).filter(Boolean);
    if (normalizedGroup.includes(normalized)) {
      normalizedGroup.forEach((item) => keys.add(item));
    }
  }
  return [...keys];
}

/** Build a lookup map from staff_id and normalized names to the primary pharmacist account. */
export function buildStaffIdentityMap(staffRows: StaffDirectoryRow[]): StaffIdentityMap {
  const primaryRows = staffRows.filter(isPrimaryPharmacistRow);
  const byNormalized = new Map<string, StaffDirectoryRow[]>();

  for (const row of primaryRows) {
    const normalized = normalizeDoctorName(staffRowDisplayName(row));
    if (!normalized) continue;
    const bucket = byNormalized.get(normalized) || [];
    bucket.push(row);
    byNormalized.set(normalized, bucket);
  }

  function pickPrimary(candidates: StaffDirectoryRow[]): StaffDirectoryRow | null {
    if (!candidates.length) return null;
    const active = candidates.filter(isStaffRowActive);
    const pool = active.length ? active : candidates;
    const pharmacist = pool.find((row) => PHARMACIST_ROLE_PATTERN.test(String(row.role ?? '')));
    return pharmacist || pool[0];
  }

  const map: StaffIdentityMap = new Map();

  for (const [normalized, candidates] of byNormalized.entries()) {
    const primary = pickPrimary(candidates);
    if (!primary) continue;
    const staffId = staffRowId(primary);
    if (!staffId) continue;
    const entry: StaffIdentityMapEntry = {
      staffId,
      displayName: staffRowDisplayName(primary),
      normalizedName: normalized,
      branch: normalizeBranchName(primary.branch || '') || String(primary.branch || '').trim(),
      username: String(primary.username || '').trim(),
      role: String(primary.role || '').trim(),
      isPrimary: true,
    };
    map.set(`id:${staffId}`, entry);
    expandDoctorAliasKeys(normalized).forEach((key) => map.set(`name:${key}`, entry));
    if (entry.username) map.set(`username:${entry.username.toLowerCase()}`, entry);
  }

  return map;
}

function readRowId(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = String(row[key] ?? '').trim();
    if (value) return value;
  }
  return '';
}

function readRowName(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = String(row[key] ?? '').trim();
    if (value) return value;
  }
  return '';
}

/** Resolve a review/invoice row to one primary staff member. */
export function resolvePrimaryStaffForDoctor(
  row: Record<string, unknown>,
  staffRows: StaffDirectoryRow[],
  identityMap?: StaffIdentityMap
): StaffIdentityMapEntry | null {
  const map = identityMap || buildStaffIdentityMap(staffRows);

  const staffId = readRowId(row, [
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
    if (direct) {
      return {
        staffId,
        displayName: staffRowDisplayName(direct),
        normalizedName: normalizeDoctorName(staffRowDisplayName(direct)),
        branch: normalizeBranchName(direct.branch || '') || String(direct.branch || '').trim(),
        username: String(direct.username || '').trim(),
        role: String(direct.role || '').trim(),
        isPrimary: isPrimaryPharmacistRow(direct),
      };
    }
  }

  const username = readRowName(row, ['username', 'staff_username', 'reviewed_username']).toLowerCase();
  if (username) {
    const byUsername = map.get(`username:${username}`);
    if (byUsername) return byUsername;
  }

  const rawName = readRowName(row, [
    'doctor_name',
    'staff_name',
    'employee_name',
    'reviewed_staff_name',
    'seller_name',
    'normalized_seller_name',
    'responsible_doctor_name',
    'responsible_doctor',
  ]);
  const normalized = normalizeDoctorName(rawName);
  if (!normalized) return null;

  for (const key of expandDoctorAliasKeys(normalized)) {
    const byName = map.get(`name:${key}`);
    if (byName) return byName;
  }

  return null;
}

export function dedupeStaffRows<T extends StaffDirectoryRow>(rows: T[]): T[] {
  const identityMap = buildStaffIdentityMap(rows);
  const seen = new Set<string>();
  const result: T[] = [];

  for (const row of rows) {
    const resolved = resolvePrimaryStaffForDoctor(row as Record<string, unknown>, rows, identityMap);
    const key = resolved?.staffId || `name:${normalizeDoctorName(staffRowDisplayName(row))}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }

  return result;
}

// ─── Sync resolver (uses preloaded staffDirectory) ───────────────────────────

function getRouteIdentifier(row: StaffDirectoryRow): string | null {
  return (row.staff_id || row.id || row.username || null) as string | null;
}

function getStaffNameStr(row: StaffDirectoryRow): string {
  return String(row.name || row.staff_name || '').trim();
}

function matchStaffInDirectory(
  name: string,
  staffDirectory: StaffDirectoryRow[]
): StaffDirectoryRow | undefined {
  const norm = normalizeStaffName(name);
  if (!norm) return undefined;

  // 1. Exact match
  const exact = staffDirectory.find((s) => normalizeStaffName(getStaffNameStr(s)) === norm);
  if (exact) return exact;

  // 2. Substring match (either side)
  const sub = staffDirectory.find(
    (s) =>
      normalizeStaffName(getStaffNameStr(s)).includes(norm) ||
      norm.includes(normalizeStaffName(getStaffNameStr(s)))
  );
  if (sub) return sub;

  // 3. First-word prefix match (≥3 chars)
  const first = norm.split(' ')[0];
  if (first.length >= 3) {
    return staffDirectory.find((s) => normalizeStaffName(getStaffNameStr(s)).startsWith(first));
  }

  return undefined;
}

/**
 * Primary resolver — used in the dashboard where staffDirectory is already loaded.
 *
 * Usage (dashboard):
 *   resolveStaffLink(sellerName, branch, state.staffDirectory).route
 *
 * Usage (simple):
 *   resolveStaffLink(staffId, fallbackName)
 */
export function resolveStaffLink(
  nameOrId: unknown,
  branchOrFallback?: unknown,
  staffDirectory?: StaffDirectoryRow[]
): StaffLinkResult {
  const name = String(nameOrId || '').trim();

  // Fast path: if staffDirectory is provided, search it synchronously
  if (staffDirectory && staffDirectory.length > 0 && name) {
    const match = matchStaffInDirectory(name, staffDirectory);
    if (match) {
      const id = getRouteIdentifier(match);
      if (id) {
        const route = `/staff/${encodeURIComponent(id)}`;
        return { route, href: route, fallback: false, isFallback: false };
      }
    }
  }

  // Fallback: open team search
  if (name) {
    const encoded = encodeURIComponent(name);
    const route = `/team?search=${encoded}`;
    return {
      route,
      href: route,
      fallback: true,
      isFallback: true,
      toastMessage: 'لم يتم العثور على الملف الشخصي بدقة، تم فتح بحث الفريق بدلاً منه.',
    };
  }

  return { route: '/team', href: '/team', fallback: true, isFallback: true };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

function normalizeLooseIdentifier(value: unknown) {
  return String(value ?? '').trim();
}

function staffFromRow(row: Record<string, unknown> | null | undefined): ResolvedStaff | null {
  if (!row) return null;
  const id = normalizeLooseIdentifier(row.id || row.staff_id);
  if (!id) return null;
  return {
    id,
    name: normalizeLooseIdentifier(row.name || row.staff_name || row.username || 'غير محدد'),
    role: (row.role as string | null | undefined) || null,
    branch: (row.branch as string | null | undefined) || null,
    username: (row.username as string | null | undefined) || null,
  };
}

function accountName(account: CanonicalStaffResolution['account']) {
  return normalizeLooseIdentifier(account?.name || account?.staff_name || account?.username);
}

async function fetchStaffById(staffId: string): Promise<ResolvedStaff | null> {
  if (!staffId || !isUuid(staffId)) return null;
  const { data, error } = await supabase
    .from('staff')
    .select('id,name,staff_name,username,role,branch,active,is_active,status')
    .eq('id', staffId)
    .maybeSingle();
  if (error) return null;
  return staffFromRow(data as Record<string, unknown> | null);
}

async function fetchStaffByNameOrUsername(identifier: string): Promise<ResolvedStaff | null> {
  const value = normalizeLooseIdentifier(identifier);
  if (!value) return null;

  const { data: byUsername } = await supabase
    .from('staff')
    .select('id,name,staff_name,username,role,branch,active,is_active,status')
    .eq('username', value)
    .limit(1);
  const usernameMatch = staffFromRow((byUsername || [])[0] as Record<string, unknown> | undefined);
  if (usernameMatch) return usernameMatch;

  const normalized = normalizeStaffName(value);
  const { data } = await supabase
    .from('staff')
    .select('id,name,staff_name,username,role,branch,active,is_active,status')
    .limit(500);
  const rows = (data || []) as Array<Record<string, unknown>>;
  const exact = rows.find((row) => normalizeStaffName(String(row.name || row.staff_name || '')) === normalized);
  if (exact) return staffFromRow(exact);
  const partial = rows.find((row) => {
    const name = normalizeStaffName(String(row.name || row.staff_name || ''));
    return name.includes(normalized) || normalized.includes(name);
  });
  return staffFromRow(partial);
}

async function fetchAccount(identifier: string) {
  const value = normalizeLooseIdentifier(identifier);
  if (!value) return null;

  const accounts = await resolveStaffAccountSafe(value);
  if (isUuid(value)) {
    const byAccountId = accounts.find((account) => account.id === value);
    if (byAccountId) return byAccountId as CanonicalStaffResolution['account'];

    const byStaffId = accounts.find((account) => account.staff_id === value && account.active !== false);
    if (byStaffId) return byStaffId as CanonicalStaffResolution['account'];
  }

  const byUsername = accounts.find((account) => account.username === value);
  if (byUsername) return byUsername as CanonicalStaffResolution['account'];

  const normalized = normalizeStaffName(value);
  return (
    (accounts as Array<NonNullable<CanonicalStaffResolution['account']>>).find(
      (account) => normalizeStaffName(accountName(account)) === normalized
    ) || null
  );
}

export async function resolveCanonicalStaffIdentifier(
  identifier: unknown
): Promise<CanonicalStaffResolution> {
  const input = normalizeLooseIdentifier(identifier);
  const unresolved = (routeIdentifier = input || ''): CanonicalStaffResolution => ({
    input,
    canonicalStaffId: null,
    routeIdentifier,
    staff: null,
    account: null,
    source: 'unresolved',
  });

  if (!input) return unresolved('');

  const directStaff = await fetchStaffById(input);
  if (directStaff) {
    const account = await fetchAccount(directStaff.id);
    return {
      input,
      canonicalStaffId: directStaff.id,
      routeIdentifier: directStaff.id,
      staff: directStaff,
      account,
      source: 'staff.id',
    };
  }

  const account = await fetchAccount(input);
  if (account) {
    const staffByAccount = account.staff_id ? await fetchStaffById(account.staff_id) : null;
    const fallbackStaff =
      staffByAccount ||
      (account.username ? await fetchStaffByNameOrUsername(account.username) : null) ||
      (accountName(account) ? await fetchStaffByNameOrUsername(accountName(account)) : null);
    const canonicalStaffId = fallbackStaff?.id || account.staff_id || null;
    return {
      input,
      canonicalStaffId,
      routeIdentifier: canonicalStaffId || account.username || account.id,
      staff: fallbackStaff,
      account,
      source: account.staff_id ? 'staff_accounts.staff_id' : input === account.id ? 'staff_accounts.id' : 'username',
    };
  }

  const staffByName = await fetchStaffByNameOrUsername(input);
  if (staffByName) {
    const matchedAccount = await fetchAccount(staffByName.id);
    return {
      input,
      canonicalStaffId: staffByName.id,
      routeIdentifier: staffByName.id,
      staff: staffByName,
      account: matchedAccount,
      source: isUuid(input) ? 'staff.id' : 'name',
    };
  }

  return unresolved(input);
}

export function staffProfilePath(row: {
  id?: unknown;
  staff_id?: unknown;
  username?: unknown;
  name?: unknown;
  staff_name?: unknown;
}) {
  const identifier =
    normalizeLooseIdentifier(row.staff_id) ||
    normalizeLooseIdentifier(row.id) ||
    normalizeLooseIdentifier(row.username) ||
    normalizeLooseIdentifier(row.name) ||
    normalizeLooseIdentifier(row.staff_name);
  return identifier ? `/staff/${encodeURIComponent(identifier)}` : '/team';
}

// ─── Async resolver (Supabase lookup) ────────────────────────────────────────

const staffCache = new Map<string, ResolvedStaff | null>();
let allStaff: ResolvedStaff[] = [];
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  const { data } = await supabase
    .from('staff')
    .select('id, name, role, branch')
    .eq('active', true)
    .limit(500);
  allStaff = (data ?? []) as ResolvedStaff[];
  loaded = true;
}

/**
 * Async resolver — looks up Supabase when no staffDirectory is available.
 * Caches results in memory.
 */
export async function resolveStaffBySellerName(
  sellerName: string | null | undefined
): Promise<ResolvedStaff | null> {
  if (!sellerName) return null;

  const key = normalizeStaffName(sellerName);
  if (staffCache.has(key)) return staffCache.get(key) ?? null;

  await ensureLoaded();
  const norm = normalizeStaffName(sellerName);

  let match =
    allStaff.find((s) => normalizeStaffName(s.name) === norm) ??
    allStaff.find(
      (s) => normalizeStaffName(s.name).includes(norm) || norm.includes(normalizeStaffName(s.name))
    );

  if (!match) {
    const first = norm.split(' ')[0];
    if (first.length >= 3) {
      match = allStaff.find((s) => normalizeStaffName(s.name).startsWith(first));
    }
  }

  staffCache.set(key, match ?? null);
  return match ?? null;
}

/**
 * Full async resolution with toast message.
 * Use when clicking a name in a table that does NOT have the staff directory preloaded.
 */
export async function getStaffNavigationTarget(sellerName: string): Promise<StaffLinkResult> {
  const staff = await resolveStaffBySellerName(sellerName);
  if (staff) {
    const route = `/staff/${staff.id}`;
    return { route, href: route, fallback: false, isFallback: false };
  }
  const encoded = encodeURIComponent(sellerName.trim());
  const route = `/team?search=${encoded}`;
  return {
    route,
    href: route,
    fallback: true,
    isFallback: true,
    toastMessage: 'لم يتم العثور على الملف الشخصي بدقة، تم فتح بحث الفريق بدلاً منه.',
  };
}

/** Clears the async cache — call after staff mutations. */
export function clearStaffCache(): void {
  staffCache.clear();
  allStaff = [];
  loaded = false;
}
