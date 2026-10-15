import { describe, expect, it } from 'vitest';
import { cairoCalendarParts, cairoWallClockToDate } from '@/lib/time/cairoDateBoundary';
import { monthCycleFromDate } from '@/lib/conversationReviews';
import { parseWhatsAppExport } from '@/lib/whatsappConversationParser';

// Expected instants are what `new Date(y, m - 1, d, h, mi)` returns on a machine set to
// Africa/Cairo; these helpers must return them on ANY machine timezone.
const iso = (date: Date | null) => date?.toISOString() ?? null;

describe('Cairo wall-clock boundary (machine-timezone independent)', () => {
  it('converts ordinary winter and summer readings', () => {
    expect(iso(cairoWallClockToDate(2026, 1, 15, 9, 0))).toBe('2026-01-15T07:00:00.000Z');
    expect(iso(cairoWallClockToDate(2026, 9, 15, 9, 0))).toBe('2026-09-15T06:00:00.000Z');
  });

  it('follows the ECMAScript DST rules exactly like a Cairo machine', () => {
    // spring-forward gap (00:00 → 01:00 on 24 Apr 2026): skipped time moves forward
    expect(iso(cairoWallClockToDate(2026, 4, 24, 0, 30))).toBe('2026-04-23T22:30:00.000Z');
    expect(iso(cairoWallClockToDate(2026, 4, 24, 1, 30))).toBe('2026-04-23T22:30:00.000Z');
    // fall-back overlap (24:00 → 23:00 on 29 Oct 2026): ambiguous time resolves to the earlier instant
    expect(iso(cairoWallClockToDate(2026, 10, 29, 23, 30))).toBe('2026-10-29T20:30:00.000Z');
    expect(iso(cairoWallClockToDate(2026, 10, 30, 0, 30))).toBe('2026-10-29T22:30:00.000Z');
  });

  it('reads the Cairo calendar day, not the UTC one', () => {
    expect(cairoCalendarParts(new Date('2026-09-25T22:30:00.000Z'))).toEqual({ year: 2026, month: 9, day: 26 });
    expect(cairoCalendarParts(new Date('2026-09-25T20:30:00.000Z'))).toEqual({ year: 2026, month: 9, day: 25 });
  });

  it('assigns the pharmacy month cycle from the Cairo day (26th starts the next cycle)', () => {
    expect(monthCycleFromDate('2026-09-25T20:30:00.000Z')).toBe('2026-09'); // 23:30 Cairo on the 25th
    expect(monthCycleFromDate('2026-09-25T22:30:00.000Z')).toBe('2026-10'); // 01:30 Cairo on the 26th
    expect(monthCycleFromDate('2026-12-25T22:30:00.000Z')).toBe('2027-01'); // year rollover
  });

  it('parses native WhatsApp export clocks as Cairo time', () => {
    const [message] = parseWhatsAppExport('[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د');
    expect(iso(message.timestamp)).toBe('2026-09-15T06:00:00.000Z');
  });
});
