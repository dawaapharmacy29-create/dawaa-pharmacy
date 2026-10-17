const fs = require('node:fs');

const path = 'src/lib/salesIntelligence/refresh/canonicalRefreshService.ts';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(label, from, to) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`${label}: anchor not found`);
  if (source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`${label}: anchor is not unique`);
  }
  source = source.slice(0, first) + to + source.slice(first + from.length);
}

if (!source.includes("projectCanonicalFollowupsToActions")) {
  replaceOnce(
    'imports',
    "import { runBatchPersistence } from '../persistence/batchPersistenceService';\n",
    "import { runBatchPersistence } from '../persistence/batchPersistenceService';\n" +
      "import { projectCanonicalFollowupsToActions } from '../persistence/canonicalFollowupProjector';\n" +
      "import { projectCanonicalCustomerRequestsToActions } from '../persistence/canonicalCustomerRequestProjector';\n"
  );
}

if (!source.includes('operationalProjection: {\n    followups:')) {
  replaceOnce(
    'result-interface',
    "  complaintEnrichment: { enrichedComplaintActions: number };\n  /** Follower: canonical meaning projected onto each touched V22 envelope (never fatal). */\n",
    "  complaintEnrichment: { enrichedComplaintActions: number };\n" +
      "  operationalProjection: {\n" +
      "    followups: { inserted: number; existing: number; skipped: number };\n" +
      "    customerRequests: { inserted: number; existing: number; skipped: number };\n" +
      "    errors: string[];\n" +
      "  };\n" +
      "  /** Follower: canonical meaning projected onto each touched V22 envelope (never fatal). */\n"
  );
}

if (!source.includes('operationalProjection: {\n      followups: { inserted: 0')) {
  replaceOnce(
    'empty-result',
    "    complaintEnrichment: { enrichedComplaintActions: 0 },\n    semanticProjection: [],\n",
    "    complaintEnrichment: { enrichedComplaintActions: 0 },\n" +
      "    operationalProjection: {\n" +
      "      followups: { inserted: 0, existing: 0, skipped: 0 },\n" +
      "      customerRequests: { inserted: 0, existing: 0, skipped: 0 },\n" +
      "      errors: [],\n" +
      "    },\n" +
      "    semanticProjection: [],\n"
  );
}

if (!source.includes('const operationalProjection = {\n    followups:')) {
  replaceOnce(
    'projection-step',
    "  // 5. Conversation evaluation follower — only after Sales Intelligence persistence, case-set\n",
    "  // 4c. Canonical operational projection. The semantic owners have already decided the work;\n" +
      "  // these projectors only publish idempotent queue proposals. They never materialize\n" +
      "  // customer_requests/daily_followups and a projection failure never rewrites canonical truth.\n" +
      "  const projectionSources = admitted.map((source) => ({\n" +
      "    id: String(source.id || ''),\n" +
      "    raw_text: typeof source.raw_text === 'string' ? source.raw_text : null,\n" +
      "    customer_name: source.customer_name ? String(source.customer_name) : null,\n" +
      "    customer_code: source.customer_code ? String(source.customer_code) : null,\n" +
      "    staff_id: source.staff_id ? String(source.staff_id) : null,\n" +
      "  }));\n" +
      "  const projectionErrors: string[] = [];\n" +
      "  let followupProjection = { inserted: 0, existing: 0, skipped: 0 };\n" +
      "  let customerRequestProjection = { inserted: 0, existing: 0, skipped: 0 };\n" +
      "  try {\n" +
      "    const result = await projectCanonicalFollowupsToActions(\n" +
      "      service,\n" +
      "      reconcileCandidates,\n" +
      "      projectionSources\n" +
      "    );\n" +
      "    followupProjection = {\n" +
      "      inserted: result.inserted,\n" +
      "      existing: result.existing,\n" +
      "      skipped: result.skipped.length,\n" +
      "    };\n" +
      "  } catch (error) {\n" +
      "    projectionErrors.push(\n" +
      "      `canonical_followup_projection_failed: ${error instanceof Error ? error.message : String(error)}`\n" +
      "    );\n" +
      "  }\n" +
      "  try {\n" +
      "    const result = await projectCanonicalCustomerRequestsToActions(\n" +
      "      service,\n" +
      "      reconcileCandidates,\n" +
      "      projectionSources\n" +
      "    );\n" +
      "    customerRequestProjection = {\n" +
      "      inserted: result.inserted,\n" +
      "      existing: result.existing,\n" +
      "      skipped: result.skipped.length,\n" +
      "    };\n" +
      "  } catch (error) {\n" +
      "    projectionErrors.push(\n" +
      "      `canonical_customer_request_projection_failed: ${error instanceof Error ? error.message : String(error)}`\n" +
      "    );\n" +
      "  }\n" +
      "  const operationalProjection = {\n" +
      "    followups: followupProjection,\n" +
      "    customerRequests: customerRequestProjection,\n" +
      "    errors: projectionErrors,\n" +
      "  };\n\n" +
      "  // 5. Conversation evaluation follower — only after Sales Intelligence persistence, case-set\n"
  );
}

if (!source.includes('complaintEnrichment: { enrichedComplaintActions },\n    operationalProjection,')) {
  replaceOnce(
    'final-return',
    "    complaintEnrichment: { enrichedComplaintActions },\n    semanticProjection,\n",
    "    complaintEnrichment: { enrichedComplaintActions },\n    operationalProjection,\n    semanticProjection,\n"
  );
}

fs.writeFileSync(path, source);
console.log('canonical refresh operational projection wiring applied');
