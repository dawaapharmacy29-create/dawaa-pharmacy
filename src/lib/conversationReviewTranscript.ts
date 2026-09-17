import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';
import type { SmartQuickDecisionResult } from './whatsappSmartReviewDecision';
import type { SmartStaffRole } from './whatsappSmartReviewOwnership';

export type ConversationReviewMessageScope = 'scored' | 'context';

export interface ConversationReviewSnapshotMessage {
  id: string;
  timestamp: string;
  sender: string;
  direction: 'inbound' | 'outbound' | 'system';
  kind: string;
  text: string;
  scope: ConversationReviewMessageScope;
  evidence: boolean;
}

export interface ConversationReviewSnapshot {
  version: 1;
  source: 'whatsapp_export';
  sourceFileName: string | null;
  sessionId: string;
  customerName: string | null;
  staffName: string;
  staffRole: SmartStaffRole;
  createdAt: string;
  scope: {
    from: string | null;
    to: string | null;
    scoredMessageIds: string[];
    contextMessageIds: string[];
  };
  decision: {
    value: SmartQuickDecisionResult['decision'];
    reasons: string[];
    affectedCriteria: string[];
    safeToQuickApprove: boolean;
  };
  messages: ConversationReviewSnapshotMessage[];
}

const TRANSFER_KEY = 'dawaa_pending_conversation_review_snapshot_v1';

function text(value: unknown) {
  return String(value ?? '').trim();
}

function parseJson(value: unknown) {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return value as any;
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function buildConversationReviewSnapshot(args: {
  session: WhatsAppConversationSession;
  displayMessages: WhatsAppParsedMessage[];
  scoredMessageIds: string[];
  contextMessageIds: string[];
  evidenceMessageIds?: string[];
  staffName: string;
  staffRole: SmartStaffRole;
  sourceFileName?: string | null;
  from?: Date | null;
  to?: Date | null;
  decision: SmartQuickDecisionResult;
}): ConversationReviewSnapshot {
  const scored = new Set(args.scoredMessageIds);
  const context = new Set(args.contextMessageIds);
  const evidence = new Set(args.evidenceMessageIds || args.decision.evidenceMessageIds || []);
  const ordered = args.displayMessages
    .filter((message) => scored.has(message.id) || context.has(message.id))
    .slice()
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return {
    version: 1,
    source: 'whatsapp_export',
    sourceFileName: text(args.sourceFileName) || null,
    sessionId: args.session.id,
    customerName: args.session.customerName || null,
    staffName: text(args.staffName),
    staffRole: args.staffRole,
    createdAt: new Date().toISOString(),
    scope: {
      from: iso(args.from),
      to: iso(args.to),
      scoredMessageIds: args.scoredMessageIds.slice(),
      contextMessageIds: args.contextMessageIds.slice(),
    },
    decision: {
      value: args.decision.decision,
      reasons: args.decision.reasons.slice(),
      affectedCriteria: args.decision.affectedCriteria.slice(),
      safeToQuickApprove: args.decision.safeToQuickApprove,
    },
    messages: ordered.map((message) => ({
      id: message.id,
      timestamp: message.timestamp.toISOString(),
      sender: message.sender,
      direction: message.direction,
      kind: message.kind,
      text: String(message.text || ''),
      scope: scored.has(message.id) ? 'scored' : 'context',
      evidence: evidence.has(message.id),
    })),
  };
}

export function parseConversationReviewSnapshot(value: unknown): ConversationReviewSnapshot | null {
  const direct = parseJson(value);
  const candidate = direct?.conversation_snapshot
    ? parseJson(direct.conversation_snapshot)
    : direct?.raw_scores
      ? parseJson(direct.raw_scores)?.conversation_snapshot
      : direct;
  if (!candidate || candidate.version !== 1 || candidate.source !== 'whatsapp_export') return null;
  if (!Array.isArray(candidate.messages) || !candidate.scope || !candidate.decision) return null;
  return candidate as ConversationReviewSnapshot;
}

export function snapshotFromReviewRow(row: Record<string, unknown> | null | undefined) {
  if (!row) return null;
  const direct = parseConversationReviewSnapshot(row.conversation_snapshot);
  if (direct) return direct;
  const raw = parseJson(row.raw_scores);
  return parseConversationReviewSnapshot(raw?.conversation_snapshot);
}

export function writePendingConversationReviewTransfer(snapshot: ConversationReviewSnapshot) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(TRANSFER_KEY, JSON.stringify(snapshot));
}

export function readPendingConversationReviewTransfer(): ConversationReviewSnapshot | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(TRANSFER_KEY);
  return parseConversationReviewSnapshot(raw);
}

export function clearPendingConversationReviewTransfer() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(TRANSFER_KEY);
}
