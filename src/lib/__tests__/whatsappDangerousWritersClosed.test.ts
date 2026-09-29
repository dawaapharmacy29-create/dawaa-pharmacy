import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REANALYSIS_APPLY_CONFIRMATION,
  resolveReanalysisMode,
  selectReanalysisTargets,
} from '../whatsappOperationalReanalysisGuard';
import type { CanonicalGateSourceRow } from '../salesIntelligence/persistence/canonicalSourceGate';

// STEP 3C-1 — dangerous writers are closed:
//   1. no ingestion path can reach the V35 hard-delete archive RPC;
//   2. CI (pull request, push, re-run) can never become a production reanalysis write;
//   3. manual reanalysis rewrites canonical analytical sources only (shared resolver owner);
//   4. legacy invoice_match_status can never become official sale truth in a migration.

const root = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

function walk(dir: string, out: string[] = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '__tests__') walk(rel, out);
    } else if (/\.(ts|tsx|js|cjs|mjs)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

describe('1. V35 hard-delete archive path is unreachable from ingestion', () => {
  it('no application, server or script code calls the V35 archive RPC', () => {
    const offenders = ['src', 'server', 'scripts']
      .flatMap((dir) => walk(dir))
      .filter((file) =>
        /dawaa_archive_superseded_whatsapp_source_v35|archiveSupersededLegacyWhatsAppSourceV35/.test(
          read(file)
        )
      );
    expect(offenders).toEqual([]);
  });

  it('the canonical import paths never hard-delete history', () => {
    for (const file of [
      'src/pages/WhatsAppSmartFolderWatcher.tsx',
      'src/lib/whatsappAutoIngestPipeline.ts',
      'src/lib/whatsappWatcherCaseGraphSync.ts',
      'src/lib/whatsappCustomerCasePersistenceV22.ts',
      'src/lib/whatsappReviewPersistenceV4.ts',
      'src/lib/salesIntelligence/refresh/canonicalRefreshService.ts',
    ]) {
      const code = read(file);
      expect(code, file).not.toMatch(/\.delete\(\)/);
      expect(code, file).not.toMatch(/rpc\(\s*'dawaa_[a-z0-9_]*(archive|delete|purge)/);
    }
  });

  it('supersession stays owned by the Canonical Source Gate', () => {
    expect(read('src/lib/salesIntelligence/persistence/canonicalSourceGate.ts')).toMatch(
      /superseded_by_finer_canonical_sources/
    );
  });
});

describe('2. CI can never turn into a production reanalysis write', () => {
  const retryEnv = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_RUN_ATTEMPT: '2' };

  it('without --apply every run is a dry run, including CI re-runs', () => {
    expect(resolveReanalysisMode({ argv: ['--json'], env: retryEnv })).toBe('dry_run');
  });

  it('--apply without manual confirmation fails closed', () => {
    expect(() => resolveReanalysisMode({ argv: ['--apply'], env: retryEnv })).toThrow(
      'reanalysis_apply_requires_manual_confirmation'
    );
    expect(() => resolveReanalysisMode({ argv: ['--apply'], env: {} })).toThrow(
      'reanalysis_apply_requires_manual_confirmation'
    );
  });

  it('a confirmed apply is still refused outside workflow_dispatch', () => {
    for (const event of ['pull_request', 'push', 'schedule']) {
      expect(() =>
        resolveReanalysisMode({
          argv: ['--apply'],
          env: {
            GITHUB_EVENT_NAME: event,
            WHATSAPP_REANALYSIS_APPLY_CONFIRMED: REANALYSIS_APPLY_CONFIRMATION,
          },
        })
      ).toThrow(`reanalysis_apply_refused_for_event:${event}`);
    }
  });

  it('only an explicit manual dispatch (or a confirmed local run) may apply', () => {
    const confirmed = { WHATSAPP_REANALYSIS_APPLY_CONFIRMED: REANALYSIS_APPLY_CONFIRMATION };
    expect(
      resolveReanalysisMode({
        argv: ['--apply'],
        env: { ...confirmed, GITHUB_EVENT_NAME: 'workflow_dispatch' },
      })
    ).toBe('apply');
    expect(resolveReanalysisMode({ argv: ['--apply'], env: confirmed })).toBe('apply');
  });

  it('the workflow applies only on manual workflow_dispatch, never on run_attempt', () => {
    const workflow = read('.github/workflows/build.yml');
    const applyStep = workflow.slice(workflow.indexOf('- name: Apply operational reanalysis'));
    const condition = applyStep.match(/if: \$\{\{(.*)\}\}/)?.[1] || '';
    expect(condition).toContain("github.event_name == 'workflow_dispatch'");
    expect(condition).toContain("inputs.whatsapp_operational_reanalysis == 'apply'");
    expect(condition).not.toMatch(/run_attempt|pull_request|push/);
    expect(workflow).not.toMatch(/run_attempt\s*>\s*1/);
    expect(applyStep).toMatch(/WHATSAPP_REANALYSIS_APPLY_CONFIRMED: manual-workflow-dispatch/);
  });

  it('the script resolves the mode through the guard before any read or write', () => {
    const script = read('scripts/run-whatsapp-operational-reanalysis.ts');
    expect(script).toMatch(
      /resolveReanalysisMode\(\{ argv: process\.argv\.slice\(2\), env: process\.env \}\)/
    );
    expect(script).not.toMatch(/const apply = args\.has\('--apply'\)/);
  });
});

describe('3. manual reanalysis rewrites canonical analytical sources only', () => {
  const FILE = 'customer 4250.zip';
  const fine: CanonicalGateSourceRow = {
    id: 'fine',
    source_filename: FILE,
    review_status: 'ready_detailed',
    conversation_started_at: '2026-01-02T12:00:00Z',
    conversation_ended_at: '2026-01-02T12:05:00Z',
    raw_text: 'a: hello',
  };
  const coarse: CanonicalGateSourceRow = {
    ...fine,
    id: 'coarse',
    conversation_ended_at: '2026-01-02T18:00:00Z',
    raw_text: 'a: hello\nb: later',
  };
  const archived: CanonicalGateSourceRow = {
    ...fine,
    id: 'archived',
    source_filename: 'x.zip',
    review_status: 'archived',
  };
  const unlinked: CanonicalGateSourceRow = { ...fine, id: 'unlinked', source_filename: 'y.zip' };

  function service(
    cases: Array<{ id: string; root_source_id: string; source_ids: string[] }>,
    rows: CanonicalGateSourceRow[]
  ) {
    return {
      from(table: string) {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          gte: () => chain,
          lte: () => chain,
          in: (_column: string, ids: string[]) =>
            Promise.resolve({ data: rows.filter((row) => ids.includes(row.id)), error: null }),
          or: () =>
            table === 'whatsapp_customer_cases_v22'
              ? Promise.resolve({ data: cases, error: null })
              : chain,
          limit: () => Promise.resolve({ data: rows, error: null }),
        };
        return chain;
      },
    };
  }

  it('coarse, archived and V22-less sources are excluded with their gate reason', async () => {
    const rows = [fine, coarse, archived, unlinked];
    const { targets, excluded } = await selectReanalysisTargets(
      service(
        [
          { id: 'v22-fine', root_source_id: 'fine', source_ids: ['fine'] },
          { id: 'v22-coarse', root_source_id: 'coarse', source_ids: ['coarse'] },
          { id: 'v22-archived', root_source_id: 'archived', source_ids: ['archived'] },
        ],
        rows
      ),
      rows
    );
    expect(targets.map((row) => row.id)).toEqual(['fine']);
    expect(Object.fromEntries(excluded.map((row) => [row.sourceId, row.reason]))).toEqual({
      coarse: 'superseded_by_finer_canonical_sources',
      archived: 'source_archived',
      unlinked: 'no_customer_case_v22',
    });
  });

  it('fails closed when canonical ownership cannot be read', async () => {
    const broken = {
      from: () => {
        const chain: any = {
          select: () => chain,
          or: () => Promise.resolve({ data: null, error: { message: 'down' } }),
        };
        return chain;
      },
    };
    await expect(selectReanalysisTargets(broken, [fine])).rejects.toThrow(
      'canonical_source_gate_case_lookup_failed'
    );
  });

  it('the script rewrites only the selected targets', () => {
    const script = read('scripts/run-whatsapp-operational-reanalysis.ts');
    expect(script).toMatch(
      /const \{ targets: rows, excluded \} = await selectReanalysisTargets\(supabase, loaded\)/
    );
  });
});

describe('4. legacy invoice status can never produce official sale truth', () => {
  const doc = read('docs/architecture/legacy/whatsapp-invoice-evidence-v17-trigger.md');
  const planned = doc.slice(doc.indexOf('## Planned replacement'));

  it('no repository migration derives official_eligible=true from invoice_match_status', () => {
    const offenders = fs
      .readdirSync(path.join(root, 'supabase/migrations'))
      .filter((file) => file.endsWith('.sql'))
      .filter((file) => {
        const sql = read(`supabase/migrations/${file}`).toLowerCase();
        return (
          sql.includes('invoice_match_status') &&
          /official_eligible\s*=\s*true|'confirmed'\s*,\s*true\s*,\s*now\(\)/.test(sql)
        );
      });
    expect(offenders).toEqual([]);
  });

  it('the recorded live definition is the legacy truth path being replaced', () => {
    const current = doc.slice(
      doc.indexOf('## Current definition'),
      doc.indexOf('## Planned replacement')
    );
    expect(current).toMatch(/official_eligible=true/);
  });

  it('the planned replacement is evidence-only and scoped to invoice columns', () => {
    expect(planned).not.toMatch(/official_eligible\s*=\s*true/);
    expect(planned).toMatch(/'proposed',false,now\(\)/);
    expect(planned).not.toMatch(/sale_verified_scope='conversation'/);
    expect(planned).toMatch(/AFTER UPDATE OF invoice_match_status/);
  });
});
