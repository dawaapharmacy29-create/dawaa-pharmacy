import { describe, expect, it } from 'vitest';
import { evaluateDeployEnvironment, PRODUCTION_SUPABASE_PROJECT_REF as PROD } from '../deployEnvironmentGuard';

const sha = 'a'.repeat(40);
const key = (ref: string, role = 'anon') => `header.${btoa(JSON.stringify({ ref, role }))}.signature`;
const approved = {
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_SHA: sha,
  DAWAA_APPROVED_PRODUCTION_PREVIEW_SHA: sha,
  VITE_SUPABASE_URL: `https://${PROD}.supabase.co`,
  VITE_SUPABASE_ANON_KEY: key(PROD),
  SUPABASE_SERVICE_ROLE_KEY: key(PROD, 'service_role'),
};

describe('exact-commit Production Preview approval', () => {
  it('permits only an explicitly approved Preview while retaining its environment', () => {
    const report = evaluateDeployEnvironment(approved);
    expect(report.ok).toBe(true);
    expect(report.environment).toBe('preview');
    expect(report.enforced).toBe(true);
    expect(report.warnings.join(' ')).toContain('normal application authorization remains required');
  });

  it('rejects missing, stale or malformed approval and development use', () => {
    for (const extra of [
      { DAWAA_APPROVED_PRODUCTION_PREVIEW_SHA: undefined },
      { DAWAA_APPROVED_PRODUCTION_PREVIEW_SHA: 'b'.repeat(40) },
      { DAWAA_APPROVED_PRODUCTION_PREVIEW_SHA: 'true' },
      { VERCEL_GIT_COMMIT_SHA: undefined },
      { VERCEL_ENV: 'development' },
    ]) expect(evaluateDeployEnvironment({ ...approved, ...extra }).ok).toBe(false);
  });

  it('still rejects missing client configuration, other projects and browser secrets', () => {
    for (const extra of [
      { VITE_SUPABASE_URL: undefined },
      { VITE_SUPABASE_ANON_KEY: undefined },
      { SUPABASE_URL: 'https://qlugjplnnkjzxcbhwopg.supabase.co' },
      { SUPABASE_SERVICE_ROLE_KEY: key('otherprojectabcdefgh', 'service_role') },
      { VITE_SUPABASE_ANON_KEY: key(PROD, 'service_role') },
      { NEXT_PUBLIC_KEY: 'sb_secret_example' },
    ]) expect(evaluateDeployEnvironment({ ...approved, ...extra }).ok).toBe(false);
  });
});
