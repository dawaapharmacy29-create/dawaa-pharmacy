import { normalizeBranchName } from '@/lib/branch';
import { normalizeRole, getUserDataScope, type DataScope, type RoleKey } from '@/lib/core/permissionSystem';
import type { User } from '@/types';

type ScopeUser = (Partial<Pick<User, 'id' | 'staffId' | 'name' | 'username' | 'branch' | 'role'>> & { id?: string | null }) | null | undefined;
type RowLike = Record<string, unknown> | null | undefined;

export interface CurrentUserScope {
  role: RoleKey;
  dataScope: DataScope;
  branch: string;
  userId: string;
  staffId: string;
  names: string[];
  viewAllBranches: boolean;
  ownOnly: boolean;
  manager: boolean;
  doctor: boolean;
}

const ALL_BRANCHES = 'كل الفروع';

export function normalizeArabicName(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u064B-\u065F\u0640]/g, '')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
    .replace(/^(?:\s*(?:دكتور|الدكتور|د\.?|د\/)\s*)+/i, '')
    .replace(/[.,،;:()[\]{}_\-/\\|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * أدوار مساحة الدكتور: الصيدلي ومشرفا الشيفت.
 * هذه الدالة تتحكم في الصفحة الرئيسية والقائمة الجانبية فقط، بينما يظل نطاق
 * البيانات الفعلي لكل دور محكومًا بـ permissionSystem وRLS.
 */
export function isDoctorRole(user: ScopeUser): boolean {
  return ['pharmacist', 'shift_supervisor_morning', 'shift_supervisor_evening'].includes(
    normalizeRole(user?.role)
  );
}

/**
 * المديرون الذين يملكون وضع استعراض الفريق داخل اللوحات الإدارية.
 * مشرف الشيفت يبدأ من لوحة الدكتور وبياناته الشخصية، وتظل صلاحيات الإشراف
 * الإضافية متاحة له من الصفحات المسموح بها.
 */
export function isManagerRole(user: ScopeUser): boolean {
  return ['general_manager', 'executive_manager', 'branches_manager', 'branch_manager'].includes(
    normalizeRole(user?.role)
  );
}

function getDashboardBranchOverrideForUser(user: ScopeUser): string | null {
  const username = String(user?.username || '').trim().toLowerCase();
  const name = String(user?.name || '').trim().toLowerCase();
  if (username === 'cs.doha' || name.includes('ضحي')) {
    return 'فرع الشامي';
  }
  return null;
}

function getReviewBranchOverride(user: ScopeUser): string[] | null {
  const username = String(user?.username || '').trim().toLowerCase();
  const name = String(user?.name || '').trim().toLowerCase();
  if (username === 'cs.doha' || name.includes('ضحي') || username === 'cs.donia' || name.includes('دنيا')) {
    return ['فرع الشامي', 'فرع شكري'];
  }
  return null;
}

export function canViewAllBranches(user: ScopeUser): boolean {
  return ['general_manager', 'executive_manager', 'branches_manager'].includes(normalizeRole(user?.role));
}

export function canViewAllBranchesForServiceAnalytics(user: ScopeUser): boolean {
  const role = normalizeRole(user?.role);
  return canViewAllBranches(user) || role === 'customer_service_manager';
}

export function canViewOwnOnly(user: ScopeUser): boolean {
  const role = normalizeRole(user?.role);
  return role === 'pharmacist' || role === 'delivery' || getUserDataScope(role) === 'own_only';
}

export function canViewBranchData(user: ScopeUser, branch?: unknown): boolean {
  if (canViewAllBranches(user)) return true;
  const overrideBranch = getDashboardBranchOverrideForUser(user);
  const userBranch = overrideBranch || normalizeBranchName(user?.branch || '');
  if (!userBranch || userBranch === ALL_BRANCHES) return false;
  return normalizeBranchName(branch || '') === userBranch;
}

export function getDashboardBranchOverride(user: ScopeUser): string {
  return getDashboardBranchOverrideForUser(user) || normalizeBranchName(user?.branch || '');
}

export function getReviewAllowedBranches(user: ScopeUser): string[] {
  return getReviewBranchOverride(user) || [normalizeBranchName(user?.branch || '')].filter(Boolean);
}

function latinDoctorAliases(value: unknown): string[] {
  const raw = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!raw) return [];

  const aliases = new Set<string>([raw]);
  raw.split(' ').forEach((part) => {
    if (part && part.length >= 3) aliases.add(part);
  });

  const dictionary: Record<string, string> = {
    eslam: 'اسلام',
    islam: 'اسلام',
    yusuf: 'يوسف',
    youssef: 'يوسف',
    yousef: 'يوسف',
    hassan: 'حسن',
    hasan: 'حسن',
    sara: 'ساره',
    sarah: 'ساره',
    nada: 'ندي',
    basant: 'بسنت',
    ola: 'علا',
    alyaa: 'علياء',
    aliaa: 'علياء',
  };

  for (const token of aliases) {
    if (dictionary[token]) aliases.add(normalizeArabicName(dictionary[token]));
  }

  return [...aliases].map(normalizeArabicName).filter(Boolean);
}
export function doctorNameKeys(user: ScopeUser): string[] {
  const values = [user?.name, user?.username, user?.staffId, user?.id];
  const direct = values.map(normalizeArabicName).filter(Boolean);
  const aliases = values.flatMap(latinDoctorAliases);
  return [...new Set([...direct, ...aliases])];
}

export function getCurrentUserScope(user: ScopeUser): CurrentUserScope {
  const role = normalizeRole(user?.role);
  return {
    role,
    dataScope: getUserDataScope(role),
    branch: normalizeBranchName(user?.branch || ''),
    userId: String(user?.id || '').trim(),
    staffId: String(user?.staffId || '').trim(),
    names: doctorNameKeys(user),
    viewAllBranches: canViewAllBranches(user),
    ownOnly: canViewOwnOnly(user),
    manager: isManagerRole(user),
    doctor: isDoctorRole(user),
  };
}

export function getScopedBranch(user: ScopeUser, requestedBranch?: string | null, allValue = ALL_BRANCHES): string {
  if (canViewAllBranches(user)) return requestedBranch || allValue;
  return normalizeBranchName(user?.branch || requestedBranch || '');
}

function rowBranch(row: RowLike): unknown {
  return row?.branch_name ?? row?.branch ?? row?.customer_branch ?? row?.pharmacy_branch;
}

function rowNameValues(row: RowLike): string[] {
  if (!row) return [];
  return [
    row.doctor_name,
    row.normalized_seller_name,
    row.seller_name,
    row.staff_name,
    row.employee_name,
    row.responsible_doctor,
    row.responsible_doctor_name,
    row.responsible_name,
    row.assigned_doctor,
    row.assigned_to,
    row.created_by_name,
    row.delivery_name,
  ].map(normalizeArabicName).filter(Boolean);
}

function rowIdValues(row: RowLike): string[] {
  if (!row) return [];
  return [
    row.user_id,
    row.staff_id,
    row.employee_id,
    row.doctor_id,
    row.assigned_to_id,
    row.delivery_id,
    row.created_by,
    row.created_by_id,
  ].map((value) => String(value ?? '').trim()).filter(Boolean);
}

export function rowMatchesCurrentDoctor(user: ScopeUser, row: RowLike): boolean {
  if (!user || !row) return false;
  const scope = getCurrentUserScope(user);
  const ids = rowIdValues(row);
  if ((scope.staffId && ids.includes(scope.staffId)) || (scope.userId && ids.includes(scope.userId))) return true;
  const names = rowNameValues(row);
  return scope.names.some((name) => names.some((rowName) => rowName === name || rowName.includes(name) || name.includes(rowName)));
}

export function rowMatchesCurrentUserScope(user: ScopeUser, row: RowLike): boolean {
  if (!user || !row) return false;
  if (canViewAllBranches(user)) return true;
  if (!canViewBranchData(user, rowBranch(row))) return false;
  const role = normalizeRole(user.role);
  if (role === 'pharmacist' || role === 'delivery' || getUserDataScope(role) === 'assigned_only' || getUserDataScope(role) === 'own_only') {
    return rowMatchesCurrentDoctor(user, row);
  }
  return true;
}
