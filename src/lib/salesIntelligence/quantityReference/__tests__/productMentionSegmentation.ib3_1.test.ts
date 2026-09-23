// Phase I.B.3.1 — Semantic Recall Hardening: mandatory regression families for catalog-first
// product-mention segmentation (structural root cause #1) and the ProductMention validity gate
// (structural root cause #2). See productMentionTracker.ts's resolveProductSegments()/
// classifyMentionValidity() for the fix itself; this file only proves it against the mandatory
// scenarios instruction #19 lists, plus the two known real failures instruction #1 requires
// permanent fixtures for.
import { describe, expect, it } from 'vitest';
import { buildProductMentions, computeActiveProductCandidates } from '../productMentionTracker';
import { messagesFrom } from './testUtils';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../../pharmacyProducts/canonicalProduct';
import { buildPharmacyProductIndex } from '../../pharmacyProducts/pharmacyProductResolverV2';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';

function catalogFrom(rows: RawProductRow[]) {
  const counts = countNormalizedNames(rows);
  const catalog = rows.map((r) => buildCanonicalProduct(r, counts, normalizePharmacyText));
  return buildPharmacyProductIndex(catalog);
}

// Every row is REAL (id/product_code/price confirmed via SQL against the live Supabase project,
// 2026-09-23) — including "زوركال"/Zurcal, confirmed present under `zurcal 20mg 14 tablets`
// (product_code 67186) after the I.B.3 report's earlier catalog check missed it.
const CATALOG = catalogFrom([
  { id: '8418f406-2c16-423e-8528-529d39e7d17b', name: 'ANTINAL 24 CAP', product_code: '56822', normalized_name: 'antinal 24 cap', category: null, price: '52', source: 'catalog_import' },
  { id: '5ab43fcb-385e-427e-bb14-b8dc0ec278eb', name: 'zurcal 20mg 14 tablets', product_code: '67186', normalized_name: 'zurcal 20mg 14 tablets', category: null, price: '96', source: 'catalog_import' },
  { id: '8e762d26-b981-4f29-a696-8f361d70349a', name: 'Flexilax 30 tabs', product_code: '68114', normalized_name: 'flexilax 30 tabs', category: null, price: '84', source: 'catalog_import' },
  { id: '67807107-59cf-4ffe-b442-6d182454fb6b', name: 'CENTRUM WOMEN 100 TAB', product_code: '79850', normalized_name: 'centrum women 100 tab', category: null, price: '810', source: 'catalog_import' },
  { id: '0479e483-c82e-4c07-bb8c-e096cc116c19', name: 'folic acid 5 mg eipico 20 tablets', product_code: '68516', normalized_name: 'folic acid 5 mg eipico 20 tablets', category: null, price: '24', source: 'catalog_import' },
]);

function customerMentions(raw: string) {
  const messages = messagesFrom(raw);
  return { messages, mentions: buildProductMentions(messages, { productIndex: CATALOG }) };
}

describe('I.B.3.1 — mandatory family #1: انتينال وزوركال (genuine two-product conjunction list)', () => {
  it('splits into two distinct, safely-resolved product mentions', () => {
    const { mentions } = customerMentions('[9/15/26, 9:00:00 AM] Customer: عايز انتينال وزوركال');
    const resolved = mentions.filter((m) => m.resolvedProductId);
    expect(resolved.map((m) => m.resolvedProductId).sort()).toEqual(
      ['5ab43fcb-385e-427e-bb14-b8dc0ec278eb', '8418f406-2c16-423e-8528-529d39e7d17b'].sort()
    );
    resolved.forEach((m) => expect(m.validity).toBe('canonical_resolved'));
  });
});

describe('I.B.3.1 — mandatory family #2: سنترم ومان (product name containing an internal transliterated و)', () => {
  it('is NEVER split — the whole phrase resolves as ONE product (the real failure this phase fixes)', () => {
    const { mentions } = customerMentions('[9/15/26, 9:00:00 AM] Customer: عايز سنترم ومان');
    const customerMentionsOnly = mentions.filter((m) => m.role === 'customer_request');
    expect(customerMentionsOnly).toHaveLength(1);
    expect(customerMentionsOnly[0].resolvedProductId).toBe('67807107-59cf-4ffe-b442-6d182454fb6b');
    expect(customerMentionsOnly[0].validity).toBe('canonical_resolved');
  });
});

describe('I.B.3.1 — mandatory family #3: whole phrase valid, split sides would be invalid', () => {
  it('prefers the whole-product interpretation over splitting (same case as family #2, phrased as the general rule)', () => {
    // "سنترم ومان" whole = a real product; "سنترم" alone and "مان" alone are NOT what a naive
    // split would produce as two independently-meaningful products — "مان" alone resolves to
    // nothing real. Catalog-first must never even attempt the split here.
    const { mentions } = customerMentions('[9/15/26, 9:00:00 AM] Customer: محتاج سنترم ومان');
    const customerMentionsOnly = mentions.filter((m) => m.role === 'customer_request');
    expect(customerMentionsOnly).toHaveLength(1);
    expect(customerMentionsOnly[0].rawText).toContain('ومان');
  });
});

describe('I.B.3.1 — mandatory family #4: whole phrase invalid, both split sides valid', () => {
  it('splits into two mentions once the whole phrase fails to resolve as one product', () => {
    const { mentions } = customerMentions('[9/15/26, 9:00:00 AM] Customer: عايز انتينال وفليكسيلاكس');
    const resolved = mentions.filter((m) => m.resolvedProductId);
    expect(resolved.map((m) => m.resolvedProductId).sort()).toEqual(
      ['8418f406-2c16-423e-8528-529d39e7d17b', '8e762d26-b981-4f29-a696-8f361d70349a'].sort()
    );
  });
});

describe('I.B.3.1 — mandatory family #5: three products joined with و', () => {
  it('splits into three distinct, safely-resolved product mentions', () => {
    const { mentions } = customerMentions('[9/15/26, 9:00:00 AM] Customer: عايز انتينال وزوركال وفليكسيلاكس');
    const resolved = mentions.filter((m) => m.resolvedProductId);
    expect(resolved).toHaveLength(3);
    expect(new Set(resolved.map((m) => m.resolvedProductId)).size).toBe(3);
  });
});

describe('I.B.3.1 — mandatory family #13: non-product phrase accidentally product-like', () => {
  it('a customer availability QUESTION about something already discussed never becomes a competing active candidate (the real R05 failure this phase fixes)', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: Isis teenderm gel for sensitive skin
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: موجود عندكم الغسول ده`;
    const { messages, mentions } = customerMentions(raw);
    const questionMention = mentions.find((m) => m.sourceMessageId === messages[2].id);
    expect(questionMention?.validity).toBe('non_product');
    const active = computeActiveProductCandidates(messages, mentions, messages.length);
    // Only ONE real identity may ever be active here — the phantom "موجود عندكم الغسول ده" bucket
    // must never appear alongside it.
    expect(active).toHaveLength(1);
  });

  it('a bare address/title phrase never becomes a product candidate', () => {
    const { mentions } = customerMentions('[9/15/26, 9:00:00 AM] Customer: دكتوره مي');
    expect(mentions.every((m) => m.validity !== 'canonical_resolved' && m.validity !== 'unresolved_but_product_like')).toBe(true);
  });
});

describe('I.B.3.1 — mandatory family #15: case-boundary isolation for segmentation', () => {
  it('a fresh case never inherits a multi-product split from an unrelated earlier case', () => {
    const { mentions: caseAMentions } = customerMentions('[9/15/26, 9:00:00 AM] Customer: عايز انتينال وزوركال');
    const { mentions: caseBMentions } = customerMentions('[9/16/26, 9:00:00 AM] Customer: عايز حاجة تانية خالص');
    expect(caseAMentions.some((m) => m.resolvedProductId)).toBe(true);
    expect(caseBMentions.some((m) => m.resolvedProductId)).toBe(false);
  });
});

describe('I.B.3.1 — mandatory family #12: same brand, different strength', () => {
  // A dedicated, isolated catalog: adding a second Zurcal strength to the SHARED module-level
  // CATALOG would make a bare "زوركال" (no strength) genuinely ambiguous for the OTHER tests in
  // this file (a real, correct resolver outcome — bare "زوركال" truly is ambiguous once two
  // strengths exist — but not what families #1/#5 are testing).
  const STRENGTH_CATALOG = catalogFrom([
    { id: '5ab43fcb-385e-427e-bb14-b8dc0ec278eb', name: 'zurcal 20mg 14 tablets', product_code: '67186', normalized_name: 'zurcal 20mg 14 tablets', category: null, price: '96', source: 'catalog_import' },
    { id: '41ec027a-4d74-430a-9253-522e653a6cb1', name: 'zurcal 40 mg 28 tab', product_code: '79311', normalized_name: 'zurcal 40 mg 28 tab', category: null, price: '192', source: 'catalog_import' },
  ]);

  it('Zurcal 20mg and Zurcal 40mg (real, distinct catalog rows) stay distinct identities, never merged by brand alone', () => {
    const messages = messagesFrom('[9/15/26, 9:00:00 AM] Customer: عايز زوركال 20 وزوركال 40');
    const mentions = buildProductMentions(messages, { productIndex: STRENGTH_CATALOG });
    const resolved = mentions.filter((m) => m.resolvedProductId);
    expect(new Set(resolved.map((m) => m.resolvedProductId)).size).toBe(2);
    expect(resolved.map((m) => m.resolvedProductId).sort()).toEqual(
      ['41ec027a-4d74-430a-9253-522e653a6cb1', '5ab43fcb-385e-427e-bb14-b8dc0ec278eb'].sort()
    );
  });
});

describe('I.B.3.1 — same-SKU merge still holds after segmentation changes (regression guard)', () => {
  it('Arabic + English mentions of the same product in one multi-product message still merge to one identity', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: Antinal 200 متوفر وزوركال برضو موجود`;
    const { mentions } = customerMentions(raw);
    const antinalIdentities = new Set(mentions.filter((m) => m.resolvedProductId === '8418f406-2c16-423e-8528-529d39e7d17b').map((m) => m.identityKey));
    expect(antinalIdentities.size).toBe(1);
  });
});
