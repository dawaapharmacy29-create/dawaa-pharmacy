import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/20261005123000_sales_intelligence_truth_boundary_v2.sql';
const migration = readFileSync(migrationPath, 'utf8');

function expectAll(text: string, snippets: string[]) {
  for (const snippet of snippets) expect(text).toContain(snippet);
}

describe('Sales Intelligence truth boundary V2', () => {
  it('retires legacy browser-callable writers while preserving current command APIs', () => {
    expectAll(migration, [
      'revoke all on function public.create_or_link_customer_followup(jsonb)',
      'revoke all on function public.create_customer_request_canonical_v1(',
      'revoke all on function public.save_staff_monthly_evaluation_safe(uuid,jsonb)',
      'revoke all on function public.settle_monthly_narrative_evaluation(uuid)',
      'revoke all on function public.dawaa_reconcile_whatsapp_product_conversion_v21(uuid)',
    ]);
  });

  it('protects Customer Case canonical sale proof from browser overwrite or erase', () => {
    expectAll(migration, [
      'dawaa_guard_whatsapp_case_sale_truth_v2',
      "new.case_json->'canonicalSaleProof'",
      "jsonb_set(coalesce(new.case_json,'{}'::jsonb),'{canonicalSaleProof}',v_old_proof,true)",
      'customer_case_sale_truth_is_service_owned',
      'before insert or update',
      'on public.whatsapp_customer_cases_v22',
    ]);
  });

  it('makes product verification database-owned and fixes the product_verified stage contract', () => {
    expectAll(migration, [
      "'product_verified'::text",
      'dawaa_guard_product_opportunity_truth_v22',
      'dawaa_reconcile_product_opportunity_after_write_v22',
      'dawaa_reconcile_product_conversion_from_invoice_item_v22',
      "sale_verified_scope = 'product'",
      "current_stage = 'product_verified'",
      'o.customer_id=v_item.customer_id',
      'btrim(o.customer_code)=btrim(v_item.customer_code)',
      "o.opened_at - interval '10 minutes'",
      "coalesce(o.last_stage_at,o.opened_at) + interval '36 hours'",
    ]);
  });

  it('keeps candidate invoice evidence but prevents a client from publishing product truth', () => {
    expectAll(migration, [
      "new.sale_verified_scope := 'none'",
      "if new.status='won' then new.status := 'open'; end if;",
      "new.current_stage := 'awaiting_invoice'",
      'new.matched_invoice_item_id := null',
      'new.product_verified_at := null',
    ]);
  });

  it('prevents legacy + automatic review double counting without deleting audit history', () => {
    expectAll(migration, [
      'dawaa_supersede_legacy_review_on_automatic_v2',
      'set is_current=false',
      'and r.sales_intelligence_case_id is null',
      'conversation_sales_reviews_canonical_v2',
      'and a.sales_intelligence_case_id is not null',
      'security_invoker = true',
    ]);
  });
});
