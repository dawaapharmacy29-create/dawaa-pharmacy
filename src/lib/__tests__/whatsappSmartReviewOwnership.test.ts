import { describe, expect, it } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '../whatsappConversationParser';
import {
  buildSmartOwnershipTimeline,
  extractSmartStaffIdentity,
  selectOwnedMessagesForStaff,
} from '../whatsappSmartReviewOwnership';

function msg(id: string, at: string, direction: 'inbound' | 'outbound', text: string): WhatsAppParsedMessage {
  return {
    id, timestamp: new Date(at), rawTimestamp: at,
    sender: direction === 'outbound' ? 'You' : 'Customer',
    text, direction, kind: 'text', forwarded: false, raw: text,
  };
}

function session(messages: WhatsAppParsedMessage[]): WhatsAppConversationSession {
  return {
    id: 's1', startedAt: messages[0].timestamp, endedAt: messages[messages.length - 1].timestamp,
    messages, participants: ['You', 'Customer'], outboundStaffNames: [], customerName: 'Customer', mediaCount: 0,
  };
}

describe('whatsappSmartReviewOwnership', () => {
  it('detects pharmacist and customer-service identities from verified introductions', () => {
    const a = extractSmartStaffIdentity(msg('m1', '2026-09-13T03:01:39', 'outbound', 'أهلًا وسهلًا بحضرتك\nمع حضرتك د اسلام\nخدمة التوصيل متاحة'));
    const b = extractSmartStaffIdentity(msg('m2', '2026-09-13T12:59:01', 'outbound', 'أهلًا بحضرتك، مع حضرتك نور من خدمة عملاء صيدليات دواء 🌷'));
    expect(a?.name).toBe('اسلام');
    expect(a?.role).toBe('pharmacist');
    expect(b?.name).toBe('نور');
    expect(b?.role).toBe('customer_service');
  });

  it('rejects text that leaks the rest of the message into the doctor name', () => {
    const identity = extractSmartStaffIdentity(msg('m1', '2026-09-13T03:01:39', 'outbound', 'مع حضرتك د هدى اقدر اساعد حضرتك ازاي؟'));
    expect(identity).toBeNull();
  });

  it('separates unique staff roster, every identity event, real handoffs and across-gap transitions', () => {
    const s = session([
      msg('n1', '2026-09-12T17:40:17', 'outbound', 'مع حضرتك نور من خدمة عملاء صيدليات دواء.'),
      msg('c1', '2026-09-13T02:59:05', 'inbound', 'السلام عليكم'),
      msg('i1', '2026-09-13T03:01:39', 'outbound', 'مع حضرتك د اسلام\nخدمة التوصيل متاحة على مدار ٢٤ ساعة'),
      msg('c2', '2026-09-13T03:06:40', 'inbound', 'محتاجه واحد من دا'),
      msg('s1', '2026-09-13T06:04:58', 'outbound', 'مع حضرتك د شبل\nخدمة التوصيل متاحة على مدار ٢٤ ساعة'),
      msg('s2', '2026-09-13T06:05:12', 'outbound', 'انا متاسف لحضرتك عالتاخير الكبير دا والله'),
      msg('n2', '2026-09-13T12:59:01', 'outbound', 'مع حضرتك نور من خدمة عملاء صيدليات دواء 🌷'),
      msg('m1', '2026-09-13T13:27:24', 'outbound', 'مع حضرتك د مي\nخدمة التوصيل متاحة على مدار ٢٤ ساعة'),
    ]);
    const result = buildSmartOwnershipTimeline(s, 120);
    expect(result.verifiedStaff.map((staff) => staff.name)).toEqual(['نور', 'اسلام', 'شبل', 'مي']);
    expect(result.identityEvents.map((staff) => staff.name)).toEqual(['نور', 'اسلام', 'شبل', 'نور', 'مي']);
    expect(result.episodes.some((episode) => episode.ownerName === null && episode.messageIds.includes('c1'))).toBe(true);
    expect(result.handoffs.map((handoff) => handoff.to)).toEqual(['مي']);
    expect(result.identityTransitions.map((item) => item.to)).toEqual(['اسلام', 'شبل', 'نور', 'مي']);
    expect(result.identityTransitions.filter((item) => item.acrossGap).map((item) => item.to)).toEqual(['اسلام', 'شبل', 'نور']);
  });

  it('records a continuous customer-service to pharmacist transfer as a real handoff', () => {
    const s = session([
      msg('n1', '2026-09-15T18:14:00', 'outbound', 'مع حضرتك نور من خدمة عملاء صيدليات دواء'),
      msg('c1', '2026-09-15T18:19:00', 'inbound', 'لسه تعبان شوية'),
      msg('n2', '2026-09-15T18:20:00', 'outbound', 'هحول حضرتك للصيدلي'),
      msg('d1', '2026-09-15T18:23:00', 'outbound', 'مع حضرتك د دنيا'),
      msg('d2', '2026-09-15T18:24:00', 'outbound', 'حضرتك بتاخد علاج ايه حاليا؟'),
    ]);
    const result = buildSmartOwnershipTimeline(s, 120);
    expect(result.handoffs.map((handoff) => handoff.to)).toEqual(['دنيا']);
    expect(result.identityTransitions[0]?.acrossGap).toBe(false);
  });

  it('resets ownership after a long gap instead of carrying an old doctor into a new conversation', () => {
    const s = session([
      msg('a1', '2026-09-12T17:40:17', 'outbound', 'مع حضرتك د اسلام'),
      msg('c1', '2026-09-12T17:42:17', 'inbound', 'تمام'),
      msg('c2', '2026-09-13T02:59:05', 'inbound', 'السلام عليكم'),
      msg('a2', '2026-09-13T03:01:39', 'outbound', 'مع حضرتك د شبل'),
    ]);
    const result = buildSmartOwnershipTimeline(s, 120);
    expect(result.episodes.some((episode) => episode.ownerName === null && episode.messageIds.includes('c2'))).toBe(true);
    expect(result.handoffs.length).toBe(0);
    expect(result.identityTransitions[0]?.acrossGap).toBe(true);
  });

  it('returns only messages inside the selected staff verified ownership episodes and respects role', () => {
    const s = session([
      msg('a1', '2026-09-13T03:01:39', 'outbound', 'مع حضرتك د اسلام'),
      msg('c1', '2026-09-13T03:06:40', 'inbound', 'محتاجه واحد من دا'),
      msg('a2', '2026-09-13T03:09:19', 'outbound', 'من عنيا لحضرتك'),
      msg('b1', '2026-09-13T03:10:58', 'outbound', 'مع حضرتك اسلام من خدمة عملاء صيدليات دواء'),
      msg('b2', '2026-09-13T03:11:12', 'outbound', 'حبيت اطمن على الخدمة'),
    ]);
    expect(selectOwnedMessagesForStaff(s, 'اسلام', 120, 'pharmacist').map((message) => message.id)).toEqual(['a1', 'c1', 'a2']);
    expect(selectOwnedMessagesForStaff(s, 'اسلام', 120, 'customer_service').map((message) => message.id)).toEqual(['b1', 'b2']);
  });
});
