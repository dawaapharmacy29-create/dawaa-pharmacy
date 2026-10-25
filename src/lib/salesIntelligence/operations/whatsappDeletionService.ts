// General-manager soft delete of one WhatsApp case or of a whole conversation (with all its cases),
// and restore from the trash. The database decides everything: authorization (active general
// manager on the strict staff session), the impact, blockers (proof, revenue, points, human or
// executed work), atomicity, audit and idempotency. This module only calls those RPCs, never
// writes tables, and never treats a response without the expected success shape as success.

export type WhatsAppDeletionScope = 'case' | 'conversation';

/** Typed by the general manager; the database refuses anything else for that scope. */
export const DELETION_CONFIRMATION_PHRASES: Record<WhatsAppDeletionScope, string> = {
  case: 'حذف الحالة',
  conversation: 'حذف المحادثة وكل حالاتها',
};
export const RESTORE_CONFIRMATION_PHRASE = 'استرجاع';
export const DELETION_REASON_MIN_LENGTH = 10;
export const DELETION_TRASH_PAGE_SIZE = 50;

export const DELETION_SCOPE_TITLES: Record<WhatsAppDeletionScope, string> = {
  case: 'حذف هذه الحالة فقط',
  conversation: 'حذف المحادثة كاملةً مع كل حالاتها',
};

export const DELETION_SCOPE_DESCRIPTIONS: Record<WhatsAppDeletionScope, string> = {
  case: 'تُحذف هذه الحالة وحدها حذفًا منطقيًا. تبقى المحادثة وبقية حالاتها كما هي.',
  conversation: 'تُحذف المحادثة وكل الحالات التابعة لها حذفًا منطقيًا، وتخرج كلها من قوائم العمل والتقييمات النشطة.',
};

/** Never deleted or changed by a case/conversation deletion. */
export const DELETION_UNTOUCHED_RECORDS = [
  'العميل',
  'الفاتورة وبنودها',
  'الإثبات المالي وإيراد الحالة',
  'نقاط وحوافز الموظفين',
  'سجل التدقيق',
] as const;

export const DELETION_BLOCKER_LABELS: Record<string, string> = {
  canonical_sale_proof_in_scope: 'يوجد إثبات بيع مثبت تملكه حالة داخل نطاق الحذف',
  canonical_sale_proof_owner_unknown: 'يوجد إثبات بيع مثبت غير معروف الحالة المالكة؛ يحتاج مراجعة',
  verified_revenue_in_scope: 'يوجد إيراد أو فاتورة موثقة داخل نطاق الحذف',
  proven_invoice_attribution: 'الحالة مرتبطة بفاتورة مثبتة أو معتمدة لتقييم الموظف',
  canonical_sale_proven: 'نتيجة الحالة الحالية بيع مثبت',
  evaluation_has_points_or_incentive: 'يوجد تقييم له نقاط أو حركة في سجل النقاط والحوافز',
  human_evaluation_in_scope: 'يوجد تقييم بشري أو مراجعة مدير داخل النطاق',
  action_has_recovered_invoice: 'يوجد إجراء مغلق بفاتورة استرداد',
  action_has_human_or_executed_work: 'يوجد إجراء تم تنفيذه أو عمل عليه موظف',
  conversation_has_invoice_link: 'المحادثة مرتبطة بفاتورة',
  conversation_has_human_confirmation: 'المحادثة عليها تأكيد أو تقييم رسمي من مراجع',
  case_invoice_linked_to_conversation: 'فاتورة الحالة هي الفاتورة المرتبطة بالمحادثة',
  restore_would_supersede_conversation_evaluation: 'الاسترجاع سيُلغي تقييمًا أحدث للمحادثة؛ يحتاج مراجعة يدوية',
};

const ERROR_LABELS: Record<string, string> = {
  whatsapp_deletion_general_manager_required: 'هذا الإجراء متاح للمدير العام فقط.',
  whatsapp_deletion_reason_required: `اكتب سببًا واضحًا للحذف (${DELETION_REASON_MIN_LENGTH} أحرف على الأقل).`,
  whatsapp_restore_reason_required: `اكتب سببًا واضحًا للاسترجاع (${DELETION_REASON_MIN_LENGTH} أحرف على الأقل).`,
  whatsapp_case_deletion_confirmation_required: `اكتب عبارة التأكيد «${DELETION_CONFIRMATION_PHRASES.case}» كما هي.`,
  whatsapp_conversation_deletion_confirmation_required: `اكتب عبارة التأكيد «${DELETION_CONFIRMATION_PHRASES.conversation}» كما هي.`,
  whatsapp_restore_confirmation_required: `اكتب عبارة التأكيد «${RESTORE_CONFIRMATION_PHRASE}» كما هي.`,
  whatsapp_deletion_preview_stale: 'تغيّرت بيانات المحادثة منذ المعاينة. أعد المعاينة قبل الحذف.',
  whatsapp_deletion_request_key_conflict: 'تعارض في رقم الطلب. أغلق النافذة وافتحها من جديد.',
  whatsapp_deletion_request_key_invalid: 'رقم الطلب غير صالح. أغلق النافذة وافتحها من جديد.',
  whatsapp_conversation_already_deleted: 'المحادثة محذوفة بالفعل.',
  whatsapp_restore_conversation_first: 'استرجع المحادثة أولًا ثم استرجع الحالة.',
  whatsapp_case_not_found: 'الحالة غير موجودة.',
  whatsapp_source_not_found: 'المحادثة غير موجودة.',
  whatsapp_deletion_not_found: 'سجل الحذف غير موجود.',
  whatsapp_deletion_scope_invalid: 'نطاق الحذف غير صالح.',
  whatsapp_candidate_reason_required: 'اكتب سبب تصحيح ربط الفاتورة (10 أحرف على الأقل).',
  whatsapp_candidate_confirmation_required: 'للتأكيد اكتب «تصحيح ربط الفاتورة» كما هي.',
  whatsapp_candidate_request_key_invalid: 'مُعرّف عملية التصحيح غير صالح.',
  whatsapp_candidate_request_key_conflict: 'هذا الطلب مرتبط بمحادثة أخرى.',
  whatsapp_candidate_confirmed_link_requires_financial_review: 'هذا الارتباط معتمد بالفعل ويحتاج مصالحة مالية موثقة.',
  whatsapp_candidate_changed_since_preview: 'تغيّر مرشح الفاتورة؛ أعد المعاينة.',
  whatsapp_candidate_other_protected_work: 'توجد أدلة مالية أو مراجعات معتمدة أخرى؛ لا يمكن فصل المرشح آليًا.',
  whatsapp_candidate_case_attribution_requires_review: 'توجد نسبة فاتورة على مستوى الحالة؛ يلزم تدقيق مستقل.',
  whatsapp_gm_change_invalid_operation: 'نوع التصحيح المطلوب غير صالح.',
  whatsapp_gm_change_reason_required: 'يلزم سبب تفصيلي لا يقل عن 10 أحرف.',
  whatsapp_gm_change_invalid_request_key: 'مُعرّف عملية التصحيح غير صالح.',
  whatsapp_gm_change_request_key_conflict: 'رقم الطلب مستخدم لتصحيح آخر.',
  whatsapp_gm_change_invalid_payload: 'تفاصيل التعديل غير صالحة.',
  whatsapp_gm_change_preview_stale: 'تغيّر الأثر منذ المعاينة؛ أعد المعاينة قبل التأكيد.',
  whatsapp_gm_change_not_found: 'طلب التصحيح غير موجود.',
  whatsapp_gm_change_confirmation_required: 'للتأكيد اكتب «أؤكد التصحيح المعتمد» كما هي.',
  whatsapp_gm_change_already_confirmed: 'تم تأكيد التصحيح مسبقًا بمُعرّف مختلف.',
  whatsapp_gm_change_not_pending: 'هذا الطلب لم يعد معلقًا للتأكيد.',
};

export function deletionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as any)?.message ?? error ?? '');
  const code = Object.keys(ERROR_LABELS).find((key) => message.includes(key));
  return code ? ERROR_LABELS[code] : message || 'تعذر تنفيذ الطلب.';
}

export function deletionBlockerLabel(code: string): string {
  return DELETION_BLOCKER_LABELS[code] ?? code;
}

/** One key per opened dialog: a retry or double click replays the same request. */
export function newDeletionRequestKey(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `del-${random}`;
}

/** Only removes an unconfirmed automatic candidate. Never edits an invoice or a proven attribution. */
export async function clearUnconfirmedWhatsAppInvoiceCandidate(
  client: Client,
  input: { sourceId: string; expectedId: string; expectedNumber: string; reason: string; requestKey: string }
): Promise<{ auditId: string; status: 'corrected' | 'replayed' | 'already_clear' }> {
  const data = await call(client, 'dawaa_clear_whatsapp_unconfirmed_invoice_candidate_v1', {
    p_source_id: input.sourceId,
    p_expected_candidate_id: input.expectedId,
    p_expected_invoice_number: input.expectedNumber,
    p_reason: input.reason,
    p_confirmation: 'تصحيح ربط الفاتورة',
    p_request_key: input.requestKey,
  });
  if (data.ok !== true || !['corrected', 'replayed', 'already_clear'].includes(data.status)) {
    throw new Error('لم يؤكد الخادم تصحيح المرشح.');
  }
  if (data.status !== 'already_clear' && !data.auditId) throw new Error('لم يرجع الخادم سجل تدقيق التصحيح.');
  return { auditId: String(data.auditId ?? ''), status: data.status };
}

/** First approval: stores immutable impact and intent. Does not delete/edit approved evidence. */
export async function requestProtectedWhatsAppChange(client: Client, input: {
  scope: WhatsAppDeletionScope; sourceId: string; caseId?: string | null;
  expectedFingerprint: string; reason: string; requestKey: string;
}): Promise<{ requestId: string; status: 'pending_confirmation'; replayed: boolean }> {
  const data = await call(client, 'dawaa_request_whatsapp_gm_change_v1', {
    p_operation: input.scope === 'case' ? 'delete_case' : 'delete_conversation',
    p_source_id: input.sourceId,
    p_case_id: input.scope === 'case' ? input.caseId : null,
    p_proposed_values: {},
    p_reason: input.reason,
    p_expected_fingerprint: input.expectedFingerprint,
    p_request_key: input.requestKey,
  });
  if (data.ok !== true || data.status !== 'pending_confirmation' || !data.requestId) {
    throw new Error('لم يؤكد الخادم تسجيل طلب التصحيح المعتمد.');
  }
  return { requestId: String(data.requestId), status: data.status, replayed: data.replayed === true };
}

/** Second explicit confirmation. Still pending reconciliation: never a financial execution. */
export async function confirmProtectedWhatsAppChange(client: Client, input: {
  requestId: string; reason: string; confirmation: string; requestKey: string;
}): Promise<{ requestId: string; status: 'approved_pending_reconciliation'; applied: false }> {
  const data = await call(client, 'dawaa_confirm_whatsapp_gm_change_v1', {
    p_request_id: input.requestId,
    p_confirmation: input.confirmation,
    p_reason: input.reason,
    p_request_key: input.requestKey,
  });
  if (data.ok !== true || data.status !== 'approved_pending_reconciliation' || data.applied !== false
      || data.settlementRequired !== true || !data.requestId) {
    throw new Error('لم يؤكد الخادم تسجيل الموافقة المعلقة للتسوية.');
  }
  return { requestId: String(data.requestId), status: data.status, applied: false };
}

export interface ProtectedWhatsAppChangeRow {
  id: string;
  sourceId: string;
  caseId: string | null;
  operation: 'delete_case' | 'delete_conversation' | 'edit_case' | 'edit_conversation';
  status: 'pending_confirmation' | 'approved_pending_reconciliation' | 'cancelled' | 'applied';
  reason: string;
  requestedBy: string | null;
  requestedAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  caseCount: number;
  blockerCount: number;
  customerName: string | null;
  customerCode: string | null;
}

export async function listProtectedWhatsAppChanges(client: Client): Promise<ProtectedWhatsAppChangeRow[]> {
  const { data, error } = await client.rpc('dawaa_list_whatsapp_gm_changes_v1', { p_limit: 100 });
  if (error) throw new Error(deletionErrorMessage(error));
  if (!Array.isArray(data)) throw new Error('استجابة غير متوقعة من سجل طلبات التصحيح.');
  return data as ProtectedWhatsAppChangeRow[];
}

export interface DeletionBlocker {
  code: string;
  ref: string | null;
  invoiceNumber?: string | null;
  revenue?: number | null;
}

export interface DeletionPreview {
  status: 'preview' | 'already_deleted' | 'conversation_deleted';
  scope: WhatsAppDeletionScope;
  sourceId: string;
  caseIds: string[];
  fingerprint: string;
  blocked: boolean;
  blockers: DeletionBlocker[];
  deletionId: string | null;
  conversation: Record<string, any> | null;
  cases: Record<string, any>[];
  remainingCases: Record<string, any>[];
  evaluations: Record<string, any>[];
  actions: Record<string, any>[];
  unscopedActionsUnchanged: number;
  attributions: Record<string, any>[];
  v22Envelopes: Record<string, any>[];
}

type Client = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> };
const list = (value: unknown) => (Array.isArray(value) ? value : []);

async function call(client: Client, fn: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(deletionErrorMessage(error));
  if (!data || typeof data !== 'object') throw new Error('استجابة غير متوقعة من الخادم.');
  return data as Record<string, any>;
}

export async function previewWhatsAppDeletion(
  client: Client,
  scope: WhatsAppDeletionScope,
  target: string
): Promise<DeletionPreview> {
  const data = await call(client, 'dawaa_preview_whatsapp_deletion_v1', { p_scope: scope, p_target: target });
  if (data.ok !== true) throw new Error('تعذرت معاينة الحذف.');
  return {
    status: data.status,
    scope,
    sourceId: String(data.sourceId ?? ''),
    caseIds: list(data.caseIds).map(String),
    fingerprint: String(data.fingerprint ?? ''),
    blocked: data.status === 'preview' ? data.blocked !== false : true,
    blockers: list(data.blockers),
    deletionId: data.deletionId ?? null,
    conversation: data.conversation ?? null,
    cases: list(data.cases),
    remainingCases: list(data.remainingCases),
    evaluations: list(data.evaluations),
    actions: list(data.actions),
    unscopedActionsUnchanged: Number(data.unscopedActionsUnchanged ?? 0),
    attributions: list(data.attributions),
    v22Envelopes: list(data.v22Envelopes),
  };
}

export type DeletionCommandResult =
  | { kind: 'deleted' | 'replayed' | 'already_deleted'; deletionId: string; changed: boolean }
  | { kind: 'blocked'; blockers: DeletionBlocker[] };

export async function deleteWhatsAppScope(
  client: Client,
  input: {
    scope: WhatsAppDeletionScope;
    target: string;
    reason: string;
    confirmation: string;
    fingerprint: string;
    requestKey: string;
  }
): Promise<DeletionCommandResult> {
  const common = {
    p_reason: input.reason,
    p_confirmation: input.confirmation,
    p_expected_fingerprint: input.fingerprint,
    p_request_key: input.requestKey,
  };
  const data = input.scope === 'case'
    ? await call(client, 'dawaa_delete_whatsapp_case_v1', { p_case_id: input.target, ...common })
    : await call(client, 'dawaa_delete_whatsapp_conversation_v1', { p_source_id: input.target, ...common });
  if (data.ok === false && data.status === 'blocked') return { kind: 'blocked', blockers: list(data.blockers) };
  if (data.ok !== true || !data.deletionId || !['deleted', 'replayed', 'already_deleted'].includes(data.status)) {
    throw new Error('لم يؤكد الخادم تنفيذ الحذف.');
  }
  return { kind: data.status, deletionId: String(data.deletionId), changed: data.changed === true };
}

export type RestoreCommandResult =
  | { kind: 'restored' | 'replayed' | 'already_restored'; deletionId: string; skippedEvaluationIds: string[]; skippedActionIds: string[] }
  | { kind: 'blocked'; blockers: DeletionBlocker[] };

export async function restoreWhatsAppDeletion(
  client: Client,
  input: { deletionId: string; reason: string; confirmation: string; requestKey: string }
): Promise<RestoreCommandResult> {
  const data = await call(client, 'dawaa_restore_whatsapp_deletion_v1', {
    p_deletion_id: input.deletionId,
    p_reason: input.reason,
    p_confirmation: input.confirmation,
    p_request_key: input.requestKey,
  });
  if (data.ok === false && data.status === 'blocked') return { kind: 'blocked', blockers: list(data.blockers) };
  if (data.ok !== true || !['restored', 'replayed', 'already_restored'].includes(data.status)) {
    throw new Error('لم يؤكد الخادم تنفيذ الاسترجاع.');
  }
  return {
    kind: data.status,
    deletionId: String(data.deletionId),
    skippedEvaluationIds: list(data.skippedEvaluationIds).map(String),
    skippedActionIds: list(data.skippedActionIds).map(String),
  };
}

export interface DeletionTrashRow {
  id: string;
  scope: WhatsAppDeletionScope;
  status: 'deleted' | 'restored';
  sourceId: string;
  caseIds: string[];
  reason: string;
  deletedBy: string | null;
  deletedAt: string;
  restoredBy: string | null;
  restoredAt: string | null;
  restoreReason: string | null;
  customerName: string | null;
  customerCode: string | null;
  branch: string | null;
  staffName: string | null;
  conversationStartedAt: string | null;
  evaluations: number;
  actions: number;
  restorable: boolean;
}

export async function listWhatsAppDeletions(
  client: Client,
  input: { status?: 'deleted' | 'restored' | 'all'; before?: string | null } = {}
): Promise<DeletionTrashRow[]> {
  const { data, error } = await client.rpc('dawaa_list_whatsapp_deletions_v1', {
    p_status: input.status ?? 'deleted',
    p_limit: DELETION_TRASH_PAGE_SIZE,
    p_before: input.before ?? null,
  });
  if (error) throw new Error(deletionErrorMessage(error));
  if (!Array.isArray(data)) throw new Error('استجابة غير متوقعة من الخادم.');
  return data.map((row: any) => ({
    ...row,
    caseIds: list(row.caseIds).map(String),
    evaluations: Number(row.evaluations ?? 0),
    actions: Number(row.actions ?? 0),
    restorable: row.restorable === true,
  }));
}

/** Client mirror of the database check, only to enable the submit button. */
export function canSubmitDeletion(input: {
  scope: WhatsAppDeletionScope;
  preview: Pick<DeletionPreview, 'status' | 'blocked' | 'fingerprint'> | null;
  reason: string;
  confirmation: string;
  submitting: boolean;
}): boolean {
  return Boolean(
    !input.submitting &&
      input.preview &&
      input.preview.status === 'preview' &&
      !input.preview.blocked &&
      input.preview.fingerprint &&
      input.reason.trim().length >= DELETION_REASON_MIN_LENGTH &&
      input.confirmation.trim() === DELETION_CONFIRMATION_PHRASES[input.scope]
  );
}

export interface DeletionPreviewSummary {
  title: string;
  description: string;
  lines: string[];
}

const count = (value: number) => value.toLocaleString('ar-EG');

/** Arabic scope summary shown before confirmation. */
export function summarizeDeletionPreview(preview: DeletionPreview): DeletionPreviewSummary {
  const conversation = preview.conversation ?? {};
  const deactivated = preview.evaluations.filter((row) => row.effect === 'deactivate').length;
  const withdrawn = preview.actions.filter((row) => row.effect === 'withdraw').length;
  const invoices = Array.from(
    new Set(
      [
        ...preview.attributions.map((row) => row.invoiceNumber),
        ...preview.v22Envelopes.map((row) => row.verifiedInvoiceNumber),
        conversation.matchedInvoiceNumber,
        conversation.invoiceLinkConfirmedInvoiceNumber,
      ].filter((value): value is string => Boolean(value))
    )
  );
  const proofs = preview.v22Envelopes.filter((row) => row.proofState === 'proven').length;
  const lines = [
    `المحادثة: ${conversation.customerName || 'عميل غير مسمى'}${conversation.customerCode ? ` (${conversation.customerCode})` : ''} — ${conversation.branch || 'بدون فرع'}`,
    `الحالات التي ستُحذف: ${count(preview.cases.length)}`,
    preview.scope === 'case'
      ? `الحالات التي ستبقى في المحادثة: ${count(preview.remainingCases.filter((row) => !row.deleted).length)}`
      : 'لن تبقى أي حالة نشطة في هذه المحادثة.',
    `تقييمات تلقائية ستخرج من التقييم النشط: ${count(deactivated)} من ${count(preview.evaluations.length)}`,
    `إجراءات مقترحة ستُسحب من قوائم العمل: ${count(withdrawn)} من ${count(preview.actions.length)}`,
    ...(preview.scope === 'case' && preview.unscopedActionsUnchanged
      ? [`إجراءات قديمة على مستوى المحادثة لن تتغير: ${count(preview.unscopedActionsUnchanged)}`]
      : []),
    `فواتير مرتبطة: ${invoices.length ? invoices.join('، ') : 'لا يوجد'}`,
    `إثباتات بيع مثبتة مرتبطة: ${count(proofs)}`,
  ];
  return {
    title: DELETION_SCOPE_TITLES[preview.scope],
    description: DELETION_SCOPE_DESCRIPTIONS[preview.scope],
    lines,
  };
}
