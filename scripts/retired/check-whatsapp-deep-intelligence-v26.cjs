// RETIRED — NOT A GATE (docs/APPLICATION_CONSOLIDATION_V1.md, closure pass).
// This script asserted that the V26 panels are wired into src/pages/WhatsAppReviewQueueV4.tsx and src/pages/WhatsAppConversationAnalyzer.tsx, pages with no route; the V26 panels and their library are used by nothing that renders.
// It failed on main 45fd8d9 already, was never part of npm test / verify / the Quality Gate
// workflow, and is kept only as history. It exits before validating anything.
console.log('[check-whatsapp-deep-intelligence-v26.cjs] RETIRED: legacy surface check, not a gate.');
process.exit(0);

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const required = [
  ['src/lib/whatsappDeepConversationIntelligenceV26.ts', ['p90Seconds', 'p95Seconds', 'classifySampleQuality', 'evaluateMedicalHardGate', 'buildExplainableInvoiceMatchScore', 'price_objection_unhandled']],
  ['src/components/reviews/WhatsAppDeepConversationIntelligenceV26.tsx', ['Conversation Deep Intelligence V26', 'whatsapp_response_turns_v18', 'جودة العينة']],
  ['src/components/reviews/WhatsAppCaseDecisionPanelV26.tsx', ['Case Decision V26', 'Medical Hard Gate', 'deriveLostReasonCodes', 'P90', 'مراجعة بشرية']],
  ['src/pages/WhatsAppReviewQueueV4.tsx', ['WhatsAppDeepConversationIntelligenceV26']],
  ['src/pages/WhatsAppConversationAnalyzer.tsx', ['WhatsAppCaseDecisionPanelV26', 'session={selected}']],
];

const missing = [];
for (const [relative, needles] of required) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) { missing.push(`${relative}:missing-file`); continue; }
  const src = fs.readFileSync(file, 'utf8');
  for (const needle of needles) if (!src.includes(needle)) missing.push(`${relative}:${needle}`);
}

if (missing.length) {
  console.error('[whatsapp-v26-check] FAIL', missing.join(', '));
  process.exit(1);
}
console.log('[whatsapp-v26-check] PASS: response percentiles, deep journey stages, case-level lost reasons, medical hard gate, sample quality and explainable invoice scoring are wired.');
