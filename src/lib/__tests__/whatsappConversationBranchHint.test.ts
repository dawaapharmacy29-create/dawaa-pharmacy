import { describe, expect, it, vi } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';
import type { WhatsAppParticipantRoleModelV15 } from '@/lib/whatsappParticipantRoleResolverV15';

const STAFF_ROWS = [
  { id: 's1', name: 'أحمد', branch: 'فرع الشامي', role: 'customer_service', is_active: true, active: true },
  { id: 's2', name: 'هبة', branch: 'فرع شكري', role: 'pharmacist', is_active: true, active: true },
];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        or: () => chain,
        eq: () => chain,
        limit: async () => {
          if (table === 'staff') return { data: STAFF_ROWS, error: null };
          if (table === 'staff_identity_aliases') return { data: [], error: null };
          return { data: [], error: null };
        },
      };
      return chain;
    },
  },
}));

function msg(id: string, at: string, direction: 'inbound' | 'outbound', text: string): WhatsAppParsedMessage {
  return {
    id,
    timestamp: new Date(at),
    rawTimestamp: at,
    sender: direction === 'inbound' ? 'عميل تجريبي' : 'staff',
    text,
    direction,
    kind: 'text',
    forwarded: false,
    raw: text,
  };
}

function session(messages: WhatsAppParsedMessage[], outboundStaffNames: string[] = []): WhatsAppConversationSession {
  return {
    id: 'session-1',
    startedAt: messages[0].timestamp,
    endedAt: messages[messages.length - 1].timestamp,
    messages,
    participants: ['عميل تجريبي'],
    outboundStaffNames,
    customerName: 'عميل تجريبي',
    mediaCount: 0,
  };
}

function emptyRoles(branches: (string | null)[] = []): WhatsAppParticipantRoleModelV15 {
  return {
    version: 'whatsapp-participant-role-v15',
    messages: [],
    staff: branches.map((branch, i) => ({
      accountId: `a${i}`,
      staffId: `a${i}`,
      staffName: `staff${i}`,
      role: 'customer_service',
      branch,
      confidence: 90,
    })),
  };
}

describe('resolveConversationBranchHint', () => {
  it('tier 1: a source branch always wins, regardless of ownership/staff data', async () => {
    const { resolveConversationBranchHint } = await import('@/lib/whatsappConversationBranchHint');
    const s = session([msg('m1', '2026-09-01T10:00:00', 'inbound', 'عايز استفسار')]);
    const result = await resolveConversationBranchHint(s, emptyRoles(), 'فرع شكري');
    expect(result).toEqual({ value: 'فرع شكري', source: 'source', reason: expect.any(String) });
  });

  it('tier 2: a CS→doctor handoff across branches resolves to the FIRST verified owner\'s branch, not a blend', async () => {
    const { resolveConversationBranchHint } = await import('@/lib/whatsappConversationBranchHint');
    const messages = [
      msg('m1', '2026-09-01T10:00:00', 'outbound', 'مع حضرتك أحمد من خدمة عملاء صيدليات دواء، حبينا نطمن عليك'),
      msg('m2', '2026-09-01T10:01:00', 'inbound', 'الحمد لله بس عندي سؤال طبي'),
      msg('m3', '2026-09-01T10:02:00', 'outbound', 'مع حضرتك د هبة'),
      msg('m4', '2026-09-01T10:03:00', 'inbound', 'شكرا يا دكتورة'),
    ];
    const s = session(messages);
    const result = await resolveConversationBranchHint(s, emptyRoles(), null);
    // أحمد (فرع الشامي) بدأ ملكية المحادثة؛ هبة (فرع شكري) انضمت بعد كده — يجب ألا يتم
    // خلط الفرعين، والفرع الصحيح هو فرع أول مالك متحقق منه.
    expect(result.value).toBe('فرع الشامي');
    expect(result.source).toBe('active_owner');
  });

  it('tier 3: no ownership intro but a resolvable outbound staff name falls back to the staff resolver', async () => {
    const { resolveConversationBranchHint } = await import('@/lib/whatsappConversationBranchHint');
    const messages = [
      msg('m1', '2026-09-01T10:00:00', 'outbound', 'أهلا بحضرتك'),
      msg('m2', '2026-09-01T10:01:00', 'inbound', 'شكرا'),
    ];
    const s = session(messages, ['أحمد']);
    const result = await resolveConversationBranchHint(s, emptyRoles(), null);
    expect(result.value).toBe('فرع الشامي');
    expect(result.source).toBe('staff_resolver');
  });

  it('tier 4: nothing resolvable falls back to the V15 majority vote', async () => {
    const { resolveConversationBranchHint } = await import('@/lib/whatsappConversationBranchHint');
    const messages = [msg('m1', '2026-09-01T10:00:00', 'outbound', 'أهلا بحضرتك'), msg('m2', '2026-09-01T10:01:00', 'inbound', 'شكرا')];
    const s = session(messages, []);
    const result = await resolveConversationBranchHint(s, emptyRoles(['فرع الشامي', 'فرع الشامي', 'فرع شكري']), null);
    expect(result.value).toBe('فرع الشامي');
    expect(result.source).toBe('majority_fallback');
  });

  it('resolves to none when no signal exists anywhere', async () => {
    const { resolveConversationBranchHint } = await import('@/lib/whatsappConversationBranchHint');
    const messages = [msg('m1', '2026-09-01T10:00:00', 'outbound', 'أهلا بحضرتك'), msg('m2', '2026-09-01T10:01:00', 'inbound', 'شكرا')];
    const s = session(messages, []);
    const result = await resolveConversationBranchHint(s, emptyRoles([]), null);
    expect(result.value).toBeNull();
    expect(result.source).toBe('none');
  });
});
