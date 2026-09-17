import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

function migration(name: string) {
  return readFileSync(resolve(process.cwd(), 'supabase', 'migrations', name), 'utf8');
}

describe('WhatsApp follow-up governance architecture', () => {
  it('uses a dedicated WhatsApp permission boundary instead of biometric permissions', () => {
    const sql = migration('20260917070000_whatsapp_followup_permissions_v2.sql');
    expect(sql).toContain('dawaa_can_manage_whatsapp_followups_v1');
    expect(sql).toContain('dawaa_is_customer_service_evaluator_v1');
    expect(sql).not.toContain('dawaa_can_manage_biometric_mapping_v1');
  });

  it('does not expose WhatsApp follow-up management RPCs to anon', () => {
    const sql = migration('20260917070000_whatsapp_followup_permissions_v2.sql');
    expect(sql).toMatch(/revoke all on function public\.dawaa_can_manage_whatsapp_followups_v1\(\) from public, anon;/i);
    expect(sql).toMatch(/grant execute on function public\.whatsapp_auto_followup_update_status_v2\([^)]+\) to authenticated, service_role;/i);
  });

  it('requires invoice evidence before a follow-up can be marked sold', () => {
    const sql = migration('20260917073000_whatsapp_followup_sale_evidence_v1.sql');
    expect(sql).toContain("p_status = 'تم البيع' and v_row.matched_invoice_id is null");
    expect(sql).toContain('اعتماد البيع يتطلب فاتورة موثقة');
    expect(sql).toContain('whatsapp_auto_followup_confirm_sale_v1');
  });

  it('re-reads canonical invoice facts server-side instead of trusting the UI preview', () => {
    const sql = migration('20260917073000_whatsapp_followup_sale_evidence_v1.sql');
    expect(sql).toContain('from public.sales_invoices i');
    expect(sql).toContain('UI preview fields are ignored');
    expect(sql).toContain('v_invoice.net_amount');
    expect(sql).toContain('v_invoice.invoice_date');
  });

  it('keeps confirmation and revocation in an audit ledger', () => {
    const sql = migration('20260917073000_whatsapp_followup_sale_evidence_v1.sql');
    expect(sql).toContain('create table if not exists public.whatsapp_auto_followup_audit');
    expect(sql).toContain("'sale_confirmed'");
    expect(sql).toContain("'sale_revoked'");
    expect(sql).toContain('alter table public.whatsapp_auto_followup_audit enable row level security');
  });

  it('resolves canonical customer identity conservatively and only on a unique match', () => {
    const sql = migration('20260917074500_whatsapp_followup_customer_identity_v1.sql');
    expect(sql).toContain('dawaa_whatsapp_followup_resolve_customer_identity_v1');
    expect(sql).toContain('if v_count = 1 then');
    expect(sql).toContain('coalesce(c.is_duplicate, false) = false');
    expect(sql).toContain('customer_id uuid');
    expect(sql).toContain('customer_code text');
  });
});
