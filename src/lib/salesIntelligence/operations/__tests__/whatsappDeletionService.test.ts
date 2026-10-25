import { describe, expect, it, vi } from 'vitest';
import {
  canSubmitDeletion,
  clearUnconfirmedWhatsAppInvoiceCandidate,
  DELETION_BLOCKER_LABELS,
  DELETION_CONFIRMATION_PHRASES,
  deleteWhatsAppScope,
  deletionErrorMessage,
  listWhatsAppDeletions,
  newDeletionRequestKey,
  previewWhatsAppDeletion,
  restoreWhatsAppDeletion,
  summarizeDeletionPreview,
} from '../whatsappDeletionService';
import { canManageWhatsAppDeletions } from '@/lib/core/permissionSystem';

const client = (data: unknown, error: unknown = null) => ({ rpc: vi.fn(async () => ({ data, error })) });

const PREVIEW = {
  ok: true,
  status: 'preview',
  scope: 'case',
  sourceId: 'src',
  caseIds: ['src:interaction:0'],
  fingerprint: 'f'.repeat(32),
  blocked: false,
  blockers: [],
  conversation: { customerName: 'إبراهيم', customerCode: '18663', branch: 'المخزن', matchedInvoiceNumber: null },
  cases: [{ caseId: 'src:interaction:0' }],
  remainingCases: [{ caseId: 'src:interaction:1', deleted: false }, { caseId: 'src:interaction:2', deleted: false }],
  evaluations: [{ id: 'r1', effect: 'deactivate' }],
  actions: [{ id: 'a1', effect: 'withdraw' }],
  unscopedActionsUnchanged: 2,
  attributions: [{ invoiceNumber: '74938' }],
  v22Envelopes: [{ proofState: 'proven', verifiedInvoiceNumber: '74938' }],
};

describe('whatsapp deletion service', () => {
  it('calls the database commands with the separate confirmation and the request key', async () => {
    const c = client({ ok: true, changed: true, status: 'deleted', deletionId: 'd1' });
    const result = await deleteWhatsAppScope(c, {
      scope: 'case', target: 'src:interaction:0', reason: 'سبب واضح للحذف', confirmation: 'حذف الحالة',
      fingerprint: 'fp', requestKey: 'del-1234567890',
    });
    expect(result).toEqual({ kind: 'deleted', deletionId: 'd1', changed: true });
    expect(c.rpc).toHaveBeenCalledWith('dawaa_delete_whatsapp_case_v1', {
      p_case_id: 'src:interaction:0', p_reason: 'سبب واضح للحذف', p_confirmation: 'حذف الحالة',
      p_expected_fingerprint: 'fp', p_request_key: 'del-1234567890',
    });
    const conv = client({ ok: true, changed: false, status: 'replayed', deletionId: 'd2' });
    await deleteWhatsAppScope(conv, {
      scope: 'conversation', target: 'src', reason: 'سبب واضح للحذف', confirmation: DELETION_CONFIRMATION_PHRASES.conversation,
      fingerprint: 'fp', requestKey: 'del-1234567890',
    });
    expect(conv.rpc).toHaveBeenCalledWith('dawaa_delete_whatsapp_conversation_v1', expect.objectContaining({ p_source_id: 'src' }));
  });

  it('returns a server block with its impact and never reports it as a deletion', async () => {
    const result = await deleteWhatsAppScope(client({ ok: false, changed: false, status: 'blocked', blockers: [{ code: 'canonical_sale_proof_in_scope', ref: 'v22' }] }), {
      scope: 'case', target: 'x', reason: 'سبب واضح للحذف', confirmation: 'حذف الحالة', fingerprint: 'fp', requestKey: 'del-1234567890',
    });
    expect(result).toEqual({ kind: 'blocked', blockers: [{ code: 'canonical_sale_proof_in_scope', ref: 'v22' }] });
  });

  it('corrects only a named unconfirmed candidate through a separate audited RPC', async () => {
    const c = client({ ok: true, status: 'corrected', auditId: 'audit-1' });
    const result = await clearUnconfirmedWhatsAppInvoiceCandidate(c, {
      sourceId: 'source-1', expectedId: 'invoice-1', expectedNumber: '77773',
      reason: 'الفاتورة تخص طلبًا سابقًا وليست بيعًا في المحادثة', requestKey: 'del-1234567890',
    });
    expect(result).toEqual({ status: 'corrected', auditId: 'audit-1' });
    expect(c.rpc).toHaveBeenCalledWith('dawaa_clear_whatsapp_unconfirmed_invoice_candidate_v1', {
      p_source_id: 'source-1', p_expected_candidate_id: 'invoice-1',
      p_expected_invoice_number: '77773', p_reason: 'الفاتورة تخص طلبًا سابقًا وليست بيعًا في المحادثة',
      p_confirmation: 'تصحيح ربط الفاتورة', p_request_key: 'del-1234567890',
    });
  });

  it('rejects candidate corrections without an auditable confirmed result', async () => {
    const input = { sourceId: 's', expectedId: 'i', expectedNumber: '77773', reason: 'سبب موثق ومفصل', requestKey: 'del-1234567890' };
    await expect(clearUnconfirmedWhatsAppInvoiceCandidate(client({ ok: true, status: 'corrected' }), input))
      .rejects.toThrow('سجل تدقيق');
    await expect(clearUnconfirmedWhatsAppInvoiceCandidate(client({ ok: true, status: 'removed', auditId: 'a' }), input))
      .rejects.toThrow('لم يؤكد الخادم');
    await expect(clearUnconfirmedWhatsAppInvoiceCandidate(client(null, { message: 'whatsapp_candidate_confirmed_link_requires_financial_review' }), input))
      .rejects.toThrow('مصالحة مالية');
  });

  it('never treats an unexpected response as success', async () => {
    const input = { scope: 'case' as const, target: 'x', reason: 'سبب واضح للحذف', confirmation: 'حذف الحالة', fingerprint: 'fp', requestKey: 'del-1234567890' };
    await expect(deleteWhatsAppScope(client({ ok: true }), input)).rejects.toThrow('لم يؤكد الخادم');
    await expect(deleteWhatsAppScope(client(null), input)).rejects.toThrow('استجابة غير متوقعة');
    await expect(restoreWhatsAppDeletion(client({ ok: true, status: 'weird' }), { deletionId: 'd', reason: 'x', confirmation: 'استرجاع', requestKey: 'del-1234567890' })).rejects.toThrow('لم يؤكد الخادم');
    await expect(listWhatsAppDeletions(client({ not: 'a list' }))).rejects.toThrow('استجابة غير متوقعة');
  });

  it('maps database refusals to Arabic messages', async () => {
    await expect(previewWhatsAppDeletion(client(null, { message: 'whatsapp_deletion_general_manager_required' }), 'case', 'x'))
      .rejects.toThrow('هذا الإجراء متاح للمدير العام فقط.');
    expect(deletionErrorMessage(new Error('whatsapp_deletion_preview_stale'))).toMatch(/أعد المعاينة/);
    expect(deletionErrorMessage(new Error('whatsapp_restore_conversation_first'))).toMatch(/استرجع المحادثة أولًا/);
    for (const label of Object.values(DELETION_BLOCKER_LABELS)) expect(label).toMatch(/[؀-ۿ]/);
  });

  it('enables the button only with a clean preview, a reason and the exact phrase of that scope', async () => {
    const preview = await previewWhatsAppDeletion(client(PREVIEW), 'case', 'src:interaction:0');
    const base = { scope: 'case' as const, preview, reason: 'حالة مكررة بالخطأ', confirmation: 'حذف الحالة', submitting: false };
    expect(canSubmitDeletion(base)).toBe(true);
    expect(canSubmitDeletion({ ...base, confirmation: DELETION_CONFIRMATION_PHRASES.conversation })).toBe(false);
    expect(canSubmitDeletion({ ...base, scope: 'conversation' })).toBe(false);
    expect(canSubmitDeletion({ ...base, reason: 'قصير' })).toBe(false);
    expect(canSubmitDeletion({ ...base, submitting: true })).toBe(false);
    expect(canSubmitDeletion({ ...base, preview: { ...preview, blocked: true } })).toBe(false);
    expect(canSubmitDeletion({ ...base, preview: { ...preview, status: 'already_deleted' } })).toBe(false);
  });

  it('summarizes the scope in Arabic before confirmation', async () => {
    const preview = await previewWhatsAppDeletion(client(PREVIEW), 'case', 'src:interaction:0');
    const summary = summarizeDeletionPreview(preview);
    expect(summary.title).toBe('حذف هذه الحالة فقط');
    expect(summary.description).toMatch(/تبقى المحادثة وبقية حالاتها/);
    expect(summary.lines).toEqual(expect.arrayContaining([
      'الحالات التي ستُحذف: ١',
      'الحالات التي ستبقى في المحادثة: ٢',
      'فواتير مرتبطة: 74938',
      'إثباتات بيع مثبتة مرتبطة: ١',
    ]));
    const conversation = summarizeDeletionPreview({ ...preview, scope: 'conversation' });
    expect(conversation.title).toBe('حذف المحادثة كاملةً مع كل حالاتها');
    expect(conversation.lines).toContain('لن تبقى أي حالة نشطة في هذه المحادثة.');
  });

  it('preview of an already deleted scope is never submittable', async () => {
    const preview = await previewWhatsAppDeletion(client({ ok: true, status: 'already_deleted', deletionId: 'd1' }), 'case', 'x');
    expect(preview.blocked).toBe(true);
    expect(preview.deletionId).toBe('d1');
  });

  it('request keys are unique and match the database format', () => {
    const a = newDeletionRequestKey();
    const b = newDeletionRequestKey();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9:_-]{8,120}$/);
  });

  it('only the general manager (or legacy admin) role sees the commands', () => {
    expect(canManageWhatsAppDeletions('general_manager')).toBe(true);
    expect(canManageWhatsAppDeletions('admin')).toBe(true);
    for (const role of ['pharmacist', 'branch_manager', 'executive_manager', 'customer_service_manager', '', null]) {
      expect(canManageWhatsAppDeletions(role)).toBe(false);
    }
  });
});
