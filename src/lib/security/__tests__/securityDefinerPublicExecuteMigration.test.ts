import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath =
  'supabase/migrations/20260826031500_close_security_definer_public_execute_v1.sql';

function sql() {
  return readFileSync(migrationPath, 'utf8').toLowerCase();
}

describe('security definer public execute boundary', () => {
  it('revokes inherited execution from every public security definer routine', () => {
    const source = sql();

    expect(source).toContain("n.nspname = 'public'");
    expect(source).toContain('p.prosecdef');
    expect(source).toContain(
      'revoke execute on function %s from public'
    );
  });

  it('prevents PUBLIC execution from returning on future routines', () => {
    expect(sql()).toContain(
      'alter default privileges for role postgres in schema public'
    );
    expect(sql()).toContain('revoke execute on functions from public');
  });

  it('asserts that no privileged routine keeps a direct PUBLIC grant', () => {
    const source = sql();

    expect(source).toContain('pg_catalog.aclexplode');
    expect(source).toContain('acl.grantee = 0');
    expect(source).toContain("acl.privilege_type = 'execute'");
    expect(source).toContain(
      "raise exception 'security definer routine remains executable by public'"
    );
  });
});
