interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message?: string } | null }>;
}

export interface ProductIdentityManagerReview {
  id: string;
  basketItemId: string;
  invoiceItemId: string;
  analysisId: string;
  reviewerName: string;
  reviewerNote: string;
  reviewedAt: string;
  decision: 'identity_confirmed';
  isCurrent: boolean;
  supersedesReviewId: string | null;
}

export async function loadProductIdentityManagerReviews(client: RpcClient, caseId: string): Promise<ProductIdentityManagerReview[]> {
  const { data, error } = await client.rpc('dawaa_list_whatsapp_product_identity_reviews_v1', { p_case_id: caseId });
  if (error) throw new Error(error.message || 'product_identity_reviews_unavailable');
  if (!Array.isArray(data)) throw new Error('invalid_product_identity_reviews_response');
  return data as ProductIdentityManagerReview[];
}

export async function confirmProductIdentityManagerDecision(client: RpcClient, input: {
  sourceId: string;
  caseId: string;
  analysisId: string;
  basketItemId: string;
  invoiceItemId: string;
  note: string;
}): Promise<{ idempotent: boolean; reviewId: string }> {
  if (input.note.trim().length < 8) throw new Error('مطلوب سبب اعتماد واضح لا يقل عن ٨ حروف.');
  const { data, error } = await client.rpc('dawaa_confirm_whatsapp_product_identity_v1', {
    p_source_id: input.sourceId,
    p_case_id: input.caseId,
    p_analysis_id: input.analysisId,
    p_basket_item_id: input.basketItemId,
    p_invoice_item_id: input.invoiceItemId,
    p_reviewer_note: input.note.trim(),
  });
  if (error) throw new Error(error.message || 'product_identity_review_failed');
  if (!data || typeof data !== 'object' || (data as Record<string, unknown>).ok !== true ||
      typeof (data as Record<string, unknown>).review_id !== 'string') {
    throw new Error('invalid_product_identity_review_response');
  }
  return {
    idempotent: (data as Record<string, unknown>).idempotent === true,
    reviewId: String((data as Record<string, unknown>).review_id),
  };
}
