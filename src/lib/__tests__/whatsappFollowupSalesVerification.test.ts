import { describe, expect, it } from 'vitest';
import {
  rankFollowupSaleCandidates,
  saleCandidateCanBeHumanConfirmed,
} from '@/lib/whatsappFollowupSalesVerification';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'INV-1',
  invoice_number: '1001',
  invoice_date: '2026-09-18T10:00:00+03:00',
  branch: 'فرع شكري',
  amount: 450,
  customer_phone: '01001234567',
  ...overrides,
});

describe('WhatsApp follow-up sale verification', () => {
  it('keeps only invoices after the signal and inside the requested window', () => {
    const candidates = rankFollowupSaleCandidates({
      rows: [
        row({ id: 'before', invoice_date: '2026-09-16T12:00:00+03:00' }),
        row({ id: 'inside', invoice_date: '2026-09-20T12:00:00+03:00' }),
        row({ id: 'late', invoice_date: '2026-10-10T12:00:00+03:00' }),
      ],
      matchedBy: 'phone',
      branch: 'شكري',
      signalAt: '2026-09-17T09:00:00+03:00',
      windowDays: 14,
    });

    expect(candidates.map((candidate) => candidate.invoiceId)).toEqual(['inside']);
  });

  it('rejects a candidate from another known branch', () => {
    const candidates = rankFollowupSaleCandidates({
      rows: [row({ branch: 'فرع الشامي' })],
      matchedBy: 'phone',
      branch: 'فرع شكري',
      signalAt: '2026-09-17T09:00:00+03:00',
    });

    expect(candidates).toHaveLength(0);
  });

  it('gives exact phone identity enough confidence for human confirmation', () => {
    const [candidate] = rankFollowupSaleCandidates({
      rows: [row()],
      matchedBy: 'phone',
      branch: 'شكري',
      signalAt: '2026-09-17T09:00:00+03:00',
    });

    expect(candidate.confidence).toBeGreaterThanOrEqual(0.75);
    expect(saleCandidateCanBeHumanConfirmed(candidate)).toBe(true);
  });

  it('keeps name-only matching below the human-confirm threshold even when branch and date align', () => {
    const [candidate] = rankFollowupSaleCandidates({
      rows: [row()],
      matchedBy: 'name',
      branch: 'شكري',
      signalAt: '2026-09-17T09:00:00+03:00',
    });

    expect(candidate.confidence).toBeLessThan(0.75);
    expect(saleCandidateCanBeHumanConfirmed(candidate)).toBe(false);
  });

  it('requires a real invoice id before confirmation', () => {
    const [candidate] = rankFollowupSaleCandidates({
      rows: [row({ id: null })],
      matchedBy: 'phone',
      branch: 'شكري',
      signalAt: '2026-09-17T09:00:00+03:00',
    });

    expect(candidate.confidence).toBeGreaterThanOrEqual(0.75);
    expect(saleCandidateCanBeHumanConfirmed(candidate)).toBe(false);
  });
});
