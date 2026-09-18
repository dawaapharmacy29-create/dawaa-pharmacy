const fs = require('fs');
const path = require('path');

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(`[whatsapp-governance-v25-check] ${message}`);
}

const page = read('src/pages/WhatsAppReviewQueueV4.tsx');
const governance = read('src/lib/whatsappReviewGovernanceV25.ts');
const resolver = read('src/lib/whatsappCustomerResolverV4.ts');
const scoring = read('src/lib/whatsappReviewScoring.ts');

assert(page.includes("import WhatsAppReviewGovernanceV25 from '@/components/reviews/WhatsAppReviewGovernanceV25';"), 'governance component import missing');
assert(page.includes('<WhatsAppReviewGovernanceV25 onOpenSource={openQueueSource} />'), 'governance component render missing');
assert(governance.includes("'mandatory_human' | 'human_sample' | 'auto_review_candidate'"), 'three-lane review disposition missing');
assert(governance.includes('samplePercent ?? 15'), 'stable human QA sampling policy missing');
assert(governance.includes("confidence < autoConfidence"), 'confidence human gate missing');
assert(governance.includes("missingMedia > 0"), 'missing media human gate missing');
assert(governance.includes('unresolvedCriteria > 0'), 'unresolved criteria human gate missing');
assert(governance.includes('!customerResolved'), 'customer identity human gate missing');
assert(governance.includes('!invoiceSafe'), 'invoice verification human gate missing');
assert(resolver.includes("strategy: 'ambiguous'"), 'customer resolver ambiguity guard missing');
assert(resolver.includes('لن يتم ربط عميل تلقائيًا'), 'customer resolver no-guess safeguard missing');
assert(scoring.includes("'review_required'"), 'official scoring human-review state missing');

console.log('[whatsapp-governance-v25-check] PASS: safe automation gates, deterministic QA sampling, no-guess customer resolution and human review safeguards are present.');
