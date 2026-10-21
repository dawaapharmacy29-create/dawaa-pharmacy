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
    if (match) explicit.add(normalizeBranchName(match[1]));
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
    department, sourceBranchNameRaw, operationalBranch, branchBasis,
    suggestedStaffBranch: department !== 'customer_service' && homeBranches.size === 1 ? [...homeBranches][0] : null,
    owners, introductionMessageIds: introductions.map((m) => m.id), blockers: [...new Set(blockers)],
  };
}
