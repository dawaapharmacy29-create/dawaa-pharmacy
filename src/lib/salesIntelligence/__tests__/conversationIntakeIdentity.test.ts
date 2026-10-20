import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/whatsappSmartReviewOwnership', () => ({ buildSmartOwnershipTimeline: () => ({ episodes: [], verifiedStaff: [] }) }));
vi.mock('@/lib/whatsappStaffResolverV6', () => ({ resolveWhatsAppStaffV6: vi.fn(async () => ({ staff: { branch: 'كل الفروع' } })) }));
import { extractIntroducedStaffName, parseWhatsAppExport, type WhatsAppConversationSession } from '../../whatsappConversationParser';
import { resolveConversationBranchHint } from '../../whatsappConversationBranchHint';
import type { WhatsAppParticipantRoleModelV15 } from '../../whatsappParticipantRoleResolverV15';
const roles = { staff: [{ branch: 'كل الفروع' }] } as unknown as WhatsAppParticipantRoleModelV15;
function session(text: string) {
  return { messages: parseWhatsAppExport(text), outboundStaffNames: ['موظف تجريبي'] } as WhatsAppConversationSession;
}
const intro = '[10/20/26, 5:00:30 AM] You: وعليكم السلام، مع حضرتك د سامر من فرع شكري. الصنف غير متوفر.';
describe('conversation intake identity provenance', () => {
  it('extracts only the staff name before an explicit branch', () => {
    expect(extractIntroducedStaffName(session(intro).messages[0])).toBe('سامر');
  });
  it('uses the explicit transaction branch instead of account-wide staff scope', async () => {
    expect(await resolveConversationBranchHint(session(intro), roles)).toMatchObject({ value: 'فرع شكري', source: 'explicit_introduction' });
  });
  it('never overwrites a stored branch on reimport or retry', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await resolveConversationBranchHint(session(intro), roles, 'فرع الشامي')).toMatchObject({ value: 'فرع الشامي', source: 'source' });
    }
  });
  it('preserves a stored legacy scope for explicit human correction', async () => {
    expect((await resolveConversationBranchHint(session(intro), roles, 'كل الفروع')).value).toBe('كل الفروع');
  });
  it('fails closed on conflicting explicit staff branches', async () => {
    const conflicting = intro + '\n[10/20/26, 5:01:30 AM] You: مع حضرتك د نادر من فرع الشامي.';
    expect((await resolveConversationBranchHint(session(conflicting), roles)).value).toBeNull();
  });
  it('does not promote all-branches scope into a transaction branch', async () => {
    expect((await resolveConversationBranchHint(session('[10/20/26, 5:00:30 AM] You: أهلًا بحضرتك'), roles)).value).toBeNull();
  });
  it('ignores branch mentions in customer messages', async () => {
    const s = session('[10/20/26, 5:00:30 AM] Customer: مع حضرتك د سامر من فرع شكري.');
    s.messages[0].direction = 'inbound';
    expect(extractIntroducedStaffName(s.messages[0])).toBeNull();
    expect((await resolveConversationBranchHint(s, roles)).value).toBeNull();
  });
});
