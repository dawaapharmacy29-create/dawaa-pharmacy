import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20260825095017_close_production_exposure_and_checklist_commands_v1.sql'),
  'utf8'
);

describe('production exposure closure migration', () => {
  it('enables RLS and revokes browser grants from every exposed table', () => {
    expect(migration).toContain("alter table public.%I enable row level security");
    expect(migration).toContain("revoke all on table public.%I from public, anon, authenticated");
    expect(migration).toContain("'sales_invoices_cycle_backup_20260825_final'");
  });

  it('keeps checklist writes behind canonical actor commands', () => {
    expect(migration).toContain('submit_my_staff_daily_checklist_v1');
    expect(migration).toContain('review_staff_daily_checklist_v1');
    expect(migration).toContain('dawaa_current_staff_account_id_strict()');
  });

  it('binds voucher redemption to the canonical doctor identity', () => {
    expect(migration).toContain('where id=p_voucher_id and doctor_id=v_subject_id for update');
    expect(migration).toContain('used_by=v_actor_id');
  });

  it('removes browser execution from internal settlement and refresh helpers', () => {
    expect(migration).toContain('revoke all on function public.refresh_pillar_competitions');
    expect(migration).toContain('revoke all on function public.settle_checklist_review');
    expect(migration).toContain('grant execute on function public.refresh_pillar_competitions(text) to service_role');
  });
});
