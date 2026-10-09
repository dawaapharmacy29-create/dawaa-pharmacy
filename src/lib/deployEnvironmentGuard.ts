// Fail-closed database isolation for deployments.
// Production -> the Production Supabase project. Preview / development -> the staging project ONLY.
// Used at build time (scripts/check-deploy-environment.cjs, run by prebuild) and at runtime by the
// server transport. It reads only public identifiers: URLs and the project ref inside a key's JWT
// payload. It never prints a key.

export const PRODUCTION_SUPABASE_PROJECT_REF = 'jkjqeqkshllustwlzzbf';

export type DeployEnvironment = 'production' | 'preview' | 'development' | 'local';
type Env = Record<string, string | undefined>;

export type DeployEnvironmentReport = {
  environment: DeployEnvironment;
  enforced: boolean;
  ok: boolean;
  errors: string[];
  warnings: string[];
  projectRefs: Record<string, string | null>;
};

const URL_VARS = ['VITE_SUPABASE_URL', 'SUPABASE_URL'] as const;
const KEY_VARS = ['VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

export function supabaseProjectRefFromUrl(value: string | undefined): string | null {
  const match = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/i.exec(String(value || '').trim());
  return match ? match[1].toLowerCase() : null;
}

export function supabaseProjectRefFromKey(value: string | undefined): string | null {
  const parts = String(value || '')
    .trim()
    .split('.');
  if (parts.length !== 3) return null; // publishable/secret keys (sb_...) carry no project ref
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)));
    return typeof payload?.ref === 'string' ? payload.ref.toLowerCase() : null;
  } catch {
    return null;
  }
}

function environmentOf(env: Env): { environment: DeployEnvironment; enforced: boolean } {
  const vercel = String(env.VERCEL_ENV || '')
    .trim()
    .toLowerCase();
  if (vercel === 'production' || vercel === 'preview' || vercel === 'development')
    return { environment: vercel, enforced: true };
  const declared = String(env.DAWAA_DEPLOY_ENV || '')
    .trim()
    .toLowerCase();
  if (
    declared === 'production' ||
    declared === 'preview' ||
    declared === 'development' ||
    declared === 'local'
  ) {
    return { environment: declared, enforced: true };
  }
  return { environment: 'local', enforced: false };
}

export function evaluateDeployEnvironment(env: Env): DeployEnvironmentReport {
  const { environment, enforced } = environmentOf(env);
  const errors: string[] = [];
  const warnings: string[] = [];
  const projectRefs: Record<string, string | null> = {};
  for (const name of URL_VARS)
    if (env[name]) projectRefs[name] = supabaseProjectRefFromUrl(env[name]);
  for (const name of KEY_VARS)
    if (env[name]) projectRefs[name] = supabaseProjectRefFromKey(env[name]);
  const production = PRODUCTION_SUPABASE_PROJECT_REF;
  const pointsAtProduction = Object.entries(projectRefs)
    .filter(([, ref]) => ref === production)
    .map(([name]) => name);
  for (const name of URL_VARS) {
    if (env[name] && String(env[name]).includes(production) && !pointsAtProduction.includes(name))
      pointsAtProduction.push(name);
  }

  if (environment === 'production') {
    if (!env.VITE_SUPABASE_URL) warnings.push('VITE_SUPABASE_URL is not set for production');
    for (const [name, ref] of Object.entries(projectRefs)) {
      if (ref && ref !== production)
        warnings.push(`${name} points to project ${ref}, not the production project`);
    }
  } else if (environment === 'preview' || environment === 'development') {
    const expected = String(env.DAWAA_STAGING_SUPABASE_REF || '')
      .trim()
      .toLowerCase();
    if (!env.VITE_SUPABASE_URL)
      errors.push('VITE_SUPABASE_URL is missing: a preview must use the staging Supabase project');
    if (!env.VITE_SUPABASE_ANON_KEY)
      errors.push(
        'VITE_SUPABASE_ANON_KEY is missing: a preview must use the staging Supabase project'
      );
    if (!expected)
      errors.push(
        'DAWAA_STAGING_SUPABASE_REF is missing: declare the staging project ref this preview must use'
      );
    if (expected === production)
      errors.push('DAWAA_STAGING_SUPABASE_REF is the production project');
    for (const name of pointsAtProduction) errors.push(`${name} points to the production project`);
    for (const name of URL_VARS) {
      if (!env[name]) continue;
      const ref = projectRefs[name];
      if (!ref) errors.push(`${name} is not a https://<ref>.supabase.co project URL`);
      else if (expected && ref !== expected)
        errors.push(`${name} points to project ${ref}, expected staging ${expected}`);
    }
    for (const name of KEY_VARS) {
      const ref = projectRefs[name];
      if (ref && expected && ref !== expected)
        errors.push(`${name} belongs to project ${ref}, expected staging ${expected}`);
    }
  } else if (enforced) {
    for (const name of pointsAtProduction)
      errors.push(
        `${name} points to the production project; local must use a local or test database`
      );
  } else if (pointsAtProduction.length) {
    warnings.push(
      `local run points to the production project (${pointsAtProduction.join(', ')}); set DAWAA_DEPLOY_ENV=local to enforce isolation`
    );
  }

  return { environment, enforced, ok: errors.length === 0, errors, warnings, projectRefs };
}
