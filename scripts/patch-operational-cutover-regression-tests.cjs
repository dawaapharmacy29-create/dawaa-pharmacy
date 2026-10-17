const fs = require('node:fs');

const path = 'src/lib/__tests__/stableOperationIdentity.test.ts';
let source = fs.readFileSync(path, 'utf8');
const replacementTitle = "Journey V15 is story/evidence only and never publishes recovery tasks beside canonical SI";
if (source.includes(replacementTitle)) {
  console.log('operational cutover regression test already updated');
  process.exit(0);
}
const startMarker = "  it('Journey V15 (reachable from every file ingest) writes its recovery follow-up through the same identity', async () => {\n";
const start = source.indexOf(startMarker);
if (start < 0) throw new Error('Journey V15 legacy test anchor not found');
if (source.indexOf(startMarker, start + startMarker.length) >= 0) throw new Error('Journey V15 legacy test anchor not unique');
const describeEnd = source.lastIndexOf('\n});');
if (describeEnd < start) throw new Error('stable operation identity describe end not found');
const replacement = `  it('Journey V15 is story/evidence only and never publishes recovery tasks beside canonical SI', async () => {\n    const raw = \`[9/15/26, 6:00:00 AM] Customer: عايز اوردر كونجستال\n[9/15/26, 6:05:00 AM] You: تمام\n[9/15/26, 9:30:00 AM] Customer: الاوردر ماوصلش ومحدش رد\`;\n    const contexts = segmentWhatsAppExportCanonical(parse(raw), 'chat.txt').caseContexts.contexts;\n    const sessions = contexts.map((context) => context.mergedSession);\n    const journeyModel = buildWhatsAppCustomerJourneyIntelligenceV15(sessions);\n    expect(journeyModel.actions.find((action) => action.key === 'journey-recovery-followup')).toBeTruthy();\n    db.tables.whatsapp_review_sources = [{ id: 'source-fixture-a', branch: 'branch-fixture', customer_id: null }];\n\n    const run = () =>\n      syncWhatsAppCustomerJourneyV15(journeyModel, {\n        sessionSources: sessions.map((session) => ({\n          sessionId: session.id,\n          sourceId: 'source-fixture-a',\n          contextOnly: false,\n        })),\n        sessions,\n      });\n\n    const first = await run();\n    const second = await run();\n    expect(first).toBeTruthy();\n    expect(second).toBeTruthy();\n    expect(rows()).toHaveLength(0);\n    expect(db.writes.filter((write) => write.table === ACTIONS)).toHaveLength(0);\n  });`;
source = source.slice(0, start) + replacement + source.slice(describeEnd);
fs.writeFileSync(path, source);
console.log('operational cutover regression test updated');
