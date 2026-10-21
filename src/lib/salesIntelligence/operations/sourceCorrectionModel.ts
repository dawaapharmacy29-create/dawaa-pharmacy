// Source attribution correction — pure preview/validation model. It never writes. The database
// command dawaa_correct_whatsapp_source_attribution_v1 re-checks every rule; this model only lets a
// reviewer see the exact old vs new values before confirming.
//
// The corrected text is normalized exactly like ingestion (parse -> canonical segmentation ->
// serialize/hash of the single case session), so a later re-upload of the corrected file dedupes to
// the same source instead of creating a parallel one.
import { isNonTransactionBranchMarker, isOperatingBranch, normalizeBranchName } from '@/lib/branch';
import { extractIntroducedStaffName, parseWhatsAppExport, serializeWhatsAppSessionRawText } from '@/lib/whatsappConversationParser';
import { segmentWhatsAppExportCanonical } from '@/lib/whatsappCanonicalSegmentation';
import { hashWhatsAppSession } from '@/lib/whatsappReviewPersistenceV4';
import type { StaffDirectoryIdentity } from '@/lib/readModels/staffDirectoryReadModel';

export const SOURCE_CORRECTION_MIN_REASON_LENGTH = 10;

export interface StoredSourceAttribution {
  id: string;
  sourceFilename: string | null;
  sourceHash: string;
  rawText: string;
  staffId: string | null;
  staffName: string | null;
  branch: string | null;
  customerId: string | null;
  customerCode: string | null;
  customerName: string | null;
  conversationStartedAt: string | null;
  conversationEndedAt: string | null;
  messageCount: number | null;
  reviewStatus: string | null;
}

export interface SourceCorrectionDraft {
  rawText: string;
  staffId: string | null;
  branch: string;
  reason: string;
  /** Explicit, audited confirmation that a doctor from another home branch covered this branch. */
  crossBranchCover?: boolean;
}

export type CorrectionStaffCoverage = 'home_branch' | 'account_wide' | 'cross_branch';

export interface SourceCorrectionChange {
  field: 'staff' | 'branch' | 'text';
  label: string;
  before: string;
  after: string;
}

export interface SourceCorrectionLineChange {
  line: number;
  before: string;
  after: string;
}

export type SourceCorrectionPreview =
  | {
      ok: true;
      rawText: string;
      sourceHash: string;
      staffId: string;
      staffName: string;
      branch: string;
      reason: string;
      crossBranchCover: boolean;
      changes: SourceCorrectionChange[];
      changedLines: SourceCorrectionLineChange[];
    }
  | { ok: false; errors: string[] };

const display = (value: string | null | undefined) => (value && value.trim() ? value.trim() : 'غير محدد');

function sameInstant(left: string | null, right: Date) {
  if (!left) return false;
  const parsed = new Date(left);
  return Number.isFinite(parsed.getTime()) && parsed.getTime() === right.getTime();
}

function changedLines(before: string, after: string): SourceCorrectionLineChange[] {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  const rows: SourceCorrectionLineChange[] = [];
  for (let index = 0; index < Math.max(oldLines.length, newLines.length); index += 1) {
    const oldLine = oldLines[index] ?? '';
    const newLine = newLines[index] ?? '';
    if (oldLine !== newLine) rows.push({ line: index + 1, before: oldLine, after: newLine });
  }
  return rows;
}

/**
 * A source correction assigns ONE source-level staff ID. Multi-staff exports are
 * inherently case-scoped; assigning the whole file to one pharmacist would
 * attribute unrelated customer-service replies (and potentially their metrics)
 * to that pharmacist. Check both persisted and proposed text so a reviewer
 * cannot sidestep this guard by editing out a second introduction.
 *
 * This is a preview guard, NOT a substitute for the database command's checks.
 */
function hasMultipleExplicitStaffIntroductions(rawText: string): boolean {
  const names = new Set(
    parseWhatsAppExport(rawText)
      .map((message) => extractIntroducedStaffName(message))
      .filter((name): name is string => Boolean(name))
      .map((name) =>
        name
          .trim()
          .toLocaleLowerCase('ar')
          .replace(/^(?:(?:د|دكتور|الدكتور|دكتورة|الدكتورة)(?:\s*[/.-]\s*|\s+|$))+/u, '')
          .replace(/[أإآ]/g, 'ا')
          .replace(/ى/g, 'ي')
          .replace(/[\u064B-\u065F]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(Boolean)
  );
  return names.size > 1;
}

/** How a doctor relates to the operation branch: the home branch, account-wide scope, or cover. */
export function correctionStaffCoverage(staffBranch: string | null, branch: string): CorrectionStaffCoverage {
  if (isNonTransactionBranchMarker(staffBranch)) return 'account_wide';
  return normalizeBranchName(staffBranch) === normalizeBranchName(branch) ? 'home_branch' : 'cross_branch';
}

/**
 * Doctors the reviewer may pick: active canonical staff rows, never the customer. Home-branch and
 * account-wide doctors come first; a doctor from another home branch is offered as explicit cover.
 */
export function eligibleCorrectionStaff(
  directory: readonly StaffDirectoryIdentity[],
  branch: string,
  customerId: string | null
) {
  const rank: Record<CorrectionStaffCoverage, number> = { home_branch: 0, account_wide: 1, cross_branch: 2 };
  return directory
    .filter((row) => row.source === 'staff' && row.active && row.id && row.id !== customerId)
    .map((row) => ({ ...row, coverage: correctionStaffCoverage(row.branch, branch) }))
    .sort((a, b) => rank[a.coverage] - rank[b.coverage] || String(a.name).localeCompare(String(b.name), 'ar'));
}

export async function buildSourceCorrectionPreview(
  stored: StoredSourceAttribution,
  draft: SourceCorrectionDraft,
  directory: readonly StaffDirectoryIdentity[]
): Promise<SourceCorrectionPreview> {
  const errors: string[] = [];
  const branch = draft.branch.trim();
  const reason = draft.reason.trim();

  if (stored.reviewStatus === 'archived') errors.push('المصدر مؤرشف ولا يقبل التصحيح.');
  if (!isOperatingBranch(branch)) {
    errors.push('اختر فرع تشغيل معتمدًا (فرع شكري أو فرع الشامي)؛ «كل الفروع» و«غير محدد» والمخزن لا تصلح كفرع معاملة.');
  }
  if (reason.length < SOURCE_CORRECTION_MIN_REASON_LENGTH) {
    errors.push(`اكتب سبب التصحيح (${SOURCE_CORRECTION_MIN_REASON_LENGTH} أحرف على الأقل) ليُحفظ في سجل المراجعة.`);
  }

  const staff = draft.staffId
    ? eligibleCorrectionStaff(directory, branch, stored.customerId).find((row) => row.id === draft.staffId) ?? null
    : null;
  if (!staff) errors.push('اختر الدكتور المسؤول من دليل الموظفين النشطين.');
  const crossBranchCover = staff?.coverage === 'cross_branch';
  if (crossBranchCover && !draft.crossBranchCover) {
    errors.push('الدكتور المختار فرعه الأساسي مختلف؛ أكد صراحة أنه غطّى هذا الفرع في هذه العملية.');
  }

  // Reject a whole-source staff correction if either version identifies multiple
  // distinct outbound employees. The safe remedy is case-level attribution review.
  if (
    hasMultipleExplicitStaffIntroductions(stored.rawText) ||
    hasMultipleExplicitStaffIntroductions(draft.rawText)
  ) {
    errors.push(
      'هذه المحادثة تضم أكثر من موظف مُعرَّف برسائل صادرة. لا يجوز نسب الملف كله لدكتور واحد؛ راجع هوية المسؤول لكل حالة على حدة، مع بقاء تصحيح فرع المصدر قرارًا مستقلًا.'
    );
  }

  const messages = parseWhatsAppExport(draft.rawText);
  if (!messages.length) {
    errors.push('لم يتم التعرف على رسائل واتساب في النص المصحح.');
    return { ok: false, errors };
  }
  const contexts = segmentWhatsAppExportCanonical(messages, stored.sourceFilename || '').caseContexts.contexts;
  if (contexts.length !== 1) {
    errors.push('النص المصحح يُنتج أكثر من حالة؛ التصحيح يجب أن يحافظ على نفس المحادثة.');
    return { ok: false, errors };
  }
  const session = contexts[0].mergedSession;
  if (
    !sameInstant(stored.conversationStartedAt, session.startedAt) ||
    !sameInstant(stored.conversationEndedAt, session.endedAt) ||
    (stored.messageCount != null && stored.messageCount !== session.messages.length)
  ) {
    errors.push('التصحيح يجب أن يحافظ على نفس توقيتات الرسائل وعددها؛ هذا يبدو محادثة مختلفة.');
  }
  const rawText = serializeWhatsAppSessionRawText(session);
  const sourceHash = await hashWhatsAppSession(session);
  if (!/^[0-9a-f]{64}$/.test(sourceHash)) errors.push('تعذر حساب بصمة المحادثة بأمان في هذا المتصفح.');

  if (errors.length || !staff) return { ok: false, errors };

  const changes: SourceCorrectionChange[] = [];
  if (staff.id !== stored.staffId) {
    changes.push({
      field: 'staff',
      label: 'الدكتور المسؤول',
      before: display(stored.staffName),
      after: crossBranchCover ? `${display(staff.name)} (تغطية من ${display(staff.branch)})` : display(staff.name),
    });
  }
  if (branch !== (stored.branch ?? '').trim()) {
    changes.push({ field: 'branch', label: 'فرع المعاملة', before: display(stored.branch), after: branch });
  }
  const lines = changedLines(stored.rawText, rawText);
  if (lines.length) {
    changes.push({ field: 'text', label: 'نص المحادثة', before: 'النص المحفوظ', after: `${lines.length} سطر معدل` });
  }
  if (!changes.length) return { ok: false, errors: ['لا يوجد أي تغيير عن البيانات المحفوظة.'] };

  return {
    ok: true,
    rawText,
    sourceHash,
    staffId: String(staff.id),
    staffName: display(staff.name),
    branch,
    reason,
    crossBranchCover,
    changes,
    changedLines: lines,
  };
}

const OPERATION_ERRORS: Record<string, string> = {
  source_attribution_correction_permission_denied: 'لا تملك صلاحية اعتماد تصحيح المصدر.',
  source_attribution_access_denied: 'لا تملك صلاحية على فرع أو موظف هذا المصدر.',
  source_attribution_source_changed: 'تغير المصدر منذ فتح الشاشة؛ أعد التحميل وراجع البيانات من جديد.',
  source_attribution_has_human_confirmation: 'المصدر عليه تأكيد بشري أو فاتورة معتمدة؛ يحتاج معالجة يدوية.',
  source_attribution_has_executed_or_approved_work: 'يوجد إجراء معتمد أو منفذ أو قيد العمل على هذا المصدر؛ لا يتم تصحيحه تلقائيًا.',
  source_attribution_staff_branch_mismatch: 'الدكتور المختار من فرع آخر؛ يلزم تأكيد التغطية صراحة.',
  source_attribution_hash_mismatch: 'بصمة النص لا تطابق النص وتوقيتات المحادثة المحفوظة.',
  customer_request_action_staff_evidence_conflict: 'أدلة المحادثة تشير إلى دكتور مختلف؛ صحح المصدر أولًا.',
  customer_request_action_cross_branch_requires_confirmation: 'الدكتور من فرع آخر بدون تأكيد تغطية مسجل؛ صحح المصدر وأكد التغطية.',
  'permission denied for function': 'الأمر غير متاح حاليًا (متوقف مؤقتًا بقرار إداري أو بدون صلاحية).',
  source_attribution_staff_is_customer: 'لا يمكن اختيار العميل كدكتور مسؤول.',
  source_attribution_hash_conflict: 'هذا النص مطابق لمصدر محفوظ آخر؛ لن يتم إنشاء تكرار.',
  source_attribution_transaction_branch_required: 'فرع المعاملة يجب أن يكون فرعًا فعليًا.',
  source_attribution_correction_reason_required: 'سبب التصحيح مطلوب.',
  source_attribution_source_archived: 'المصدر مؤرشف.',
  source_attribution_requires_correction_command: 'تعديل بيانات المصدر المحفوظة يتم فقط من شاشة التصحيح المعتمدة.',
  active_staff_required: 'الدكتور المختار غير نشط.',
  customer_request_action_transaction_branch_required: 'لا يمكن اعتماد طلب في «كل الفروع» أو فرع غير محدد؛ صحح المصدر أولًا.',
  customer_request_requires_current_qualification: 'التحليل الحالي لم يعد يؤهل هذا الطلب؛ أعد التحليل أو راجع الحالة.',
  customer_request_action_staff_mismatch: 'الدكتور على الاقتراح لا يطابق الدكتور على المصدر.',
  customer_request_action_branch_mismatch: 'فرع الاقتراح لا يطابق فرع المصدر.',
  customer_request_action_canonical_identity_required: 'هوية العميل أو الصنف أو الدكتور غير محسومة.',
  customer_request_action_not_approvable: 'هذا الاقتراح ليس في حالة تسمح بالاعتماد.',
  customer_request_action_confidence_too_low: 'ثقة الاقتراح أقل من حد الاعتماد.',
  customer_request_requires_explicit_approval: 'الطلب يحتاج اعتمادًا صريحًا قبل التنفيذ.',
  whatsapp_action_transaction_branch_required: 'لا يمكن تنفيذ عمل في «كل الفروع» أو فرع غير محدد.',
  canonical_followup_requires_current_projection: 'المتابعة لم تعد مطابقة للتحليل الحالي؛ أعد التحليل.',
  not_authorized: 'لا تملك الصلاحية المطلوبة.',
};

/** Arabic message for a known command refusal; unknown errors stay visible verbatim. */
export function describeOperationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error ?? '');
  const code = Object.keys(OPERATION_ERRORS).find((key) => message.includes(key));
  return code ? `${OPERATION_ERRORS[code]} (${code})` : message || 'فشل غير معروف.';
}
