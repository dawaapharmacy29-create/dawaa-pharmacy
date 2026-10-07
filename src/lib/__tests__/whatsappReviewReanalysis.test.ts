// Real reanalysis contract for whatsapp_review_sources (in-memory client, no network):
// duplicate ingest never creates a second source; reanalysis rebuilds only derived columns on the
// same durable source, is idempotent and audited, and never touches human/reviewer/invoice truth.
import { describe, expect, it } from 'vitest';
import type { WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import {
  attachInvoiceVerificationToQueue,
  persistAnalyzedWhatsAppSession,
} from '@/lib/whatsappReviewPersistenceV4';

type Row = Record<string, any>;

function createFakeClient() {
  const tables: Record<string, Row[]> = { whatsapp_review_sources: [], whatsapp_review_audit: [] };
  let seq = 0;
  const client = {
    tables,
    from(table: string) {
      const rows = (tables[table] ||= []);
      const filters: Array<[string, unknown]> = [];
      let mode: 'select' | 'update' | 'insert' = 'select';
      let payload: Row | null = null;
      const match = () => rows.filter((row) => filters.every(([key, value]) => row[key] === value));
      const chain: any = {
        select: () => chain,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return chain;
        },
        maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
        single: async () => {
          if (mode === 'insert') return { data: payload, error: null };
          const found = match()[0];
          return found ? { data: found, error: null } : { data: null, error: { code: 'PGRST116', message: 'none' } };
        },
        insert: (row: Row) => {
          mode = 'insert';
          payload = { id: `id-${++seq}`, ...row };
          rows.push(payload);
          return chain;
        },
        update: (patch: Row) => {
          mode = 'update';
          payload = patch;
          return chain;
        },
        then: (resolve: (value: unknown) => void) => {
          if (mode === 'update') for (const row of match()) Object.assign(row, payload);
          resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  };
  return client;
}

function session(): WhatsAppConversationSession {
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 6, 7, minute));
  const messages = [
    { id: 'm1', timestamp: at(0), rawTimestamp: '10/06/2026, 9:00 AM', sender: 'معاذ مزروع', text: 'جاست ريج أمبول', direction: 'inbound', kind: 'text', forwarded: false, raw: '10/06/2026, 9:00 AM - معاذ مزروع: جاست ريج أمبول' },
    { id: 'm2', timestamp: at(1), rawTimestamp: '10/06/2026, 9:01 AM', sender: 'نور', text: 'هراجع لحضرتك التوفر.', direction: 'outbound', kind: 'text', forwarded: false, raw: '10/06/2026, 9:01 AM - نور: هراجع لحضرتك التوفر.' },
  ] as any;
  return {
    id: 's1', startedAt: at(0), endedAt: at(1), messages,
    participants: ['معاذ مزروع', 'نور'], outboundStaffNames: ['نور'], customerName: 'معاذ مزروع', mediaCount: 0,
  } as WhatsAppConversationSession;
}

function intelligence(overrides: Record<string, unknown> = {}) {
  return {
    version: 'whatsapp-review-v4',
    confidence: 80,
    requiresHumanApproval: false,
    priority: 'normal',
    serviceScore: 70,
    commercialScore: 60,
    commercialEligible: true,
    chatSuggestedSold: false,
    followupRequired: true,
    suggestedFollowupReason: 'وعد بمراجعة التوفر',
    ...overrides,
  } as any;
}

describe('whatsapp review reanalysis', () => {
  it('duplicate ingest returns the same source and never duplicates or rewrites it', async () => {
    const client = createFakeClient();
    const first = await persistAnalyzedWhatsAppSession(session(), intelligence(), { customerCode: '17' }, { client });
    const second = await persistAnalyzedWhatsAppSession(session(), intelligence({ serviceScore: 99 }), {}, { client });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
    expect(client.tables.whatsapp_review_sources).toHaveLength(1);
    expect(client.tables.whatsapp_review_sources[0].service_score).toBe(70);
    expect(second.reanalysis).toBeUndefined();
  });

  it('reanalysis updates the derived version on the existing hash without a duplicate source', async () => {
    const client = createFakeClient();
    const created = await persistAnalyzedWhatsAppSession(session(), intelligence(), {}, { client });
    const reanalyzed = await persistAnalyzedWhatsAppSession(
      session(),
      intelligence({ serviceScore: 88, caseContext: { caseId: 'case-1' } }),
      { analysisVersion: 'whatsapp-smart-folder-v5', createdBy: 'reviewer' },
      { client, mode: 'reanalyze' }
    );
    expect(reanalyzed.id).toBe(created.id);
    expect(client.tables.whatsapp_review_sources).toHaveLength(1);
    const row = client.tables.whatsapp_review_sources[0];
    expect(row.analysis_version).toBe('whatsapp-smart-folder-v5');
    expect(row.service_score).toBe(88);
    expect(row.analysis_json.caseContext).toEqual({ caseId: 'case-1' });
    expect(reanalyzed.reanalysis).toEqual({ status: 'updated', fromVersion: 'whatsapp-review-v4', toVersion: 'whatsapp-smart-folder-v5' });
    const audit = client.tables.whatsapp_review_audit.filter((item) => item.action === 'analysis_reanalyzed');
    expect(audit).toHaveLength(1);
    expect(audit[0].before_state.from_version).toBe('whatsapp-review-v4');
    expect(audit[0].after_state.to_version).toBe('whatsapp-smart-folder-v5');
  });

  it('reanalysis is idempotent: same engines -> no write, no extra audit', async () => {
    const client = createFakeClient();
    await persistAnalyzedWhatsAppSession(session(), intelligence(), {}, { client });
    const ctx = { analysisVersion: 'whatsapp-smart-folder-v5' };
    await persistAnalyzedWhatsAppSession(session(), intelligence(), ctx, { client, mode: 'reanalyze' });
    const again = await persistAnalyzedWhatsAppSession(session(), intelligence(), ctx, { client, mode: 'reanalyze' });
    expect(again.reanalysis?.status).toBe('unchanged');
    expect(client.tables.whatsapp_review_audit.filter((item) => item.action === 'analysis_reanalyzed')).toHaveLength(1);
  });

  it('reanalysis preserves human review, manual invoice confirmation, corrections and reviewer fields', async () => {
    const client = createFakeClient();
    await persistAnalyzedWhatsAppSession(session(), intelligence(), {}, { client });
    const row = client.tables.whatsapp_review_sources[0];
    const human = {
      review_status: 'approved',
      official_review_id: 'review-123',
      reviewer_confirmed: true,
      reviewer_id: 'manager-1',
      reviewer_name: 'مدير',
      reviewer_confirmed_at: '2026-10-06T10:00:00.000Z',
      invoice_link_confirmed: true,
      invoice_link_confirmed_invoice_id: 'inv-9',
      invoice_link_confirmed_invoice_number: '9001',
      invoice_link_confirmed_by: 'manager-1',
      invoice_link_confirmed_at: '2026-10-06T10:05:00.000Z',
      // manual corrections
      customer_id: 'cust-corrected',
      customer_code: '17',
      staff_id: 'staff-noor',
      staff_name: 'نور',
    };
    Object.assign(row, human);
    row.analysis_json = { ...row.analysis_json, operational: { kept: true } };

    await persistAnalyzedWhatsAppSession(
      session(),
      intelligence({ serviceScore: 10, priority: 'urgent' }),
      { customerId: 'cust-other', customerCode: '99', staffId: 'staff-other', staffName: 'آخر', analysisVersion: 'whatsapp-smart-folder-v5' },
      { client, mode: 'reanalyze' }
    );
    for (const [key, value] of Object.entries(human)) expect(row[key]).toEqual(value);
    expect(row.service_score).toBe(10);
    expect(row.priority).toBe('urgent');
    // derived keys written by other writers on the same source stay
    expect(row.analysis_json.operational).toEqual({ kept: true });
  });

  it('reanalysis only fills identity/staff columns that are still empty', async () => {
    const client = createFakeClient();
    await persistAnalyzedWhatsAppSession(session(), intelligence(), {}, { client });
    const row = client.tables.whatsapp_review_sources[0];
    expect(row.customer_id).toBeNull();
    await persistAnalyzedWhatsAppSession(
      session(),
      intelligence(),
      { customerId: '17fd9821-05c2-4ebb-93dd-38f202611a52', customerCode: '17' },
      { client, mode: 'reanalyze' }
    );
    expect(row.customer_id).toBe('17fd9821-05c2-4ebb-93dd-38f202611a52');
    expect(row.customer_code).toBe('17');
  });

  it('re-attaching the same invoice verification writes no new audit row', async () => {
    const client = createFakeClient();
    const created = await persistAnalyzedWhatsAppSession(session(), intelligence(), {}, { client });
    const verification = {
      status: 'not_found', bestCandidate: null, revenue: null, verificationConfidence: 0, reason: 'no invoice',
    } as any;
    await attachInvoiceVerificationToQueue(created.id, verification, null, null, client);
    await attachInvoiceVerificationToQueue(created.id, verification, null, null, client);
    expect(client.tables.whatsapp_review_audit.filter((item) => item.action === 'invoice_verification')).toHaveLength(1);
  });
});
