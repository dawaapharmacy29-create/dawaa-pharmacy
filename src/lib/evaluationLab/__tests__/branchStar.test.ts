import { describe, expect, it } from 'vitest';
import { branchStars, starPoints, type StarInput } from '../branchStar';

const doctor = (over: Partial<StarInput> & { staffId: string }): StarInput => ({
  name: over.staffId,
  branch: 'فرع شكري',
  score: 75,
  salesPct: 100,
  followupPct: 100,
  requestsPct: 100,
  avgInvoicePct: 100,
  followups: 300,
  workedDays: 22,
  absentDays: 0,
  violations: 0,
  ...over,
});

describe('branch star', () => {
  it('weighs sales 40, follow-ups 30, requests 15, average invoice 15, capped at 150, and moves a missing part to the rest', () => {
    expect(starPoints({ salesPct: 100, followupPct: 100, requestsPct: 100, avgInvoicePct: 100 }).points).toBe(100);
    expect(starPoints({ salesPct: 300, followupPct: 0, requestsPct: 0, avgInvoicePct: 0 }).points).toBe(60);
    expect(starPoints({ salesPct: 100, followupPct: 100, requestsPct: 100, avgInvoicePct: 200 }).points).toBe(107.5);
    expect(starPoints({ salesPct: null, followupPct: 120, requestsPct: 60, avgInvoicePct: null }).points).toBe(100);
    expect(starPoints({ salesPct: null, followupPct: null, requestsPct: null, avgInvoicePct: null }).points).toBeNull();
    expect(starPoints({ salesPct: 122.7, followupPct: 179, requestsPct: 290, avgInvoicePct: 104.8 }).parts).toEqual({ sales: 122.7, followups: 150, requests: 150, avgInvoice: 104.8 });
  });

  it('ranks each branch on its own, with the gap to its leader', () => {
    const stars = branchStars(
      [
        doctor({ staffId: 'a', followupPct: 140 }),
        doctor({ staffId: 'b' }),
        doctor({ staffId: 'c', branch: 'فرع الشامي', salesPct: 80 }),
      ],
      1
    );
    expect(stars.get('a')).toMatchObject({ rank: 1, of: 2, gap: 0 });
    expect(stars.get('b')).toMatchObject({ rank: 2, of: 2, gap: 12 });
    expect(stars.get('c')).toMatchObject({ rank: 1, of: 1, leader: { name: 'c' } });
  });

  it('keeps out absence, 3+ violations, too few days and a score under 60, and says why', () => {
    const stars = branchStars(
      [
        doctor({ staffId: 'absent', absentDays: 1, followupPct: 150 }),
        doctor({ staffId: 'violations', violations: 3 }),
        doctor({ staffId: 'days', workedDays: 8 }),
        doctor({ staffId: 'score', score: 55 }),
        doctor({ staffId: 'ok', salesPct: 60 }),
      ],
      1
    );
    for (const id of ['absent', 'violations', 'days', 'score']) {
      expect(stars.get(id)).toMatchObject({ eligible: false, rank: null });
      expect(stars.get(id)!.blockers.length).toBeGreaterThan(0);
    }
    expect(stars.get('ok')).toMatchObject({ eligible: true, rank: 1, of: 1 });
    // Half-way through the month, half the working days are enough.
    expect(branchStars([doctor({ staffId: 'mid', workedDays: 10 })], 0.5).get('mid')?.eligible).toBe(true);
  });

  it('breaks a tie on fewer violations, then more follow-ups', () => {
    const stars = branchStars(
      [doctor({ staffId: 'x', violations: 1 }), doctor({ staffId: 'y' }), doctor({ staffId: 'z', followups: 500 })],
      1
    );
    expect(stars.get('z')?.rank).toBe(1);
    expect(stars.get('y')?.rank).toBe(2);
    expect(stars.get('x')?.rank).toBe(3);
  });
});
