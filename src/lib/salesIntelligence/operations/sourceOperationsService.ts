// Source-scoped operational boundary for the Sales Intelligence case page: bounded reads of one
// source's proposals/audit and the three authorized commands (correct attribution, approve a
// customer-request proposal, execute an approved proposal). It never writes tables directly and
// never treats an RPC response without the expected success shape as success.
import { supabase } from '@/lib/supabase';
import type { SourceCorrectionPreview, StoredSourceAttribution } from './sourceCorrectionModel';

export const SOURCE_OPERATIONS_ACTION_LIMIT = 50;
export const SOURCE_OPERATIONS_AUDIT_LIMIT = 20;

export interface SourceOperationalAction {
  id: string;
  actionType: string;
  status: string;
  createdBy: string | null;
  branch: string | null;
  staffId: string | null;
  customerId: string | null;
  customerName: string | null;
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  quantity: number | null;
  autoEligible: boolean;
  targetTable: string | null;
  targetId: string | null;
  canonicalLifecycle: string | null;
  withdrawalReason: string | null;
  approvedByName: string | null;
  updatedAt: string | null;
}

export interface SourceAuditEntry {
  id: string;
  action: string;
  actorName: string | null;
  note: string | null;
  createdAt: string | null;
  afterState: Record<string, unknown> | null;
}

const SOURCE_COLUMNS = [
  'id', 'source_filename', 'source_hash', 'raw_text', 'staff_id', 'staff_name', 'branch', 'customer_id',
  'customer_code', 'customer_name', 'conversation_started_at', 'conversation_ended_at', 'message_count', 'review_status',
].join(',');
const ACTION_COLUMNS = [
  'id', 'action_type', 'status', 'created_by', 'branch', 'staff_id', 'customer_id', 'customer_name', 'product_id',
  'product_code', 'product_name', 'quantity', 'auto_eligible', 'target_table', 'target_id', 'payload', 'updated_at',
].join(',');

type Row = Record<string, any>;
const text = (value: unknown) => (value == null || String(value).trim() === '' ? null : String(value));

export async function loadStoredSourceAttribution(sourceId: string): Promise<StoredSourceAttribution> {
  const { data, error } = await supabase.from('whatsapp_review_sources').select(SOURCE_COLUMNS).eq('id', sourceId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('whatsapp_source_not_found');
  const row = data as Row;
  return {
    id: String(row.id),
    sourceFilename: text(row.source_filename),
    sourceHash: String(row.source_hash ?? ''),
    rawText: String(row.raw_text ?? ''),
    staffId: text(row.staff_id),
    staffName: text(row.staff_name),
    branch: text(row.branch),
    customerId: text(row.customer_id),
    customerCode: text(row.customer_code),
    customerName: text(row.customer_name),
    conversationStartedAt: text(row.conversation_started_at),
    conversationEndedAt: text(row.conversation_ended_at),
    messageCount: row.message_count == null ? null : Number(row.message_count),
    reviewStatus: text(row.review_status),
  };
}

export function mapSourceOperationalAction(row: Row): SourceOperationalAction {
  const payload = (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Row;
  return {
    id: String(row.id),
    actionType: String(row.action_type ?? ''),
    status: String(row.status ?? ''),
    createdBy: text(row.created_by),
    branch: text(row.branch),
    staffId: text(row.staff_id),
    customerId: text(row.customer_id),
    customerName: text(row.customer_name),
    productId: text(row.product_id),
    productCode: text(row.product_code),
    productName: text(row.product_name),
    quantity: row.quantity == null ? null : Number(row.quantity),
    autoEligible: row.auto_eligible === true,
    targetTable: text(row.target_table),
    targetId: text(row.target_id),
    canonicalLifecycle: text(payload.canonicalLifecycle),
    withdrawalReason: text(payload.canonicalWithdrawalReason),
    approvedByName: text(payload.approvedByName),
    updatedAt: text(row.updated_at),
  };
}

export async function loadSourceOperationalActions(sourceId: string): Promise<SourceOperationalAction[]> {
  const { data, error } = await supabase
    .from('whatsapp_conversation_actions')
    .select(ACTION_COLUMNS)
    .eq('source_id', sourceId)
    .order('created_at', { ascending: true })
    .limit(SOURCE_OPERATIONS_ACTION_LIMIT);
  if (error) throw error;
  return ((data ?? []) as Row[]).map(mapSourceOperationalAction);
}

export async function loadSourceAuditEntries(sourceId: string): Promise<SourceAuditEntry[]> {
  const { data, error } = await supabase
    .from('whatsapp_review_audit')
    .select('id,action,actor_name,note,created_at,after_state')
    .eq('source_id', sourceId)
    .order('created_at', { ascending: false })
    .limit(SOURCE_OPERATIONS_AUDIT_LIMIT);
  if (error) throw error;
  return ((data ?? []) as Row[]).map((row) => ({
    id: String(row.id),
    action: String(row.action ?? ''),
    actorName: text(row.actor_name),
    note: text(row.note),
    createdAt: text(row.created_at),
    afterState: row.after_state && typeof row.after_state === 'object' ? row.after_state : null,
  }));
}

export interface SourceCorrectionResult {
  changed: boolean;
  correctionId: string | null;
  retiredActions: number;
}

export function parseSourceCorrectionResult(data: unknown): SourceCorrectionResult {
  const row = (data ?? {}) as Row;
  if (row.ok !== true || typeof row.changed !== 'boolean' || !Number.isSafeInteger(row.retiredActions)) {
    throw new Error('source_attribution_correction_invalid_result');
  }
  if (row.changed && !text(row.correctionId)) throw new Error('source_attribution_correction_invalid_result');
  return { changed: row.changed, correctionId: text(row.correctionId), retiredActions: Number(row.retiredActions) };
}

export async function submitSourceAttributionCorrection(
  stored: StoredSourceAttribution,
  preview: Extract<SourceCorrectionPreview, { ok: true }>
): Promise<SourceCorrectionResult> {
  const { data, error } = await supabase.rpc('dawaa_correct_whatsapp_source_attribution_v1', {
    p_source_id: stored.id,
    p_expected_source_hash: stored.sourceHash,
    p_raw_text: preview.rawText,
    p_source_hash: preview.sourceHash,
    p_staff_id: preview.staffId,
    p_branch: preview.branch,
    p_reason: preview.reason,
  });
  if (error) throw error;
  return parseSourceCorrectionResult(data);
}

export async function approveCustomerRequestProposal(actionId: string) {
  const { data, error } = await supabase.rpc('dawaa_approve_whatsapp_customer_request_action_v2', { p_action_id: actionId });
  if (error) throw error;
  const row = (data ?? {}) as Row;
  if (row.ok !== true || row.status !== 'ready') throw new Error('customer_request_approval_invalid_result');
  return { actionId: String(row.action_id ?? actionId) };
}

export function parseMaterializationResult(data: unknown) {
  const row = (data ?? {}) as Row;
  const targetId = text(row.target_id);
  // HTTP 200 without a real target is a failure, never a silent success.
  if (row.ok !== true || !targetId) throw new Error('whatsapp_action_materialization_invalid_result');
  return { targetId, alreadyCreated: row.already_created === true };
}

export async function executeOperationalAction(actionId: string) {
  const { data, error } = await supabase.rpc('dawaa_materialize_whatsapp_action_v1', { p_action_id: actionId });
  if (error) throw error;
  return parseMaterializationResult(data);
}
