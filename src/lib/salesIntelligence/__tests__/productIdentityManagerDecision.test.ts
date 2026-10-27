import { describe, expect, it, vi } from 'vitest';
import { confirmProductIdentityManagerDecision, loadProductIdentityManagerReviews } from '../productIdentityManagerDecision';

const input = { sourceId: 'source-1', caseId: 'source-1:interaction:0', analysisId: 'analysis-1', basketItemId: 'item-1', invoiceItemId: 'line-1', note: 'راجعت صورة العبوة وكود الصنف' };

describe('manager product identity decision RPC', () => {
  it('passes only immutable evidence references and the note to the server', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, idempotent: false, review_id: 'review-1' }, error: null });
    expect(await confirmProductIdentityManagerDecision({ rpc }, input)).toEqual({ idempotent: false, reviewId: 'review-1' });
    expect(rpc).toHaveBeenCalledWith('dawaa_confirm_whatsapp_product_identity_v1', {
      p_source_id: input.sourceId, p_case_id: input.caseId, p_analysis_id: input.analysisId,
      p_basket_item_id: input.basketItemId, p_invoice_item_id: input.invoiceItemId, p_reviewer_note: input.note,
    });
  });
  it('rejects a missing reason before RPC', async () => {
    const rpc = vi.fn();
    await expect(confirmProductIdentityManagerDecision({ rpc }, { ...input, note: 'لا' })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('surfaces authorization errors without pretending to save', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'product_identity_review_not_authorized' } });
    await expect(confirmProductIdentityManagerDecision({ rpc }, input)).rejects.toThrow('product_identity_review_not_authorized');
  });
  it('retrieves persisted decisions for the exact case', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    expect(await loadProductIdentityManagerReviews({ rpc }, input.caseId)).toEqual([]);
    expect(rpc).toHaveBeenCalledWith('dawaa_list_whatsapp_product_identity_reviews_v1', { p_case_id: input.caseId });
  });
});
