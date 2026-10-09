import { describe, expect, it } from 'vitest';
import { reconcileSoldCustomerRequestActions } from '../canonicalRefreshService';

const proof = {
  caseId: 'case-1',
  attribution: { selectedInvoiceId: 'invoice-1', selectedInvoiceNumber: '101', attributionLevel: 'proven', contradictions: [] },
  basketInvoiceMatch: { itemMatch: 'exact', itemEvidenceReady: true },
};

function fixture(target: Record<string, unknown> = {}, options: { readError?: boolean; writeError?: boolean; race?: boolean } = {}) {
  const row: any = { id: 'action-1', action_key: 'request:1:product', action_type: 'customer_request', status: 'created', product_id: 'product-1', payload: { origin: 'fixture' }, ...target };
  const writes: any[] = [];
  const filters: any[] = [];
  const service = { from(table: string) {
    let patch: any;
    const chain: any = {
      select: () => chain,
      eq: (key: string, value: unknown) => { filters.push([table,key,value]); return chain; },
      in: () => chain,
      update: (value: any) => { patch = value; writes.push(value); return chain; },
      then: (resolve: any) => {
        if (patch) {
          if (!options.writeError) Object.assign(row, patch);
          return Promise.resolve({ error: options.writeError ? Error('write failed') : null }).then(resolve);
        }
        if (table === 'whatsapp_conversation_actions') {
          const snapshot = { ...row };
          // Materializer commits after the refresh reads its action snapshot.
          if (options.race) Object.assign(row, { target_table: 'customer_requests', target_id: 'raced-request' });
          return Promise.resolve({ data: [snapshot], error: options.readError ? Error('read failed') : null }).then(resolve);
        }
        return Promise.resolve({ data: [{ product_id: 'product-1', product_code: 'P1', quantity: 2, line_total: 80 }], error: null }).then(resolve);
      },
    };
    return chain;
  } };
  return { service, row, writes, filters };
}

describe('canonical sold-action execution lineage', () => {
  it('preserves materialized request across repeated sale reconciliation and attaches invoice proof separately', async () => {
    const f = fixture({ target_table: 'customer_requests', target_id: 'request-1' });
    for (let i=0;i<2;i++) await reconcileSoldCustomerRequestActions(f.service,'source-1',[proof]);
    expect(f.row.target_table).toBe('customer_requests');
    expect(f.row.target_id).toBe('request-1');
    expect(f.row.payload.origin).toBe('fixture');
    expect(f.row.payload.canonical_sale.invoice_id).toBe('invoice-1');
    expect(f.row.outcome).toBe('sold');
    expect(f.filters.some(([table,key,value]) => table === 'whatsapp_conversation_actions' && key === 'source_id' && value === 'source-1')).toBe(true);
    expect(f.filters.some(([table,key,value]) => table === 'sales_invoice_items_v21' && key === 'invoice_id' && value === 'invoice-1')).toBe(true);
  });
  it('keeps an unmaterialized target empty rather than presenting an invoice as execution', async () => {
    const f=fixture({status:'ready',target_table:null,target_id:null});
    await reconcileSoldCustomerRequestActions(f.service,'source-1',[proof]);
    expect(f.row.target_table).toBeNull(); expect(f.row.target_id).toBeNull();
    expect(f.row.payload.canonical_sale.invoice_id).toBe('invoice-1');
  });
  it('does not overwrite a target materialized after the action read', async () => {
    const f=fixture({target_table:null,target_id:null},{race:true});
    await reconcileSoldCustomerRequestActions(f.service,'source-1',[proof]);
    expect(f.row.target_id).toBe('raced-request');
    expect(Object.hasOwn(f.writes[0],'target_id')).toBe(false);
    expect(Object.hasOwn(f.writes[0],'target_table')).toBe(false);
  });
  it('does not close unproven or contradictory sales', async () => {
    const f=fixture();
    await reconcileSoldCustomerRequestActions(f.service,'source-1',[
      {...proof, attribution:{...proof.attribution, attributionLevel:'likely'}},
      {...proof, attribution:{...proof.attribution, contradictions:['mismatch']}},
    ]);
    expect(f.writes).toHaveLength(0);
  });
  it('surfaces action read and write failures', async () => {
    for(const options of [{readError:true},{writeError:true}]) {
      const f=fixture({},options); let caught=false;
      try {await reconcileSoldCustomerRequestActions(f.service,'source-1',[proof]);} catch {caught=true;}
      expect(caught).toBe(true);
    }
  });
});
