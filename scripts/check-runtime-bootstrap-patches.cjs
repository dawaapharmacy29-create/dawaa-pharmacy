const fs = require('node:fs');

const failures = [];
const index = fs.readFileSync('index.html', 'utf8');
const main = fs.readFileSync('src/main.tsx', 'utf8');
const normalizer = fs.readFileSync('src/lib/reviews/reviewDraftNormalization.ts', 'utf8');

for (const legacyToken of [
  'dawaa_conversation_review_draft_v3',
  'dawaa_notification_settings_v1',
]) {
  if (index.includes(legacyToken)) {
    failures.push(`index.html must not patch persisted application state: ${legacyToken}`);
  }
}

if (!main.includes('normalizeStoredConversationReviewDraft(window.localStorage)')) {
  failures.push('main.tsx must normalize persisted conversation-review drafts before React routes mount.');
}
if (!normalizer.includes('for (const criterion of REVIEW_CRITERIA)')) {
  failures.push('review draft normalization must derive its schema from canonical REVIEW_CRITERIA.');
}
if (!normalizer.includes('defaultReviewState()') || !normalizer.includes('defaultSevereErrors()')) {
  failures.push('review draft normalization must start from canonical current defaults.');
}

if (failures.length) {
  console.error('[runtime-bootstrap-patches] FAIL');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[runtime-bootstrap-patches] PASS: startup HTML is state-neutral and review drafts use typed canonical normalization.');
