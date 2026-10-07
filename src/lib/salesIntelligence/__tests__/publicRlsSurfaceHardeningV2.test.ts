import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  'supabase/migrations/20261005153000_public_rls_surface_hardening_v2.sql',
  'utf8'
);

describe('Public RLS surface hardening V2', () => {
  it('enables RLS on all three exposed public tables', () => {
    expect(source).toContain('alter table public.notification_sla_policies enable row level security');
    expect(source).toContain('alter table public.sales_import_bridge_tokens_20260908 enable row level security');
    expect(source).toContain('alter table public.task_activity_log enable row level security');
  });

  it('keeps SLA policy reads authenticated-only and writes server-owned', () => {
    expect(source).toContain('notification_sla_policies_authenticated_read_v2');
    expect(source).toContain('using (auth.uid() is not null)');
    expect(source).toContain('grant select on table public.notification_sla_policies to authenticated');
    expect(source).toContain('revoke all on table public.notification_sla_policies from anon');
  });

  it('makes bridge tokens and task audit logs service-only', () => {
    expect(source).toContain('revoke all on table public.sales_import_bridge_tokens_20260908 from anon,authenticated');
    expect(source).toContain('revoke all on table public.task_activity_log from anon,authenticated');
    expect(source).toContain('grant select,insert,update,delete on table public.task_activity_log to service_role');
  });
});
