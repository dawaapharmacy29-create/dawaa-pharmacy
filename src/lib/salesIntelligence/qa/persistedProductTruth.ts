// Projection only. Product identity belongs to the persisted canonical analysis, never a
// reviewer-side search. Missing snapshots require an explicit canonical refresh.
import { readCaseIntelligence } from './caseIntelligencePresentation';
import { normalizePharmacyText } from '../pharmacyProducts/pharmacyNormalization';
import type { CaseBasketItem } from '../types';

export type ProductDisplayState = 'CANONICAL_MATCH' | 'AMBIGUOUS' | 'UNRESOLVED' | 'HUMAN_REVIEW';
export interface PersistedProductDisplay {
  key: string;
  sourceMessageId: string;
  evidenceMessageIds: string[];
  rawPhrase: string;
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  state: ProductDisplayState;
  source: 'persisted_need' | 'persisted_basket';
  packSizes: ReturnType<typeof normalizePharmacyText>['packSizes'];
  strengths: ReturnType<typeof normalizePharmacyText>['strengths'];
  dosageForms: ReturnType<typeof normalizePharmacyText>['dosageForms'];
}

export function readPersistedProductTruth(
  caseId: string,
  row: {
    case_id?: string;
    evidence_snapshot?: Record<string, any> | null;
  }
) {
  const view = readCaseIntelligence(row);
  const valid = row.case_id === caseId && view?.caseId === caseId;
  if (!valid)
    return {
      products: [] as PersistedProductDisplay[],
      basketItems: [] as CaseBasketItem[],
      basket: null,
      messageIds: [] as string[],
      warning: 'بيانات الأصناف المحفوظة غير متاحة لهذه الحالة؛ استخدم إعادة التحليل الصريحة.',
    };

  const basketItems = view.basket?.activeItems ?? [];
  // Need carries the persisted resolver confidence and evidence. Basket is used only when
  // this older snapshot has no need products; it never overwrites a null canonical identity.
  const needs = view.need?.products ?? [];
  const inputs = needs.length
    ? needs.map((p) => ({
        key: p.key,
        raw: p.productNameRaw,
        id: p.productId,
        code: p.productCode,
        name: p.canonicalName,
        confidence: p.confidence,
        evidence: p.evidenceMessageIds,
        ambiguous: false,
        source: 'persisted_need' as const,
      }))
    : basketItems.map((p) => ({
        key: p.itemId,
        raw: p.productNameRaw,
        id: p.productId,
        code: p.productCode,
        name: p.canonicalName,
        confidence: p.confidence,
        evidence: [p.sourceMessageId],
        ambiguous: p.resolutionStatus === 'contradicted',
        source: 'persisted_basket' as const,
      }));
  const products: PersistedProductDisplay[] = inputs.map((p) => {
    const facts = normalizePharmacyText(p.name ?? '');
    const trusted = p.confidence?.level === 'proven' || p.confidence?.level === 'strongly_inferred';
    const reasons = p.confidence?.ruleIds ?? [];
    const ambiguous = p.ambiguous || reasons.some((r) => /ambiguous|tie|conflict/.test(r));
    const state: ProductDisplayState = ambiguous
      ? 'AMBIGUOUS'
      : p.id && trusted
        ? 'CANONICAL_MATCH'
        : p.evidence?.length
          ? 'HUMAN_REVIEW'
          : 'UNRESOLVED';
    return {
      key: p.key,
      sourceMessageId: p.evidence?.[0] ?? '',
      evidenceMessageIds: p.evidence ?? [],
      rawPhrase: p.raw,
      productId: p.id ?? null,
      productCode: p.code ?? null,
      productName: p.name ?? null,
      state,
      source: p.source,
      packSizes: facts.packSizes,
      strengths: facts.strengths,
      dosageForms: facts.dosageForms,
    };
  });
  return {
    products,
    basketItems,
    basket: view.basket?.activeBasketId
      ? {
          announcedTotal:
            view.basket.announcedTotal == null ? null : { amount: view.basket.announcedTotal },
        }
      : null,
    messageIds: view.interaction?.messageIds ?? [],
    warning: null,
  };
}

export function productDisplayStateLabel(state: ProductDisplayState): string {
  return {
    CANONICAL_MATCH: 'مطابقة قياسية محفوظة',
    AMBIGUOUS: 'أكثر من احتمال — مراجعة بشرية',
    UNRESOLVED: 'غير محسوم — مراجعة بشرية',
    HUMAN_REVIEW: 'مراجعة بشرية مطلوبة',
  }[state];
}
