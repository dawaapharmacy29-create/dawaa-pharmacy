import { splitWhatsAppSessions, type WhatsAppParsedMessage } from './whatsappConversationParser';
import {
  buildWhatsAppCaseContextsV27,
  type WhatsAppCaseContextEngineV27,
} from './whatsappCaseContextV27';
import { extractCustomerHintFromExportFileName } from './whatsappExportCustomerHint';

// Canonical Segmentation Contract — the only way an export becomes review sources.
//
//   Raw import -> parse/normalize -> deterministic segmentation -> canonical source identity
//   -> supersession detection (Canonical Source Gate, at Sales Intelligence admission)
//
// Every ingestion path (manual Smart Watcher, automatic folder ingest) must persist exactly one
// source per case context returned here. Segmentation depends only on the parsed messages and the
// export filename hint, so the same conversation always yields the same case units, the same
// session hash (whatsappReviewPersistenceV4.hashWhatsAppSession) and therefore the same source id.
// A path that persisted raw 120-minute sessions or whole days instead would create overlapping
// coarse/fine sources for the same messages; the Canonical Source Gate refuses such sources.

export const CANONICAL_SEGMENTATION_VERSION = 'whatsapp-canonical-segmentation-v1';
export const RAW_SESSION_GAP_MINUTES = 120;

export interface CanonicalWhatsAppSegmentation {
  version: typeof CANONICAL_SEGMENTATION_VERSION;
  fileCustomerHint: ReturnType<typeof extractCustomerHintFromExportFileName>;
  rawSessionCount: number;
  caseContexts: WhatsAppCaseContextEngineV27;
}

export function segmentWhatsAppExportCanonical(
  messages: WhatsAppParsedMessage[],
  sourceFileName: string
): CanonicalWhatsAppSegmentation {
  const fileCustomerHint = extractCustomerHintFromExportFileName(sourceFileName);
  const rawSessions = splitWhatsAppSessions(messages, RAW_SESSION_GAP_MINUTES).map((session) => ({
    ...session,
    // The export filename carries the customer name as a hint only (never a confirmed identity).
    customerName: fileCustomerHint.nameHint || session.customerName,
  }));
  // 120 minutes is a raw-session boundary only; Case Context V27 joins sessions of the same
  // order/complaint/recovery into one case unit before anything is persisted.
  const caseContexts = buildWhatsAppCaseContextsV27(rawSessions);
  return {
    version: CANONICAL_SEGMENTATION_VERSION,
    fileCustomerHint,
    rawSessionCount: rawSessions.length,
    caseContexts,
  };
}
