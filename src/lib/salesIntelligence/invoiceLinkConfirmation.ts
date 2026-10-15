export const INVOICE_LINK_CONFIRMATION_RPC = 'dawaa_confirm_whatsapp_invoice_link_v1';

export interface InvoiceLinkConfirmationInput {
  sourceId: string;
  invoiceId: string;
  invoiceNumber: string;
  note?: string | null;
}

export interface InvoiceConfirmationDialogDetails {
  invoiceNumber: string;
  customer: string;
  branch: string;
  staff: string;
  datetime: string;
  total: string;
  confidence: string;
  reason: string;
  retryingRefresh?: boolean;
}

interface RpcClient {
  rpc(
    functionName: string,
    args: Record<string, unknown>
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
}

export function hasConfirmableInvoiceCandidate(candidate: {
  sourceId: string | null | undefined;
  invoiceId: string | null | undefined;
  invoiceNumber: string | null | undefined;
  sourceIsCanonical: boolean;
  alreadyConfirmed: boolean;
  alreadyConfirmedInvoiceId?: string | null;
  alreadyProven: boolean;
}): boolean {
  return Boolean(
    candidate.sourceIsCanonical &&
      (!candidate.alreadyConfirmed ||
        (candidate.invoiceId && candidate.invoiceId === candidate.alreadyConfirmedInvoiceId)) &&
      !candidate.alreadyProven &&
      candidate.sourceId?.trim() &&
      candidate.invoiceId?.trim() &&
      candidate.invoiceNumber?.trim()
  );
}

export function buildInvoiceConfirmationDialogText(details: InvoiceConfirmationDialogDetails): string {
  return [
    `الفاتورة: ${details.invoiceNumber}`,
    `العميل: ${details.customer}`,
    `الفرع: ${details.branch}`,
    `الموظف: ${details.staff}`,
    `الوقت: ${details.datetime}`,
    `الإجمالي: ${details.total}`,
    `الثقة: ${details.confidence}`,
    `السبب: ${details.reason}`,
    '',
    details.retryingRefresh
      ? 'رابط الفاتورة محفوظ بالفعل. هل تريد إعادة محاولة التحليل الآن؟'
      : 'هل راجعت تطابق هذه الفاتورة مع الحالة وتريد اعتماد الرابط؟',
  ].join('\n');
}

export async function confirmInvoiceCandidate(
  client: RpcClient,
  input: InvoiceLinkConfirmationInput
): Promise<{ idempotent: boolean }> {
  const { data, error } = await client.rpc(INVOICE_LINK_CONFIRMATION_RPC, {
    p_source_id: input.sourceId,
    p_invoice_id: input.invoiceId,
    p_invoice_number: input.invoiceNumber,
    p_confirmation_note: input.note?.trim() || null,
  });
  if (error) throw new Error(error.message || 'invoice_link_confirmation_failed');
  if (!data || typeof data !== 'object' || (data as Record<string, unknown>).ok !== true) {
    throw new Error('invoice_link_confirmation_invalid_response');
  }
  return { idempotent: (data as Record<string, unknown>).idempotent === true };
}

export async function confirmInvoiceCandidateAndRefresh<TRefresh>(
  client: RpcClient,
  input: InvoiceLinkConfirmationInput,
  refreshSource: (sourceId: string) => Promise<TRefresh>
): Promise<{ confirmation: { idempotent: boolean }; refresh: TRefresh }> {
  const confirmation = await confirmInvoiceCandidate(client, input);
  const refresh = await refreshSource(input.sourceId);
  return { confirmation, refresh };
}
