// Pure impact selection only. The canonical refresh still owns proof and publication.
import { CANDIDATE_RETRIEVAL_TIME_WINDOW } from '../invoiceCandidateRetrieval';
import { normalizeDawaaCustomerCode, normalizeEgyptianCustomerPhone, isValidEgyptianCustomerMobile } from '../../customers/customerIdentity';

export interface InvoiceImpactIdentity {
  invoiceId: string;
  invoiceAt: string | null;
  customerId?: string | null;
  customerCode?: string | null;
  customerPhone?: string | null;
  whatsappPhone?: string | null;
}
export interface InvoiceImpactCase {
  sourceId: string;
  active: boolean;
  deleted: boolean;
  startedAt: string | null;
  endedAt: string | null;
  customerId?: string | null;
  customerCode?: string | null;
  customerPhone?: string | null;
  selectedInvoiceId?: string | null;
}
export interface InvoiceEvidenceChange {
  before: InvoiceImpactIdentity | null;
  after: InvoiceImpactIdentity | null;
}
function phone(value: string | null | undefined): string | null {
  const p = normalizeEgyptianCustomerPhone(value ?? '');
  return isValidEgyptianCustomerMobile(p) ? p : null;
}
function equalNonEmpty(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a === b);
}
function inWindow(c: InvoiceImpactCase, i: InvoiceImpactIdentity): boolean {
  const start = Date.parse(c.startedAt ?? '');
  const end = Date.parse(c.endedAt ?? '');
  const at = Date.parse(i.invoiceAt ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(at)) return false;
  const effectiveEnd = Number.isFinite(end) ? Math.max(end, start) : start;
  return at >= start - CANDIDATE_RETRIEVAL_TIME_WINDOW.beforeCaseStartHours * 3600000
    && at <= effectiveEnd + CANDIDATE_RETRIEVAL_TIME_WINDOW.afterCaseEndHours * 3600000;
}
function sharesIdentity(c: InvoiceImpactCase, i: InvoiceImpactIdentity): boolean {
  const p = phone(c.customerPhone);
  return equalNonEmpty(c.customerId, i.customerId)
    || equalNonEmpty(normalizeDawaaCustomerCode(c.customerCode), normalizeDawaaCustomerCode(i.customerCode))
    || equalNonEmpty(p, phone(i.customerPhone))
    || equalNonEmpty(p, phone(i.whatsappPhone));
}
/** Returns deduplicated source IDs, not sale-proof decisions.
 * Before AND after are essential for correction/deletion.
 * A direct invoice dependency survives a changed customer or date.
 * Caller must provide a complete authorized snapshot of relevant active cases.
 */
export function selectInvoiceChangeImpact(changes: readonly InvoiceEvidenceChange[], cases: readonly InvoiceImpactCase[]): string[] {
  const sources = new Set<string>();
  const identities = changes.flatMap(change => [change.before, change.after].filter((x): x is InvoiceImpactIdentity => x !== null));
  const invoiceIds = new Set(identities.map(i => i.invoiceId).filter(Boolean));
  for (const c of cases) {
    if (!c.active || c.deleted || !c.sourceId) continue;
    if (c.selectedInvoiceId && invoiceIds.has(c.selectedInvoiceId)) {
      sources.add(c.sourceId);
      continue;
    }
    if (identities.some(i => sharesIdentity(c, i) && inWindow(c, i))) sources.add(c.sourceId);
  }
  return [...sources].sort();
}
