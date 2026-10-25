// Canonical case branch — the ONE operational branch a case shows in its detail, the case list,
// the list filter and the list summary. It is never the source's historical branch (that stays on
// whatsapp_review_sources.branch and in ownership.sourceBranchNameRaw) and never rewrites it.
//
// Per case, it is decided only by case-local evidence (a resolved doctor's explicit introduction,
// an operating source branch, or the branch of an invoice proven for THIS case). A service case
// that belongs to the same operation as a proven sale (e.g. the nursing follow-up of a delivered
// drip order) may inherit the OPERATION branch from that sibling sale case — never its invoice or
// sale — and only when every linking condition holds; otherwise it stays unresolved with the
// Arabic reason. Customer-service cases never get a branch.
import { isOperatingBranch, normalizeBranchName } from '../branch';
import type { CaseBranchRecommendation, CaseType } from './types';
import type { CaseOwnershipContext } from './caseOwnershipContext';

export type CanonicalCaseBranchBasis =
  | 'explicit_introduction'
  | 'operating_source'
  | 'proven_invoice'
  | 'linked_sale_case'
  | 'customer_service'
  | 'conflict'
  | 'unresolved';

export interface CanonicalCaseBranch {
  /** Decided operational branch; null unless `decided`. */
  branch: string | null;
  decided: boolean;
  basis: CanonicalCaseBranchBasis;
  /** linked_sale_case: the sibling sale case whose proven invoice set the operation branch. */
  linkedCaseId: string | null;
  /** proven_invoice / linked_sale_case: the invoice whose branch is the transaction branch. */
  linkedInvoiceId: string | null;
  /** Arabic reasons, most specific last. */
  reasons: string[];
}

export const CANONICAL_CASE_BRANCH_BASIS_LABELS: Record<CanonicalCaseBranchBasis, string> = {
  explicit_introduction: 'فرع صريح في تعريف دكتور محسوم الهوية',
  operating_source: 'فرع المصدر فرع تشغيل معتمد',
  proven_invoice: 'فرع فاتورة مثبتة لهذه الحالة',
  linked_sale_case: 'فرع العملية من حالة البيع المرتبطة (دون ربط الفاتورة بهذه الحالة)',
  customer_service: 'حالة خدمة عملاء؛ لا يُسند لها فرع بيع',
  conflict: 'أدلة الفرع متعارضة',
  unresolved: 'غير محسوم',
};

export function canonicalCaseBranchFromRecommendation(input: {
  recommendation: CaseBranchRecommendation | null | undefined;
  ownership: CaseOwnershipContext | null | undefined;
  /** The invoice proven for this case by a direct link, when its branch decided the case. */
  provenInvoiceId: string | null;
}): CanonicalCaseBranch {
  const { recommendation, ownership } = input;
  const reasons = [...(recommendation?.reasons ?? [])];
  const none = { linkedCaseId: null, linkedInvoiceId: null };
  if (ownership?.department === 'customer_service') {
    return { branch: null, decided: false, basis: 'customer_service', ...none, reasons };
  }
  if (recommendation?.strength === 'conflict') {
    return { branch: null, decided: false, basis: 'conflict', ...none, reasons };
  }
  if (recommendation?.strength === 'decided' && recommendation.branch) {
    const basis: CanonicalCaseBranchBasis =
      ownership?.operationalBranch && ownership.branchBasis === 'explicit_introduction'
        ? 'explicit_introduction'
        : ownership?.operationalBranch && ownership.branchBasis === 'source'
          ? 'operating_source'
          : 'proven_invoice';
    return {
      branch: recommendation.branch,
      decided: true,
      basis,
      linkedCaseId: null,
      linkedInvoiceId: basis === 'proven_invoice' ? input.provenInvoiceId : null,
      reasons,
    };
  }
  return { branch: null, decided: false, basis: 'unresolved', ...none, reasons };
}

export interface CaseBranchLinkInput {
  caseId: string;
  caseType: CaseType;
  department: CaseOwnershipContext['department'] | null;
  customerId: string | null;
  customerResolved: boolean;
  startedAt: string;
  endedAt: string | null;
  /** Raw (coarse) WhatsApp sessions the case's messages fall in — segmentation output. */
  coarseSessionIndexes: number[];
  /** Resolved pharmacist owners of the case (case-local introductions/senders). */
  pharmacistOwnerIds: string[];
  /** Every resolved owner of the case, any function. */
  ownerIds: string[];
  /** Directory home branch of the case's doctor, if any — a contradiction check only. */
  suggestedStaffBranch: string | null;
  /** This case's own selected invoice candidate, if any (any level). */
  ownSelectedInvoiceId: string | null;
  /** proven_invoice cases: the invoice and its branch. */
  provenInvoice: { invoiceId: string; branch: string | null } | null;
  caseBranch: CanonicalCaseBranch;
}

/** Case types that can be the service/operation follow-up of a sale (never information or a sale). */
const SERVICE_CASE_TYPES = new Set<CaseType>(['follow_up', 'complaint']);

const time = (value: string | null | undefined) => {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * Source-level pass over the cases of ONE conversation. Returns the canonical branch of every case,
 * with a linked operation branch only for a service case that satisfies all of:
 *   same source (the input is one conversation) and the same resolved customer;
 *   the same raw WhatsApp session, starting after the sale case started;
 *   every resolved pharmacist of the service case is a pharmacist of the sale case, and the service
 *   case has no other owner;
 *   exactly one sale case in the conversation with an invoice proven for it, on an operating branch;
 *   no own invoice candidate, no explicit/conflicting branch, no doctor home branch that differs.
 * The sale's invoice is never attached to the service case.
 */
export function linkSiblingServiceCaseBranches(
  cases: CaseBranchLinkInput[]
): Map<string, CanonicalCaseBranch> {
  const result = new Map(cases.map((c) => [c.caseId, c.caseBranch] as const));
  const saleCases = cases.filter(
    (c) => c.caseBranch.basis === 'proven_invoice' && c.caseBranch.decided && c.provenInvoice
  );
  for (const service of cases) {
    if (!SERVICE_CASE_TYPES.has(service.caseType)) continue;
    if (service.department !== 'pharmacy') continue;
    if (service.caseBranch.decided || service.caseBranch.basis !== 'unresolved') continue;
    if (!saleCases.length) continue;
    const blocked = (reason: string) =>
      result.set(service.caseId, {
        ...service.caseBranch,
        reasons: [...service.caseBranch.reasons, reason],
      });

    if (saleCases.length > 1) {
      blocked(
        'توجد أكثر من حالة بيع بفاتورة مثبتة في نفس المحادثة؛ لا يُنقل فرع العملية تلقائيًا.'
      );
      continue;
    }
    const sale = saleCases[0];
    if (sale.caseId === service.caseId) continue;
    const invoiceBranch = isOperatingBranch(sale.provenInvoice!.branch)
      ? normalizeBranchName(sale.provenInvoice!.branch)
      : null;
    if (!invoiceBranch || invoiceBranch !== sale.caseBranch.branch) {
      blocked('فرع فاتورة حالة البيع ليس فرع تشغيل معتمدًا؛ لا يُنقل فرع.');
      continue;
    }
    if (
      !service.customerResolved ||
      !sale.customerResolved ||
      !service.customerId ||
      service.customerId !== sale.customerId
    ) {
      blocked('هوية العميل غير محسومة أو مختلفة بين الحالتين؛ لا يُنقل فرع العملية.');
      continue;
    }
    const sharedSession = service.coarseSessionIndexes.some((i) =>
      sale.coarseSessionIndexes.includes(i)
    );
    const serviceStart = time(service.startedAt);
    const saleStart = time(sale.startedAt);
    if (!sharedSession || serviceStart == null || saleStart == null || serviceStart < saleStart) {
      blocked(
        'لا يوجد ارتباط زمني مباشر بحالة البيع (ليست في نفس جلسة المحادثة بعد الطلب)؛ لا يُنقل فرع.'
      );
      continue;
    }
    const salePharmacists = new Set(sale.pharmacistOwnerIds);
    const sharedDoctor =
      service.pharmacistOwnerIds.length > 0 &&
      service.pharmacistOwnerIds.every((id) => salePharmacists.has(id)) &&
      service.ownerIds.every((id) => service.pharmacistOwnerIds.includes(id));
    if (!sharedDoctor) {
      blocked('لا يوجد دكتور مسؤول محسوم مشترك بين حالة الخدمة وحالة البيع؛ لا يُنقل فرع.');
      continue;
    }
    if (
      service.ownSelectedInvoiceId &&
      service.ownSelectedInvoiceId !== sale.provenInvoice!.invoiceId
    ) {
      blocked('لحالة الخدمة فاتورة مرشحة أخرى؛ تعارض يحتاج مراجعة.');
      continue;
    }
    const homeBranch = isOperatingBranch(service.suggestedStaffBranch)
      ? normalizeBranchName(service.suggestedStaffBranch)
      : null;
    if (homeBranch && homeBranch !== invoiceBranch) {
      blocked(
        `فرع الدكتور (${homeBranch}) يخالف فرع فاتورة حالة البيع (${invoiceBranch})؛ يحتاج مراجعة.`
      );
      continue;
    }
    result.set(service.caseId, {
      branch: invoiceBranch,
      decided: true,
      basis: 'linked_sale_case',
      linkedCaseId: sale.caseId,
      linkedInvoiceId: sale.provenInvoice!.invoiceId,
      reasons: [
        ...service.caseBranch.reasons,
        `فرع العملية من حالة الطلب المرتبطة: نفس العميل ونفس جلسة المحادثة ونفس الدكتور، وفاتورتها المثبتة الوحيدة من ${invoiceBranch}. لا يعني ذلك ربط الفاتورة أو البيع بهذه الحالة.`,
      ],
    });
  }
  return result;
}
