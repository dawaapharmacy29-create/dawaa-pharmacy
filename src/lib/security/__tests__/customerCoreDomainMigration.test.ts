import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20260826003000_harden_customer_core_domain_v1.sql'),
  'utf8',
);
const runtimeFix = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20260826004000_fix_customer_core_scope_helper_v2.sql'),
  'utf8',
);
const performanceFix = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20260826005000_optimize_customer_core_rls_scope_v3.sql'),
  'utf8',
);
const indexedFix = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20260826006000_index_customer_core_rls_scope_v4.sql'),
  'utf8',
);
const definerReduction = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase/migrations/20260826007000_reduce_customer_core_definer_surface_v5.sql'),
  'utf8',
);

describe('customer core domain hardening migration', () => {
  it('replaces all known permissive customer policies', () => {
    for (const policy of [
      'Enable insert for all users',
      'Enable read access for all users',
      'Enable update for all users',
      'customers_client_read',
      'customers_insert_app',
      'customers_select_app',
      'customers_update_app',
    ]) expect(migration).toContain(`drop policy if exists ${policy.startsWith('Enable') ? `"${policy}"` : policy}`);

    expect(migration).not.toMatch(/create policy[\s\S]{0,180}(using|with check) \(true\)/i);
  });

  it('uses one canonical permission and branch helper for customers and metrics', () => {
    expect(migration).toContain('dawaa_can_access_customer_core_branch_v1');
    expect(migration).toContain('coalesce(effective_branch, branch)');
    expect(migration).toContain('customer_metrics_summary_core_scoped_select');
    expect(migration).toContain("set search_path = ''");
  });

  it('preserves unresolved and multi-branch identities only behind staff authorization', () => {
    expect(migration).toContain('if v_actor_id is null or not public.dawaa_current_actor_can(p_permissions)');
    expect(migration).toContain("('متعدد الفروع', 'كل الفروع', 'all')");
  });

  it('makes the metrics projection backend-write-only', () => {
    expect(migration).toContain('revoke insert, update, delete, truncate on public.customer_metrics_summary from anon, authenticated');
    expect(migration).toContain('revoke delete, truncate on public.customers from anon, authenticated');
  });

  it('keeps SQL syntax unqualified in the runtime helper', () => {
    expect(runtimeFix).toContain("btrim(coalesce(sa.role, ''))");
    expect(runtimeFix).not.toContain('pg_catalog.coalesce');
    expect(runtimeFix).toContain("set search_path = ''");
  });

  it('resolves actor scope through RLS init-plans instead of per row', () => {
    expect(performanceFix).toContain('dawaa_current_customer_core_scope_v2');
    expect(performanceFix).toContain('(select public.dawaa_current_customer_core_scope_v2');
    expect(performanceFix).toContain('drop function public.dawaa_can_access_customer_core_branch_v1');
    expect(performanceFix).not.toMatch(/using \(\s*public\.dawaa_can_access_customer_core_branch_v1/i);
  });

  it('uses canonical direct branch comparisons backed by indexes', () => {
    expect(indexedFix).toContain('idx_customers_access_branch_v4');
    expect(indexedFix).toContain('idx_customer_metrics_summary_access_branch_v4');
    expect(indexedFix).toContain('dawaa_current_customer_read_scope_v4');
    expect(indexedFix).toContain("coalesce(effective_branch, branch) = (select public.dawaa_current_customer_read_scope_v4())");
    expect(indexedFix).not.toContain('dawaa_customer_request_branch_key(coalesce(effective_branch, branch))');
  });

  it('keeps policy wrappers security-invoker', () => {
    expect(definerReduction.match(/security invoker/g)).toHaveLength(2);
    expect(definerReduction).not.toContain('security definer');
  });
});
