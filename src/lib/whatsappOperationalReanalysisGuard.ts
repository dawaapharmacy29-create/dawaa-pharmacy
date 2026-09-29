// Write guard for scripts/run-whatsapp-operational-reanalysis.ts.
//
// 1. Mode: dry-run unless apply is explicitly requested AND confirmed as a manual action.
//    A pull request, a push or a CI re-run never becomes a production write.
// 2. Targets: only Canonical Analytical Sources (shared owner: canonicalSourceGate
//    loadCanonicalAnalyticalSources). Archived, superseded (coarse) and sources without exactly
//    one V22 case are never rewritten. A resolver failure fails the whole run closed.
import {
  loadCanonicalAnalyticalSources,
  type CanonicalGateSourceRow,
} from './salesIntelligence/persistence/canonicalSourceGate';

export const REANALYSIS_APPLY_CONFIRMATION = 'manual-workflow-dispatch';

export type ReanalysisMode = 'dry_run' | 'apply';

export function resolveReanalysisMode(input: {
  argv: string[];
  env: Record<string, string | undefined>;
}): ReanalysisMode {
  if (!input.argv.includes('--apply')) return 'dry_run';
  if (input.env.WHATSAPP_REANALYSIS_APPLY_CONFIRMED !== REANALYSIS_APPLY_CONFIRMATION) {
    throw new Error('reanalysis_apply_requires_manual_confirmation');
  }
  const event = input.env.GITHUB_EVENT_NAME;
  if (event !== undefined && event !== 'workflow_dispatch') {
    throw new Error(`reanalysis_apply_refused_for_event:${event}`);
  }
  return 'apply';
}

export async function selectReanalysisTargets<T extends CanonicalGateSourceRow>(
  service: unknown,
  rows: T[]
): Promise<{ targets: T[]; excluded: Array<{ sourceId: string; reason: string }> }> {
  const { canonicalIds, decisions } = await loadCanonicalAnalyticalSources(service, rows);
  const targets: T[] = [];
  const excluded: Array<{ sourceId: string; reason: string }> = [];
  for (const row of rows) {
    const id = String(row.id);
    if (canonicalIds.has(id)) targets.push(row);
    else {
      const decision = decisions.get(id);
      const reason = decision && 'reason' in decision ? decision.reason : 'not_canonical';
      excluded.push({ sourceId: id, reason });
    }
  }
  return { targets, excluded };
}
