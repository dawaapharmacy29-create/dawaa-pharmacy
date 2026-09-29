import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildUnifiedConversationIntelligence } from '@/lib/whatsappUnifiedIntelligenceV4';
import { buildWhatsAppOperationalIntelligenceV6 } from '@/lib/whatsappOperationalIntelligenceV6';

function analyze(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions.length).toBeGreaterThan(0);
  const session = sessions[0];
  const base = buildUnifiedConversationIntelligence(session);
  return buildWhatsAppOperationalIntelligenceV6(session, base);
}

describe('WhatsApp Operational Intelligence V6 complaint recovery', () => {
  it('detects delivery-attitude complaint from natural Egyptian wording and keeps followup open after apology only', () => {
    const model = analyze(`[9/27/26, 7:05:12 PM] Customer: يعني انا المندوب مكلمني 6.25
[9/27/26, 7:06:52 PM] Customer: اي الطريقه السخيفه دي اللي بيتكلم بيها بيقولي انا واقف بقالي عشر دقايق
[9/27/26, 7:08:31 PM] You: انا بعتذر جدا جدا على الموقف دا وهيتاخد اجراء معاه فورا
[9/27/26, 7:14:08 PM] Customer: شكرا مش للدرجه دي عشان حرام شغله بس خليه يبقي روحه طويله بس شويه`);

    expect(model.primaryIntent).toBe('complaint');
    expect(model.operationalOutcome).toBe('complaint_unresolved');
    expect(model.followupPlan.required).toBe(true);
    expect(model.followupPlan.ownerRole).toBe('customer_service');
    expect(model.followupPlan.dueInDays).toBe(0);
    expect(model.evidence.complaint.messageIds.length).toBeGreaterThan(0);
  });

  it('allows explicit customer closure after recovery to resolve the complaint', () => {
    const model = analyze(`[9/27/26, 7:06:52 PM] Customer: اي الطريقه السخيفه دي اللي بيتكلم بيها المندوب
[9/27/26, 7:08:31 PM] You: احنا بنعتذر لحضرتك وهنراجع الموقف
[9/27/26, 7:14:08 PM] Customer: حصل خير خلاص تمام كده`);

    expect(model.operationalOutcome).toBe('complaint_resolved');
    expect(model.followupPlan.required).toBe(false);
  });
});
