import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('application consolidation — data and analytics contracts', () => {
  it('WhatsApp analytics bounds the review read on the server by period and currentness', () => {
    const page = read('src/pages/WhatsappAnalytics.tsx');
    expect(page).toMatch(/\{ column: 'is_current', operator: 'eq', value: true \}/);
    // Bounded by the operational conversation day on the Cairo calendar (same date the monthly
    // evaluation uses), not by the day the review was typed.
    expect(page).toMatch(/\{ column: 'conversation_date', operator: 'gte', value: cairoDateBoundaryIso\(startDate\) \}/);
    expect(page).toMatch(/\{ column: 'conversation_date', operator: 'lte', value: cairoDateBoundaryIso\(endDate, true\) \}/);
    expect(page).toMatch(/isOfficialConversationReview/);
    // a period that still hits the read cap is reported, never shown as complete
    expect(page).toMatch(/reviewsTruncated/);
  });

  it('the doctor dashboard activity tab turns a failed read into an error state, never an endless spinner', () => {
    const page = read('src/pages/DoctorDashboardStable.tsx');
    expect(page).toMatch(/setPart\('activity', 'error'\)/);
    expect(page).toMatch(/personalState\.activity === 'error'/);
  });
});
