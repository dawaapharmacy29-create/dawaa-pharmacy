import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, serializeWhatsAppSessionRawText } from '@/lib/whatsappConversationParser';
import { segmentWhatsAppExportCanonical } from '@/lib/whatsappCanonicalSegmentation';
import { hashWhatsAppSession } from '@/lib/whatsappReviewPersistenceV4';
import type { StaffDirectoryIdentity } from '@/lib/readModels/staffDirectoryReadModel';
import {
  buildSourceCorrectionPreview,
  describeOperationError,
  eligibleCorrectionStaff,
  type StoredSourceAttribution,
} from '../sourceCorrectionModel';
import { parseMaterializationResult, parseSourceCorrectionResult, submitSourceAttributionCorrection } from '../sourceOperationsService';

// Synthetic management scenario only (no real conversation).
const HEADER = 'سيناريو تجريبي مصطنع بطلب الإدارة لا يمثل محادثة فعلية مع العميل.';
const lines = (staffIntro: string) => [
  HEADER,
  '[10/20/26, 5:00:00 AM] معاذ - عميل تجريبي 17: السلام عليكم، عندكم كاتفلام 50 مجم أقراص؟ عايز علبة واحدة 20 قرص.',
  `[10/20/26, 5:00:30 AM] You: وعليكم السلام، مع حضرتك ${staffIntro} من فرع شكري. كتافلام 50 مجم 20 قرص غير متوفر حاليًا.`,
  '[10/20/26, 5:01:00 AM] معاذ - عميل تجريبي 17: تمام، سجل لي طلب علبة واحدة كاتفلام 50 مجم أقراص، وكلمني أول ما يتوفر. مش عايز بديل دلوقتي.',
  '[10/20/26, 5:01:30 AM] You: حاضر، هنراجع طلب توفير كتافلام 50 مجم أقراص ونتواصل مع حضرتك أول ما يتوفر.',
  '[10/20/26, 5:02:00 AM] معاذ - عميل تجريبي 17: شكرًا، هنتظر تواصلكم.',
].join('\n');
const ORIGINAL = lines('د معاذ');
const CORRECTED = lines('د دنيا');
const FILE = 'TEST-V35-customer-17.txt';
const CUSTOMER = '17fd9821-05c2-4ebb-93dd-38f202611a52';
const GM = '303f15a8-5161-4c99-8301-4df256215a25';
const DONIA = '0afe27ce-bc26-4b14-9e1b-c37d9040631e';
const DONIA_OLD = 'e6b0dfe1-f4ea-46bf-9111-be4f327f0ee9';
const SHAMY = '99999999-9999-4999-8999-999999999999';

const directory: StaffDirectoryIdentity[] = [
  { id: GM, name: 'د/ معاذ', branch: 'كل الفروع', role: 'مدير عام', username: null, status: null, active: true, source: 'staff' },
  { id: DONIA, name: 'د دنيا', branch: 'فرع شكري', role: 'صيدلاني', username: null, status: null, active: true, source: 'staff' },
  { id: DONIA_OLD, name: 'د/ دنيا', branch: 'المخزن', role: 'صيدلاني', username: null, status: null, active: false, source: 'staff' },
  { id: SHAMY, name: 'د سارة', branch: 'فرع الشامي', role: 'صيدلاني', username: null, status: null, active: true, source: 'staff' },
  { id: CUSTOMER, name: 'معاذ', branch: 'فرع شكري', role: null, username: 'moaz', status: null, active: true, source: 'staff_account' },
];

async function storedFrom(text: string): Promise<StoredSourceAttribution> {
  const [context] = segmentWhatsAppExportCanonical(parseWhatsAppExport(text), FILE).caseContexts.contexts;
  const session = context.mergedSession;
  return {
    id: '753b38b2-69d7-48da-85be-acd8f50e1e80',
    sourceFilename: FILE,
    sourceHash: await hashWhatsAppSession(session),
    rawText: serializeWhatsAppSessionRawText(session),
    staffId: GM,
    staffName: 'د معاذ',
    branch: 'كل الفروع',
    customerId: CUSTOMER,
    customerCode: '17',
    customerName: 'د معاذ ش 13204',
    conversationStartedAt: session.startedAt.toISOString(),
    conversationEndedAt: session.endedAt.toISOString(),
    messageCount: session.messages.length,
    reviewStatus: 'ready_detailed',
  };
}

const REASON = 'تصحيح المثال التجريبي إلى د دنيا فرع شكري';

describe('source correction preview', () => {
  it('shows old vs new staff/branch and exactly the changed line for the corrected scenario', async () => {
    const stored = await storedFrom(ORIGINAL);
    const preview = await buildSourceCorrectionPreview(stored, { rawText: CORRECTED, staffId: DONIA, branch: 'فرع شكري', reason: REASON }, directory);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.changes).toEqual([
      { field: 'staff', label: 'الدكتور المسؤول', before: 'د معاذ', after: 'د دنيا' },
      { field: 'branch', label: 'فرع المعاملة', before: 'كل الفروع', after: 'فرع شكري' },
      { field: 'text', label: 'نص المحادثة', before: 'النص المحفوظ', after: '1 سطر معدل' },
    ]);
    expect(preview.changedLines).toHaveLength(1);
    expect(preview.changedLines[0].before).toContain('د معاذ');
    expect(preview.changedLines[0].after).toContain('د دنيا');
    expect(preview.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.sourceHash).not.toBe(stored.sourceHash);
    // A later re-upload of the corrected file hashes to the corrected source (no parallel source).
    expect((await storedFrom(CORRECTED)).sourceHash).toBe(preview.sourceHash);
    expect((await storedFrom(CORRECTED)).rawText).toBe(preview.rawText);
  });

  it('refuses account-wide branch, missing reason, ineligible staff and a different conversation', async () => {
    const stored = await storedFrom(ORIGINAL);
    const run = (draft: Partial<{ rawText: string; staffId: string | null; branch: string; reason: string }>) =>
      buildSourceCorrectionPreview(stored, { rawText: CORRECTED, staffId: DONIA, branch: 'فرع شكري', reason: REASON, ...draft }, directory);
    const errorsOf = async (draft: Parameters<typeof run>[0]) => {
      const preview = await run(draft);
      expect(preview.ok).toBe(false);
      return preview.ok ? [] : preview.errors.join(' | ');
    };
    expect(await errorsOf({ branch: 'كل الفروع' })).toContain('فرع تشغيل معتمد');
    expect(await errorsOf({ branch: 'المخزن' })).toContain('فرع تشغيل معتمد');
    expect(await errorsOf({ reason: 'خطأ' })).toContain('سبب التصحيح');
    expect(await errorsOf({ staffId: DONIA_OLD })).toContain('الدكتور المسؤول');
    // A doctor from another home branch needs an explicit cover confirmation.
    expect(await errorsOf({ staffId: SHAMY })).toContain('غطّى هذا الفرع');
    expect(await errorsOf({ staffId: CUSTOMER })).toContain('الدكتور المسؤول');
    expect(await errorsOf({ staffId: null })).toContain('الدكتور المسؤول');
    expect(await errorsOf({ rawText: CORRECTED.replace('5:02:00 AM', '5:09:00 AM') })).toContain('نفس توقيتات');
    expect(await errorsOf({ rawText: 'نص بلا رسائل' })).toContain('لم يتم التعرف');
  });

  it('reports no change instead of submitting an empty correction', async () => {
    const stored = { ...(await storedFrom(ORIGINAL)), staffId: DONIA, staffName: 'د دنيا', branch: 'فرع شكري' };
    const preview = await buildSourceCorrectionPreview(stored, { rawText: ORIGINAL, staffId: DONIA, branch: 'فرع شكري', reason: REASON }, directory);
    expect(preview).toEqual({ ok: false, errors: ['لا يوجد أي تغيير عن البيانات المحفوظة.'] });
  });

  it('refuses to assign an entire Heba-then-pharmacist source to one employee', async () => {
    const multi = [
      '[10/20/26, 5:00:00 AM] You: صباح الخير، مع حضرتك هبه من خدمة عملاء صيدليات دواء',
      '[10/20/26, 5:00:20 AM] عميل تجريبي: أهلاً وسهلاً',
      '[10/20/26, 5:01:00 AM] You: أهلاً وسهلاً مع حضرتك د دنيا',
      '[10/20/26, 5:01:30 AM] عميل تجريبي: عايز علبة واحدة',
    ].join('\n');
    const stored = await storedFrom(multi);
    const preview = await buildSourceCorrectionPreview(stored, {
      rawText: multi, staffId: DONIA, branch: 'فرع شكري', reason: REASON,
    }, directory);
    expect(preview.ok).toBe(false);
    if (!preview.ok) expect(preview.errors.join(' | ')).toContain('أكثر من موظف');
    // Editing out the second introduction cannot make the stored multi-owner source
    // eligible for an unsafe whole-file attribution.
    const hidden = multi.replace('مع حضرتك د دنيا', 'نتشرف بخدمة حضرتك');
    const hiddenPreview = await buildSourceCorrectionPreview(stored, {
      rawText: hidden, staffId: DONIA, branch: 'فرع شكري', reason: REASON,
    }, directory);
    expect(hiddenPreview.ok).toBe(false);
    if (!hiddenPreview.ok) expect(hiddenPreview.errors.join(' | ')).toContain('أكثر من موظف');
  });

  it('also rejects a synthetic successful-preview bypass before submitting an unsafe source-wide update', async () => {
    const multi = [
      '[10/20/26, 5:00:00 AM] You: مع حضرتك هبه من خدمة عملاء صيدليات دواء',
      '[10/20/26, 5:01:00 AM] عميل تجريبي: تمام',
      '[10/20/26, 5:01:30 AM] You: مع حضرتك د دنيا',
      '[10/20/26, 5:02:00 AM] عميل تجريبي: أهلاً',
    ].join('\n');
    const stored = await storedFrom(multi);
    const craftedPreview = {
      ok: true as const,
      rawText: multi.replace('مع حضرتك د دنيا', 'نورت حضرتك'),
      sourceHash: stored.sourceHash,
      staffId: DONIA,
      staffName: 'د دنيا',
      branch: 'فرع شكري',
      reason: REASON,
      crossBranchCover: false,
      changes: [],
      changedLines: [],
    };
    await expect(submitSourceAttributionCorrection(stored, craftedPreview))
      .rejects.toThrow('source_attribution_multistaff_requires_case_review');
  });

  it('rejects a draft that inserts a second named employee even when the stored source had one', async () => {
    const stored = await storedFrom(ORIGINAL);
    const extraIntro = ORIGINAL.replace(
      'حاضر، هنراجع طلب',
      'مع حضرتك د دنيا. حاضر، هنراجع طلب'
    );
    const preview = await buildSourceCorrectionPreview(stored, {
      rawText: extraIntro, staffId: DONIA, branch: 'فرع شكري', reason: REASON,
    }, directory);
    expect(preview.ok).toBe(false);
    if (!preview.ok) expect(preview.errors.join(' | ')).toContain('أكثر من موظف');
  });

  it('offers active canonical staff (home branch, then account-wide, then explicit cover), never the customer', () => {
    expect(eligibleCorrectionStaff(directory, 'فرع شكري', CUSTOMER).map((row) => [row.id, row.coverage])).toEqual([
      [DONIA, 'home_branch'], [GM, 'account_wide'], [SHAMY, 'cross_branch'],
    ]);
    expect(eligibleCorrectionStaff(directory, 'فرع الشامي', CUSTOMER).map((row) => row.id)).toEqual([SHAMY, GM, DONIA]);
  });

  it('records an explicitly confirmed cross-branch cover in the preview', async () => {
    const stored = await storedFrom(ORIGINAL);
    const preview = await buildSourceCorrectionPreview(stored,
      { rawText: CORRECTED, staffId: SHAMY, branch: 'فرع شكري', reason: REASON, crossBranchCover: true }, directory);
    expect('rawText' in preview && preview.crossBranchCover).toBe(true);
    expect('rawText' in preview && preview.changes[0].after).toBe('د سارة (تغطية من فرع الشامي)');
  });
});

describe('source operation results', () => {
  it('never treats a 200 response without a real target as executed', () => {
    expect(() => parseMaterializationResult({ ok: true })).toThrow('whatsapp_action_materialization_invalid_result');
    expect(() => parseMaterializationResult({ ok: false, target_id: 'x' })).toThrow();
    expect(() => parseMaterializationResult(null)).toThrow();
    expect(parseMaterializationResult({ ok: true, already_created: true, target_id: 'r1' })).toEqual({ targetId: 'r1', alreadyCreated: true });
  });

  it('validates the correction command result shape', () => {
    expect(() => parseSourceCorrectionResult({ ok: true, changed: true, retiredActions: 2 })).toThrow();
    expect(() => parseSourceCorrectionResult({ ok: true, retiredActions: 0 })).toThrow();
    expect(parseSourceCorrectionResult({ ok: true, changed: true, retiredActions: 2, correctionId: 'c1' }))
      .toEqual({ changed: true, correctionId: 'c1', retiredActions: 2 });
    expect(parseSourceCorrectionResult({ ok: true, changed: false, retiredActions: 0, sourceId: 's' }))
      .toEqual({ changed: false, correctionId: null, retiredActions: 0 });
  });

  it('maps database refusals to clear Arabic messages and keeps unknown errors visible', () => {
    expect(describeOperationError(new Error('ERROR: customer_request_action_transaction_branch_required')))
      .toContain('كل الفروع');
    expect(describeOperationError({ message: 'source_attribution_has_executed_or_approved_work' })).toContain('معتمد أو منفذ');
    expect(describeOperationError(new Error('network down'))).toBe('network down');
  });
});
