// Staging isolation: a preview build or the server transport must never reach the production
// database. The build gate (scripts/check-deploy-environment.cjs) and the server share this rule.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_SUPABASE_PROJECT_REF as PROD,
  evaluateDeployEnvironment,
  supabaseProjectRefFromKey,
} from '@/lib/deployEnvironmentGuard';

const STAGING = 'stagingrefabcdefghij';
const url = (ref: string) => `https://${ref}.supabase.co`;
const key = (ref: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ ref, role: 'anon' })).replace(/=+$/, '')}.signature`;
const preview = (extra: Record<string, string | undefined> = {}) => ({
  VERCEL_ENV: 'preview', VITE_SUPABASE_URL: url(STAGING), VITE_SUPABASE_ANON_KEY: key(STAGING),
  DAWAA_STAGING_SUPABASE_REF: STAGING, ...extra,
});

describe('deploy environment isolation', () => {
  it('reads the project ref of a legacy JWT key without exposing the key', () => {
    expect(supabaseProjectRefFromKey(key(PROD))).toBe(PROD);
    expect(supabaseProjectRefFromKey('sb_publishable_abc')).toBeNull();
  });

  it('a preview wired to the declared staging project passes', () => {
    const report = evaluateDeployEnvironment(preview({ SUPABASE_URL: url(STAGING), SUPABASE_SERVICE_ROLE_KEY: key(STAGING) }));
    expect(report.ok).toBe(true);
    expect(report.environment).toBe('preview');
  });

  it('a preview fails closed when staging variables are missing', () => {
    expect(evaluateDeployEnvironment({ VERCEL_ENV: 'preview' }).ok).toBe(false);
    expect(evaluateDeployEnvironment(preview({ DAWAA_STAGING_SUPABASE_REF: undefined })).ok).toBe(false);
    expect(evaluateDeployEnvironment(preview({ VITE_SUPABASE_ANON_KEY: undefined })).ok).toBe(false);
  });

  it('a preview fails when any URL or key belongs to production', () => {
    for (const extra of [
      { VITE_SUPABASE_URL: url(PROD) },
      { SUPABASE_URL: url(PROD) },
      { VITE_SUPABASE_ANON_KEY: key(PROD) },
      { SUPABASE_SERVICE_ROLE_KEY: key(PROD) },
      { DAWAA_STAGING_SUPABASE_REF: PROD, VITE_SUPABASE_URL: url(PROD), VITE_SUPABASE_ANON_KEY: key(PROD) },
      { VITE_SUPABASE_URL: url('otherprojectabcdefgh') },
      { VITE_SUPABASE_URL: `https://proxy.example.com/${PROD}` },
    ]) {
      const report = evaluateDeployEnvironment(preview(extra));
      expect(report.ok).toBe(false);
    }
    expect(evaluateDeployEnvironment({ VERCEL_ENV: 'development', VITE_SUPABASE_URL: url(PROD) }).ok).toBe(false);
  });

  it('production and unflagged local runs are reported, not blocked; flagged local is enforced', () => {
    expect(evaluateDeployEnvironment({ VERCEL_ENV: 'production', VITE_SUPABASE_URL: url(PROD) }).ok).toBe(true);
    expect(evaluateDeployEnvironment({ VERCEL_ENV: 'production', VITE_SUPABASE_URL: url(STAGING) }).warnings.length).toBe(1);
    expect(evaluateDeployEnvironment({ VITE_SUPABASE_URL: url(PROD) }).ok).toBe(true);
    expect(evaluateDeployEnvironment({ DAWAA_DEPLOY_ENV: 'local', VITE_SUPABASE_URL: url(PROD) }).ok).toBe(false);
  });

  it('every build runs the gate and the server has no production fallback', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts.prebuild.startsWith('node scripts/check-deploy-environment.cjs && ')).toBe(true);
    const server = readFileSync('server/sales-intelligence-refresh-source.ts', 'utf8');
    expect(server).not.toContain(PROD);
    expect(server).toContain('evaluateDeployEnvironment(process.env)');
    expect(readFileSync('api/sales-intelligence-refresh-source.js', 'utf8')).not.toContain(`'https://${PROD}.supabase.co'`);
  });
});
