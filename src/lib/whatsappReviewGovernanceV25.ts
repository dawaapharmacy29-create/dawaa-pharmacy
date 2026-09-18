export type WhatsAppGovernanceDisposition = 'mandatory_human' | 'human_sample' | 'auto_review_candidate';

export type WhatsAppGovernanceRow = {
  id: string;
  branch?: string | null;
  customer_name?: string | null;
  customer_code?: string | null;
  customer_phone?: string | null;
  staff_name?: string | null;
  review_status?: string | null;
  priority?: string | null;
  analysis_confidence?: number | null;
  service_score?: number | null;
  commercial_eligible?: boolean | null;
  invoice_match_status?: string | null;
  followup_required?: boolean | null;
  analysis_json?: any;
  created_at?: string | null;
};

export type WhatsAppGovernanceDecision = {
  sourceId: string;
  disposition: WhatsAppGovernanceDisposition;
  priorityScore: number;
  confidence: number;
  reasonCodes: string[];
  reasonLabels: string[];
  unresolvedCriteria: number;
  missingMedia: number;
  customerResolved: boolean;
  invoiceSafe: boolean;
  sampleBucket: number;
};

const REASON_LABELS: Record<string, string> = {
  urgent_priority: 'أولوية عاجلة',
  needs_context: 'المحادثة تحتاج بيانات إضافية',
  detailed_review: 'مراجعة تفصيلية مطلوبة',
  low_confidence: 'ثقة التحليل أقل من الحد الآمن',
  unresolved_customer: 'هوية العميل غير محسومة',
  invoice_review: 'ربط الفاتورة يحتاج مراجعة',
  unresolved_criteria: 'بنود تقييم تحتاج قرارًا بشريًا',
  complaint: 'شكوى أو تصعيد',
  medical_safety: 'إشارة أمان طبي',
  missing_media: 'ميديا غير مفهومة أو مفقودة',
  followup_required: 'متابعة العميل مطلوبة',
};

function n(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bool(value: unknown) {
  return value === true || value === 'true' || value === 1;
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function arr(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function stableBucket(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 100;
}

function reviewRequiredCount(model: Record<string, any>) {
  const official = object(model.officialReview || model.officialReviewSuggestion || model.reviewSuggestion || model.official_review);
  const explicit = n(official.reviewRequiredCount ?? model.reviewRequiredCount ?? model.review_required_count);
  if (explicit > 0) return explicit;
  const items = arr(official.items || model.reviewItems || model.review_items);
  return items.filter((item) => String(item?.status || '').toLowerCase() === 'review_required').length;
}

function missingMediaCount(model: Record<string, any>) {
  const media = object(model.mediaCoverage || model.media || model.media_context);
  return n(
    model.missingMediaCount ??
    model.missing_media_count ??
    media.missingCount ??
    media.missing_media_count ??
    media.unresolvedCount
  );
}

function hasComplaint(model: Record<string, any>) {
  const signals = object(model.signals || model.deterministicSignals);
  return bool(
    model.complaintOrEscalationDetected ??
    model.complaint_or_escalation_detected ??
    signals.complaintOrEscalationDetected ??
    signals.complaint
  );
}

function hasMedicalSafetyFlag(model: Record<string, any>) {
  return arr(model.medicalSafetyFlags || model.medical_safety_flags || model.safetyFlags).length > 0;
}

function customerIsResolved(row: WhatsAppGovernanceRow, model: Record<string, any>) {
  const resolver = object(model.customerResolution || model.customer_resolution || model.resolvedCustomer);
  const strategy = String(resolver.strategy || '').toLowerCase();
  if (['phone_exact', 'code_exact', 'name_exact_branch', 'name_exact'].includes(strategy)) return true;
  if (strategy === 'ambiguous' || strategy === 'none') return false;
  return Boolean(String(row.customer_code || '').trim() || String(row.customer_phone || '').trim());
}

function invoiceIsSafe(row: WhatsAppGovernanceRow) {
  if (!row.commercial_eligible) return true;
  const status = String(row.invoice_match_status || 'pending').toLowerCase();
  return ['verified', 'not_applicable'].includes(status);
}

export function evaluateWhatsAppGovernance(
  row: WhatsAppGovernanceRow,
  options: { autoConfidence?: number; samplePercent?: number } = {},
): WhatsAppGovernanceDecision {
  const autoConfidence = options.autoConfidence ?? 95;
  const samplePercent = Math.max(0, Math.min(100, options.samplePercent ?? 15));
  const model = object(row.analysis_json);
  const confidence = Math.max(0, Math.min(100, n(row.analysis_confidence)));
  const unresolvedCriteria = reviewRequiredCount(model);
  const missingMedia = missingMediaCount(model);
  const customerResolved = customerIsResolved(row, model);
  const invoiceSafe = invoiceIsSafe(row);
  const complaint = hasComplaint(model);
  const medicalSafety = hasMedicalSafetyFlag(model);
  const reasons: string[] = [];

  if (row.priority === 'urgent') reasons.push('urgent_priority');
  if (row.review_status === 'needs_context') reasons.push('needs_context');
  if (row.review_status === 'ready_detailed') reasons.push('detailed_review');
  if (confidence < autoConfidence) reasons.push('low_confidence');
  if (!customerResolved) reasons.push('unresolved_customer');
  if (!invoiceSafe) reasons.push('invoice_review');
  if (unresolvedCriteria > 0) reasons.push('unresolved_criteria');
  if (complaint) reasons.push('complaint');
  if (medicalSafety) reasons.push('medical_safety');
  if (missingMedia > 0) reasons.push('missing_media');
  if (row.followup_required) reasons.push('followup_required');

  let priorityScore = 0;
  if (row.priority === 'urgent') priorityScore += 40;
  else if (row.priority === 'important') priorityScore += 18;
  if (row.review_status === 'needs_context') priorityScore += 35;
  if (row.review_status === 'ready_detailed') priorityScore += 30;
  if (confidence < 80) priorityScore += 25;
  else if (confidence < autoConfidence) priorityScore += 12;
  if (!customerResolved) priorityScore += 18;
  if (!invoiceSafe) priorityScore += 18;
  priorityScore += Math.min(25, unresolvedCriteria * 5);
  if (complaint) priorityScore += 25;
  if (medicalSafety) priorityScore += 35;
  if (missingMedia > 0) priorityScore += Math.min(20, 5 + missingMedia * 3);
  if (row.followup_required) priorityScore += 10;
  priorityScore = Math.min(100, priorityScore);

  const hardHumanGate =
    row.priority === 'urgent' ||
    row.review_status === 'needs_context' ||
    row.review_status === 'ready_detailed' ||
    confidence < autoConfidence ||
    !customerResolved ||
    !invoiceSafe ||
    unresolvedCriteria > 0 ||
    complaint ||
    medicalSafety ||
    missingMedia > 0;

  const autoEligible = row.review_status === 'ready_quick' && !hardHumanGate;
  const sampleBucket = stableBucket(row.id || `${row.customer_code || ''}:${row.created_at || ''}`);
  const disposition: WhatsAppGovernanceDisposition = !autoEligible
    ? 'mandatory_human'
    : sampleBucket < samplePercent
      ? 'human_sample'
      : 'auto_review_candidate';

  return {
    sourceId: row.id,
    disposition,
    priorityScore,
    confidence,
    reasonCodes: reasons,
    reasonLabels: reasons.map((code) => REASON_LABELS[code] || code),
    unresolvedCriteria,
    missingMedia,
    customerResolved,
    invoiceSafe,
    sampleBucket,
  };
}

export function buildDoctorCoachingV25(rows: WhatsAppGovernanceRow[]) {
  const grouped = new Map<string, { staffName: string; total: number; mandatory: number; reasons: Map<string, number> }>();
  for (const row of rows) {
    const staffName = String(row.staff_name || '').trim();
    if (!staffName) continue;
    const decision = evaluateWhatsAppGovernance(row);
    const current = grouped.get(staffName) || { staffName, total: 0, mandatory: 0, reasons: new Map<string, number>() };
    current.total += 1;
    if (decision.disposition === 'mandatory_human') current.mandatory += 1;
    for (const label of decision.reasonLabels) current.reasons.set(label, (current.reasons.get(label) || 0) + 1);
    grouped.set(staffName, current);
  }

  return [...grouped.values()]
    .map((item) => ({
      staffName: item.staffName,
      total: item.total,
      mandatory: item.mandatory,
      topReasons: [...item.reasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([label, count]) => ({ label, count })),
    }))
    .sort((a, b) => b.mandatory - a.mandatory || b.total - a.total);
}
