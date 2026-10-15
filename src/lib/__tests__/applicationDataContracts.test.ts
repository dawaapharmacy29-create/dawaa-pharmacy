import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('application consolidation — data and analytics contracts', () => {
  it('WhatsApp analytics bounds the review read on the server by period and currentness', () => {
    const page = read('src/pages/WhatsappAnalytics.tsx');
    expect(page).toMatch(/\{ column: 'is_current', operator: 'eq', value: true \}/);
    expect(page).toMatch(/\{ column: 'review_date', operator: 'gte', value: startDate \}/);
    expect(page).toMatch(/\{ column: 'review_date', operator: 'lte', value: endDate \}/);
    // a period that still hits the read cap is reported, never shown as complete
    expect(page).toMatch(/reviewsTruncated/);
  });

  it('auto follow-up requests call the committed v2 functions without a silent v1 retry', () => {
    const page = read('src/pages/WhatsAppAutoFollowupRequests.tsx');
    expect(page).toMatch(/whatsapp_auto_followup_list_v2/);
    expect(page).toMatch(/whatsapp_auto_followup_update_status_v2/);
    expect(page).not.toMatch(/whatsapp_auto_followup_list_v1|whatsapp_auto_followup_update_status_v1|isMissingRpc/);
  });
});
