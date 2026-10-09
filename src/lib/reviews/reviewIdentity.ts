// Canonical identity rules for conversation reviews (contracts 1, 2, 3 and the points side of 14).
//
// Customer: `customer_id` is the authority when resolved. Name / code / phone are written only
//   together, from the SAME selected customer record; with no resolved customer the row keeps an
//   explicitly unresolved text snapshot and `customer_id` stays null (never guessed from a code).
// Staff: `staff_id` is the authority. Name / role are derived from the staff record of that id; a
//   review whose responsible staff did not change keeps its historical snapshot for audit.
// Branch: the review's `branch` is the conversation/source branch. It is set once when the review
//   is created and never rewritten from the responsible employee's home branch.

export interface ReviewCustomerFormFields {
  customerId: string;
  customerCode: string;
  customerName: string;
  customerPhone: string;
}

export interface ReviewCustomerRecord {
  id: string | null | undefined;
  code?: string | null;
  name?: string | null;
  phone?: string | null;
}

const clean = (value: unknown) => String(value ?? '').trim();

/** All four form fields from ONE customer record (missing values stay empty, never filled from elsewhere). */
export function reviewCustomerFieldsFromRecord(record: ReviewCustomerRecord): ReviewCustomerFormFields {
  const id = clean(record.id);
  if (!id) return clearedReviewCustomerFields();
  return {
    customerId: id,
    customerCode: clean(record.code),
    customerName: clean(record.name),
    customerPhone: clean(record.phone),
  };
}

export function clearedReviewCustomerFields(): ReviewCustomerFormFields {
  return { customerId: '', customerCode: '', customerName: '', customerPhone: '' };
}

/** A resolved customer locks name/code/phone: they can only change by choosing another customer. */
export function isReviewCustomerLocked(form: Pick<ReviewCustomerFormFields, 'customerId'>) {
  return Boolean(clean(form.customerId));
}

/** Review row customer columns. Without a resolved customer the id is null: a typed code is not an identity. */
export function reviewCustomerPayload(form: ReviewCustomerFormFields) {
  const id = clean(form.customerId);
  return {
    customer_id: id || null,
    customer_name: clean(form.customerName) || null,
    customer_code: clean(form.customerCode) || null,
    customer_phone: clean(form.customerPhone) || null,
  };
}

export interface ReviewStaffRecord {
  id: string;
  name?: string | null;
  role?: string | null;
  branch?: string | null;
}

export interface ReviewIdentityRow {
  staff_id?: string | null;
  doctor_id?: string | null;
  customer_id?: string | null;
  branch?: string | null;
}

export interface LegacyEditIdentityInput {
  staff_id: string;
  customer_name: string;
  customer_code: string;
  customer_phone: string;
}

export type LegacyEditIdentityPatch =
  | { ok: true; patch: Record<string, unknown>; staffChanged: boolean }
  | { ok: false; error: 'staff_required' | 'staff_not_found' };

/** The responsible staff id of a review row: staff_id, or the legacy doctor_id mirror when staff_id is empty. */
export function reviewResponsibleStaffId(row: ReviewIdentityRow | null | undefined) {
  return clean(row?.staff_id) || clean(row?.doctor_id);
}

/**
 * Identity columns an in-place (non-versioned) edit may write.
 * - Unchanged staff: nothing (the historical staff snapshot stays as recorded).
 * - Reassigned staff: id + name + role from the chosen staff record, together.
 * - Branch: never (source branch is immutable provenance).
 * - Customer: nothing when the row has a resolved customer_id; otherwise the unresolved text snapshot.
 */
export function legacyEditIdentityPatch(
  row: ReviewIdentityRow,
  input: LegacyEditIdentityInput,
  staffDirectory: readonly ReviewStaffRecord[]
): LegacyEditIdentityPatch {
  const previousStaffId = reviewResponsibleStaffId(row);
  const nextStaffId = clean(input.staff_id);
  const patch: Record<string, unknown> = {};
  let staffChanged = false;

  if (nextStaffId !== previousStaffId) {
    if (!nextStaffId) return { ok: false, error: 'staff_required' };
    const staff = staffDirectory.find((item) => clean(item.id) === nextStaffId);
    if (!staff) return { ok: false, error: 'staff_not_found' };
    staffChanged = true;
    patch.staff_id = nextStaffId;
    patch.doctor_id = nextStaffId;
    patch.staff_name = clean(staff.name) || null;
    patch.doctor_name = clean(staff.name) || null;
    patch.staff_role = clean(staff.role) || null;
  }

  if (!clean(row.customer_id)) {
    patch.customer_name = clean(input.customer_name) || null;
    patch.customer_code = clean(input.customer_code) || null;
    patch.customer_phone = clean(input.customer_phone) || null;
  }

  return { ok: true, patch, staffChanged };
}

/**
 * Source branch of a NEW review. The conversation's own branch wins (Smart transfer branch, then the
 * branch the reviewer explicitly reviews for); the staff's home branch is only the last default for a
 * manual review with no other conversation context.
 */
export function newReviewSourceBranch(args: {
  conversationBranch?: string | null;
  reviewerBranch?: string | null;
  staffHomeBranch?: string | null;
}) {
  return clean(args.conversationBranch) || clean(args.reviewerBranch) || clean(args.staffHomeBranch) || '';
}

export interface ReviewPointsKey {
  staffId: string;
  monthCycle: string;
}

export interface ReviewPointsWrite extends ReviewPointsKey {
  points: number;
}

/**
 * Absolute (convergent) points writes for an in-place edit, keyed exactly like the original
 * record_conversation_review_points_v1 row: (staff, month_cycle, 'conversation_evaluation', review_id).
 * The DB upserts on that key (employee_transactions_semantic_event_once_v3), so a retry, a double click
 * or two overlapping saves converge to: current staff = current impact, previous staff = 0.
 */
export function reviewPointsConvergencePlan(
  previous: ReviewPointsKey & { impact: number },
  next: ReviewPointsKey & { impact: number }
): ReviewPointsWrite[] {
  const writes: ReviewPointsWrite[] = [];
  const prevStaff = clean(previous.staffId);
  const nextStaff = clean(next.staffId);
  const keyChanged = prevStaff !== nextStaff || clean(previous.monthCycle) !== clean(next.monthCycle);
  if (keyChanged && prevStaff && previous.impact !== 0) {
    writes.push({ staffId: prevStaff, monthCycle: clean(previous.monthCycle), points: 0 });
  }
  if (nextStaff && (next.impact !== 0 || (!keyChanged && previous.impact !== 0))) {
    writes.push({ staffId: nextStaff, monthCycle: clean(next.monthCycle), points: next.impact });
  }
  return writes;
}

/** PostgREST `or` filter: rows attributed to this staff id (doctor_id only counts when staff_id is empty). */
export function staffAttributionOrFilter(staffId: string) {
  const id = clean(staffId);
  return `staff_id.eq.${id},and(staff_id.is.null,doctor_id.eq.${id})`;
}

/**
 * Deterministic UUID for one logical action (e.g. the coaching note of review R). Used as the row's
 * primary key so a retry or a concurrent duplicate hits the PK instead of inserting a second row.
 */
export async function deterministicActionUuid(...parts: string[]): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.map(clean).join('|')))
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5 layout (name-based)
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A canonical customer lookup key for a review: a UUID is a customers.id, anything else a customer code. */
export function reviewCustomerLookup(customerId: string | null | undefined) {
  const id = clean(customerId);
  if (!id) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? ({ column: 'id', value: id } as const)
    : ({ column: 'customer_code', value: id } as const);
}
