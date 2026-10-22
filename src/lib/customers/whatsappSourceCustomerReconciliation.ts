// Links WhatsApp review sources saved before their customer existed in `customers`.
//
// Runs after a customer is created or imported. It only FILLS an empty source customer_id (the
// source attribution guard allows exactly that; replacing a stored customer still requires the
// audited correction command). The decision is the canonical customer identity resolver's, so a
// duplicated code, an unresolved alias or a conflicting contact phone stays for human review.
// Case rows are written only by the canonical Sales Intelligence refresh; a linked source is
// therefore marked as needing an explicit single-source re-analysis, never re-analysed here.
import { normalizeDawaaCustomerCode, normalizeEgyptianCustomerPhone, isValidEgyptianCustomerMobile } from './customerIdentity';
import { resolveCanonicalCustomerIdentities } from './canonicalCustomerIdentityResolver';
import { appendWhatsAppReviewAudit } from '@/lib/whatsappReviewPersistenceV4';

export const SOURCE_CUSTOMER_RECONCILIATION_ACTION = 'customer_identity_reconciled_v1';
/** Bounded per run; a code shared by more unlinked sources is finished by a later run. */
export const SOURCE_CUSTOMER_RECONCILIATION_LIMIT = 200;

export type SourceCustomerReconciliationStatus =
  | 'linked'
  | 'skipped_already_linked'
  | 'skipped_unresolved'
  | 'skipped_ambiguous'
  | 'skipped_contradicted'
  | 'failed';

export interface SourceCustomerReconciliationOutcome {
  sourceId: string;
  sourceCode: string | null;
  normalizedCode: string | null;
  status: SourceCustomerReconciliationStatus;
  customerId: string | null;
  reason: string;
}

export interface ReconciliationActor {
  id?: string | null;
  name?: string | null;
  role?: string | null;
}

type SourceRow = {
  id: string;
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
};

function uniq(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)));
}

export async function reconcileWhatsAppSourceCustomers(
  client: any,
  rawCodes: Array<string | null | undefined>,
  actor: ReconciliationActor = {}
): Promise<SourceCustomerReconciliationOutcome[]> {
  const codes = uniq(rawCodes.map((code) => normalizeDawaaCustomerCode(code)));
  if (!codes.length) return [];

  // Stored source codes may keep their original spelling; query both and re-check after normalising.
  const lookup = uniq([...codes, ...rawCodes.map((code) => String(code ?? '').trim())]);
  const { data, error } = await client
    .from('whatsapp_review_sources')
    .select('id,customer_id,customer_code,customer_name,customer_phone')
    .is('customer_id', null)
    .in('customer_code', lookup)
    .limit(SOURCE_CUSTOMER_RECONCILIATION_LIMIT);
  if (error) throw error;
  const rows = ((data ?? []) as SourceRow[]).filter(
    (row) => !row.customer_id && codes.includes(normalizeDawaaCustomerCode(row.customer_code))
  );
  if (!rows.length) return [];

  const identities = await resolveCanonicalCustomerIdentities(
    client,
    rows.map((row) => {
      const phone = normalizeEgyptianCustomerPhone(row.customer_phone ?? '');
      return {
        customerCodes: [String(row.customer_code ?? '')],
        contactPhones: isValidEgyptianCustomerMobile(phone) ? [phone] : [],
        mentionedPhones: [],
        displayName: row.customer_name,
      };
    })
  );

  const outcomes: SourceCustomerReconciliationOutcome[] = [];
  for (const [index, row] of rows.entries()) {
    const identity = identities[index];
    const normalizedCode = normalizeDawaaCustomerCode(row.customer_code) || null;
    const base = { sourceId: String(row.id), sourceCode: row.customer_code, normalizedCode };
    if (identity.status !== 'resolved' || !identity.customerId) {
      outcomes.push({ ...base, status: `skipped_${identity.status === 'resolved' ? 'unresolved' : identity.status}` as SourceCustomerReconciliationStatus, customerId: null, reason: identity.reason });
      continue;
    }
    // Compare-and-set: a concurrent run or a human link since the read wins; nothing is replaced.
    const { data: changed, error: updateError } = await client
      .from('whatsapp_review_sources')
      .update({ customer_id: identity.customerId })
      .eq('id', row.id)
      .is('customer_id', null)
      .select('id')
      .maybeSingle();
    if (updateError) {
      outcomes.push({ ...base, status: 'failed', customerId: null, reason: String(updateError.message ?? updateError) });
      continue;
    }
    if (!changed) {
      outcomes.push({ ...base, status: 'skipped_already_linked', customerId: null, reason: 'source_linked_concurrently' });
      continue;
    }
    try {
      await appendWhatsAppReviewAudit(
        String(row.id),
        SOURCE_CUSTOMER_RECONCILIATION_ACTION,
        { customer_id: null, customer_code: row.customer_code },
        {
          customer_id: identity.customerId,
          customer_code: identity.customerCode,
          source_code: row.customer_code,
          normalized_code: normalizedCode,
          resolved_by: identity.resolvedBy,
          reason: identity.reason,
          case_reanalysis_required: true,
        },
        actor.id ?? null,
        actor.name ?? 'ربط العملاء الآلي',
        actor.role ?? null,
        'تم ربط العميل بالمصدر بعد إضافته لسجل العملاء بكود مطابق وحيد. الحالات تتحدث عند إعادة تحليل هذا المصدر صراحةً.',
        client
      );
      outcomes.push({ ...base, status: 'linked', customerId: identity.customerId, reason: identity.reason });
    } catch (auditError) {
      outcomes.push({
        ...base,
        status: 'failed',
        customerId: identity.customerId,
        reason: `linked_without_audit:${auditError instanceof Error ? auditError.message : String(auditError)}`,
      });
    }
  }
  return outcomes;
}

/** Short Arabic summary for import screens. */
export function describeSourceCustomerReconciliation(outcomes: SourceCustomerReconciliationOutcome[]): string | null {
  if (!outcomes.length) return null;
  const linked = outcomes.filter((row) => row.status === 'linked').length;
  const review = outcomes.filter((row) => row.status === 'skipped_ambiguous' || row.status === 'skipped_contradicted').length;
  const failed = outcomes.filter((row) => row.status === 'failed').length;
  const parts = [];
  if (linked) parts.push(`تم ربط ${linked.toLocaleString('ar-EG')} محادثة واتساب سابقة بالعملاء الجدد`);
  if (review) parts.push(`${review.toLocaleString('ar-EG')} محادثة تحتاج مراجعة هوية (كود مكرر أو تعارض)`);
  if (failed) parts.push(`تعذر ربط ${failed.toLocaleString('ar-EG')} محادثة وسيُعاد المحاولة لاحقًا`);
  return parts.length ? `${parts.join('، ')}.` : null;
}
