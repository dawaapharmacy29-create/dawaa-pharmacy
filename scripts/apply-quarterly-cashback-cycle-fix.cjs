const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'src/pages/CustomerCashback.tsx');
let source = fs.readFileSync(target, 'utf8');

const oldReturn = "  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };";
const newReturn = "  const toLocalDate = (value: Date) => {\n    const y = value.getFullYear();\n    const m = String(value.getMonth() + 1).padStart(2, '0');\n    const d = String(value.getDate()).padStart(2, '0');\n    return `${y}-${m}-${d}`;\n  };\n  return { start: toLocalDate(start), end: toLocalDate(end) };";

const oldFilter = ".gte('cycle_start', cycleStart)\n          .lte('cycle_end', cycleEnd)";
const newFilter = ".eq('cycle_start', cycleStart)\n          .eq('cycle_end', cycleEnd)";

let changed = false;
if (source.includes(oldReturn)) {
  source = source.replace(oldReturn, newReturn);
  changed = true;
}
if (source.includes(oldFilter)) {
  source = source.replace(oldFilter, newFilter);
  changed = true;
}

if (!changed) {
  console.log('[quarterly-cashback-cycle-fix] already applied or target not found');
  process.exit(0);
}

fs.writeFileSync(target, source);
console.log('[quarterly-cashback-cycle-fix] applied');
