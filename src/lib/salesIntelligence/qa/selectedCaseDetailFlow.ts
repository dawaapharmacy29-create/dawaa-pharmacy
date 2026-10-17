// The selected-conversation detail flows (open a case; confirm an invoice then reload), written
// against a state sink so the page and the regression tests run the SAME code. Every UI state
// change after an await goes through SelectedCaseRequest.commit(), which refuses results that no
// longer belong to the selected case.

import { isAbortError, type SelectedCaseRequestGate } from './selectedCaseRequestGate';

export interface SelectedCaseDetailSink<TBundle> {
  setBundle(bundle: TBundle | null | undefined): void;
  setError(message: string | null): void;
  setConfirmationMessage(message: string | null): void;
  setConfirmationError(message: string | null): void;
  setConfirming(confirming: boolean): void;
}

export type SelectedCaseDetailLoader<TBundle> = (
  caseId: string,
  signal: AbortSignal
) => Promise<TBundle | null>;

function messageOf(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === 'string' && cause) return cause;
  return fallback;
}

/**
 * Selects `caseId`, resets every per-case UI state and starts its load. Returns the effect
 * cleanup, which releases the case so a late response can never commit afterwards.
 */
export function openSelectedCase<TBundle>(
  gate: SelectedCaseRequestGate,
  caseId: string,
  loadDetail: SelectedCaseDetailLoader<TBundle>,
  sink: SelectedCaseDetailSink<TBundle>
): () => void {
  gate.select(caseId);
  const request = gate.begin();
  sink.setBundle(undefined);
  sink.setError(null);
  sink.setConfirmationMessage(null);
  sink.setConfirmationError(null);
  sink.setConfirming(false);

  loadDetail(caseId, request.signal).then(
    (bundle) => {
      request.commit(() => sink.setBundle(bundle));
    },
    (cause) => {
      if (isAbortError(cause)) return;
      request.commit(() => sink.setError(messageOf(cause, 'تعذر تحميل تفاصيل الحالة.')));
    }
  );

  return () => gate.release(caseId);
}

export interface InvoiceConfirmationOutcome {
  /** Success text for the saved confirmation (idempotent or new). */
  message: string;
  /** Non-null when the confirmation was saved but the canonical refresh did not complete. */
  refreshFailure: string | null;
}

/**
 * Confirms the selected invoice candidate, then reloads the SAME case. The confirmation itself is
 * a server write and is never aborted; only its UI effects are dropped when the user has moved to
 * another case meanwhile.
 */
export async function confirmInvoiceThenReload<TBundle>(
  gate: SelectedCaseRequestGate,
  confirm: () => Promise<InvoiceConfirmationOutcome>,
  loadDetail: SelectedCaseDetailLoader<TBundle>,
  sink: SelectedCaseDetailSink<TBundle>
): Promise<void> {
  const request = gate.begin();
  request.commit(() => {
    sink.setConfirming(true);
    sink.setConfirmationError(null);
    sink.setConfirmationMessage(null);
  });

  try {
    const outcome = await confirm();
    let failure = outcome.refreshFailure;
    try {
      const bundle = await loadDetail(request.caseId, request.signal);
      request.commit(() => sink.setBundle(bundle));
    } catch (reloadCause) {
      if (!isAbortError(reloadCause)) {
        failure = [failure, messageOf(reloadCause, String(reloadCause))].filter(Boolean).join('؛ ');
      }
    }
    request.commit(() => {
      sink.setConfirmationMessage(outcome.message);
      if (failure)
        sink.setConfirmationError(
          `تم حفظ التأكيد لكن تعذر إكمال إعادة التحليل/إعادة التحميل: ${failure}`
        );
    });
  } catch (confirmationCause) {
    let failureMessage = messageOf(confirmationCause, 'تعذر اعتماد رابط الفاتورة.');
    try {
      const bundle = await loadDetail(request.caseId, request.signal);
      request.commit(() => sink.setBundle(bundle));
    } catch (reloadCause) {
      if (!isAbortError(reloadCause)) {
        failureMessage = `${failureMessage}؛ وتعذر تحديث الحالة لمعرفة وضع التأكيد المحفوظ: ${messageOf(reloadCause, String(reloadCause))}`;
      }
    }
    request.commit(() => sink.setConfirmationError(failureMessage));
  } finally {
    request.commit(() => sink.setConfirming(false));
  }
}
