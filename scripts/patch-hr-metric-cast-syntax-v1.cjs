const fs = require('fs');
const p = 'src/pages/HRComplianceCenter.tsx';
let s = fs.readFileSync(p, 'utf8');
const old = `        {[\n          ['الموظفون', totals.employees, Users],`;
const next = `        {([\n          ['الموظفون', totals.employees, Users],`;
if (!s.includes(old) && !s.includes(next)) throw new Error('metric expression anchor not found');
if (s.includes(old)) s = s.replace(old, next);
fs.writeFileSync(p, s);
console.log('fixed HR metric cast syntax');
