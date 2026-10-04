from pathlib import Path
import base64

# 1) Share the exact V32/V9 payment-settlement semantic detector.
p = Path("src/lib/whatsappConversationUnderstandingV32.ts")
s = p.read_text()
old = """const PAYMENT_SETTLEMENT_CONTINUATION_RX =
  /رقم\\s*التحويل|(?:صوره|صورة)\\s*التحويل|استاذن[^\\n]{0,80}(?:صوره|صورة)[^\\n]{0,40}التحويل|رابط\\s*الدفع|لينك\\s*الدفع/i;
"""
new = old + """
/** Shared semantic guard: an explicit staff payment/transfer handoff, never a generic phone mention. */
export function hasPaymentSettlementHandoffText(text: string): boolean {
  return PAYMENT_SETTLEMENT_CONTINUATION_RX.test(text || '');
}
"""
assert s.count(old) == 1, "payment settlement regex anchor drifted"
s = s.replace(old, new, 1)
old_return = "return currentHasOrderCommitment(current) && PAYMENT_SETTLEMENT_CONTINUATION_RX.test(next.text);"
new_return = "return currentHasOrderCommitment(current) && hasPaymentSettlementHandoffText(next.text);"
assert s.count(old_return) == 1, "payment continuation call anchor drifted"
s = s.replace(old_return, new_return, 1)
p.write_text(s)

# 2) Reassemble only an explicit payment settlement into its canonical order anchor for SI analysis.
p = Path("src/lib/salesIntelligence/refresh/canonicalRefreshService.ts")
s = p.read_text()
import_anchor = "import { persistAutomaticCaseConversationReviewWithClient } from '../conversationEvaluationPersistence';\n"
import_add = import_anchor + "import { hasPaymentSettlementHandoffText } from '../../whatsappConversationUnderstandingV32';\n"
assert s.count(import_anchor) == 1, "canonical refresh import anchor drifted"
s = s.replace(import_anchor, import_add, 1)

marker = """function toBlocked(
  decision: Extract<CanonicalSourceGateDecision, { allowed: false }>
): BlockedSource {
  return {
    sourceId: decision.sourceId,
    error: decision.code,
    reason: decision.reason,
    v22CaseIds: decision.v22CaseIds,
    supersedingSourceIds: decision.supersedingSourceIds,
  };
}
"""
insert = marker + """

export type V22AnalysisContext = {
  id: string;
  journeyId: string | null;
  customerId: string | null;
  caseType: string | null;
  orderIntent: boolean;
  orderConfirmed: boolean;
};

const V22_ANALYSIS_CONTEXT_CHUNK = 40;
const PAYMENT_CONTINUATION_MAX_GAP_MS = 24 * 60 * 60 * 1000;

function sourceTime(value: unknown): number | null {
  const parsed = value ? Date.parse(String(value)) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Analysis-only assembly for a legacy fine-source split that represents one order lifecycle.
 * Canonical ownership remains on the order source; the payment follower is consumed only as
 * analysis context and its stale SI case-set is retired by the normal reconciliation pass.
 */
export function buildCanonicalAnalysisConversations(
  admitted: Record<string, unknown>[],
  v22CaseIdBySource: Map<string, string>,
  v22ContextByCaseId: Map<string, V22AnalysisContext>
): ReturnType<typeof reviewSourceRowToBatchConversation>[] {
  type Member = {
    source: Record<string, unknown>;
    sourceId: string;
    context: V22AnalysisContext;
  };

  const groups = new Map<string, Member[]>();
  for (const source of admitted) {
    const sourceId = String(source.id || '');
    const caseId = v22CaseIdBySource.get(sourceId) || '';
    const context = v22ContextByCaseId.get(caseId);
    const fileName = String(source.source_filename || '');
    if (!sourceId || !caseId || !context?.journeyId || !context.customerId || !fileName) continue;
    const key = `${fileName}|${context.journeyId}|${context.customerId}`;
    const members = groups.get(key) || [];
    members.push({ source, sourceId, context });
    groups.set(key, members);
  }

  const followersByAnchor = new Map<string, Set<string>>();
  const mergedFollowers = new Set<string>();
  for (const members of groups.values()) {
    const anchors = members.filter(
      (member) =>
        member.context.caseType === 'order' &&
        (member.context.orderIntent || member.context.orderConfirmed)
    );
    if (anchors.length !== 1) continue;
    const anchor = anchors[0];
    const anchorEnd = sourceTime(anchor.source.conversation_ended_at);
    if (anchorEnd === null) continue;

    const paymentFollowers = members.filter((member) => {
      if (member.sourceId === anchor.sourceId || member.context.caseType !== 'followup') return false;
      if (!hasPaymentSettlementHandoffText(String(member.source.raw_text || ''))) return false;
      const followerStart = sourceTime(member.source.conversation_started_at);
      if (followerStart === null || followerStart < anchorEnd) return false;
      return followerStart - anchorEnd <= PAYMENT_CONTINUATION_MAX_GAP_MS;
    });
    if (!paymentFollowers.length) continue;

    followersByAnchor.set(anchor.sourceId, new Set(paymentFollowers.map((row) => row.sourceId)));
    for (const follower of paymentFollowers) mergedFollowers.add(follower.sourceId);
  }

  const conversations: ReturnType<typeof reviewSourceRowToBatchConversation>[] = [];
  for (const source of admitted) {
    const sourceId = String(source.id || '');
    if (mergedFollowers.has(sourceId)) continue;
    const followerIds = followersByAnchor.get(sourceId);
    let analysisSource = source;
    if (followerIds?.size) {
      const parts = admitted
        .filter((row) => String(row.id || '') === sourceId || followerIds.has(String(row.id || '')))
        .sort(
          (a, b) =>
            (sourceTime(a.conversation_started_at) ?? 0) -
            (sourceTime(b.conversation_started_at) ?? 0)
        );
      analysisSource = {
        ...source,
        raw_text: parts
          .map((row) => String(row.raw_text || '').trim())
          .filter(Boolean)
          .join(String.fromCharCode(10)),
      };
    }
    conversations.push(
      reviewSourceRowToBatchConversation({
        ...(analysisSource as any),
        source_case_id_v22: v22CaseIdBySource.get(sourceId) || null,
      })
    );
  }
  return conversations;
}

async function loadV22AnalysisContexts(
  service: any,
  caseIds: string[]
): Promise<Map<string, V22AnalysisContext>> {
  const out = new Map<string, V22AnalysisContext>();
  const ids = Array.from(new Set(caseIds.map(String).filter(Boolean)));
  for (let index = 0; index < ids.length; index += V22_ANALYSIS_CONTEXT_CHUNK) {
    const { data, error } = await service
      .from('whatsapp_customer_cases_v22')
      .select('id,journey_id,customer_id,case_type,order_intent,order_confirmed')
      .in('id', ids.slice(index, index + V22_ANALYSIS_CONTEXT_CHUNK));
    if (error) throw new Error(`canonical_refresh_v22_context_lookup_failed: ${error.message}`);
    for (const row of data || []) {
      out.set(String(row.id), {
        id: String(row.id),
        journeyId: row.journey_id ? String(row.journey_id) : null,
        customerId: row.customer_id ? String(row.customer_id) : null,
        caseType: row.case_type ? String(row.case_type) : null,
        orderIntent: Boolean(row.order_intent),
        orderConfirmed: Boolean(row.order_confirmed),
      });
    }
  }
  return out;
}
"""
assert s.count(marker) == 1, "toBlocked marker drifted"
s = s.replace(marker, insert, 1)

old_conv = """  // 2. Sales Intelligence pipeline + persistence, with the resolved Customer Case V22 identity.
  const conversations = admitted.map((source) =>
    reviewSourceRowToBatchConversation({
      ...(source as any),
      source_case_id_v22: v22CaseIdBySource.get(String(source.id)) || null,
    })
  );
  const batch = await runBatchPersistence(service, { conversations, dryRun: input.dryRun });
"""
new_conv = """  // 2. Sales Intelligence pipeline + persistence, with the resolved Customer Case V22 identity.
  // Reassemble only an explicit same-journey payment-settlement followup into its single
  // order anchor for analysis. Canonical gate/source ownership remains unchanged.
  const v22ContextByCaseId = await loadV22AnalysisContexts(
    service,
    Array.from(new Set(v22CaseIdBySource.values()))
  );
  const conversations = buildCanonicalAnalysisConversations(
    admitted,
    v22CaseIdBySource,
    v22ContextByCaseId
  );
  const batch = await runBatchPersistence(service, { conversations, dryRun: input.dryRun });
"""
assert s.count(old_conv) == 1, "conversation assembly anchor drifted"
s = s.replace(old_conv, new_conv, 1)
p.write_text(s)

# 3) Version the analysis-input semantic change.
p = Path("src/lib/salesIntelligence/persistence/versions.ts")
s = p.read_text()
old_version = "export const PIPELINE_VERSION = 'sales-intelligence-v13';"
assert s.count(old_version) == 1, "V13 version anchor drifted"
s = s.replace(old_version, "export const PIPELINE_VERSION = 'sales-intelligence-v14';", 1)
comment_anchor = "// v13 (2026-10-04): quality hardening validated on real WhatsApp cases. The semantic pipeline\n"
v14_comment = (
    "// v14 (2026-10-04): canonical refresh reassembles only explicit payment-settlement followup fine\n"
    "// sources into their single same-journey order anchor for analysis, while preserving source/V22\n"
    "// ownership and retiring the follower's stale SI case-set through normal reconciliation.\n"
)
assert s.count(comment_anchor) == 1, "version comment anchor drifted"
s = s.replace(comment_anchor, v14_comment + comment_anchor, 1)
p.write_text(s)

# 4) Isolated regression tests; avoids the unrelated legacy backfill-script fixture.
test_bytes = base64.b64decode("aW1wb3J0IHsgZGVzY3JpYmUsIGV4cGVjdCwgaXQgfSBmcm9tICd2aXRlc3QnOwppbXBvcnQgewogIGJ1aWxkQ2Fub25pY2FsQW5hbHlzaXNDb252ZXJzYXRpb25zLAogIHR5cGUgVjIyQW5hbHlzaXNDb250ZXh0LAp9IGZyb20gJy4uL2Nhbm9uaWNhbFJlZnJlc2hTZXJ2aWNlJzsKCmRlc2NyaWJlKCdjYW5vbmljYWwgYW5hbHlzaXMgam91cm5leSBwYXltZW50LWNvbnRleHQgYXNzZW1ibHknLCAoKSA9PiB7CiAgY29uc3Qgc291cmNlTWFwID0gbmV3IE1hcChbCiAgICBbJ29yZGVyLXNvdXJjZScsICdvcmRlci1jYXNlJ10sCiAgICBbJ3BheW1lbnQtc291cmNlJywgJ3BheW1lbnQtY2FzZSddLAogIF0pOwogIGNvbnN0IHYyMiA9IG5ldyBNYXA8c3RyaW5nLCBWMjJBbmFseXNpc0NvbnRleHQ+KFsKICAgIFsnb3JkZXItY2FzZScsIHsKICAgICAgaWQ6ICdvcmRlci1jYXNlJywKICAgICAgam91cm5leUlkOiAnam91cm5leS0xJywKICAgICAgY3VzdG9tZXJJZDogJ2N1c3RvbWVyLTM2NDMnLAogICAgICBjYXNlVHlwZTogJ29yZGVyJywKICAgICAgb3JkZXJJbnRlbnQ6IHRydWUsCiAgICAgIG9yZGVyQ29uZmlybWVkOiB0cnVlLAogICAgfV0sCiAgICBbJ3BheW1lbnQtY2FzZScsIHsKICAgICAgaWQ6ICdwYXltZW50LWNhc2UnLAogICAgICBqb3VybmV5SWQ6ICdqb3VybmV5LTEnLAogICAgICBjdXN0b21lcklkOiAnY3VzdG9tZXItMzY0MycsCiAgICAgIGNhc2VUeXBlOiAnZm9sbG93dXAnLAogICAgICBvcmRlckludGVudDogZmFsc2UsCiAgICAgIG9yZGVyQ29uZmlybWVkOiBmYWxzZSwKICAgIH1dLAogIF0pOwoKICBjb25zdCBvcmRlciA9IHsKICAgIGlkOiAnb3JkZXItc291cmNlJywKICAgIHNvdXJjZV9maWxlbmFtZTogJ9in2KjYsdin2YfZitmFINin2YTYtdmK2KfYryDZo9a2NOKjICgxKS56aXAnLAogICAgcmF3X3RleHQ6ICdbOS8yNy8yNiwgOTowMzozNCBQTV0gQ3VzdG9tZXI6INi52YTYqNiq2YrZhiDZhNio2YYg2YfZitix2Ygg2KjZitio2YrXmFtcblxuWzkvMjcvMjYsIDk6MDY6MDAgUE1dIFlvdTog2KzYp9ix2Yog2KfZhNin2LHYs9in2YQnLAogICAgY29udmVyc2F0aW9uX3N0YXJ0ZWRfYXQ6ICcyMDI2LTA5LTI3VDE4OjAzOjM0WicsCiAgICBjb252ZXJzYXRpb25fZW5kZWRfYXQ6ICcyMDI2LTA5LTI3VDE4OjE1OjM1WicsCiAgICBjdXN0b21lcl9pZDogJ2N1c3RvbWVyLTM2NDMnLAogICAgY3VzdG9tZXJfY29kZTogJzM2NDMnLAogICAgY3VzdG9tZXJfbmFtZTogJ9in2KjYsdin2YfZitmFINin2YTYtdmK2KfYrycsCiAgICBjdXN0b21lcl9waG9uZTogJzAxMDE2ODkxOTQwJywKICB9OwoKICBjb25zdCBwYXltZW50ID0gewogICAgaWQ6ICdwYXltZW50LXNvdXJjZScsCiAgICBzb3VyY2VfZmlsZW5hbWU6ICfYp9io2LHYp9mH2YrZhSDYp9mE2LXZitin2K8g2aPWtjTioyAoMSkuemlwJywKICAgIHJhd190ZXh0OiAnWzkvMjgvMjYsIDI6NTI6MDkgQU1dIFlvdTog2KfYqtmB2LbZhCDYsdmC2YUg2KfZhNiq2K3ZiNmK2YQg2YrYpyDZgdmG2K/ZhSAwMTAyODMwODIzNVxuWzkvMjgvMjYsIDM6MDg6MDkgQU1dIEN1c3RvbWVyOiDYp9mE2K3Ys9in2Kgg2YPYp9mFINmF2YYg2YHYttmE2YPcbls5LzI4LzI2LCAzOjEwOjQwIEFNXSBZb3U6INmI2LXYpyDYtNmD2LHYpyDYrNiy2YrZhNinJywKICAgIGNvbnZlcnNhdGlvbl9zdGFydGVkX2F0OiAnMjAyNi0wOS0yN1QyMzo1MjowOVonLAogICAgY29udmVyc2F0aW9uX2VuZGVkX2F0OiAnMjAyNi0wOS0yOFQwMDoxMDo0MFonLAogICAgY3VzdG9tZXJfaWQ6ICdjdXN0b21lci0zNjQzJywKICAgIGN1c3RvbWVyX2NvZGU6ICczNjQzJywKICAgIGN1c3RvbWVyX25hbWU6ICfYp9io2LHYp9mH2YrZhSDYp9mE2LXZitin2K8nLAogICAgY3VzdG9tZXJfcGhvbmU6ICcwMTAxNjg5MTk0MCcsCiAgfTsKCiAgaXQoJ2ZlZWRzIG9uZSBvcmRlci1hbmNob3IgY29udmVyc2F0aW9uIHRvIFY5IHdpdGggdGhlIHBheW1lbnQtc2V0dGxlbWVudCBjb250ZXh0JywgKCkgPT4gewogICAgY29uc3QgY29udmVyc2F0aW9ucyA9IGJ1aWxkQ2Fub25pY2FsQW5hbHlzaXNDb252ZXJzYXRpb25zKFtvc mRlciwgcGF5bWVudF0sIHNvdXJjZU1hcCwgdjIyKTsKICAgIGV4cGVjdChjb252ZXJzYXRpb25zKS50b0hhdmVMZW5ndGgoMSk7CiAgICBleHBlY3QoY29udmVyc2F0aW9uc1swXS5jb252ZXJzYXRpb25JZCkudG9CZSgnb3JkZXItc291cmNlJyk7CiAgICBleHBlY3QoY29udmVyc2F0aW9uc1swXS5zb3VyY2VDYXNlSWRWMjIpLnRvQmUoJ29yZGVyLWNhc2UnKTsKICAgIGV4cGVjdChjb252ZXJzYXRpb25zWzBdLnJhd1doYXRzQXBwRXhwb3J0VGV4dCkudG9Db250YWluKCfYudmE2KjYqtmK2YYg2YTYqNio2YYg2YfZitix2Ygg2KjZitio2YknKTsKICAgIGV4cGVjdChjb252ZXJzYXRpb25zWzBdLnJhd1doYXRzQXBwRXhwb3J0VGV4dCkudG9Db250YWluKCfYsdmC2YUg2KfZhNiq2K3ZiNmK2YQnKTsKICAgIGV4cGVjdChjb252ZXJzYXRpb25zWzBdLnJhd1doYXRzQXBwRXhwb3J0VGV4dCkudG9Db250YWluKCfZiNi12YQg2LTZg9ix2Kcg2KzYstmK2YTYpycpOwogIH0pOwoKICBpdCgnZmFpbHMgY2xvc2VkIGZvciBhIGdlbmVyaWMgZm9sbG93dXAgd2l0aCBubyBleHBsaWNpdCBwYXltZW50IGhhbmRvZmYnLCAoKSA9PiB7CiAgICBjb25zdCBnZW5lcmljID0geyAuLi5wYXltZW50LCByYXdfdGV4dDogJ1s5LzI4LzI2LCAyOjUyOjA5IEFNXSBZb3U6INmF2LPYp9ihINin2YTYrtmK2LEg2YrYpyDZgdmG2K/ZhScgfTsKICAgIGNvbnN0IGNvbnZlcnNhdGlvbnMgPSBidWlsZENhbm9uaWNhbEFuYWx5c2lzQ29udmVyc2F0aW9ucyhb b3JkZXIsIGdlbmVyaWNdLCBzb3VyY2VNYXAsIHYyMik7CiAgICBleHBlY3QoY29udmVyc2F0aW9ucykudG9IYXZlTGVuZ3RoKDIpOwogIH0pOwoKICBpdCgnZmFpbHMgY2xvc2VkIHdoZW4gdGhlIHNhbWUgam91cm5leSBjb250YWlucyBtb3JlIHRoYW4gb25lIG9yZGVyIGFuY2hvcicsICgpID0+IHsKICAgIGNvbnN0IGNvbnRleHRzID0gbmV3IE1hcCh2MjIpOwogICAgY29udGV4dHMuc2V0KCdwYXltZW50LWNhc2UnLCB7CiAgICAgIC4uLnYyMi5nZXQoJ3BheW1lbnQtY2FzZScpISwKICAgICAgY2FzZVR5cGU6ICdvcmRlcicsCiAgICAgIG9yZGVySW50ZW50OiB0cnVlLAogICAgfSk7CiAgICBjb25zdCBjb252ZXJzYXRpb25zID0gYnVpbGRDYW5vbmljYWxBbmFseXNpc0NvbnZlcnNhdGlvbnMoW29yZGVyLCBwYXltZW50XSwgc291cmNlTWFwLCBjb250ZXh0cyk7CiAgICBleHBlY3QoY29udmVyc2F0aW9ucykudG9IYXZlTGVuZ3RoKDIpOwogIH0pOwp9KTsK")
Path("src/lib/salesIntelligence/refresh/__tests__/canonicalJourneyPaymentContext.test.ts").write_bytes(test_bytes)
