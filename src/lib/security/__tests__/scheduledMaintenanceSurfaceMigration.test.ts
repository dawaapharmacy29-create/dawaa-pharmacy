import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath =
  'supabase/migrations/20260826034500_close_scheduled_maintenance_rpc_surface_v1.sql';

function sql() {
  return readFileSync(migrationPath, 'utf8').toLowerCase();
}

describe('scheduled maintenance RPC boundary', () => {
  it('derives internal routines from active pg_cron jobs', () => {
    const source = sql();

    expect(source).toContain('from cron.job job');
    expect(source).toContain('job.active');
    expect(source).toContain("job.command ilike '%public.' || p.proname || '(%'");
    expect(source).toContain('p.prosecdef');
  });

  it('removes browser execution from scheduled maintenance', () => {
    expect(sql()).toContain(
      'revoke execute on function %s from anon, authenticated'
    );
  });

  it('asserts both client closure and scheduler continuity', () => {
    const source = sql();

    expect(source).toContain(
      "pg_catalog.has_function_privilege(routine.username, routine.oid, 'execute')"
    );
    expect(source).toContain(
      "pg_catalog.has_function_privilege('service_role', routine.oid, 'execute')"
    );
    expect(source).toContain(
      "raise exception 'scheduled routine remains executable by a client role: %'"
    );
    expect(source).toContain(
      "raise exception 'scheduled routine lost scheduler/service execution: %'"
    );
  });
});
