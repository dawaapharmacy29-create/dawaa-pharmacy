#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const CONTRACT = path.join(ROOT, 'src/lib/tasks/taskEvidence.ts');
const DOC = path.join(ROOT, 'docs/TASK_EVIDENCE_ARCHITECTURE.md');
const failures = [];

if (!fs.existsSync(CONTRACT)) failures.push('missing canonical task evidence contract');
if (!fs.existsSync(DOC)) failures.push('missing task evidence architecture document');

if (fs.existsSync(CONTRACT)) {
  const source = fs.readFileSync(CONTRACT, 'utf8');
  const requiredTokens = [
    'sourceType:',
    'sourceId:',
    'taskKey:',
    'subjectStaffId:',
    'branch:',
    'status:',
    'occurredAt:',
    'cancellationReason:',
  ];
  for (const token of requiredTokens) {
    if (!source.includes(token)) failures.push(`task evidence contract missing ${token}`);
  }

  const forbiddenFinancialFields = [
    /\bpointsDelta\s*:/,
    /\bpoints_delta\s*:/,
    /\bincentiveAmount\s*:/,
    /\bpayrollAmount\s*:/,
    /\bsalaryDeduction\s*:/,
    /\bamount\s*:/,
  ];
  for (const pattern of forbiddenFinancialFields) {
    if (pattern.test(source)) {
      failures.push(`task evidence contract contains forbidden financial field: ${pattern}`);
    }
  }

  for (const status of ['expected', 'assigned', 'accepted', 'completed', 'missed', 'cancelled']) {
    if (!source.includes(`'${status}'`)) failures.push(`task evidence status missing: ${status}`);
  }
}

if (fs.existsSync(DOC)) {
  const doc = fs.readFileSync(DOC, 'utf8');
  const requiredPrinciples = [
    'Domain workflow -> Task Evidence -> Task Completion Projection -> Evaluation Metrics -> Approved Evaluation -> Settlement -> Payroll',
    'Do not replace all operational domains with a giant generic task table.',
    'A feature page must not turn task completion directly into points or money.',
    'A failed evidence source is `unavailable`, not equivalent to `missed` or zero performance.',
  ];
  for (const principle of requiredPrinciples) {
    if (!doc.includes(principle)) failures.push(`task evidence architecture principle missing: ${principle}`);
  }
}

if (failures.length) {
  console.error('Task evidence architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[task-evidence-architecture] PASS: canonical evidence identity/lifecycle exists and financial settlement stays outside the task contract.');
