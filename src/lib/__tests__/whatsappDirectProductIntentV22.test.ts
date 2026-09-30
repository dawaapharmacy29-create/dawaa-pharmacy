import { describe, expect, it } from 'vitest';
import { isDirectCommercialProductMessageV22 } from '@/lib/whatsappDirectProductIntentV22';

function message(text: string, forwarded = false) {
  return { direction: 'inbound' as const, kind: 'text' as const, forwarded, text };
}

describe('direct commercial product intent V22', () => {
  it('treats an explicit customer product request as commercial intent', () => {
    expect(isDirectCommercialProductMessageV22(message('عايز Isis teenderm gel'))).toBe(true);
  });

  it('recovers a short forwarded product name as a direct request', () => {
    expect(isDirectCommercialProductMessageV22(
      message('[Forwarded] Isis teenderm gel for sensitive skin', true)
    )).toBe(true);
  });

  it('does not convert a medical-use narrative into a purchase request', () => {
    expect(isDirectCommercialProductMessageV22(
      message('انا باخد Concor 5 والدكتور قال اكمل عليه')
    )).toBe(false);
  });

  it('does not convert a forwarded medical narrative into a purchase request', () => {
    expect(isDirectCommercialProductMessageV22(
      message('[Forwarded] عندي ضغط وباخد Concor 5 هل ينفع مع الدواء ده؟', true)
    )).toBe(false);
  });

  it('does not treat greetings or generic chat as product intent', () => {
    expect(isDirectCommercialProductMessageV22(message('مساء الخير', true))).toBe(false);
  });

  it('never treats outbound text as a customer request', () => {
    expect(isDirectCommercialProductMessageV22({
      direction: 'outbound',
      kind: 'text',
      forwarded: true,
      text: '[Forwarded] Isis teenderm gel',
    })).toBe(false);
  });
});
