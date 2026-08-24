import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20260825233000_harden_customer_points_domain_v1.sql'),
  'utf8',
);

describe('customer points domain hardening migration', () => {
  it('replaces open reads with permission and branch scoped policies', () => {
    expect(migration).toContain('dawaa_can_access_customer_points_branch_v1');
    expect(migration).toContain("array['view_points','manage_points','approve_points']");
    expect(migration).not.toMatch(/create policy[\s\S]{0,180}using \(true\)/i);
  });

  it('makes the three domain tables command-only for client mutations', () => {
    for (const table of ['customer_points_ledger', 'customer_points_approval_requests', 'customer_loyalty_settings']) {
      expect(migration).toContain(`revoke insert, update, delete, truncate on public.${table} from anon, authenticated`);
    }
  });

  it('derives command actor identity from the current request', () => {
    expect(migration).toContain('dawaa_current_points_actor_v1');
    expect(migration).toContain("jsonb_build_object('created_by', v_actor.actor_id, 'created_by_name', v_actor.actor_name)");
    expect(migration).toContain("array['approve_points']");
    expect(migration).toContain("array['manage_points']");
  });

  it('removes client execution from renamed legacy implementations', () => {
    expect(migration).toContain('insert_customer_points_ledger_internal_v1');
    expect(migration).toContain('review_customer_loyalty_approval_internal_v1');
    expect(migration).toMatch(/revoke all on function public\.insert_customer_points_ledger_internal_v1\(jsonb\) from public, anon, authenticated/i);
  });
});
