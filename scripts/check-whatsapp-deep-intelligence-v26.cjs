const fs = require('fs');
const path = require('path');

const root = process.cwd();
const required = [
  ['src/lib/whatsappDeepConversationIntelligenceV26.ts', ['p90Seconds', 'p95Seconds', 'classifySampleQuality', 'evaluateMedicalHardGate', 'buildExplainableInvoiceMatchScore', 'price_objection_unhandled']],
  ['src/components/reviews/WhatsAppDeepConversationIntelligenceV26.tsx', ['Conversation Deep Intelligence V26', 'whatsapp_response_turns_v18', 'جودة العينة']],
  ['src/pages/WhatsAppReviewQueueV4.tsx', ['WhatsAppDeepConversationIntelligenceV26']],
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
console.log('[whatsapp-v26-check] PASS: response percentiles, sample quality, medical hard gate, explainable invoice scoring and lost reason codes are present.');
