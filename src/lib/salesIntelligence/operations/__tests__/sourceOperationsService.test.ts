import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { table: string; columns?: string; filters: Array<[string, string, unknown]>; limit?: number };
const calls: Call[] = [];
let nextResult: { data: unknown; error: unknown } = { data: [], error: null };

function builder(table: string) {
  const call: Call = { table, filters: [] };
  calls.push(call);
  const chain: any = {
    select(columns: string) { call.columns = columns; return chain; },
    eq(column: string, value: unknown) { call.filters.push(['eq', column, value]); return chain; },
    lt(column: string, value: unknown) { call.filters.push(['lt', column, value]); return chain; },
    order() { return chain; },
    limit(value: number) { call.limit = value; return chain; },
    maybeSingle: async () => nextResult,
    then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
      return Promise.resolve(nextResult).then(resolve, reject);
    },
  };
  return chain;
}

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from: (table: string) => builder(table), rpc: vi.fn() },
}));

const service = await import('../sourceOperationsService');

beforeEach(() => {
  calls.length = 0;
  nextResult = { data: [], error: null };
});

describe('source operations reads', () => {
  it('opens with a summary that never reads the conversation text', async () => {
    nextResult = { data: { id: 's1', source_hash: 'h', staff_id: null, branch: 'فرع شكري' }, error: null };
    const summary = await service.loadSourceAttributionSummary('s1');
    expect(calls[0].columns).not.toContain('raw_text');
    expect(summary).not.toHaveProperty('rawText');
    await service.loadStoredSourceAttribution('s1');
    expect(calls[1].columns).toContain('raw_text');
  });

  it('bounds the proposals read to one source', async () => {
    await service.loadSourceOperationalActions('s1');
    expect(calls[0]).toMatchObject({ table: 'whatsapp_conversation_actions', limit: service.SOURCE_OPERATIONS_ACTION_LIMIT });
    expect(calls[0].filters).toEqual([['eq', 'source_id', 's1']]);
  });

  it('pages the audit newest-first with a cursor and reports older events', async () => {
    nextResult = {
      data: Array.from({ length: service.SOURCE_OPERATIONS_AUDIT_PAGE_SIZE + 1 }, (_, i) => ({
        id: i, action: 'x', created_at: `2026-10-20T0${i % 10}:00:00Z`,
      })),
      error: null,
    };
    const first = await service.loadSourceAuditPage('s1');
    expect(first.entries).toHaveLength(service.SOURCE_OPERATIONS_AUDIT_PAGE_SIZE);
    expect(first.hasOlder).toBe(true);
    expect(calls[0].columns).not.toMatch(/before_state|after_state/);
    expect(calls[0].limit).toBe(service.SOURCE_OPERATIONS_AUDIT_PAGE_SIZE + 1);
    nextResult = { data: [], error: null };
    const older = await service.loadSourceAuditPage('s1', '2026-10-20T01:00:00Z');
    expect(calls[1].filters).toContainEqual(['lt', 'created_at', '2026-10-20T01:00:00Z']);
    expect(older).toEqual({ entries: [], hasOlder: false });
  });

  it('surfaces failed reads as errors, never as an empty list', async () => {
    nextResult = { data: null, error: new Error('timeout') };
    await expect(service.loadSourceOperationalActions('s1')).rejects.toThrow('timeout');
    await expect(service.loadSourceAuditPage('s1')).rejects.toThrow('timeout');
    await expect(service.loadSourceAttributionSummary('s1')).rejects.toThrow('timeout');
  });
});

describe('source operations panel loading contract', () => {
  it('renders a loading state first, never an empty or success state', async () => {
    const { SourceOperationsPanel } = await import('@/components/salesIntelligence/SourceOperationsPanel');
    const html = renderToStaticMarkup(createElement(SourceOperationsPanel, {
      sourceId: 's1', analysisKey: 'a1', permissions: { canCorrect: true, canApprove: true, canExecute: true },
    }));
    expect(html).toContain('جاري قراءة المصدر');
    expect(html).toContain('جاري تحميل الاقتراحات');
    expect(html).not.toContain('لا توجد اقتراحات');
    expect(html).not.toContain('dawaa-alert--success');
  });

  it('loads the staff directory, conversation text and audit only inside their on-demand sections', () => {
    const source = readFileSync('src/components/salesIntelligence/SourceOperationsPanel.tsx', 'utf8');
    const section = (name: string) => source.slice(source.indexOf(`function ${name}(`), source.indexOf('\nfunction ', source.indexOf(`function ${name}(`) + 1));
    const panel = section('SourceOperationsPanel');
    expect(panel).not.toMatch(/readStaffDirectory\(|loadStoredSourceAttribution\(|loadSourceAuditPage\(/);
    expect(section('SourceCorrectionForm')).toMatch(/loadStoredSourceAttribution\(sourceId\), readStaffDirectory\(\)/);
    expect(section('SourceAuditLog')).toContain('loadSourceAuditPage(');
    expect(section('SourceAuditLog')).toContain("isOpen && state.status === 'idle'");
  });
});
