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
}

/** Subset of staff row used in the dashboard */
export interface StaffDirectoryRow {
  id?: string | null;
  staff_id?: string | null;
  name?: string | null;
  staff_name?: string | null;
  branch?: string | null;
  role?: string | null;
  status?: string | null;
  active?: boolean | null;
  is_active?: boolean | null;
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

function getStaffId(row: StaffDirectoryRow): string | null {
  return (row.id || row.staff_id || null) as string | null;
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
      const id = getStaffId(match);
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
