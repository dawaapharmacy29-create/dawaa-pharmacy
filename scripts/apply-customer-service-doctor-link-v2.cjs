const fs = require('node:fs');

const filePath = 'src/lib/api/customerServiceCommandCenter.ts';
let source = fs.readFileSync(filePath, 'utf8');

function replaceOnce(search, replacement, label) {
  if (source.includes(replacement)) return;
  if (!source.includes(search)) throw new Error(`doctor followup link patch missing: ${label}`);
  source = source.replace(search, replacement);
}

replaceOnce(
  `  createdBy?: string | null;\n  createdByName?: string | null;`,
  `  createdBy?: string | null;\n  createdByName?: string | null;\n  requestedByStaffId?: string | null;\n  assignedToStaffId?: string | null;`,
  'input identity fields'
);

replaceOnce(
  `    created_by: input.createdBy || null,\n    created_by_name: input.createdByName || null,\n    request_source: input.source || null,`,
  `    created_by: input.createdBy || null,\n    created_by_name: input.createdByName || null,\n    requested_by_staff_id: input.requestedByStaffId || input.createdBy || null,\n    assigned_to_staff_id: input.assignedToStaffId || null,\n    request_source: input.source || null,`,
  'insert identity fields'
);

fs.writeFileSync(filePath, source);
console.log('Customer service doctor requester linkage v2 applied.');
