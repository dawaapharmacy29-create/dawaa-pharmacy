import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
  WhatsAppConversationSession,
  WhatsAppParsedMessage,
} from '@/lib/whatsappConversationParser';

const persistPointsTransactionMock = vi.fn();
const resolveStaffNameToStaffIdMock = vi.fn();
const appendWhatsAppReviewAuditMock = vi.fn();

vi.mock('@/lib/pointsPersistence', () => ({
  persistPointsTransaction: (...args: unknown[]) => persistPointsTransactionMock(...args),
}));

vi.mock('@/lib/staffIdentityMapping', () => ({
  resolveStaffNameToStaffId: (...args: unknown[]) => resolveStaffNameToStaffIdMock(...args),
}));

vi.mock('@/lib/whatsappReviewPersistenceV4', () => ({
  appendWhatsAppReviewAudit: (...args: unknown[]) => appendWhatsAppReviewAuditMock(...args),
}));

const STAFF_ROW = {
  id: 'staff-1',
  name: 'د أحمد',
  branch: 'الفرع الرئيسي',
  branch_id: 'branch-1',
  role: 'doctor',
};

function makeSupabaseMock() {
  return {
    from(table: string) {
      let mode: 'select' | 'insert' | 'update' = 'select';
      const chain: Record<string, unknown> = {
        select: () => {
          if (mode !== 'insert' && mode !== 'update') mode = 'select';
          return chain;
        },
        eq: () => chain,
        insert: () => {
          mode = 'insert';
          return chain;
        },
        update: () => {
          mode = 'update';
          return chain;
        },
        maybeSingle: async () => {
          if (table === 'staff') return { data: STAFF_ROW, error: null };
          if (table === 'conversation_sales_reviews') return { data: null, error: null };
          return { data: null, error: null };
        },
        single: async () => {
          if (table === 'conversation_sales_reviews' && mode === 'insert') {
            return { data: { id: 'review-1' }, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: (value: unknown) => void) => resolve({ data: null, error: null }),
      };
      return chain;
    },
  };
}

vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return makeSupabaseMock();
  },
}));

function msg(
  id: string,
  at: string,
  direction: 'inbound' | 'outbound',
  text: string
): WhatsAppParsedMessage {
  return {
    id,
    timestamp: new Date(at),
    rawTimestamp: at,
    sender: direction === 'inbound' ? 'عميل تجريبي' : 'You',
    text,
    direction,
    kind: 'text',
    forwarded: false,
    raw: text,
    sourceFormat: 'txt',
    replyTo: null,
    mediaPlaceholder: false,
    mediaAvailable: false,
  };
}

function buildMultiStaffSession(): WhatsAppConversationSession {
  const messages = [
    msg('m1', '2026-09-01T10:00:00', 'inbound', 'محتاج صنف'),
    msg('m2', '2026-09-01T10:10:00', 'outbound', 'مع حضرتك د أحمد من صيدليات دواء'),
    msg('m3', '2026-09-01T10:15:00', 'outbound', 'مع حضرتك د محمد من صيدليات دواء وهكمل مع حضرتك'),
  ];
  return {
    id: 'session-multi',
    startedAt: messages[0].timestamp,
    endedAt: messages[messages.length - 1].timestamp,
    messages,
    participants: ['عميل تجريبي', 'You'],
    outboundStaffNames: ['أحمد', 'محمد'],
    customerName: 'عميل تجريبي',
    mediaCount: 0,
    missingMediaCount: 0,
    replyCount: 0,
    forwardedCount: 0,
  };
}

function buildSession(): WhatsAppConversationSession {
  const messages = [
    msg('m1', '2026-09-01T10:00:00', 'inbound', 'محتاج استفسار عن دواء الضغط'),
    msg(
      'm2',
      '2026-09-01T10:02:00',
      'outbound',
      'أهلًا وسهلًا بحضرتك، معاك د أحمد من خدمة عملاء صيدليات دواء'
    ),
    msg('m3', '2026-09-01T10:05:00', 'outbound', 'تحت امر حضرتك في اي وقت'),
  ];
  return {
    id: 'session-1',
    startedAt: messages[0].timestamp,
    endedAt: messages[messages.length - 1].timestamp,
    messages,
    participants: ['عميل تجريبي', 'You'],
    outboundStaffNames: ['أحمد'],
    customerName: 'عميل تجريبي',
    mediaCount: 0,
    missingMediaCount: 0,
    replyCount: 0,
    forwardedCount: 0,
  };
}

const CYCLE = {
  start: new Date('2026-09-01'),
  end: new Date('2026-09-30'),
  label: 'سبتمبر 2026',
  shortLabel: 'سبتمبر',
};

describe('persistAutomaticWhatsAppReview', () => {
  beforeEach(() => {
    persistPointsTransactionMock.mockReset();
    resolveStaffNameToStaffIdMock.mockReset();
    appendWhatsAppReviewAuditMock.mockReset();
    resolveStaffNameToStaffIdMock.mockResolvedValue('staff-1');
  });

  it('reports pointsError and pointsRecorded=false when the approved RPC fails, instead of pretending success', async () => {
    persistPointsTransactionMock.mockResolvedValue({
      error: 'تعذر تسجيل حركة النقاط عبر مسار V3 المعتمد.',
    });

    const { persistAutomaticWhatsAppReview } =
      await import('@/lib/whatsappAutomaticReviewPersistence');
    const outcome = await persistAutomaticWhatsAppReview({
      sourceId: 'source-1',
      session: buildSession(),
      branch: 'الفرع الرئيسي',
      customerId: null,
      customerCode: null,
      customerName: 'عميل تجريبي',
      customerPhone: null,
      staffName: 'أحمد',
      reviewCycle: CYCLE,
    });

    // الإصلاح المطلوب: مينفعش نعتبر أثر النقاط "اتسجل" لو الـ RPC فشل فعليًا.
    expect(persistPointsTransactionMock).toHaveBeenCalled();
    expect(outcome.status).toBe('saved');
    expect(outcome.reviewId).toBe('review-1');
    expect(outcome.pointsRecorded).toBe(false);
    expect(outcome.pointsError).toBe('تعذر تسجيل حركة النقاط عبر مسار V3 المعتمد.');
  });

  it('always forces status "pending" on the points transaction, regardless of the computed impact status', async () => {
    persistPointsTransactionMock.mockResolvedValue({ error: null, id: 'txn-1' });

    const { persistAutomaticWhatsAppReview } =
      await import('@/lib/whatsappAutomaticReviewPersistence');
    const outcome = await persistAutomaticWhatsAppReview({
      sourceId: 'source-2',
      session: buildSession(),
      branch: 'الفرع الرئيسي',
      customerId: null,
      customerCode: null,
      customerName: 'عميل تجريبي',
      customerPhone: null,
      staffName: 'أحمد',
      reviewCycle: CYCLE,
    });

    expect(outcome.pointsRecorded).toBe(true);
    expect(outcome.pointsError).toBeNull();
    expect(persistPointsTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' })
    );
  });

  it('skips silently when the staff name cannot be resolved to a staff_id', async () => {
    resolveStaffNameToStaffIdMock.mockResolvedValue(null);

    const { persistAutomaticWhatsAppReview } =
      await import('@/lib/whatsappAutomaticReviewPersistence');
    const outcome = await persistAutomaticWhatsAppReview({
      sourceId: 'source-3',
      session: buildSession(),
      branch: null,
      customerId: null,
      customerCode: null,
      customerName: 'عميل تجريبي',
      customerPhone: null,
      staffName: 'موظف غير معروف',
      reviewCycle: CYCLE,
    });

    expect(outcome.status).toBe('skipped_no_staff');
    expect(persistPointsTransactionMock).not.toHaveBeenCalled();
  });
  it('skips automatic review when multiple staff identities appear in one session', async () => {
    persistPointsTransactionMock.mockResolvedValue({ error: null, id: 'txn-ambiguous' });

    const { persistAutomaticWhatsAppReview } =
      await import('@/lib/whatsappAutomaticReviewPersistence');
    const outcome = await persistAutomaticWhatsAppReview({
      sourceId: 'source-multi-staff',
      session: buildMultiStaffSession(),
      branch: 'الفرع الرئيسي',
      customerId: null,
      customerCode: null,
      customerName: 'عميل تجريبي',
      customerPhone: null,
      staffName: 'أحمد',
      reviewCycle: CYCLE,
    });

    expect(outcome.status).toBe('skipped_ambiguous_staff');
    expect(outcome.error).toMatch(/أكثر من هوية موظف|تقييم بشري/);
    expect(resolveStaffNameToStaffIdMock).not.toHaveBeenCalled();
    expect(persistPointsTransactionMock).not.toHaveBeenCalled();
  });

});
