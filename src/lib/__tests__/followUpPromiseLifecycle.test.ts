// Follow-up promise lifecycle: the end of an export is not proof of a forgotten customer.
import { describe, expect, it } from 'vitest';
import { evaluateFollowUpPromiseLifecycle, FOLLOWUP_PROMISE_SLA } from '@/lib/followUpPromiseLifecycle';
import { buildOfficialReviewSuggestion } from '@/lib/whatsappReviewScoring';
import type { WhatsAppConversationSession } from '@/lib/whatsappConversationParser';

const T0 = '2026-10-06T07:01:00.000Z';
const plus = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();

describe('follow-up promise lifecycle', () => {
  it('promise at T0, export ends T0+1m -> pending, no penalty', () => {
    const lifecycle = evaluateFollowUpPromiseLifecycle({ promiseAt: T0, observedUntil: plus(1) })!;
    expect(lifecycle.status).toBe('pending');
    expect(lifecycle.penaltyEligible).toBe(false);
    expect(lifecycle.dueAt).toBe(plus(FOLLOWUP_PROMISE_SLA.dueAfterMinutes));
    expect(lifecycle.violationAt).toBe(plus(FOLLOWUP_PROMISE_SLA.violationAfterMinutes));
    expect(lifecycle.observedMinutes).toBe(1);
  });

  it('promise is the last message (nothing observed after it) -> pending', () => {
    expect(evaluateFollowUpPromiseLifecycle({ promiseAt: T0, observedUntil: T0 })!.status).toBe('pending');
  });

  it('past the SLA but not mature -> overdue, still no penalty', () => {
    const lifecycle = evaluateFollowUpPromiseLifecycle({ promiseAt: T0, observedUntil: plus(45) })!;
    expect(lifecycle.status).toBe('overdue');
    expect(lifecycle.penaltyEligible).toBe(false);
  });

  it('mature overdue promise (observed past the violation window) -> violated', () => {
    const lifecycle = evaluateFollowUpPromiseLifecycle({ promiseAt: T0, observedUntil: plus(180) })!;
    expect(lifecycle.status).toBe('violated');
    expect(lifecycle.penaltyEligible).toBe(true);
  });

  it('a staff return completes the promise with an explainable wait', () => {
    const lifecycle = evaluateFollowUpPromiseLifecycle({ promiseAt: T0, returnedAt: plus(4), observedUntil: plus(10) })!;
    expect(lifecycle.status).toBe('completed');
    expect(lifecycle.waitMinutes).toBe(4);
    expect(lifecycle.penaltyEligible).toBe(false);
  });
});

function session(lines: Array<[number, 'inbound' | 'outbound', string]>): WhatsAppConversationSession {
  const messages = lines.map(([minute, direction, text], index) => ({
    id: `m${index + 1}`,
    timestamp: new Date(plus(minute)),
    rawTimestamp: plus(minute),
    sender: direction === 'inbound' ? 'معاذ مزروع' : 'نور',
    text,
    direction,
    kind: 'text',
    forwarded: false,
    raw: text,
  })) as any;
  return {
    id: 's1',
    startedAt: messages[0].timestamp,
    endedAt: messages[messages.length - 1].timestamp,
    messages,
    participants: ['معاذ مزروع', 'نور'],
    outboundStaffNames: ['نور'],
    customerName: 'معاذ مزروع',
    mediaCount: 0,
  } as WhatsAppConversationSession;
}

describe('review suggestion engine uses the lifecycle (no false forgotten_customer)', () => {
  it('A1: "هراجع لحضرتك التوفر." as the last message is not "لم يرجع نهائيًا"', () => {
    const suggestion = buildOfficialReviewSuggestion(
      session([
        [-1, 'inbound', 'جاست ريج أمبول'],
        [0, 'outbound', 'أهلًا وسهلًا بحضرتك مع حضرتك د/ نور، هراجع لحضرتك التوفر.'],
      ]),
      'معاذ مزروع'
    );
    const item = suggestion.items.find((row) => row.key === 'followup_after_wait')!;
    expect(item.selectedOption).not.toBe('never');
    expect(item.status).toBe('review_required');
  });

  it('a mature unanswered promise (customer chases 3h later, no reply) may propose "never"', () => {
    const suggestion = buildOfficialReviewSuggestion(
      session([
        [-1, 'inbound', 'جاست ريج أمبول'],
        [0, 'outbound', 'هراجع لحضرتك التوفر.'],
        [180, 'inbound', 'يا دكتور؟'],
      ]),
      'معاذ مزروع'
    );
    const item = suggestion.items.find((row) => row.key === 'followup_after_wait')!;
    expect(item.selectedOption).toBe('never');
  });
});
