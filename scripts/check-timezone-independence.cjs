#!/usr/bin/env node
// Timezone-independence gate for the canonical WhatsApp → Sales Intelligence path.
//
// WhatsApp export clocks are Cairo wall-clock. The canonical result (parsed timestamps, cases,
// invoice attribution, month cycle) must be identical whether the machine runs in UTC (Vercel
// functions), Africa/Cairo (pharmacy browsers) or anything else. This bundles the real modules,
// runs Golden Case #1 plus every WhatsApp fixture in the golden test files under several machine
// timezones, and fails unless the canonical JSON is byte-identical.
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const ZONES = ['UTC', 'Africa/Cairo', 'Asia/Tokyo', 'America/New_York'];
const FIXTURE_FILES = [
  'src/lib/salesIntelligence/__tests__/salesIntelligencePipeline.test.ts',
  'src/lib/salesIntelligence/__tests__/followUpOpportunityEngine.test.ts',
];

const GOLDEN_CASE_1 = {
  raw: `[9/15/26, 9:00:00 AM] Customer: عايز 2 علبة فيتامين د
[9/15/26, 9:01:00 AM] You: حضرتك تأمر بـ:
2 علبة فيتامين د
إجمالي الحساب 180 جنيه
هل الطلب كده كامل؟
[9/15/26, 9:02:00 AM] Customer: ايوه تمام
[9/15/26, 9:03:00 AM] You: تمام يا فندم، تم تأكيد الطلب وجاري الإرسال`,
  invoice: { id: 'inv-1', customer_id: 'cust-1', invoice_datetime: '2026-09-15T09:05:00.000Z', net_amount: 180 },
};

function extractFixtures() {
  const fixtures = [];
  for (const rel of FIXTURE_FILES) {
    const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const match of source.matchAll(/`(\[[^`$]*?)`/g)) {
      if (/^\[\d{1,2}\/\d{1,2}\/\d{2,4},|^\[\d{1,2}:\d{2}/.test(match[1])) fixtures.push(match[1]);
    }
  }
  return [...new Set(fixtures)];
}

const HARNESS = `
import { deriveCasesOnly, runSalesIntelligencePipeline } from '@/lib/salesIntelligence/salesIntelligencePipeline';
import { parseWhatsAppExport } from '@/lib/whatsappConversationParser';
import { monthCycleFromDate } from '@/lib/conversationReviews';

const input = JSON.parse(process.env.DAWAA_TZ_GATE_INPUT);
const canonical = (value) => JSON.parse(JSON.stringify(value, (_key, v) => (v instanceof Date ? v.toISOString() : v)));

const golden = runSalesIntelligencePipeline({
  conversationId: 'golden-1',
  rawWhatsAppExportText: input.golden.raw,
  customerIdHint: 'cust-1',
  resolveInvoiceCandidates: () => [input.golden.invoice],
});
const fixtures = input.fixtures.map((raw, index) => ({
  parsed: parseWhatsAppExport(raw).map((message) => message.timestamp),
  cases: deriveCasesOnly({ conversationId: 'fixture-' + index, rawWhatsAppExportText: raw }),
  anchored: deriveCasesOnly({
    conversationId: 'anchored-' + index,
    rawWhatsAppExportText: raw,
    trustedConversationStartedAt: '2026-09-15T13:27:00.000Z',
  }),
}));
const cycles = ['2026-09-25T21:30:00.000Z', '2026-09-25T22:30:00.000Z', '2026-12-25T22:30:00.000Z', '2026-01-31T23:00:00.000Z']
  .map((iso) => monthCycleFromDate(iso));

process.stdout.write(JSON.stringify(canonical({
  goldenCase1: { status: golden.caseAnalyses[0]?.status ?? null, analyses: golden.caseAnalyses, warnings: golden.pipelineWarnings },
  fixtures,
  cycles,
})));
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dawaa-tz-gate-'));
try {
  const bundle = path.join(tmp, 'harness.cjs');
  esbuild.buildSync({
    stdin: { contents: HARNESS, resolveDir: ROOT, sourcefile: 'tz-gate-harness.ts', loader: 'ts' },
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node22'],
    packages: 'external',
    logLevel: 'silent',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': 'undefined',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': 'undefined',
      'import.meta.env.DEV': 'false',
      'import.meta.env.PROD': 'true',
      'import.meta.env.MODE': '"test"',
    },
  });

  const fixtures = extractFixtures();
  const env = { ...process.env, DAWAA_TZ_GATE_INPUT: JSON.stringify({ golden: GOLDEN_CASE_1, fixtures }) };
  const results = ZONES.map((zone) => {
    const output = execFileSync(process.execPath, [bundle], { cwd: ROOT, env: { ...env, TZ: zone }, maxBuffer: 256 * 1024 * 1024 }).toString();
    const parsed = JSON.parse(output);
    return { zone, hash: crypto.createHash('sha256').update(output).digest('hex').slice(0, 16), golden: parsed.goldenCase1.status };
  });

  for (const row of results) console.log(`[timezone-independence] ${row.zone.padEnd(16)} canonical=${row.hash} goldenCase1=${row.golden}`);
  const failures = [];
  if (new Set(results.map((row) => row.hash)).size !== 1) failures.push('canonical output differs between machine timezones');
  if (results.some((row) => row.golden !== 'needs_human_review')) failures.push('Golden Case #1 must stay needs_human_review in every timezone');
  if (fixtures.length < 10) failures.push(`expected at least 10 WhatsApp fixtures, found ${fixtures.length}`);
  if (failures.length) {
    failures.forEach((failure) => console.error(`[timezone-independence] FAIL: ${failure}`));
    process.exit(1);
  }
  console.log(`[timezone-independence] PASS: ${fixtures.length} fixtures + Golden Case #1 identical across ${ZONES.join(', ')}.`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
