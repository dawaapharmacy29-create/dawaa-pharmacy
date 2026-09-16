import { supabase } from '@/lib/supabase';
import type { WhatsAppCustomerJourneyIntelligenceV15 } from './whatsappCustomerJourneyIntelligenceV15';
import type { JourneySessionSourceV15 } from './whatsappCustomerJourneyPersistenceV15';

type SourceRow = {
  id: string;
  customer_id?: string | null;
  customer_code?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  branch?: string | null;
  conversation_started_at?: string | null;
  conversation_ended_at?: string | null;
  staff_id?: string | null;
  staff_name?: string | null;
};

function normalizeBranch(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '-');
}

function normalizeCode(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

function normalizePhone(value: unknown) {
  return String(value ?? '').replace(/\D/g, '');
}

export function buildCustomerStoryKeyV16(source: SourceRow) {
  if (source.customer_id) return `customer-id:${source.customer_id}`;
  const code = normalizeCode(source.customer_code);
  const branch = normalizeBranch(source.branch) || 'unknown';
  if (code) return `customer-code:${code}:${branch}`;
  const phone = normalizePhone(source.customer_phone);
  if (phone) return `customer-phone:${phone}:${branch}`;
  return null;
}

function eventTypeForRole(role: string) {
  if (role === 'complaint_or_failure') return 'order_problem';
  if (role === 'order_request') return 'customer_request';
  if (role === 'service_feedback_request') return 'service_followup';
  if (role === 'apology_recovery') return 'apology_recovery';
  if (role === 'recommendation_followup') return 'recommendation_followup';
  if (role === 'general_followup') return 'service_followup';
  return 'conversation';
}

function eventTitleForRole(role: string) {
  if (role === 'complaint_or_failure') return 'طلب متعثر / شكوى';
  if (role === 'order_request') return 'طلب عميل';
  if (role === 'service_feedback_request') return 'طلب تقييم الخدمة';
  if (role === 'apology_recovery') return 'اعتذار ومحاولة استرجاع';
  if (role === 'recommendation_followup') return 'متابعة ترشيح';
  if (role === 'general_followup') return 'متابعة من الصيدلية';
  return 'محادثة واتساب';
}

export async function syncPersistentCustomerStoryV16(params: {
  journeyId: string;
  model: WhatsAppCustomerJourneyIntelligenceV15;
  sources: SourceRow[];
  sessionSources: JourneySessionSourceV15[];
  branch?: string | null;
  createdBy?: string | null;
}) {
  const { journeyId, model, sources, sessionSources } = params;
  const root = sources.find((row) => row.customer_id || row.customer_code || row.customer_phone) || sources[0];
  if (!root) return null;
  const storyKey = buildCustomerStoryKeyV16({ ...root, branch: params.branch || root.branch });
  if (!storyKey) return null;

  const startedAt = sources.map((s) => s.conversation_started_at).filter(Boolean).sort()[0] || new Date().toISOString();
  const endedAt = sources.map((s) => s.conversation_ended_at).filter(Boolean).sort().at(-1) || startedAt;
  const needsRecovery = model.unresolvedOrder || model.unresolvedComplaint || model.customerState === 'silent_after_problem' || model.customerState === 'silent_after_recovery';

  const { data: existing, error: existingError } = await supabase
    .from('whatsapp_customer_stories')
    .select('*')
    .eq('story_key', storyKey)
    .maybeSingle();
  if (existingError && existingError.code !== 'PGRST116') throw existingError;

  const storyPayload = {
    story_key: storyKey,
    branch: params.branch || root.branch || null,
    customer_id: root.customer_id || null,
    customer_code: root.customer_code || null,
    customer_name: root.customer_name || null,
    customer_phone: root.customer_phone || null,
    status: existing?.status === 'recovered' ? 'recovered' : needsRecovery ? 'recovery' : (existing?.status || 'active'),
    risk_level: model.customerRisk,
    story_started_at: existing?.story_started_at || startedAt,
    last_activity_at: [existing?.last_activity_at, endedAt].filter(Boolean).sort().at(-1) || endedAt,
    recovery_started_at: existing?.recovery_started_at || (needsRecovery ? startedAt : null),
    summary: model.summary,
    state_json: {
      ...(existing?.state_json || {}),
      latestJourneyId: journeyId,
      latestJourneyVersion: model.version,
      customerState: model.customerState,
      unresolvedOrder: model.unresolvedOrder,
      unresolvedComplaint: model.unresolvedComplaint,
      improvementInsights: model.improvementInsights,
      updatedFromSourceCount: sources.length,
    },
    created_by: existing?.created_by || params.createdBy || null,
    updated_at: new Date().toISOString(),
  };

  const { data: story, error: storyError } = await supabase
    .from('whatsapp_customer_stories')
    .upsert(storyPayload, { onConflict: 'story_key', ignoreDuplicates: false })
    .select('id,status,story_key')
    .single();
  if (storyError) throw storyError;

  const { error: journeyLinkError } = await supabase
    .from('whatsapp_customer_journeys')
    .update({ story_id: story.id, lifecycle_status: needsRecovery ? 'recovery' : 'open', updated_at: new Date().toISOString() })
    .eq('id', journeyId);
  if (journeyLinkError) throw journeyLinkError;

  const sourceBySession = new Map(sessionSources.map((x) => [x.sessionId, x.sourceId]));
  const sourceById = new Map(sources.map((x) => [String(x.id), x]));
  const eventRows: any[] = [];
  for (const session of model.sessions) {
    const sourceId = sourceBySession.get(session.sessionId) || null;
    const source = sourceId ? sourceById.get(sourceId) : null;
    const eventType = eventTypeForRole(session.role);
    eventRows.push({
      story_id: story.id,
      event_key: `journey:${journeyId}:session:${session.sessionId}:${eventType}`,
      event_type: eventType,
      event_at: session.startedAt,
      journey_id: journeyId,
      source_id: sourceId,
      staff_id: source?.staff_id || null,
      staff_name: source?.staff_name || session.staffNames[0] || null,
      confidence: session.confidence,
      title: eventTitleForRole(session.role),
      detail: session.orderFailed
        ? 'ظهر تعثر في الطلب ويحتاج متابعة حتى حل السبب أو عودة العميل للشراء.'
        : session.customerSilentAfterOutbound
          ? 'انتهت الجلسة برسالة من الصيدلية بدون رد لاحق من العميل.'
          : session.label,
      payload: session,
    });
    if (session.apologyDetected || session.feedbackRequestDetected || session.role === 'general_followup') {
      eventRows.push({
        story_id: story.id,
        event_key: `journey:${journeyId}:recovery:${session.sessionId}`,
        event_type: 'recovery_attempt',
        event_at: session.startedAt,
        journey_id: journeyId,
        source_id: sourceId,
        staff_id: source?.staff_id || null,
        staff_name: source?.staff_name || session.staffNames[0] || null,
        confidence: session.confidence,
        title: 'محاولة استرجاع العميل',
        detail: session.apologyDetected ? 'تم إرسال اعتذار/احتواء بعد المشكلة.' : 'تمت محاولة متابعة العميل بعد التجربة.',
        payload: { role: session.role, customerSilentAfterOutbound: session.customerSilentAfterOutbound },
      });
    }
  }

  eventRows.push({
    story_id: story.id,
    event_key: `journey:${journeyId}:summary`,
    event_type: needsRecovery ? 'journey_recovery_opened' : 'journey_recorded',
    event_at: endedAt,
    journey_id: journeyId,
    source_id: null,
    confidence: model.customerRisk === 'critical' ? 96 : model.customerRisk === 'high' ? 90 : 80,
    title: needsRecovery ? 'فتح مسار استرجاع للعميل' : 'تحديث قصة العميل',
    detail: model.summary,
    payload: {
      customerState: model.customerState,
      customerRisk: model.customerRisk,
      recoveryAttempts: model.recoveryAttempts,
      unresolvedOrder: model.unresolvedOrder,
      unresolvedComplaint: model.unresolvedComplaint,
    },
  });

  if (eventRows.length) {
    const { error: eventError } = await supabase
      .from('whatsapp_customer_story_events')
      .upsert(eventRows, { onConflict: 'story_id,event_key', ignoreDuplicates: false });
    if (eventError) throw eventError;
  }

  const { error: refreshError } = await supabase.rpc('dawaa_refresh_whatsapp_customer_story_v16', { p_story_id: story.id });
  if (refreshError) throw refreshError;

  return { storyId: String(story.id), storyKey, status: story.status, events: eventRows.length };
}
