#!/usr/bin/env node
// Gate: Single Canonical Truth for WhatsApp conversations, evaluations, sales and follow-ups.
//
// Every source file that touches conversation reviews, WhatsApp sale truth or WhatsApp
// operational actions must be listed below with its role. The gate fails when:
//   * a new file starts reading these sources without being registered;
//   * a registered file no longer touches them (stale register — the list must shrink honestly);
//   * a file registered as `official_scored` (it averages, ranks or pays from reviews) does not
//     import the official-review contract src/lib/evaluations/officialConversationReview.ts;
//   * a non-writer file selects the legacy sale flag `converted_to_sale` outside the documented
//     transitional path.
// Roles:
//   official_scored   — computes scores/rankings/points; MUST use the official contract.
//   canonical_si      — Sales Intelligence canonical engines/read models (sale proof, KPIs, actions).
//   writer            — creates/updates rows (persistence, projectors, approval queue).
//   record_view       — shows one record or a status-labelled list; computes no score.
//   operational       — work queue / data-health / coaching alert that intentionally includes
//                       pending rows and is not used for evaluation, ranking or money.
//   config            — table names, column lists, scales, calibration constants.
//   transitional      — documented divergence with an owner decision pending (see REASONS).
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const PATTERN = /conversation_sales_reviews|conversationSalesReviews|converted_to_sale|whatsapp_sales_opportunities_v17|is_official_for_staff_evaluation|whatsapp_conversation_actions/;
const CONTRACT = /from ['"]@\/lib\/evaluations\/officialConversationReview['"]/;

const REGISTER = {
  // official_scored
  'src/lib/staff/employeeMonthlyEvidenceService.ts': 'official_scored',
  'src/lib/staff/staffPerformanceProfileService.ts': 'official_scored',
  'src/lib/doctorCompetitionMetrics.ts': 'official_scored',
  'src/lib/reports/monthlyPerformance360Service.ts': 'official_scored',
  'src/pages/WhatsappAnalytics.tsx': 'official_scored',
  'src/pages/DoctorCompetition.tsx': 'official_scored',
  'src/pages/DoctorDashboardStable.tsx': 'official_scored',
  'src/pages/ReportsCenter.tsx': 'official_scored',
  'src/components/reviews/ReviewsInsightsHub.tsx': 'official_scored',
  'src/components/doctor/DoctorReviewDetails.tsx': 'official_scored',
  'src/lib/evaluations/officialConversationReview.ts': 'official_scored',
  // canonical_si
  'src/lib/salesIntelligence/canonicalKpiReadModel.ts': 'canonical_si',
  'src/lib/salesIntelligence/qa/canonicalCaseTruth.ts': 'canonical_si',
  'src/lib/salesIntelligence/qa/queries.ts': 'canonical_si',
  'src/lib/salesIntelligence/qa/saleProofProjection.ts': 'canonical_si',
  'src/lib/salesIntelligence/refresh/canonicalRefreshService.ts': 'canonical_si',
  'src/lib/salesIntelligence/saleAttributionEngine.ts': 'canonical_si',
  'src/lib/salesIntelligence/types.ts': 'canonical_si',
  'src/lib/salesIntelligence/followUpOpportunityEngine.ts': 'canonical_si',
  'src/lib/salesIntelligence/operations/sourceOperationsService.ts': 'canonical_si',
  'src/lib/salesIntelligence/legacyOpportunityAdapter.ts': 'canonical_si',
  'src/lib/whatsappProductDemandBackfillV22.ts': 'canonical_si',
  'src/lib/whatsappAutoIngestPipeline.ts': 'canonical_si',
  // writer
  'src/lib/salesIntelligence/conversationEvaluationPersistence.ts': 'writer',
  'src/lib/whatsappAutomaticReviewPersistence.ts': 'writer',
  'src/pages/Reviews.tsx': 'writer',
  'src/lib/staffIdentityMapping.ts': 'writer',
  'src/lib/whatsappEvidenceLedgerV17.ts': 'writer',
  'src/lib/whatsappOperationalIntelligenceV6.ts': 'writer',
  'src/lib/salesIntelligence/persistence/attributionWriter.ts': 'writer',
  'src/lib/salesIntelligence/persistence/canonicalComplaintProjector.ts': 'writer',
  'src/lib/salesIntelligence/persistence/canonicalCustomerRequestProjector.ts': 'writer',
  'src/lib/salesIntelligence/persistence/canonicalFollowupProjector.ts': 'writer',
  // record_view
  'src/pages/ConversationReviewDetailsFast.tsx': 'record_view',
  'src/pages/ConversationReviewEvidence.tsx': 'record_view',
  'src/pages/ConversationReviewsHistoryAdvanced.tsx': 'record_view',
  'src/pages/Customer360.tsx': 'record_view',
  'src/pages/Points.tsx': 'record_view',
  'src/pages/SalesIntelligenceQACaseDetail.tsx': 'record_view',
  'src/lib/whatsappCustomerStoryV16.ts': 'record_view',
  // operational
  'src/pages/DailyCommand.tsx': 'operational',
  'src/lib/dataHealth/appDataHealthService.ts': 'operational',
  'src/lib/staffDuplicateAudit.ts': 'operational',
  'src/lib/staffDetailLoader.ts': 'operational',
  'src/lib/doctorQualitySummaryService.ts': 'operational',
  // config
  'src/lib/dataSources.ts': 'config',
  'src/lib/supabaseTables.ts': 'config',
  'src/lib/evaluations/monthlyConversationScoreScale.ts': 'config',
  'src/lib/reviews/conversationReviewEvaluationColumns.ts': 'config',
  'src/lib/whatsappHistoricalReviewCalibration.ts': 'config',
  // transitional
  'src/lib/evaluations/doctorPerformanceIntelligenceService.ts': 'transitional',
};

const REASONS = {
  'src/lib/evaluations/doctorPerformanceIntelligenceService.ts':
    'Doctor-eye conversion comes from get_doctor_sales_reconciliation_v1 (review "sold" claims checked against invoices, excluding sales keyed by another seller). Canonical KPI uses Sales Intelligence sale_proven + closer credit. Displayed as an insight, not used for payroll; replacing the RPC with the canonical KPI read model is an open owner decision.',
  'src/lib/staffDetailLoader.ts': 'loadStaffDetailSections has no callers; its unfiltered review list is dead code kept only for the exported section helpers.',
  'src/pages/DailyCommand.tsx': 'Low-score coaching alerts intentionally include reviews still awaiting approval; they never feed a score, rank or payment.',
  'src/lib/doctorQualitySummaryService.ts': 'Reads get_doctor_conversation_quality_summary (SQL) for coaching text; listed in the readiness report as a SQL reader still to move to the monthly official view.',
};

const ALLOWED_CONVERTED_TO_SALE = new Set([
  'src/lib/evaluations/doctorPerformanceIntelligenceService.ts', // transitional, see REASONS
  'src/lib/salesIntelligence/conversationEvaluationPersistence.ts', // writer
  'src/lib/whatsappAutomaticReviewPersistence.ts', // writer
  'src/pages/Reviews.tsx', // writer / approval queue
  'src/pages/ConversationReviewsHistoryAdvanced.tsx', // record view (labelled field)
  'src/lib/salesIntelligence/types.ts',
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const failures = [];
const found = new Set();
for (const file of walk(path.join(root, 'src'))) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const text = fs.readFileSync(file, 'utf8');
  if (!PATTERN.test(text)) continue;
  found.add(rel);
  const role = REGISTER[rel];
  if (!role) {
    failures.push(`${rel}: reads WhatsApp review/sale/action truth but is not registered in scripts/check-whatsapp-canonical-consumers.cjs`);
    continue;
  }
  if (role === 'official_scored' && rel !== 'src/lib/evaluations/officialConversationReview.ts' && !CONTRACT.test(text)) {
    failures.push(`${rel}: registered as official_scored but does not import the official-review contract`);
  }
  if (role === 'transitional' && !REASONS[rel]) failures.push(`${rel}: transitional entries need a documented reason`);
  if (/converted_to_sale/.test(text) && !ALLOWED_CONVERTED_TO_SALE.has(rel)) {
    failures.push(`${rel}: reads the legacy review sale flag converted_to_sale; sale truth is Sales Intelligence sale_proven`);
  }
}
for (const rel of Object.keys(REGISTER)) {
  if (!found.has(rel)) failures.push(`${rel}: registered but no longer reads these sources — remove it from the register`);
}

if (failures.length) {
  console.error('[whatsapp-canonical-consumers] FAIL');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
const byRole = Object.values(REGISTER).reduce((acc, role) => ({ ...acc, [role]: (acc[role] || 0) + 1 }), {});
console.log(`[whatsapp-canonical-consumers] PASS: ${found.size} consumers registered ${JSON.stringify(byRole)}; ${Object.keys(REASONS).length} documented exceptions.`);
