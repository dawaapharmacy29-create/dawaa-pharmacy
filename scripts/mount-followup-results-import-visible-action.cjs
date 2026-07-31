const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/components/layout/Layout.tsx');
if (!fs.existsSync(file)) throw new Error('[followup-results-visible-action] Layout not found');

let source = fs.readFileSync(file, 'utf8');
const before = source;
const importLine = "import CustomerServiceResultsImportTopAction from '@/components/customerService/CustomerServiceResultsImportTopAction';";

if (!source.includes(importLine)) {
  const anchor = "import ReviewsInsightsHub from '@/components/reviews/ReviewsInsightsHub';";
  if (!source.includes(anchor)) throw new Error('[followup-results-visible-action] import anchor not found');
  source = source.replace(anchor, `${anchor}\n${importLine}`);
}

if (!source.includes('<CustomerServiceResultsImportTopAction />')) {
  const anchor = '              <PageSectionsPreview path={location.pathname} />';
  if (!source.includes(anchor)) throw new Error('[followup-results-visible-action] render anchor not found');
  source = source.replace(anchor, `              <CustomerServiceResultsImportTopAction />\n${anchor}`);
}

for (const required of [importLine, '<CustomerServiceResultsImportTopAction />']) {
  if (!source.includes(required)) throw new Error(`[followup-results-visible-action] missing ${required}`);
}

if (source !== before) {
  fs.writeFileSync(file, source);
  console.log('[followup-results-visible-action] mounted portal action in Layout');
} else {
  console.log('[followup-results-visible-action] already mounted');
}
