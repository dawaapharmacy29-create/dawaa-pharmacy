const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/StaffMonthlyEvaluation.tsx');
if (!fs.existsSync(file)) {
  throw new Error('[monthly-eval-dedupe] StaffMonthlyEvaluation.tsx not found');
}

let source = fs.readFileSync(file, 'utf8');
const before = source;
const helperPattern = /function nextMonthStart\(value: string\) \{ const \[year, month\] = value\.split\('-'\)\.map\(Number\); return new Date\(Date\.UTC\(year, month, 1\)\)\.toISOString\(\)\.slice\(0, 10\); \}\n?/g;
const matches = source.match(helperPattern) || [];

source = source.replace(helperPattern, '');
const monthStartLine = "function monthStart(value: string) { return `${value}-01`; }";
const helperLine = "function nextMonthStart(value: string) { const [year, month] = value.split('-').map(Number); return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10); }";

if (!source.includes(monthStartLine)) {
  throw new Error('[monthly-eval-dedupe] monthStart helper not found');
}
source = source.replace(monthStartLine, `${monthStartLine}\n${helperLine}`);

const finalMatches = source.match(helperPattern) || [];
if (finalMatches.length !== 1) {
  throw new Error(`[monthly-eval-dedupe] expected one nextMonthStart helper, found ${finalMatches.length}`);
}

if (source !== before) fs.writeFileSync(file, source);
console.log(`[monthly-eval-dedupe] normalized nextMonthStart helpers: before=${matches.length}, after=1`);
