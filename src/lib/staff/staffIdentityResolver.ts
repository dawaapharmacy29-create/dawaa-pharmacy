/**
 * staffIdentityResolver.ts
 * Resolves staff profiles from seller/doctor names.
 * Supports both sync (staffDirectory) and async (Supabase) lookups.
 */

import { supabase } from '@/lib/supabase';

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
 * Strips Arabic diacritics, collapses spaces, and lowercases.
 * Used for fuzzy name matching.
 */
export function normalizeStaffName(name: string | null | undefined): string {
  if (!name) return '';
  return String(name)
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06ED]/g, '')
    .toLowerCase();
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

  if (isUuid(value)) {
    const { data: byAccountId } = await supabase
      .from('staff_accounts')
      .select('id,staff_id,username,name,staff_name,role,branch,active,can_login')
      .eq('id', value)
      .maybeSingle();
    if (byAccountId) return byAccountId as CanonicalStaffResolution['account'];

    const { data: byStaffId } = await supabase
      .from('staff_accounts')
      .select('id,staff_id,username,name,staff_name,role,branch,active,can_login')
      .eq('staff_id', value)
      .eq('active', true)
      .limit(1);
    if (byStaffId?.[0]) return byStaffId[0] as CanonicalStaffResolution['account'];
  }

  const { data: byUsername } = await supabase
    .from('staff_accounts')
    .select('id,staff_id,username,name,staff_name,role,branch,active,can_login')
    .eq('username', value)
    .limit(1);
  if (byUsername?.[0]) return byUsername[0] as CanonicalStaffResolution['account'];

  const normalized = normalizeStaffName(value);
  const { data: accounts } = await supabase
    .from('staff_accounts')
    .select('id,staff_id,username,name,staff_name,role,branch,active,can_login')
    .eq('active', true)
    .limit(500);
  return (
    ((accounts || []) as Array<NonNullable<CanonicalStaffResolution['account']>>).find(
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
