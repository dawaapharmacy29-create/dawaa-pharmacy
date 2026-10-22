import { isOperatingBranch, normalizeBranchName } from '../branch';
import { extractIntroducedStaffName, isCustomerServiceIntroduction } from '../whatsappConversationParser';
import type { NormalizedConversationMessageV32 } from '../whatsappConversationUnderstandingV32';

export interface CaseStaffProfile {
  staffId: string;
  name: string;
  homeBranch: string | null;
  function: 'customer_service' | 'pharmacist' | 'other';
}

export interface CaseOwnershipContext {
  /** Who wrote which outbound messages of THIS case (see deriveCaseStaffContributions). */
  contributions?: CaseStaffContribution[];
  department: 'customer_service' | 'pharmacy' | 'mixed' | 'unresolved';
  sourceBranchNameRaw: string | null;
  operationalBranch: string | null;
  branchBasis: 'explicit_introduction' | 'source' | 'none' | 'conflict';
  /** Directory assignment is a suggestion, never transaction truth or sale proof. */
  suggestedStaffBranch: string | null;
  owners: CaseStaffProfile[];
  introductionMessageIds: string[];
  blockers: string[];
}

/** Case-local context only. Never uses the invoice seller to identify a chat responder. */
export function deriveCaseOwnershipContext(input: {
  messages: NormalizedConversationMessageV32[];
  sourceBranch?: string | null;
  staffIdBySender?: Record<string, string>;
  staffIdByIntroductionMessageId?: Record<string, string>;
  staffProfilesById?: Record<string, CaseStaffProfile>;
}): CaseOwnershipContext {
  const introductions = input.messages.filter((m) => Boolean(extractIntroducedStaffName(m)));
  const ids = new Set<string>();
  const blockers: string[] = [];
  for (const message of input.messages.filter((m) => m.role === 'staff')) {
    const introduced = Boolean(extractIntroducedStaffName(message));
    const id = introduced
      ? input.staffIdByIntroductionMessageId?.[message.id]
      : input.staffIdBySender?.[message.sender];
    if (id) ids.add(id);
    else if (introduced) blockers.push('introduced_staff_unresolved');
  }
  const owners = [...ids].flatMap((id) => input.staffProfilesById?.[id] ? [input.staffProfilesById[id]] : []);
  const hasService = input.messages.some((m) => m.staffFunction === 'customer_service') || introductions.some(isCustomerServiceIntroduction) || owners.some((p) => p.function === 'customer_service');
  const hasPharmacy = owners.some((p) => p.function === 'pharmacist') || introductions.some((m) => {
    const id = input.staffIdByIntroductionMessageId?.[m.id];
    const profile = id ? input.staffProfilesById?.[id] : null;
    return profile?.function !== 'customer_service' && !isCustomerServiceIntroduction(m) &&
      /(?:مع\s+حضرتك|معاك(?:ي)?)\s+(?:دكتور(?:ة)?|دكتوره|د\s*[/.-]?)\s+/u.test(m.text);
  });
  const department = hasService && hasPharmacy ? 'mixed' : hasService ? 'customer_service' : hasPharmacy ? 'pharmacy' : 'unresolved';
  const explicit = new Set<string>();
  for (const message of introductions) {
    const match = message.text.match(/من\s+فرع\s+(شكري|الشامي)(?=[\s،,.!?؟]|$)/u);
    if (match) {
      const id = input.staffIdByIntroductionMessageId?.[message.id];
      if (id && input.staffProfilesById?.[id]?.function === 'pharmacist') {
        explicit.add(normalizeBranchName(match[1]));
      } else {
        blockers.push('explicit_branch_staff_unresolved');
      }
    }
  }
  const sourceBranchNameRaw = input.sourceBranch?.trim() || null;
  const source = isOperatingBranch(sourceBranchNameRaw) ? normalizeBranchName(sourceBranchNameRaw) : null;
  const homeBranches = new Set(owners.filter((p) => p.function === 'pharmacist' && isOperatingBranch(p.homeBranch))
    .map((p) => normalizeBranchName(p.homeBranch)));
  let operationalBranch: string | null = null;
  let branchBasis: CaseOwnershipContext['branchBasis'] = 'none';
  if (department === 'customer_service') {
    // Cross-branch service work has a department, not the employee's home warehouse/branch.
    if (sourceBranchNameRaw) blockers.push('service_case_does_not_inherit_source_branch');
  } else if (explicit.size > 1 || (explicit.size === 1 && source && !explicit.has(source))) {
    branchBasis = 'conflict';
    blockers.push('case_branch_evidence_conflict');
  } else if (explicit.size === 1) {
    operationalBranch = [...explicit][0];
    branchBasis = 'explicit_introduction';
  } else if (source) {
    operationalBranch = source;
    branchBasis = 'source';
  }
  if (sourceBranchNameRaw && !source) blockers.push('source_branch_not_transaction_branch');
  if (department === 'mixed') blockers.push('multiple_staff_functions_require_review');
  if (ids.size > 1) blockers.push('multiple_staff_owners_require_review');
  if (operationalBranch && homeBranches.size && !homeBranches.has(operationalBranch)) blockers.push('staff_home_branch_differs_from_operation');
  return {
    contributions: deriveCaseStaffContributions(input),
    department, sourceBranchNameRaw, operationalBranch, branchBasis,
    suggestedStaffBranch: department !== 'customer_service' && homeBranches.size === 1 ? [...homeBranches][0] : null,
    owners, introductionMessageIds: introductions.map((m) => m.id), blockers: [...new Set(blockers)],
  };
}

/**
 * Staff contributions inside ONE case, in message order. An explicit introduction owns the
 * following unattributed outbound messages of the same case until another introduction appears;
 * it never reaches earlier messages or other cases. Messages nobody can be tied to stay unresolved.
 */
export interface CaseStaffContribution {
  staffId: string | null;
  name: string | null;
  function: CaseStaffProfile['function'] | 'unresolved';
  messageIds: string[];
}

export function deriveCaseStaffContributions(input: {
  messages: NormalizedConversationMessageV32[];
  staffIdBySender?: Record<string, string>;
  staffIdByIntroductionMessageId?: Record<string, string>;
  staffProfilesById?: Record<string, CaseStaffProfile>;
}): CaseStaffContribution[] {
  const buckets = new Map<string, CaseStaffContribution>();
  let introduced: string | null = null;
  for (const message of input.messages) {
    if (message.role !== 'staff' || !message.isMeaningful) continue;
    if (extractIntroducedStaffName(message)) introduced = input.staffIdByIntroductionMessageId?.[message.id] ?? null;
    const id = input.staffIdByIntroductionMessageId?.[message.id] ?? input.staffIdBySender?.[message.sender] ?? introduced;
    const key = id ?? 'unresolved';
    const profile = id ? input.staffProfilesById?.[id] : undefined;
    const bucket = buckets.get(key) ?? {
      staffId: id,
      name: profile?.name ?? null,
      function: profile?.function ?? (id ? 'other' : 'unresolved'),
      messageIds: [],
    };
    bucket.messageIds.push(message.id);
    buckets.set(key, bucket);
  }
  return [...buckets.values()];
}

/**
 * Case-level branch recommendation. A decided case branch (explicit resolved introduction or an
 * operating source branch) stands. Otherwise the staff home branch and the invoice branch are
 * combined only when they are independent: the invoice branch counts only for a strong invoice
 * candidate whose score did not already use the case branch. Disagreement is a conflict.
 */
export function recommendCaseBranch(input: {
  ownership: CaseOwnershipContext | null | undefined;
  invoiceBranch: string | null | undefined;
  invoiceCandidateStrong: boolean;
  attributionUsedCaseBranch: boolean;
}): import('./types').CaseBranchRecommendation {
  const ownership = input.ownership;
  if (!ownership) return { branch: null, strength: 'none', reasons: ['لا توجد أدلة فرع على مستوى الحالة'] };
  if (ownership.department === 'customer_service') {
    return { branch: null, strength: 'none', reasons: ['حالة خدمة عملاء؛ لا تُنسب لفرع بيع'] };
  }
  if (ownership.branchBasis === 'conflict') {
    return { branch: null, strength: 'conflict', reasons: ['تعارض بين تعريف الموظف وفرع المصدر'] };
  }
  if (ownership.operationalBranch) {
    return {
      branch: ownership.operationalBranch,
      strength: 'decided',
      reasons: [ownership.branchBasis === 'explicit_introduction' ? 'فرع صريح في تعريف دكتور محسوم الهوية' : 'فرع المصدر فرع تشغيل معتمد'],
    };
  }
  const staffBranch = ownership.suggestedStaffBranch;
  const invoiceBranch = input.invoiceCandidateStrong && !input.attributionUsedCaseBranch && isOperatingBranch(input.invoiceBranch)
    ? normalizeBranchName(input.invoiceBranch)
    : null;
  const reasons: string[] = [];
  if (ownership.sourceBranchNameRaw && !isOperatingBranch(ownership.sourceBranchNameRaw)) {
    reasons.push(`فرع المصدر المسجل (${ownership.sourceBranchNameRaw}) ليس فرع تشغيل`);
  }
  if (staffBranch) reasons.push(`الفرع الأساسي للدكتور المسؤول: ${staffBranch}`);
  if (invoiceBranch) reasons.push(`فرع الفاتورة المرشحة بقوة: ${invoiceBranch}`);
  if (staffBranch && invoiceBranch && staffBranch !== invoiceBranch) {
    return { branch: null, strength: 'conflict', reasons: [...reasons, 'فرع الدكتور يخالف فرع الفاتورة؛ يحتاج مراجعة'] };
  }
  if (staffBranch && invoiceBranch) {
    return { branch: staffBranch, strength: 'strong_recommendation', reasons: [...reasons, 'دليلان مستقلان متفقان؛ يحتاج اعتمادًا قبل اعتباره فرع العملية'] };
  }
  if (staffBranch || invoiceBranch) {
    return { branch: staffBranch ?? invoiceBranch, strength: 'supporting_only', reasons: [...reasons, 'دليل واحد فقط؛ غير كافٍ لحسم الفرع'] };
  }
  return { branch: null, strength: 'none', reasons: reasons.length ? reasons : ['لا توجد أدلة فرع كافية'] };
}
