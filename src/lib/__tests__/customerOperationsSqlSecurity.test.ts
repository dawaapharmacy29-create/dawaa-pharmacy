import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const operationsSql = readFileSync(
  resolve(root, 'supabase/sql/DAWAA_CUSTOMER_OPERATIONS_AUTO_FIX.sql'),
  'utf8'
);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === '__tests__') return [];
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(ts|tsx)$/.test(name)
        ? [path]
        : [];
  });
}

const appSource = sourceFiles(resolve(root, 'src'))
  .filter((path) => !/\.test\.[jt]sx?$/.test(path))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');
const repairPrivilegeMigration = readFileSync(
  resolve(root, 'supabase/migrations/20261009190000_harden_customer_repair_rpc_privileges_v1.sql'),
  'utf8'
);
const reviewIncubationMigration = readFileSync(
  resolve(root, 'supabase/migrations/20261009193000_harden_customer_review_and_incubation_scope_v1.sql'),
  'utf8'
);

describe('customer operations SQL security boundary', () => {
  it('revokes default PUBLIC and browser execution from every repair function', () => {
    for (const signature of [
      'dawaa_best_customer_branch(text)',
      'approve_customer_branch_repair_v14(text,text)',
      'ignore_customer_branch_repair_v14(text,text,text)',
      'update_customer_phone_v14_6(text,text,text)',
      'dawaa_run_customer_operations_autofix(text)',
    ]) {
      expect(operationsSql).toMatch(
        new RegExp(
          `revoke all on function public\\.${signature.replace(/[()]/g, '\\$&')} from public, anon, authenticated;`,
          'i'
        )
      );
    }
    expect(operationsSql).not.toMatch(
      /grant execute on function public\.(?:dawaa_best_customer_branch|approve_customer_branch_repair_v14|ignore_customer_branch_repair_v14|update_customer_phone_v14_6|dawaa_run_customer_operations_autofix)\b[^;]*\bto\s+(?:anon|authenticated|public)\b/i
    );
    for (const functionName of [
      'dawaa_best_customer_branch',
      'approve_customer_branch_repair_v14',
      'ignore_customer_branch_repair_v14',
      'update_customer_phone_v14_6',
      'dawaa_run_customer_operations_autofix',
      'mark_customer_branch_repair_reviewed_v14',
    ]) {
      expect(repairPrivilegeMigration).toContain(functionName);
    }
    expect(repairPrivilegeMigration.toLowerCase()).toContain(
      'revoke all on function public.%s from public, anon, authenticated'
    );
    expect(repairPrivilegeMigration).toContain("has_function_privilege('anon'");
    expect(repairPrivilegeMigration).toContain("has_function_privilege('authenticated'");
    expect(repairPrivilegeMigration).toContain(
      'customer_repair_rpc_browser_execute_still_granted'
    );
    expect(reviewIncubationMigration).toContain(
      'revoke all on function public.review_customer_data_issue_v2(uuid,text,text,text) from public, anon, authenticated'
    );
    expect(reviewIncubationMigration).toContain(
      'grant execute on function public.review_customer_data_issue_v2(uuid,text,text,text) to authenticated'
    );
    expect(reviewIncubationMigration).toContain(
      'alter function public.review_customer_data_issue_v2(uuid,text,text,text)'
    );
    expect(reviewIncubationMigration).toContain('set search_path to pg_catalog, auth');
  });

  it('keeps the active CRM and incubation UI on authenticated-only, minimal grants', () => {
    const crmPage = readFileSync(resolve(root, 'src/pages/CRMPage.tsx'), 'utf8');
    const incubationPage = readFileSync(resolve(root, 'src/pages/CustomerIncubation.tsx'), 'utf8');

    expect(crmPage).toContain("const REQUESTS_TABLE = 'crm_requests'");
    expect(crmPage).toContain("const TIMELINE_TABLE = 'crm_timeline'");
    expect(incubationPage).toContain(".from('dawaa_incubation_candidates_v1')");
    expect(incubationPage).toContain(".from('customer_incubation_cases')");
    expect(incubationPage).toContain(".from('customer_incubation_steps')");

    for (const grant of [
      'grant select, update on table public.crm_requests to authenticated;',
      'grant select, insert on table public.crm_timeline to authenticated;',
      'grant select, insert, update on table public.customer_incubation_cases to authenticated;',
      'grant select, insert on table public.customer_incubation_steps to authenticated;',
      'grant select on table public.dawaa_incubation_candidates_v1 to authenticated;',
    ]) {
      expect(operationsSql.toLowerCase()).toContain(grant);
    }
    expect(reviewIncubationMigration).toContain('alter table public.customer_incubation_cases enable row level security');
    expect(reviewIncubationMigration).toContain('alter table public.customer_incubation_steps enable row level security');
    expect(reviewIncubationMigration).toContain(
      "dawaa_current_customer_core_scope_v2(array['view_customer_incubation'])"
    );
    expect(reviewIncubationMigration).toContain(
      "dawaa_current_customer_core_scope_v2(array['manage_customer_incubation'])"
    );
    expect(reviewIncubationMigration).toContain('dawaa_customer_request_branch_key(c.branch)');
    expect(operationsSql).not.toMatch(/\bgrant\b[^;]*\bto\s+[^;]*\banon\b/i);
  });

  it('does not grant unused branch-review views to browser roles', () => {
    expect(appSource).not.toMatch(/\.from\(\s*['"]dawaa_customer_branch_review_(?:queue|summary)_v14['"]\s*\)/);
    expect(operationsSql).toMatch(
      /revoke all on table public\.dawaa_customer_branch_review_queue_v14 from public, anon, authenticated;/i
    );
    expect(operationsSql).toMatch(
      /revoke all on table public\.dawaa_customer_branch_review_summary_v14 from public, anon, authenticated;/i
    );
  });

  it('keeps the current data-review UI on its separate correction RPC', () => {
    const reviewPage = readFileSync(resolve(root, 'src/pages/CustomerDataReview.tsx'), 'utf8');
    const service = readFileSync(
      resolve(root, 'src/lib/customers/customerDataFoundationService.ts'),
      'utf8'
    );

    expect(reviewPage).toContain('decideCustomerReview');
    expect(service).toContain(".rpc('review_customer_data_issue_v2'");
    expect(appSource).not.toMatch(
      /\.rpc\(\s*['"](?:approve_customer_branch_repair_v14|ignore_customer_branch_repair_v14|update_customer_phone_v14_6|dawaa_run_customer_operations_autofix)['"]/
    );
    expect(repairPrivilegeMigration).not.toMatch(
      /revoke all on function public\.review_customer_data_issue_v2/i
    );
    expect(reviewIncubationMigration).toContain(
      "dawaa_current_actor_can(array[''edit_customer''])"
    );
    expect(reviewIncubationMigration).toContain('customer_data_review_branch_scope_denied');
    expect(reviewIncubationMigration).toContain(
      'into v_reviewer\\n  from public.staff_accounts sa'
    );
  });
});
