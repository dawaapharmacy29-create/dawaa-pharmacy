import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('canonical operational writer cutover', () => {
  it('does not let automatic ingest publish V6 operational actions before canonical SI', () => {
    const source = read('src/lib/whatsappAutoIngestPipeline.ts');
    expect(source).not.toContain('await syncWhatsAppOperationalActionsV6(');
  });

  it('does not let automatic ingest publish legacy follow-up signals as a second task authority', () => {
    const source = read('src/lib/whatsappAutoIngestPipeline.ts');
    expect(source).not.toContain('const followups = await saveFollowupSignals(');
  });

  it('does not let the legacy product-demand backfill publish V6 actions', () => {
    const source = read('src/lib/whatsappProductDemandBackfillV22.ts');
    expect(source).not.toContain('await syncWhatsAppOperationalActionsV6(');
  });

  it('does not let Journey V15 publish recovery tasks beside the canonical brain', () => {
    const source = read('src/lib/whatsappCustomerJourneyPersistenceV15.ts');
    expect(source).not.toContain('await writeWhatsAppOperationalActionsV6(');
  });

  it('keeps canonical projectors wired into the single refresh service', () => {
    const source = read('src/lib/salesIntelligence/refresh/canonicalRefreshService.ts');
    expect(source).toContain('projectCanonicalFollowupsToActions');
    expect(source).toContain('projectCanonicalCustomerRequestsToActions');
    expect(source).toContain('projectCanonicalComplaintsToActions');
  });
});
