import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import {
  extractConfirmationSignals,
  extractQuantitySignals,
  isRequestCandidate,
  isSubstantiveConfirmationSignal,
} from '@/lib/whatsappSemanticSignalsV32';

// V32.2.1 hardening — three logical risks found reviewing commit c4784d7 (V32.2), fixed here:
// (1) QUANTITY_RX let a naked number ("250", a phone number) satisfy the quantity check inside
//     isConfirmationContextuallyLinked(), so a price/phone answer could wrongly look like the
//     thing a later implicit confirmation ("من عنيا لحضرتك") was confirming.
// (2) resolutionAfterCorrection called any staff message after a correction "resolved", even a
//     bare "تمام" or a message about something unrelated.
// (3) isRequestCandidate() treated any non-greeting meaningful customer message as a valid
//     Understanding trigger, including "شكرا"/"تمام"/"خلاص ابعته".

function understandingOf(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions.length).toBeGreaterThan(0);
  return buildConversationUnderstandingV32(sessions[0]);
}

describe('whatsappSemanticSignalsV32 — V32.2.1 hardening', () => {
  describe('Quantity false positives', () => {
    it('a price question ("هو بـ 250؟") does not make a later implicit confirmation an order confirmation', () => {
      const raw = `[9/15/26, 9:00:00 AM] Customer: هو بـ 250؟
[9/15/26, 9:01:00 AM] You: من عنيا لحضرتك`;
      const understanding = understandingOf(raw);
      const confirmation = extractConfirmationSignals(understanding.messages)[0];
      expect(confirmation).toBeDefined();
      expect(isSubstantiveConfirmationSignal(confirmation)).toBe(false);
      expect(confirmation.relatedMessageIds || []).toHaveLength(0);
    });

    it('a bare phone number alone does not make an implicit confirmation an order confirmation', () => {
      const raw = `[9/15/26, 9:00:00 AM] Customer: رقمي 01012345678
[9/15/26, 9:01:00 AM] You: من عنيا لحضرتك`;
      const understanding = understandingOf(raw);
      const confirmation = extractConfirmationSignals(understanding.messages)[0];
      expect(confirmation).toBeDefined();
      expect(isSubstantiveConfirmationSignal(confirmation)).toBe(false);
      expect(confirmation.relatedMessageIds || []).toHaveLength(0);
    });

    it('a reference-attached quantity ("عايز اتنين منه") correctly links to the confirmation that follows', () => {
      const raw = `[9/15/26, 9:00:00 AM] You: عندنا سيروم فيتامين سي
[9/15/26, 9:01:00 AM] Customer: عايز اتنين منه
[9/15/26, 9:02:00 AM] You: من عنيا لحضرتك`;
      const understanding = understandingOf(raw);
      const confirmation = extractConfirmationSignals(understanding.messages)[0];
      expect(isSubstantiveConfirmationSignal(confirmation)).toBe(true);
      const customerMessage = understanding.messages.find((m) => m.text.includes('عايز اتنين منه'));
      expect(confirmation.relatedMessageIds).toContain(customerMessage?.id);
    });

    it('a quantity with an explicit unit ("عايز 2 علبة فيتامين د") is a real quantity signal and links the confirmation', () => {
      const raw = `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: عنيا حاضر`;
      const understanding = understandingOf(raw);
      const quantitySignal = extractQuantitySignals(understanding.messages)[0];
      expect(quantitySignal).toBeDefined();
      expect(quantitySignal.extractedValue).toContain('علبة');
      const confirmation = extractConfirmationSignals(understanding.messages)[0];
      expect(isSubstantiveConfirmationSignal(confirmation)).toBe(true);
    });

    it('a bare price ("السعر 90 جنيه") never produces a quantity signal', () => {
      const raw = `[9/15/26, 9:00:00 AM] Customer: السعر 90 جنيه
[9/15/26, 9:01:00 AM] You: تمام`;
      const understanding = understandingOf(raw);
      expect(extractQuantitySignals(understanding.messages)).toHaveLength(0);
    });
  });

  describe('isRequestCandidate narrowing', () => {
    function customerMessageFor(text: string) {
      const raw = `[9/15/26, 9:00:00 AM] Customer: ${text}`;
      const understanding = understandingOf(raw);
      const message = understanding.messages.find((m) => m.role === 'customer');
      if (!message) throw new Error('no customer message parsed');
      return message;
    }

    it('"شكرا لحضرتك" is not a request candidate', () => {
      expect(isRequestCandidate(customerMessageFor('شكرا لحضرتك'))).toBe(false);
    });

    it('"تمام" is not a request candidate', () => {
      expect(isRequestCandidate(customerMessageFor('تمام'))).toBe(false);
    });

    it('"خلاص ابعته" (pure acceptance) is not a request candidate', () => {
      expect(isRequestCandidate(customerMessageFor('خلاص ابعته'))).toBe(false);
    });

    it('"هو متوفر؟" (availability question) IS a valid request candidate', () => {
      expect(isRequestCandidate(customerMessageFor('هو متوفر؟'))).toBe(true);
    });

    it('"ابني عنده كحة وحرارة" (substantive need, no request verb) IS a valid request candidate', () => {
      expect(isRequestCandidate(customerMessageFor('ابني عنده كحة وحرارة'))).toBe(true);
    });

    it('"السعر كام؟" (price question) IS a valid request candidate', () => {
      expect(isRequestCandidate(customerMessageFor('السعر كام؟'))).toBe(true);
    });
  });
});
