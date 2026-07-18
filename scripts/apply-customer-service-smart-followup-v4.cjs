const fs = require('node:fs');

const filePath = 'src/components/customerService/UnifiedCustomerServiceWorkspace.tsx';
let source = fs.readFileSync(filePath, 'utf8');
const marker = "@/lib/customerServiceSmartFollowup";

if (source.includes(marker)) {
  console.log('Customer service smart followup v4 already applied.');
  process.exit(0);
}

function replaceOnce(search, replacement, label) {
  if (!source.includes(search)) {
    console.warn(`customer service smart followup skipped: ${label}`);
    return false;
  }
  source = source.replace(search, replacement);
  return true;
}

const imported = replaceOnce(
  `import type { DailyFollowup } from '@/types/database';`,
  `import type { DailyFollowup } from '@/types/database';\nimport { notifyFollowupOutcome, suggestSmartFollowupDate } from '@/lib/customerServiceSmartFollowup';`,
  'smart followup import'
);

const computed = replaceOnce(
  `    const needsNext = data.needsNextFollowup || !completed;\n    const payload = {`,
  `    const needsNext = data.needsNextFollowup || !completed;\n    const smartNextFollowupDate = data.nextFollowupDate || (!completed ? suggestSmartFollowupDate(data.result) : null);\n    const payload = {`,
  'smart date calculation'
);

const payloadDate = replaceOnce(
  `      next_followup_date: data.nextFollowupDate || null,`,
  `      next_followup_date: smartNextFollowupDate,`,
  'payload smart date'
);

const validation = replaceOnce(
  `    if (!completed && !data.nextFollowupDate && data.result !== 'الرقم غير صحيح') {\n      toast.error('حدد موعد المتابعة القادمة للحالات غير المكتملة');\n      return;\n    }`,
  `    if (!completed && !smartNextFollowupDate && data.result !== 'الرقم غير صحيح') {\n      toast.error('تعذر اقتراح موعد تلقائي؛ حدد موعد المتابعة القادمة');\n      return;\n    }`,
  'smart validation'
);

const notified = replaceOnce(
  `    await updateFollowupResult(resultRow.id, payload);\n    setResultRow(null);`,
  `    await updateFollowupResult(resultRow.id, payload);\n    try {\n      await notifyFollowupOutcome({\n        followupId: resultRow.id,\n        customerName: resultRow.customer_name || resultRow.name || 'العميل',\n        branch: resultRow.branch || branch,\n        result: data.result,\n        nextFollowupDate: smartNextFollowupDate,\n        requestedByStaffId: resultRow.requested_by_staff_id || resultRow.created_by || null,\n        needsManager: data.result === 'يحتاج متابعة مدير',\n        notes: data.notes || null,\n      });\n    } catch (notificationError) {\n      console.warn('Customer service outcome notification failed', notificationError);\n    }\n    if (!data.nextFollowupDate && smartNextFollowupDate && !completed) {\n      toast.success(\`تم اقتراح موعد المتابعة تلقائيًا: \${smartNextFollowupDate}\`);\n    }\n    setResultRow(null);`,
  'outcome notifications'
);

if (imported && computed && payloadDate && validation && notified) {
  fs.writeFileSync(filePath, source);
  console.log('Customer service smart followup v4 applied.');
} else {
  console.warn('Customer service smart followup v4 was not fully applied; source left unchanged.');
}
