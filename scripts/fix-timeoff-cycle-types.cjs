const fs = require('fs');
const path = 'src/pages/TimeOff.tsx';
let source = fs.readFileSync(path, 'utf8');
const oldText = "      getPermissionPolicyStatusV2(form.staffId, cycle.start, cycle.end),";
const newText = "      getPermissionPolicyStatusV2(form.staffId, cycle.start.toISOString().slice(0, 10), cycle.end.toISOString().slice(0, 10)),";
if (!source.includes(oldText)) throw new Error('time-off cycle call not found');
source = source.replace(oldText, newText);
fs.writeFileSync(path, source);
