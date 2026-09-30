const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
function fail(message) {
  console.error('::error::WhatsApp/Sales Intelligence owner-registry violation: ' + message);
  process.exitCode = 1;
}
function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const ownerDocPath = 'docs/architecture/whatsapp-sales-intelligence-owner-review.md';
if (!fs.existsSync(path.join(ROOT, ownerDocPath))) {
  fail('missing owner registry: ' + ownerDocPath);
} else {
  const ownerDoc = read(ownerDocPath);
  for (const required of [
    'Brain A: Sales Intelligence pipeline',
    'Brain B: Watcher page orchestration',
    'Concept → Authoritative Owner'
  ]) {
    if (!ownerDoc.includes(required)) fail('owner registry lost required contract text: ' + required);
  }
}

const frozenTopLevelVersionedWhatsAppModules = new Set([
  'whatsappCaseContextV27.ts',
  'whatsappCaseLostReasonV23.ts',
  'whatsappConversationEvaluationV2.ts',
  'whatsappConversationFocusV30.ts',
  'whatsappConversationTimingV28.ts',
  'whatsappConversationUnderstandingV32.ts',
  'whatsappCriterionEvidenceV32.ts',
  'whatsappCustomerCaseEngineV22.ts',
  'whatsappCustomerCasePersistenceV22.ts',
  'whatsappCustomerJourneyDecisionV8.ts',
  'whatsappCustomerJourneyIntelligenceV15.ts',
  'whatsappCustomerJourneyPersistenceV15.ts',
  'whatsappCustomerResolverV4.ts',
  'whatsappCustomerStoryV16.ts',
  'whatsappDeepConversationIntelligenceV26.ts',
  'whatsappDelayAttributionV29.ts',
  'whatsappDirectProductIntentV22.ts',
  'whatsappEvaluationConversationV31.ts',
  'whatsappEvidenceLedgerV17.ts',
  'whatsappGroundedSaleJourneyV33.ts',
  'whatsappMediaV21.ts',
  'whatsappOperationalIntelligenceV6.ts',
  'whatsappOrderConfirmationEvidenceV32.ts',
  'whatsappOrderLifecycleV19.ts',
  'whatsappParticipantRoleResolverV15.ts',
  'whatsappPerformanceV4.ts',
  'whatsappProductDemandBackfillQualityGateV22.ts',
  'whatsappProductDemandBackfillV22.ts',
  'whatsappProductJourneyV7.ts',
  'whatsappResponseSpeedEvidenceV32.ts',
  'whatsappResponseTurnsV18.ts',
  'whatsappReviewFrameworkV3.ts',
  'whatsappReviewGovernanceV25.ts',
  'whatsappReviewPersistenceV4.ts',
  'whatsappSemanticSignalsV32.ts',
  'whatsappStaffResolverV6.ts',
  'whatsappUnderstandingEvidenceV32.ts',
  'whatsappUnifiedIntelligenceV4.ts'
]);

const libDir = path.join(ROOT, 'src/lib');
const currentTopLevelVersioned = fs.readdirSync(libDir, { withFileTypes: true })
  .filter(function(entry) { return entry.isFile() && /^whatsapp.*V\d+\.ts$/i.test(entry.name); })
  .map(function(entry) { return entry.name; })
  .sort();

for (const fileName of currentTopLevelVersioned) {
  if (!frozenTopLevelVersionedWhatsAppModules.has(fileName)) {
    fail(
      'new versioned WhatsApp analytical module outside src/lib/salesIntelligence/: src/lib/' + fileName + '. ' +
      'Extend the canonical Sales Intelligence brain instead of creating another parallel V<n> engine.'
    );
  }
}

const canonicalCoreFiles = [
  'src/lib/salesIntelligence/salesIntelligencePipeline.ts',
  'src/lib/salesIntelligence/conversationCaseEngine.ts',
  'src/lib/salesIntelligence/caseBasketEngine.ts',
  'src/lib/salesIntelligence/commercialConfirmationEngine.ts',
  'src/lib/salesIntelligence/invoiceCandidateRetrieval.ts',
  'src/lib/salesIntelligence/saleAttributionEngine.ts',
  'src/lib/salesIntelligence/basketInvoiceMatchingEngine.ts',
  'src/lib/salesIntelligence/salesIntegrityEngine.ts',
  'src/lib/salesIntelligence/saleProofState.ts',
  'src/lib/salesIntelligence/canonicalSalesOutcomeEngine.ts',
  'src/lib/salesIntelligence/customerNeedModel.ts',
  'src/lib/salesIntelligence/unavailableDemandEngine.ts',
  'src/lib/salesIntelligence/lostOpportunityEngine.ts',
  'src/lib/salesIntelligence/followUpOpportunityEngine.ts',
  'src/lib/salesIntelligence/caseIntelligenceView.ts'
];

const evidenceOnlyModules = [
  'whatsappOperationalIntelligenceV6',
  'whatsappProductJourneyV7',
  'whatsappCustomerJourneyIntelligenceV15',
  'whatsappCustomerStoryV16',
  'whatsappEvidenceLedgerV17',
  'whatsappResponseTurnsV18',
  'whatsappOrderLifecycleV19',
  'whatsappCaseLostReasonV23',
  'whatsappDeepConversationIntelligenceV26',
  'whatsappGroundedSaleJourneyV33',
  'whatsappUnifiedIntelligenceV4'
];

const evidenceOnlyTables = [
  'whatsapp_conversation_actions',
  'whatsapp_evidence_facts_v17',
  'whatsapp_response_turns_v18',
  'whatsapp_sales_opportunities_v17',
  'whatsapp_customer_journey_sessions_v15',
  'whatsapp_order_lifecycle_v19'
];

for (const relativePath of canonicalCoreFiles) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail('canonical core owner missing: ' + relativePath);
    continue;
  }
  const content = fs.readFileSync(absolutePath, 'utf8');
  for (const legacyModule of evidenceOnlyModules) {
    if (content.includes(legacyModule)) {
      fail(relativePath + ' imports/references evidence-only analytical module ' + legacyModule);
    }
  }
  for (const legacyTable of evidenceOnlyTables) {
    const escaped = legacyTable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const directRead = new RegExp("\\.from\\(\\s*['\\\"]" + escaped + "['\\\"]\\s*\\)");
    if (directRead.test(content)) {
      fail(relativePath + ' directly reads evidence-only operational table ' + legacyTable);
    }
  }
}

const appPath = 'src/App.tsx';
if (fs.existsSync(path.join(ROOT, appPath))) {
  const app = read(appPath);
  if (app.includes("import('@/pages/WhatsAppFolderWatcher')")) {
    fail(
      'legacy WhatsAppFolderWatcher/whatsappAutoIngestPipeline was re-routed into production; ' +
      'the active ingestion surface must remain WhatsAppSmartFolderWatcher until orchestration is consolidated.'
    );
  }
}

if (!process.exitCode) {
  console.log(
    'WhatsApp/Sales Intelligence owner registry OK: ' + currentTopLevelVersioned.length +
    ' legacy versioned modules frozen; ' + canonicalCoreFiles.length +
    ' canonical core owners protected from evidence-only dependencies.'
  );
}
