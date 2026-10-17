const fs = require('node:fs');

const path = 'src/lib/whatsappCustomerJourneyPersistenceV15.ts';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(label, from, to) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`${label}: anchor not found`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`${label}: anchor is not unique`);
  source = source.slice(0, first) + to + source.slice(first + from.length);
}

replaceOnce(
  'writer-import',
  "import { writeWhatsAppOperationalActionsV6 } from './whatsappOperationalIntelligenceV6';\n",
  ''
);
replaceOnce(
  'due-helper',
  "function dueInHours(hours: number | null) {\n  if (hours == null) return null;\n  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();\n}\n\n",
  ''
);

const startMarker = "  const recoveryAction = model.actions.find((action) => action.key === 'journey-recovery-followup');\n";
const endMarker = "  let story: Awaited<ReturnType<typeof syncPersistentCustomerStoryV16>> = null;\n";
const start = source.indexOf(startMarker);
if (start < 0) throw new Error('recovery-writer: start anchor not found');
const end = source.indexOf(endMarker, start);
if (end < 0) throw new Error('recovery-writer: end anchor not found');
if (source.indexOf(startMarker, start + startMarker.length) >= 0) throw new Error('recovery-writer: start anchor is not unique');
source =
  source.slice(0, start) +
  "  // Journey V15 remains a story/evidence side projection only. Recovery task publication is\n" +
  "  // owned exclusively by the canonical Sales Intelligence FollowUp/Complaint projectors.\n\n" +
  source.slice(end);

fs.writeFileSync(path, source);
console.log('Journey V15 operational writer cutover applied');
