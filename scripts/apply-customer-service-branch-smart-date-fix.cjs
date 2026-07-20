const fs = require('node:fs');
const path = require('node:path');

const file = path.join(process.cwd(), 'src/components/customerService/UnifiedCustomerServiceWorkspace.tsx');
const source = fs.readFileSync(file, 'utf8');

const requiredChecks = [
  {
    label: 'توحيد الفرع داخل قائمة المتابعات',
    patterns: [
      'normalizeBranchName(followupToItem(row).branch)',
      'normalizeBranchName(item.branch) === normalizeBranchName(branch)',
    ],
  },
  {
    label: 'دعم تأجيل المتابعة',
    patterns: ['postponeFollowup', 'next_followup_date'],
  },
  {
    label: 'تسجيل إلغاء المتابعة بدون تعطيل الإجراء',
    patterns: ['eventType: \'cancelled\'', 'eventError'],
  },
];

const missing = requiredChecks
  .filter((check) => !check.patterns.every((pattern) => source.includes(pattern)))
  .map((check) => check.label);

if (missing.length) {
  throw new Error(`Customer service safeguards are missing: ${missing.join('، ')}`);
}

console.log('Verified customer-service branch, postponement, and cancellation safeguards without modifying source files.');
