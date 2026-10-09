// Release Candidate closure: conversation branch provenance and confirmed invoice links.
import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { resolveConversationBranchHint } from '@/lib/whatsappConversationBranchHint';
import {
  attachInvoiceVerificationToQueue,
  hashWhatsAppSession,
  readStoredSourceBranch,
} from '@/lib/whatsappReviewPersistenceV4';
import type { WhatsAppParticipantRoleModelV15 } from '@/lib/whatsappParticipantRoleResolverV15';

const CUSTOMER_ONLY = `[9/28/26, 3:51:56 AM] Customer: السلام عليكم عايزه بانادول
[9/28/26, 3:52:30 AM] Customer: لو سمحت`;

function session() {
  return splitWhatsAppSessions(parseWhatsAppExport(CUSTOMER_ONLY))[0];
}

function rolesWithStaffBranch(branch: string): WhatsAppParticipantRoleModelV15 {
  return {
    version: 'whatsapp-participant-role-v15',
    messages: [],
    staff: [{ accountId: null, staffId: 's1', staffName: 'موظف', role: 'staff' as any, branch, confidence: 1 }],
  };
}

function fakeSourcesClient(row: Record<string, unknown> | null, updates: unknown[] = []) {
  return {
    from: () => ({
      select: () => ({
        eq: (_column: string, value: string) => ({
          maybeSingle: async () => ({ data: row && (row.source_hash === undefined || row.source_hash === value || row.id === value) ? row : null, error: null }),
        }),
      }),
      update: (patch: unknown) => {
        updates.push(patch);
        return { eq: async () => ({ error: null }) };
      },
      insert: async () => ({ error: null }),
    }),
  };
}

describe('RC closure — conversation branch provenance', () => {
  it('16. a stored source branch beats a different staff branch', async () => {
    const hint = await resolveConversationBranchHint(session(), rolesWithStaffBranch('فرع الشامي'), 'فرع شكري');
    expect(hint).toMatchObject({ value: 'فرع شكري', source: 'source' });
  });

  it('17. with no source branch, the staff branch is only a labelled fallback', async () => {
    const hint = await resolveConversationBranchHint(session(), rolesWithStaffBranch('فرع الشامي'), null);
    expect(hint.value).toBe('فرع الشامي');
    expect(hint.source).toBe('majority_fallback');
  });

  it('18. re-import reads the stored branch, so the historical branch is preserved', async () => {
    const s = session();
    const sourceHash = await hashWhatsAppSession(s);
    const stored = await readStoredSourceBranch(s, fakeSourcesClient({ source_hash: sourceHash, branch: ' فرع شكري ' }));
    expect(stored).toBe('فرع شكري');
    const hint = await resolveConversationBranchHint(s, rolesWithStaffBranch('فرع الشامي'), stored);
    expect(hint).toMatchObject({ value: 'فرع شكري', source: 'source' });
    expect(await readStoredSourceBranch(s, fakeSourcesClient(null))).toBe(null);
  });

  it('a machine re-match never overwrites a human-confirmed invoice link', async () => {
    const updates: unknown[] = [];
    await attachInvoiceVerificationToQueue(
      'src-1',
      { status: 'verified', bestCandidate: { invoiceId: 'inv-other', invoiceNumber: '9', invoiceDate: null }, revenue: 10, verificationConfidence: 90, reason: 'x' } as any,
      null,
      null,
      fakeSourcesClient({ id: 'src-1', invoice_link_confirmed: true, matched_invoice_id: 'inv-confirmed' }, updates)
    );
    expect(updates).toHaveLength(0);
  });
});
