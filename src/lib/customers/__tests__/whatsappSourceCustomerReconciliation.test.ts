import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import {
  describeSourceCustomerReconciliation,
  reconcileWhatsAppSourceCustomers,
  SOURCE_CUSTOMER_RECONCILIATION_ACTION,
} from '../whatsappSourceCustomerReconciliation';

// A source saved with code 18663 before the customer existed (customer_id NULL). Synthetic ids.
type Row = Record<string, any>;

function memoryClient(
  tables: Record<string, Row[]>,
  options: { onUpdate?: (row: Row) => void; failInsertInto?: string; failUpdate?: boolean; failReadOf?: string } = {}
) {
  const writes: Array<{ table: string; kind: string; row: Row }> = [];
  const listOf = (expr: string) => (expr.match(/\(([^)]*)\)/)?.[1] ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  return {
    writes,
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let patch: Row | null = null;
      let inserted: Row | null = null;
      const rows = () => (tables[table] ??= []).filter((row) => filters.every((f) => f(row)));
      const builder: any = {
        select: () => builder,
        limit: () => builder,
        eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return builder; },
        is: (key: string, value: unknown) => { filters.push((row) => (row[key] ?? null) === value); return builder; },
        in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return builder; },
        or: (expr: string) => {
          const clauses = expr.split(/,(?=[a-z_]+\.in\.)/).map((clause) => ({ column: clause.split('.in.')[0], values: listOf(clause) }));
          filters.push((row) => clauses.some(({ column, values }) => values.includes(String(row[column] ?? ''))));
          return builder;
        },
        update: (next: Row) => { patch = next; return builder; },
        insert: (row: Row) => {
          if (options.failInsertInto === table) { inserted = row; builder.then = (resolve: (value: unknown) => void) => resolve({ data: null, error: { message: 'insert denied' } }); return builder; }
          inserted = row; (tables[table] ??= []).push(row); writes.push({ table, kind: 'insert', row }); return builder;
        },
        maybeSingle: async () => {
          if (patch) {
            if (options.failUpdate) return { data: null, error: { message: 'update denied' } };
            const target = rows()[0];
            if (!target) return { data: null, error: null };
            options.onUpdate?.(target);
            if (!filters.every((f) => f(target))) return { data: null, error: null };
            Object.assign(target, patch);
            writes.push({ table, kind: 'update', row: { ...target } });
            return { data: { id: target.id }, error: null };
          }
          return { data: rows()[0] ?? null, error: null };
        },
        then: (resolve: (value: unknown) => void) =>
          resolve(options.failReadOf === table ? { data: null, error: { message: 'read failed' } } : { data: inserted ? null : rows(), error: null }),
      };
      return builder;
    },
  };
}

const source = (id: string, extra: Row = {}): Row => ({
  id, customer_id: null, customer_code: '18663', customer_name: 'ابراهيم الخولي', customer_phone: null, ...extra,
});
const customer = (id: string, extra: Row = {}): Row => ({ id, customer_code: '18663', name: 'د ابراهيم الخولي', phone: null, is_duplicate: false, ...extra });

describe('WhatsApp source ↔ customer reconciliation after a customer is added', () => {
  it('links an older source to the single canonical customer once, with an audit record', async () => {
    const tables = { whatsapp_review_sources: [source('src-1')], customers: [customer('cust-1')], customer_aliases: [], whatsapp_review_audit: [] as Row[] };
    const client = memoryClient(tables);
    const outcomes = await reconcileWhatsAppSourceCustomers(client, ['18663'], { name: 'اختبار' });
    expect(outcomes).toEqual([expect.objectContaining({ sourceId: 'src-1', status: 'linked', customerId: 'cust-1', normalizedCode: '18663' })]);
    expect(tables.whatsapp_review_sources[0].customer_id).toBe('cust-1');
    // The original source text fields are untouched.
    expect(tables.whatsapp_review_sources[0].customer_name).toBe('ابراهيم الخولي');
    expect(tables.whatsapp_review_audit).toEqual([expect.objectContaining({
      source_id: 'src-1', action: SOURCE_CUSTOMER_RECONCILIATION_ACTION,
      before_state: { customer_id: null, customer_code: '18663' },
      after_state: expect.objectContaining({ customer_id: 'cust-1', normalized_code: '18663', case_reanalysis_required: true }),
    })]);

    // Idempotent: a second run finds nothing left to link and writes nothing.
    const writesBefore = client.writes.length;
    expect(await reconcileWhatsAppSourceCustomers(client, ['18663'])).toEqual([]);
    expect(client.writes.length).toBe(writesBefore);
  });

  it('a duplicated code is left for human review, never the first record', async () => {
    const tables = { whatsapp_review_sources: [source('src-1')], customers: [customer('cust-1'), customer('cust-2')], customer_aliases: [], whatsapp_review_audit: [] as Row[] };
    const client = memoryClient(tables);
    const [outcome] = await reconcileWhatsAppSourceCustomers(client, ['18663']);
    expect(outcome.status).toBe('skipped_ambiguous');
    expect(tables.whatsapp_review_sources[0].customer_id).toBeNull();
    expect(client.writes).toEqual([]);
  });

  it('an approved duplicate alias resolves to its canonical customer; an unapproved duplicate does not', async () => {
    const aliased = { whatsapp_review_sources: [source('src-1')], customers: [customer('dup-1', { is_duplicate: true }), customer('cust-1', { customer_code: '90000' })], customer_aliases: [{ alias_customer_id: 'dup-1', canonical_customer_id: 'cust-1' }], whatsapp_review_audit: [] as Row[] };
    expect((await reconcileWhatsAppSourceCustomers(memoryClient(aliased), ['18663']))[0]).toMatchObject({ status: 'linked', customerId: 'cust-1' });
    const unapproved = { whatsapp_review_sources: [source('src-1')], customers: [customer('dup-1', { is_duplicate: true })], customer_aliases: [], whatsapp_review_audit: [] as Row[] };
    const [outcome] = await reconcileWhatsAppSourceCustomers(memoryClient(unapproved), ['18663']);
    expect(outcome.status).not.toBe('linked');
    expect(unapproved.whatsapp_review_sources[0].customer_id).toBeNull();
  });

  it('a contact phone that belongs to another customer contradicts the code and blocks the link', async () => {
    const tables = {
      whatsapp_review_sources: [source('src-1', { customer_phone: '01012345678' })],
      customers: [customer('cust-1'), customer('cust-other', { customer_code: '55555', phone: '01012345678' })],
      customer_aliases: [], whatsapp_review_audit: [] as Row[],
    };
    const [outcome] = await reconcileWhatsAppSourceCustomers(memoryClient(tables), ['18663']);
    expect(outcome.status).toBe('skipped_contradicted');
    expect(tables.whatsapp_review_sources[0].customer_id).toBeNull();
  });

  it('never replaces an existing manual link, including one made while the run was in flight', async () => {
    const linked = { whatsapp_review_sources: [source('src-1', { customer_id: 'manual-cust' })], customers: [customer('cust-1')], customer_aliases: [], whatsapp_review_audit: [] as Row[] };
    expect(await reconcileWhatsAppSourceCustomers(memoryClient(linked), ['18663'])).toEqual([]);
    expect(linked.whatsapp_review_sources[0].customer_id).toBe('manual-cust');

    const racing = { whatsapp_review_sources: [source('src-1')], customers: [customer('cust-1')], customer_aliases: [], whatsapp_review_audit: [] as Row[] };
    const client = memoryClient(racing, { onUpdate: (row) => { row.customer_id = 'human-cust'; } });
    const [outcome] = await reconcileWhatsAppSourceCustomers(client, ['18663']);
    expect(outcome.status).toBe('skipped_already_linked');
    expect(racing.whatsapp_review_sources[0].customer_id).toBe('human-cust');
    expect(racing.whatsapp_review_audit).toEqual([]);
  });

  it('a customer still missing from the customer register leaves the source unlinked (no id from the name or the invoice)', async () => {
    const tables = { whatsapp_review_sources: [source('src-1')], customers: [] as Row[], customer_aliases: [], whatsapp_review_audit: [] as Row[] };
    const client = memoryClient(tables);
    const [outcome] = await reconcileWhatsAppSourceCustomers(client, ['18663']);
    expect(outcome.status).toBe('skipped_unresolved');
    expect(tables.whatsapp_review_sources[0].customer_id).toBeNull();
    expect(client.writes).toEqual([]);
  });

  it('a failed source read is an error, never an empty "nothing to link" result', async () => {
    const tables = { whatsapp_review_sources: [source('src-1')], customers: [customer('cust-1')], customer_aliases: [], whatsapp_review_audit: [] as Row[] };
    await expect(reconcileWhatsAppSourceCustomers(memoryClient(tables, { failReadOf: 'whatsapp_review_sources' }), ['18663'])).rejects.toBeTruthy();
  });

  it('a rejected update writes nothing and stays retryable by the next run', async () => {
    const tables = { whatsapp_review_sources: [source('src-1')], customers: [customer('cust-1')], customer_aliases: [], whatsapp_review_audit: [] as Row[] };
    const [failed] = await reconcileWhatsAppSourceCustomers(memoryClient(tables, { failUpdate: true }), ['18663']);
    expect(failed.status).toBe('failed');
    expect(tables.whatsapp_review_sources[0].customer_id).toBeNull();
    expect(tables.whatsapp_review_audit).toEqual([]);
    const [retried] = await reconcileWhatsAppSourceCustomers(memoryClient(tables), ['18663']);
    expect(retried.status).toBe('linked');
  });

  it('a link whose audit row could not be written is surfaced for review, not promised a retry', async () => {
    const tables = { whatsapp_review_sources: [source('src-1')], customers: [customer('cust-1')], customer_aliases: [], whatsapp_review_audit: [] as Row[] };
    const outcomes = await reconcileWhatsAppSourceCustomers(memoryClient(tables, { failInsertInto: 'whatsapp_review_audit' }), ['18663']);
    expect(outcomes[0]).toMatchObject({ status: 'linked_audit_missing', customerId: 'cust-1' });
    // A later run only reads unlinked sources, so it would never repair the audit: it must not claim to.
    expect(await reconcileWhatsAppSourceCustomers(memoryClient(tables), ['18663'])).toEqual([]);
    const note = describeSourceCustomerReconciliation(outcomes) ?? '';
    expect(note).toContain('دون سجل تدقيق');
    expect(note).not.toContain('سيُعاد المحاولة');
  });
});
