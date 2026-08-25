import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath =
  'supabase/migrations/20260826033000_close_internal_trigger_function_rpc_surface_v1.sql';

function sql() {
  return readFileSync(migrationPath, 'utf8').toLowerCase();
}

describe('internal trigger function RPC boundary', () => {
  it('targets only privileged trigger and event-trigger routines', () => {
    const source = sql();

    expect(source).toContain("n.nspname = 'public'");
    expect(source).toContain('p.prosecdef');
    expect(source).toContain("'trigger'::regtype");
    expect(source).toContain("'event_trigger'::regtype");
  });

  it('removes browser execution without changing service ownership', () => {
    const source = sql();

    expect(source).toContain(
      'revoke execute on function %s from anon, authenticated'
    );
    expect(source.includes('from service_role')).toBe(false);
  });

  it('fails closed when a trigger function is exposed again', () => {
    const source = sql();

    expect(source).toContain(
      "pg_catalog.has_function_privilege('anon', p.oid, 'execute')"
    );
    expect(source).toContain(
      "pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')"
    );
    expect(source).toContain(
      "raise exception 'internal trigger function remains executable by a client role'"
    );
  });
});
