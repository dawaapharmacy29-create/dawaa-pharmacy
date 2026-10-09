// Staging isolation: a preview build or the server transport must never reach the production
// database. The build gate (scripts/check-deploy-environment.cjs) and the server share this rule.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DELIVERY_SUPABASE_PROJECT_REF as DELIVERY,
  PRODUCTION_SUPABASE_PROJECT_REF as PROD,
  clientExposedSecrets,
  evaluateDeployEnvironment,
  supabaseProjectRefFromKey,
} from '@/lib/deployEnvironmentGuard';

const STAGING = 'stagingrefabcdefghij';
const url = (ref: string) => `https://${ref}.supabase.co`;
const key = (ref: string) =>
  `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ ref, role: 'anon' })).replace(/=+$/, '')}.signature`;
const preview = (extra: Record<string, string | undefined> = {}) => ({
  VERCEL_ENV: 'preview',
  VITE_SUPABASE_URL: url(STAGING),
  VITE_SUPABASE_ANON_KEY: key(STAGING),
  DAWAA_STAGING_SUPABASE_REF: STAGING,
  ...extra,
});

describe('deploy environment isolation', () => {
  it('reads the project ref of a legacy JWT key without exposing the key', () => {
    expect(supabaseProjectRefFromKey(key(PROD))).toBe(PROD);
    expect(supabaseProjectRefFromKey('sb_publishable_abc')).toBeNull();
  });

  it('a preview wired to the declared staging project passes', () => {
    const report = evaluateDeployEnvironment(
      preview({ SUPABASE_URL: url(STAGING), SUPABASE_SERVICE_ROLE_KEY: key(STAGING) })
    );
    expect(report.ok).toBe(true);
    expect(report.environment).toBe('preview');
  });

  it('a preview fails closed when staging variables are missing', () => {
    expect(evaluateDeployEnvironment({ VERCEL_ENV: 'preview' }).ok).toBe(false);
    expect(evaluateDeployEnvironment(preview({ DAWAA_STAGING_SUPABASE_REF: undefined })).ok).toBe(
      false
    );
    expect(evaluateDeployEnvironment(preview({ VITE_SUPABASE_ANON_KEY: undefined })).ok).toBe(
      false
    );
  });

  it('a preview fails when any URL or key belongs to production', () => {
    for (const extra of [
      { VITE_SUPABASE_URL: url(PROD) },
      { SUPABASE_URL: url(PROD) },
      { VITE_SUPABASE_ANON_KEY: key(PROD) },
      { SUPABASE_SERVICE_ROLE_KEY: key(PROD) },
      {
        DAWAA_STAGING_SUPABASE_REF: PROD,
        VITE_SUPABASE_URL: url(PROD),
        VITE_SUPABASE_ANON_KEY: key(PROD),
      },
      { VITE_SUPABASE_URL: url('otherprojectabcdefgh') },
      { VITE_SUPABASE_URL: `https://proxy.example.com/${PROD}` },
    ]) {
      const report = evaluateDeployEnvironment(preview(extra));
      expect(report.ok).toBe(false);
    }
    expect(
      evaluateDeployEnvironment({ VERCEL_ENV: 'development', VITE_SUPABASE_URL: url(PROD) }).ok
    ).toBe(false);
  });

  it('production and unflagged local runs are reported, not blocked; flagged local is enforced', () => {
    expect(
      evaluateDeployEnvironment({ VERCEL_ENV: 'production', VITE_SUPABASE_URL: url(PROD) }).ok
    ).toBe(true);
    expect(
      evaluateDeployEnvironment({ VERCEL_ENV: 'production', VITE_SUPABASE_URL: url(STAGING) })
        .warnings.length
    ).toBe(1);
    expect(evaluateDeployEnvironment({ VITE_SUPABASE_URL: url(PROD) }).ok).toBe(true);
    expect(
      evaluateDeployEnvironment({ DAWAA_DEPLOY_ENV: 'local', VITE_SUPABASE_URL: url(PROD) }).ok
    ).toBe(false);
  });

  it('every build runs the gate and the server has no production fallback', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts.prebuild.startsWith('node scripts/check-deploy-environment.cjs && ')).toBe(
      true
    );
    const server = readFileSync('server/sales-intelligence-refresh-source.ts', 'utf8');
    expect(server).not.toContain(PROD);
    expect(server).toContain('evaluateDeployEnvironment(process.env)');
    expect(readFileSync('api/sales-intelligence-refresh-source.js', 'utf8')).not.toContain(
      `'https://${PROD}.supabase.co'`
    );
  });
});

describe('deploy environment isolation: delivery project and client secrets', () => {
  const jwt = (payload: Record<string, string>) =>
    `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.signature`;
  const stagingPreview = {
    VERCEL_ENV: 'preview',
    VITE_SUPABASE_URL: `https://${STAGING}.supabase.co`,
    VITE_SUPABASE_ANON_KEY: jwt({ ref: STAGING, role: 'anon' }),
    DAWAA_STAGING_SUPABASE_REF: STAGING,
  };

  it('a preview fails when any URL, key or the declared ref is the delivery project', () => {
    for (const extra of [
      { VITE_SUPABASE_URL: `https://${DELIVERY}.supabase.co` },
      { SUPABASE_URL: `https://${DELIVERY}.supabase.co` },
      { SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: DELIVERY, role: 'service_role' }) },
      {
        DAWAA_STAGING_SUPABASE_REF: DELIVERY,
        VITE_SUPABASE_URL: `https://${DELIVERY}.supabase.co`,
      },
    ]) {
      expect(evaluateDeployEnvironment({ ...stagingPreview, ...extra }).ok).toBe(false);
    }
    expect(
      evaluateDeployEnvironment({
        DAWAA_DEPLOY_ENV: 'local',
        VITE_SUPABASE_URL: `https://${DELIVERY}.supabase.co`,
      }).ok
    ).toBe(false);
  });

  it('no browser-readable variable may hold a service-role or secret key, in any environment', () => {
    const serviceRole = jwt({ ref: STAGING, role: 'service_role' });
    expect(clientExposedSecrets({ VITE_SUPABASE_ANON_KEY: serviceRole })).toEqual([
      'VITE_SUPABASE_ANON_KEY',
    ]);
    expect(
      clientExposedSecrets({
        VITE_SUPABASE_SERVICE_ROLE_KEY: 'x',
        NEXT_PUBLIC_KEY: 'sb_secret_abc',
      })
    ).toEqual(['NEXT_PUBLIC_KEY', 'VITE_SUPABASE_SERVICE_ROLE_KEY']);
    expect(
      clientExposedSecrets({
        SUPABASE_SERVICE_ROLE_KEY: serviceRole,
        VITE_SUPABASE_ANON_KEY: jwt({ ref: STAGING, role: 'anon' }),
      })
    ).toEqual([]);
    for (const environment of ['production', 'preview', undefined]) {
      expect(
        evaluateDeployEnvironment({
          ...stagingPreview,
          VERCEL_ENV: environment,
          VITE_SUPABASE_ANON_KEY: serviceRole,
        }).ok
      ).toBe(false);
    }
  });

  it('the service role key is read only by server code, never by browser sources', () => {
    const files = readdirSync('src', { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.(ts|tsx)$/.test(file) && !file.includes('__tests__'))
      .filter((file) => file !== path.join('lib', 'deployEnvironmentGuard.ts'));
    const offenders = files.filter((file) =>
      /SERVICE_ROLE/.test(readFileSync(path.join('src', file), 'utf8'))
    );
    expect(offenders).toEqual([]);
    expect(readFileSync('src/lib/supabase.ts', 'utf8')).not.toMatch(/process\.env/);
  });
});
