import { extractIntroducedStaffName, splitWhatsAppSessions, type WhatsAppConversationSession, type WhatsAppParsedMessage } from './whatsappConversationParser';
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

// A completed order followed by a new customer greeting, a different identified staff
// member, and an explicit complaint about staff/courier conduct is a NEW service issue.
// A delayed delivery complaint about the same still-open order must remain continuous.
const FULFILLED_RX = /تم\s*(?:ال[إا]رسال|التوصيل|التسليم)|(?:الطلب|الأوردر|الاوردر)\s*(?:وصل|اتسلم)/i;
const NEW_GREETING_RX = /(?:ال+سلام\s*عليكم|مساء\s*الخير|صباح\s*الخير)/i;
const CONDUCT_COMPLAINT_RX = /(?:الطريق[هة]|الاسلوب|الأسلوب|سخيف|بيتكلم\s*بيها|بيكلمني|اتكلم\s*معايا|معامل[هة]\s*وحش[هة]|قلة\s*ذوق)/i;

function introducedStaff(message: WhatsAppParsedMessage): string | null {
  const name = extractIntroducedStaffName(message);
  return name ? name.replace(/\s+/g, ' ').trim().toLowerCase() : null;
}

function splitVerifiedNewIssues(session: WhatsAppConversationSession): WhatsAppConversationSession[] {
  const messages = session.messages;
  const boundaries: number[] = [0];
  for (let index = 1; index < messages.length; index += 1) {
    const greeting = messages[index];
    if (greeting.direction !== 'inbound' || !NEW_GREETING_RX.test(greeting.text)) continue;
    // Bound lookback for very large exports; if proof is too remote, retain continuity.
    const prefix = messages.slice(Math.max(boundaries.at(-1) ?? 0, index - 200), index);
    const fulfillment = prefix.slice().reverse().find((m) => m.direction === 'outbound' && FULFILLED_RX.test(m.text));
    if (!fulfillment || greeting.timestamp.getTime() - fulfillment.timestamp.getTime() < 10 * 60_000) continue;
    const previousStaff = prefix.map(introducedStaff).filter(Boolean);
    if (!previousStaff.length) continue;
    const following = messages.slice(index + 1, index + 16);
    const nextStaff = following.map(introducedStaff).find(Boolean);
    if (!nextStaff || previousStaff.includes(nextStaff)) continue;
    const newIssue = following.some((m) => m.direction === 'inbound' && CONDUCT_COMPLAINT_RX.test(m.text));
    if (newIssue) boundaries.push(index);
  }
  if (boundaries.length === 1) return [session];
  return boundaries.map((start, index) => {
    const end = boundaries[index + 1] ?? messages.length;
    const [part] = splitWhatsAppSessions(messages.slice(start, end), RAW_SESSION_GAP_MINUTES);
    return { ...part, customerName: session.customerName, startsNewCase: index > 0 };
  });
}

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
  const rawSessions = splitWhatsAppSessions(messages, RAW_SESSION_GAP_MINUTES).flatMap(splitVerifiedNewIssues).map((session) => ({
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
