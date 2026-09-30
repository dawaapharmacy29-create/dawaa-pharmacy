import { describe, expect, it } from 'vitest';
import { resolveEvidenceStaffV23 } from '@/lib/whatsappEvidenceLedgerV17';

describe('WhatsApp Evidence Ledger V17 message-level staff attribution', () => {
  it('attributes evidence to the staff member who owns the evidence message', () => {
    const roles = {
      messages: [
        { messageId: 'm1', role: 'pharmacist', staffId: 's1', accountId: 'a1', staffName: 'د مي', confidence: 99 },
        { messageId: 'm2', role: 'pharmacist', staffId: 's2', accountId: 'a2', staffName: 'د أميرة', confidence: 98 },
      ],
    };
    const resolved = resolveEvidenceStaffV23(roles, ['m2']);
    expect(resolved?.staffId).toBe('s2');
    expect(resolved?.staffName).toBe('د أميرة');
  });

  it('returns null rather than guessing when evidence has no attributable staff message', () => {
    const roles = {
      messages: [
        { messageId: 'c1', role: 'customer', staffId: null, accountId: null, staffName: null, confidence: 98 },
      ],
    };
    expect(resolveEvidenceStaffV23(roles, ['c1'])).toBeNull();
  });
});
