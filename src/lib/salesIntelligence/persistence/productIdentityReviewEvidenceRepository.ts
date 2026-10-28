// Privileged canonical refresh ONLY. No browser or evaluator calls this repository.
// Every saved approval must still agree with the CURRENT source and CURRENT invoice line.
import type { VerifiedProductIdentityReview } from '../productIdentityReviewClosure';
import { readInvoiceItemCommercialMeta } from '../../invoices/invoiceItemCommercialMeta';

export async function fetchVerifiedProductIdentityReviews(
  client: any,
  sourceIds: string[]
): Promise<Record<string, VerifiedProductIdentityReview[]>> {
  const ids = [...new Set(sourceIds.filter(Boolean))];
  if (!ids.length) return {};
  const { data: reviewRows, error: reviewError } = await client
    .from('whatsapp_product_identity_manager_reviews_v1')
    .select('id,source_id,source_hash,case_id,basket_item_id,source_message_id,raw_phrase,catalog_product_id,catalog_product_code,invoice_id,invoice_item_id,quantity,decision,is_current')
    .eq('is_current', true)
    .in('source_id', ids)
    .limit(5001);
  if (reviewError) throw new Error(`product_identity_review_read_failed: ${reviewError.message}`);
  if ((reviewRows ?? []).length >= 5001) throw new Error('product_identity_review_read_limit_reached');
  if (!reviewRows?.length) return {};

  const [{ data: sources, error: sourceError }, { data: lines, error: lineError }] = await Promise.all([
    client.from('whatsapp_review_sources')
      .select('id,source_hash,invoice_link_confirmed,invoice_link_confirmed_invoice_id')
      .in('id', [...new Set(reviewRows.map((row: any) => row.source_id))]),
    client.from('sales_invoice_items_v21')
      .select('id,invoice_id,product_id,product_code,quantity,raw_data')
      .in('invoice_id', [...new Set(reviewRows.map((row: any) => row.invoice_id))])
      .limit(10001),
  ]);
  if (sourceError || lineError) throw new Error(`product_identity_review_proof_read_failed: ${sourceError?.message || lineError?.message}`);
  if ((lines ?? []).length >= 10001) throw new Error('product_identity_invoice_line_read_limit_reached');
  const sourceById = new Map((sources ?? []).map((row: any) => [String(row.id), row]));
  const lineById = new Map((lines ?? []).map((row: any) => [String(row.id), row]));
  const result: Record<string, VerifiedProductIdentityReview[]> = {};
  for (const review of reviewRows) {
    const sourceId = String(review.source_id);
    const source: any = sourceById.get(sourceId);
    const line: any = lineById.get(String(review.invoice_item_id));
    const quantity = Number(review.quantity);
    const commercial = readInvoiceItemCommercialMeta(line?.raw_data);
    const lineQuantity = line?.quantity == null ? NaN : Number(line.quantity);
    const returnedQuantity = commercial.returnedQuantity ?? 0;
    const effectiveQuantity = commercial.effectiveQuantity ?? lineQuantity - returnedQuantity;
    const matchingLineCount = (lines ?? []).filter((candidate: any) =>
      candidate.invoice_id === review.invoice_id &&
      (candidate.product_id === review.catalog_product_id || candidate.product_code === review.catalog_product_code)
    ).length;
    if (!source || !line || review.decision !== 'identity_confirmed' || review.is_current !== true ||
        source.source_hash !== review.source_hash ||
        source.invoice_link_confirmed !== true ||
        source.invoice_link_confirmed_invoice_id !== review.invoice_id ||
        line.invoice_id !== review.invoice_id ||
        line.product_id !== review.catalog_product_id ||
        line.product_code !== review.catalog_product_code ||
        matchingLineCount !== 1 ||
        !Number.isFinite(quantity) || quantity <= 0 ||
        !Number.isFinite(lineQuantity) || !Number.isFinite(returnedQuantity) ||
        !Number.isFinite(effectiveQuantity) || effectiveQuantity !== quantity) continue;
    const confirmed: VerifiedProductIdentityReview = {
      reviewId: String(review.id),
      sourceId,
      caseId: String(review.case_id),
      basketItemId: String(review.basket_item_id),
      sourceMessageId: String(review.source_message_id),
      rawPhrase: String(review.raw_phrase),
      catalogProductId: String(review.catalog_product_id),
      catalogProductCode: String(review.catalog_product_code),
      quantity,
      invoiceId: String(review.invoice_id),
      invoiceItemId: String(review.invoice_item_id),
    };
    (result[sourceId] ??= []).push(confirmed);
  }
  return result;
}
