import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredSourceAttribution, SourceCorrectionPreview } from '../sourceCorrectionModel';

const mocks = vi.hoisted(() => ({ read: vi.fn(), rpc: vi.fn(), select: vi.fn(), eq: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: () => ({
      select: mocks.select.mockImplementation(() => ({
        eq: mocks.eq.mockImplementation(() => ({ maybeSingle: mocks.read })),
      })),
    }),
    rpc: mocks.rpc,
  },
}));
const { submitSourceAttributionCorrection } = await import('../sourceOperationsService');

const single = '[10/20/26, 5:00:00 AM] You: مع حضرتك د دنيا';
const multiple = [
  '[10/20/26, 5:00:00 AM] You: مع حضرتك هبه من خدمة عملاء صيدليات دواء',
  '[10/20/26, 5:01:00 AM] عميل تجريبي: تمام',
  '[10/20/26, 5:01:30 AM] You: مع حضرتك د دنيا',
].join('\n');
const stored: StoredSourceAttribution = {
  id: 'synthetic-source', sourceFilename: 'synthetic.txt', sourceHash: 'expected-hash',
  rawText: single, staffId: null, staffName: null, branch: 'فرع شكري',
  customerId: null, customerCode: null, customerName: null,
  conversationStartedAt: null, conversationEndedAt: null, messageCount: 1, reviewStatus: null,
};
const preview: Extract<SourceCorrectionPreview, { ok: true }> = {
  ok: true, rawText: single, sourceHash: 'corrected-hash', staffId: 'synthetic-staff',
  staffName: 'د دنيا', branch: 'فرع شكري', reason: 'Synthetic correction only',
  crossBranchCover: false, changes: [], changedLines: [],
};
const persisted = (rawText = single, sourceHash = stored.sourceHash) => ({
  data: { id: stored.id, raw_text: rawText, source_hash: sourceHash }, error: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(persisted());
  mocks.rpc.mockResolvedValue({
    data: { ok: true, changed: true, retiredActions: 0, correctionId: 'synthetic-correction' }, error: null,
  });
});

describe('source correction submission verifies persisted ownership', () => {
  it('rejects a forged single-staff snapshot when the persisted source identifies two employees', async () => {
    mocks.read.mockResolvedValue(persisted(multiple));
    await expect(submitSourceAttributionCorrection(stored, preview))
      .rejects.toThrow('source_attribution_multistaff_requires_case_review');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.eq).toHaveBeenCalledWith('id', stored.id);
    expect(mocks.select.mock.calls[0][0]).toContain('raw_text');
  });

  it('requires a new preview if the persisted hash changed', async () => {
    mocks.read.mockResolvedValue(persisted(single, 'newer-hash'));
    await expect(submitSourceAttributionCorrection(stored, preview))
      .rejects.toThrow('source_attribution_source_changed');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not submit if the persisted source is unreadable or missing', async () => {
    mocks.read.mockResolvedValue({ data: null, error: new Error('source read failed') });
    await expect(submitSourceAttributionCorrection(stored, preview)).rejects.toThrow('source read failed');
    mocks.read.mockResolvedValue({ data: null, error: null });
    await expect(submitSourceAttributionCorrection(stored, preview)).rejects.toThrow('whatsapp_source_not_found');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('keeps the fast rejection when the caller already supplies multiple employees', async () => {
    await expect(submitSourceAttributionCorrection({ ...stored, rawText: multiple }, preview))
      .rejects.toThrow('source_attribution_multistaff_requires_case_review');
    await expect(submitSourceAttributionCorrection(stored, { ...preview, rawText: multiple }))
      .rejects.toThrow('source_attribution_multistaff_requires_case_review');
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('retains the existing atomic command and its expected hash for an eligible source', async () => {
    expect(await submitSourceAttributionCorrection(stored, preview))
      .toEqual({ changed: true, retiredActions: 0, correctionId: 'synthetic-correction' });
    expect(mocks.rpc).toHaveBeenCalledWith('dawaa_correct_whatsapp_source_attribution_v1',
      expect.objectContaining({ p_source_id: stored.id, p_expected_source_hash: stored.sourceHash }));
  });

  it('propagates an atomic RPC refusal after a successful preflight', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('source_attribution_source_changed') });
    await expect(submitSourceAttributionCorrection(stored, preview))
      .rejects.toThrow('source_attribution_source_changed');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
