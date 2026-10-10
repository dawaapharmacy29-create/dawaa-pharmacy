// Fail-closed database isolation for deployments.
// Production -> the Production Supabase project. Preview / development -> the staging project ONLY.
// Explicit local development may use loopback Supabase only, including under `vercel dev`.
// Used at build time (scripts/check-deploy-environment.cjs, run by prebuild) and at runtime by the
// server transport. It reads only public identifiers: URLs and the project ref inside a key's JWT
// payload. It never prints a key.

export const PRODUCTION_SUPABASE_PROJECT_REF = 'jkjqeqkshllustwlzzbf';
// The delivery app's project: never a database for this app in any non-production environment.
export const DELIVERY_SUPABASE_PROJECT_REF = 'qlugjplnnkjzxcbhwopg';
const FORBIDDEN_OUTSIDE_PRODUCTION: Record<string, string> = {
  [PRODUCTION_SUPABASE_PROJECT_REF]: 'the production project',
  [DELIVERY_SUPABASE_PROJECT_REF]: 'the delivery project (dawaa-delivery-os)',
};
const CLIENT_PREFIXES = ['VITE_', 'NEXT_PUBLIC_'];

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

function isLoopbackUrl(value: string | undefined): boolean {
  try {
    const parsed = new URL(String(value || '').trim());
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function jwtPayload(value: string | undefined): Record<string, unknown> | null {
  const parts = String(value || '')
    .trim()
    .split('.');
  if (parts.length !== 3) return null; // publishable/secret keys (sb_...) are not JWTs
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)));
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

export function supabaseProjectRefFromKey(value: string | undefined): string | null {
  const ref = jwtPayload(value)?.ref;
  return typeof ref === 'string' ? ref.toLowerCase() : null;
}

// A variable the browser bundle can read must never hold a service-role or secret key.
export function clientExposedSecrets(env: Env): string[] {
  return Object.keys(env)
    .filter((name) => CLIENT_PREFIXES.some((prefix) => name.startsWith(prefix)) && env[name])
    .filter((name) => {
      const value = String(env[name]).trim();
      return (
        /SERVICE_ROLE|SECRET/i.test(name) ||
        value.startsWith('sb_secret_') ||
        jwtPayload(value)?.role === 'service_role'
      );
    })
    .sort();
}

function environmentOf(env: Env): { environment: DeployEnvironment; enforced: boolean } {
  const vercel = String(env.VERCEL_ENV || '')
    .trim()
    .toLowerCase();
  const declared = String(env.DAWAA_DEPLOY_ENV || '')
    .trim()
    .toLowerCase();

  // `vercel dev` sets VERCEL_ENV=development. Permit an explicit local override only there;
  // preview/production can never be reclassified as local.
  if (vercel === 'development' && declared === 'local')
    return { environment: 'local', enforced: true };
  if (vercel === 'production' || vercel === 'preview' || vercel === 'development')
    return { environment: vercel, enforced: true };
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
  for (const name of clientExposedSecrets(env))
    errors.push(`${name} is readable by the browser bundle and holds a service-role or secret key`);

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
    if (FORBIDDEN_OUTSIDE_PRODUCTION[expected])
      errors.push(`DAWAA_STAGING_SUPABASE_REF is ${FORBIDDEN_OUTSIDE_PRODUCTION[expected]}`);
    for (const name of pointsAtProduction) errors.push(`${name} points to the production project`);
    for (const [name, ref] of Object.entries(projectRefs)) {
      if (ref === DELIVERY_SUPABASE_PROJECT_REF)
        errors.push(`${name} points to the delivery project`);
    }
    for (const name of URL_VARS) {
      if (
        env[name] &&
        String(env[name]).includes(DELIVERY_SUPABASE_PROJECT_REF) &&
        projectRefs[name] !== DELIVERY_SUPABASE_PROJECT_REF
      )
        errors.push(`${name} points to the delivery project`);
    }
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
    for (const [name, ref] of Object.entries(projectRefs)) {
      if (ref === DELIVERY_SUPABASE_PROJECT_REF)
        errors.push(`${name} points to the delivery project`);
    }
    for (const name of pointsAtProduction)
      errors.push(
        `${name} points to the production project; local must use a local or test database`
      );
    for (const name of URL_VARS) {
      if (env[name] && !isLoopbackUrl(env[name]))
        errors.push(`${name} must be a loopback URL when DAWAA_DEPLOY_ENV=local`);
    }
  } else if (pointsAtProduction.length) {
    warnings.push(
      `local run points to the production project (${pointsAtProduction.join(', ')}); set DAWAA_DEPLOY_ENV=local to enforce isolation`
    );
  }

  return { environment, enforced, ok: errors.length === 0, errors, warnings, projectRefs };
}
