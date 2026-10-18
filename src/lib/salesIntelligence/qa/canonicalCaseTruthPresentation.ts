// Pure labels for the selected-conversation canonical truth panel. Each row renders ONE persisted
// fact as stored; nothing here infers one fact from another (a proven invoice proof never turns
// into a countable sale or a confirmed order on its own).

import type { CanonicalCaseSaleTruth, CanonicalSaleLedgerState } from './canonicalCaseTruth';

export type CanonicalTruthTone = 'success' | 'warning' | 'danger' | 'neutral';

export interface CanonicalTruthRow {
  key:
    | 'availability'
    | 'outcome'
    | 'invoiceProof'
    | 'orderConfirmed'
    | 'saleCountable'
    | 'revenueCountable'
    | 'humanReview'
    | 'ledger';
  label: string;
  value: string;
  tone: CanonicalTruthTone;
}

export const NOT_ANALYZED_LABEL = 'غير محللة بالمحرك الحالي';
const NOT_RECORDED_LABEL = 'غير مسجل في التحليل المحفوظ';

const OUTCOME_LABELS: Record<string, string> = {
  sale_proven: 'بيع مثبت بفاتورة موثوقة',
  order_confirmed_unproven: 'أوردر مؤكد بالشات — البيع غير مثبت',
  customer_confirmed_unproven: 'العميل وافق — الإغلاق/البيع غير مثبت',
  open_opportunity: 'فرصة بيعية مفتوحة',
  customer_rejected: 'العميل رفض',
  information_only: 'استفسار / معلومات فقط',
  needs_review: 'تحتاج مراجعة بشرية',
  unknown: 'غير محسومة',
};

const PROOF_STATE_LABELS: Record<string, string> = {
  proven: 'إثبات فاتورة: مثبت',
  strongly_supported: 'إثبات فاتورة: مدعوم بقوة (غير مثبت)',
  weakly_supported: 'إثبات فاتورة: مدعوم بضعف (غير مثبت)',
  unknown: 'إثبات فاتورة: غير معروف',
  contradicted: 'إثبات فاتورة: متعارض',
};

const LEDGER_LABELS: Record<CanonicalSaleLedgerState, string> = {
  proven: 'مسجل كبيع معتمد',
  revoked: 'تم سحب إثبات البيع',
  not_proven: 'لا يوجد بيع معتمد لهذه الحالة',
  proof_belongs_to_other_case: 'إثبات البيع المسجل يخص جزءًا آخر من نفس العملية',
  v22_not_linked: 'الحالة غير مرتبطة بملف عميل V22',
  v22_not_visible: 'ملف V22 المرتبط غير متاح لهذا المستخدم',
};

function yesNo(value: boolean | null): string {
  if (value === null) return NOT_RECORDED_LABEL;
  return value ? 'نعم' : 'لا';
}

export function describeCanonicalCaseSaleTruth(truth: CanonicalCaseSaleTruth): CanonicalTruthRow[] {
  const outcome = truth.outcome;
  const ledger = truth.ledger;
  const ledgerValue =
    ledger.state === 'proven'
      ? `${LEDGER_LABELS.proven}${ledger.invoiceNumber ? ` — فاتورة ${ledger.invoiceNumber}` : ''}${ledger.revenue != null ? ` — ${ledger.revenue} ج.م` : ''}`
      : ledger.state === 'revoked' && ledger.revokeReason
        ? `${LEDGER_LABELS.revoked} (${ledger.revokeReason})`
        : LEDGER_LABELS[ledger.state];
  const ledgerRow: CanonicalTruthRow = {
    key: 'ledger',
    label: 'سجل البيع المعتمد (V22)',
    value: ledgerValue,
    tone: ledger.state === 'proven' ? 'success' : ledger.state === 'revoked' ? 'danger' : 'neutral',
  };

  if (!outcome) {
    return [
      {
        key: 'availability',
        label: 'حالة التحليل',
        value:
          truth.availability === 'not_analyzed'
            ? 'لا يوجد تحليل حالي لهذه الحالة'
            : `${NOT_ANALYZED_LABEL}${truth.pipelineVersion ? ` (${truth.pipelineVersion})` : ''} — النتيجة البيعية غير محفوظة`,
        tone: 'warning',
      },
      ledgerRow,
    ];
  }

  const invoiceNumber = truth.attribution?.selectedInvoiceNumber;
  return [
    {
      key: 'outcome',
      label: 'نتيجة المحادثة',
      value: OUTCOME_LABELS[outcome.outcome] ?? outcome.outcome,
      tone:
        outcome.outcome === 'sale_proven'
          ? 'success'
          : outcome.outcome === 'needs_review'
            ? 'warning'
            : 'neutral',
    },
    {
      key: 'invoiceProof',
      label: 'إثبات فاتورة المعاملة',
      value: `${PROOF_STATE_LABELS[outcome.saleProofState] ?? outcome.saleProofState}${invoiceNumber ? ` — فاتورة ${invoiceNumber}` : ''}`,
      tone:
        outcome.saleProofState === 'proven'
          ? 'success'
          : outcome.saleProofState === 'contradicted'
            ? 'danger'
            : 'neutral',
    },
    {
      key: 'orderConfirmed',
      label: 'اكتمال تأكيد الطلب (مستقل عن إثبات البيع)',
      value: yesNo(outcome.isOrderConfirmed),
      tone: outcome.isOrderConfirmed ? 'success' : 'neutral',
    },
    {
      key: 'saleCountable',
      label: 'بيع قابل للعد رسميًا',
      value: yesNo(outcome.isSaleCountable),
      tone: outcome.isSaleCountable ? 'success' : 'neutral',
    },
    {
      key: 'revenueCountable',
      label: 'إيراد قابل للعد رسميًا',
      value: yesNo(outcome.isRevenueCountable),
      tone: outcome.isRevenueCountable ? 'success' : 'neutral',
    },
    {
      key: 'humanReview',
      label: 'مراجعة بشرية',
      value:
        outcome.needsHumanReview === null
          ? NOT_RECORDED_LABEL
          : outcome.needsHumanReview
            ? 'مطلوبة'
            : 'غير مطلوبة',
      tone: outcome.needsHumanReview ? 'warning' : 'neutral',
    },
    ledgerRow,
  ];
}

/** The trusted invoice for display: only when the persisted proof state is proven for this case's attribution. */
export function canonicalTrustedInvoiceId(truth: CanonicalCaseSaleTruth): string | null {
  if (truth.outcome?.saleProofState !== 'proven') return null;
  if (truth.attribution?.attributionLevel !== 'proven') return null;
  return truth.attribution.selectedInvoiceId;
}

