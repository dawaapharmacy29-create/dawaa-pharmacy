// Runtime read contracts found by the runtime performance + data-correctness audit:
// * lists/aggregates of conversation reviews read CURRENT versions only (superseded and
//   SI-reconciled rows are lineage, never an official review or a second score);
// * screens do not download data they never show (hidden history, evidence JSON, analysis JSON);
// * independent reads start in the same wave.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPETITION_REVIEW_COLUMNS } from '@/lib/doctorCompetitionMetrics';
import { loadV22CaseOwnership } from '@/lib/salesIntelligence/persistence/canonicalSourceGate';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(path.join(process.cwd(), dir))) {
    const rel = `${dir}/${name}`;
    if (fs.statSync(path.join(process.cwd(), rel)).isDirectory()) {
      if (name !== '__tests__') sourceFiles(rel, out);
    } else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

// Writer-side lookups that own lineage themselves, and the alias/name discovery read.
const LINEAGE_OWNERS = new Set([
  'src/lib/salesIntelligence/conversationEvaluationPersistence.ts',
  'src/lib/whatsappAutomaticReviewPersistence.ts',
  'src/lib/staffIdentityMapping.ts',
]);

describe('conversation review reads: current versions only', () => {
  it('every list/aggregate read outside the lineage owners filters is_current = true', () => {
    const offenders: string[] = [];
    let lists = 0;
    for (const file of sourceFiles('src')) {
      if (LINEAGE_OWNERS.has(file)) continue;
      const source = read(file);
      const pattern = /(?:from|safeSelect)\('conversation_sales_reviews'/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source))) {
        const chunk = source.slice(match.index, match.index + 700);
        const end = chunk.slice(1).search(/;\s*\n|\.from\(|safeSelect\(|\n\s*\]\);/);
        const chain = end > 0 ? chunk.slice(0, end + 1) : chunk;
        if (/\.(update|insert|upsert|delete)\(/.test(chain)) continue;
        if (/\.eq\('id',|\.in\('id',/.test(chain)) continue; // a by-id read may open any version
        lists += 1;
        if (!/\.eq\('is_current', true\)/.test(chain)) {
          offenders.push(`${file}:${source.slice(0, match.index).split('\n').length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    expect(lists).toBeGreaterThanOrEqual(15);
  });

  it('the Reviews history cache key moved to v2 so v1 caches cannot resurrect non-current rows', () => {
    const reviews = read('src/pages/Reviews.tsx');
    expect(reviews).toMatch(/REVIEW_HISTORY_CACHE_KEY = 'dawaa_conversation_review_history_v2'/);
  });
});

describe('Reviews page: the hidden history list is neither fetched nor rendered', () => {
  const reviews = read('src/pages/Reviews.tsx');

  it('history loads only when the section is visible', () => {
    expect(reviews).toMatch(/const historyVisible = historyOnlyMode && !newOnlyMode;/);
    expect(reviews).toMatch(/if \(historyVisible\) void loadReviewHistory\(\);/);
    expect(reviews).not.toMatch(/useEffect\(\(\) => \{\s*loadReviewHistory\(\);\s*\}, \[loadReviewHistory\]\);/);
  });

  it('the section is rendered conditionally (not mounted under a hidden class)', () => {
    expect(reviews).toMatch(/\{historyVisible \? \(\s*<section className="stat-card border border-teal-500\/20/);
    expect(reviews).not.toMatch(/newOnlyMode \|\| !historyOnlyMode \? 'hidden'/);
  });

  it('saves never block on reloading an invisible history list', () => {
    const unguarded = reviews.match(/^\s*await loadReviewHistory\(\);/gm) || [];
    expect(unguarded).toHaveLength(0);
    expect(reviews.match(/if \(historyVisible\) await loadReviewHistory\(\);/g) || []).toHaveLength(3);
    expect(reviews).toMatch(/if \(historyVisible\) postSaveTasks\.push\(loadReviewHistory\(\)\);/);
  });
});

describe('oversized selects', () => {
  it('doctor competition (executive dashboard) reads only the review columns its score loop uses', () => {
    const cols = COMPETITION_REVIEW_COLUMNS.split(',');
    for (const col of ['staff_id', 'doctor_id', 'staff_name', 'doctor_name', 'branch', 'final_score']) {
      expect(cols).toContain(col);
    }
    expect(cols).not.toContain('*');
    for (const heavy of ['raw_scores', 'review_items', 'automatic_evaluation_json']) {
      expect(cols).not.toContain(heavy);
    }
    const metrics = read('src/lib/doctorCompetitionMetrics.ts');
    expect(metrics).not.toMatch(/safeSelect\('conversation_sales_reviews', \(query\) => query\.select\('\*'\)/);
  });

  it('the monthly 360 review read no longer selects the non-existent `score` column', () => {
    const service = read('src/lib/reports/monthlyPerformance360Service.ts');
    expect(service).toMatch(/\.select\('total_score,final_score,created_at'\)/);
  });

  it('SI coverage panel projects analysis_json.productDemandTruthVersion instead of the full JSON', () => {
    const panel = read('src/components/salesIntelligence/SalesIntelligenceCoveragePanelV1.tsx');
    expect(panel).toMatch(/\$\{PRODUCT_DEMAND_TRUTH_VERSION_ALIAS\}:analysis_json->>productDemandTruthVersion/);
    expect(panel).not.toMatch(/raw_text,analysis_json,review_status/);
    // the panel still compares the same value on the rebuilt object
    expect(panel).toMatch(/analysis_json: version == null \? null : \{ productDemandTruthVersion: version \}/);
    expect(panel).toMatch(/row\.analysis_json\?\.productDemandTruthVersion === 'product-invoice-truth-v23\.1'/);
  });
});

describe('independent reads start in the same wave', () => {
  it('Reviews Hub starts the follow-ups read before awaiting reviews + staff directory', () => {
    const hub = read('src/components/reviews/ReviewsInsightsHub.tsx');
    const start = hub.indexOf('const followupRequest = showService');
    const wave = hub.indexOf('const [reviewResult, staffResult] = await Promise.all([');
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(wave);
    expect(hub).toMatch(/\? Promise\.resolve\(\s*supabase\s*\.from\('daily_followups'\)/);
    expect(hub).toMatch(/\)\.catch\(\(error: unknown\) => \(\{/);
  });
});

describe('route bundles', () => {
  it('the Reviews Hub loads xlsx only when exporting (not with every /reviews visit)', () => {
    const hub = read('src/components/reviews/ReviewsInsightsHub.tsx');
    expect(hub).not.toMatch(/^import \* as XLSX from 'xlsx';/m);
    expect(hub).toMatch(/const XLSX = await import\('xlsx'\);/);
  });
});

describe('V22 ownership lookup (SI QA canonical source gate)', () => {
  function fakeService(cases: Array<{ id: string; root_source_id: string | null; source_ids: string[] }>, failOn?: string) {
    const state = { inFlight: 0, maxInFlight: 0, calls: 0 };
    const service = {
      from: () => ({
        select: () => ({
          or: (filter: string) => {
            state.calls += 1;
            state.inFlight += 1;
            state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
            const ids = /root_source_id\.in\.\(([^)]*)\)/.exec(filter)![1].split(',');
            return new Promise((resolve) =>
              setTimeout(() => {
                state.inFlight -= 1;
                if (failOn && ids.includes(failOn)) resolve({ data: null, error: { message: 'boom' } });
                else resolve({ data: cases.filter((row) => ids.includes(String(row.root_source_id)) || row.source_ids.some((id) => ids.includes(id))), error: null });
              }, 5)
            );
          },
        }),
      }),
    };
    return { service, state };
  }

  const sourceIds = Array.from({ length: 130 }, (_, index) => `s${index}`);
  const cases = sourceIds.map((id, index) => ({ id: `c${index}`, root_source_id: id, source_ids: index % 2 ? [id, `s${(index + 1) % 130}`] : [id] }));

  it('runs the 40-id chunks in parallel waves and returns the same ownership as one-by-one', async () => {
    const { service, state } = fakeService(cases);
    const map = await loadV22CaseOwnership(service, sourceIds);
    expect(state.calls).toBe(4);
    expect(state.maxInFlight).toBeGreaterThan(1);
    expect(state.maxInFlight).toBeLessThanOrEqual(4);
    // every source maps to exactly the cases that own it, in a stable order
    expect(map.get('s0')).toEqual(['c0', 'c129']);
    expect(map.get('s2')).toEqual(['c1', 'c2']);
    expect(map.get('s129')).toEqual(['c129']);
    expect(map.size).toBe(130);
  });

  it('still fails closed when any chunk fails', async () => {
    const { service } = fakeService(cases, 's85');
    let message = '';
    try {
      await loadV22CaseOwnership(service, sourceIds);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/canonical_source_gate_case_lookup_failed/);
  });
});
