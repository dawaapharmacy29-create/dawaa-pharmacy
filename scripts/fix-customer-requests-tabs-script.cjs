const fs = require('fs');
const file = 'scripts/apply-customer-requests-tabs-v1.cjs';
let src = fs.readFileSync(file, 'utf8');
src = src.replace("style={{ width: \\`${Math.min(summary.fulfillment_rate, 100)}%\\` }}", "style={{ width: Math.min(summary.fulfillment_rate, 100) + '%' }}");
fs.writeFileSync(file, src);
console.log('customer requests tabs script fixed');
