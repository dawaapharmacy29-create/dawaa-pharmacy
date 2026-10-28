import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { StaffDirectoryIdentity } from '@/lib/readModels/staffDirectoryReadModel';
import type { WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
const state = vi.hoisted(() => ({ rows: [] as StaffDirectoryIdentity[], error: false }));
vi.mock('@/lib/readModels/staffDirectoryReadModel', () => ({ readStaffDirectory: async () => {
  if (state.error) throw new Error('incomplete identity directory'); return state.rows;
} }));
vi.mock('@/lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }));
import { normalizeArabicName } from '@/lib/security/userDataScope';
import { resolveWhatsAppParticipantRolesV15 } from '@/lib/whatsappParticipantRoleResolverV15';
import { findStaffIdentityForSalesRow, groupStaffSalesPerformance } from '@/lib/staffIdentityService';
import { resolveStaffDirectoryName } from '@/lib/staff/staffIdentityResolver';
import { normalizeAcceptedAttendanceLogs } from '@/lib/attendance/attendanceReadNormalization';
const person = (id: string, name: string, role = 'pharmacist'): StaffDirectoryIdentity => ({
  id, name, role, branch: 'شكري', active: true, username: null, status: 'active', source: 'staff',
});
const session = (...texts: string[]): WhatsAppConversationSession => ({
  id: 'synthetic', startedAt: new Date('2026-10-25T06:00:00Z'), endedAt: new Date('2026-10-25T07:00:00Z'),
  participants: ['You'], outboundStaffNames: [], customerName: null, mediaCount: 0,
  messages: texts.map((text, i) => ({ id: `m${i}`, timestamp: new Date('2026-10-25T06:00:00Z'), rawTimestamp: '',
    sender: 'You', text, direction: 'outbound', kind: 'text', forwarded: false, raw: text })),
});
beforeEach(() => {
  state.error = false;
  state.rows = [person('doctor', 'د اسلام فاروق'), ...['نور', 'هاجر', 'هبه'].flatMap((name, i) => [
    person(`cs-${i}`, name, 'assistant'),
    { ...person(`cs-${i}`, name, 'team_dawaa_alpha'), source: 'staff_account' as const, accountId: `login-${i}` },
  ])];
});
describe('unified employee core confirmed regression boundaries', () => {
  for (const name of ['د اسلام فاروق', 'د/ إسلام فاروق', 'د. اسلام فاروق', 'دكتور اسلام فاروق', '  د / اسلام فاروق ']) {
    it('one full Arabic identity across prefix/hamza/spacing: ' + name, () => {
      expect(resolveStaffDirectoryName(name, state.rows).staff?.id).toBe('doctor');
    });
  }
  it('does not strip the first letter of دنيا or merge her with نيا', () => {
    expect(normalizeArabicName('دنيا')).toBe('دنيا');
    expect(normalizeArabicName('د/ دنيا')).toBe('دنيا');
    expect(normalizeArabicName('د دنيا')).not.toBe(normalizeArabicName('نيا'));
  });
  for (const name of ['نور', 'هاجر', 'هبه']) {
    it('keeps ' + name + ' in customer service without changing the doctor identity', async () => {
      const roles = await resolveWhatsAppParticipantRolesV15(session('مع حضرتك دكتور اسلام فاروق', `مع حضرتك ${name} من خدمة العملاء صيدليات دواء`));
      expect(roles.messages[0]).toMatchObject({ role: 'pharmacist', staffId: 'doctor' });
      expect(roles.messages[1].role).toBe('customer_service');
      expect(roles.messages[1].staffId).not.toBe('doctor');
      expect(roles.messages[1].staffId).toMatch(/^cs-/);
    });
  }
  it('does not inherit the prior doctor when an explicit introduction is unresolved', async () => {
    const roles = await resolveWhatsAppParticipantRolesV15(session('مع حضرتك دكتور اسلام فاروق', 'مع حضرتك اسلام', 'الطلب جاهز'));
    expect(roles.messages[0].staffId).toBe('doctor');
    expect(roles.messages[1].staffId).toBeNull();
    expect(roles.messages[2].staffId).toBeNull();
  });
  it('directory failure blocks inference instead of caching empty accounts', async () => {
    state.error = true;
    await expect(resolveWhatsAppParticipantRolesV15(session('مع حضرتك نور'))).rejects.toThrow('incomplete');
  });
  it('sales cannot pick a pharmacist by hiding the competing delivery identity', () => {
    const rows = [person('doctor', 'اسلام'), person('courier', 'اسلام', 'delivery')];
    const sale = { saleDate: '2026-10-25', sellerName: 'اسلام', branch: 'شكري', netTotal: 10, invoicesCount: 1, uniqueCustomers: 1, avgInvoice: 10 };
    expect(findStaffIdentityForSalesRow(sale, rows)).toBeNull();
    const result = groupStaffSalesPerformance([sale], rows);
    expect(result[0].staffId).toBeNull();
    expect(result[0].netTotal).toBe(10);
  });
  it('two pharmacists with one name cannot be picked by row order or branch', () => {
    const rows = [person('one', 'د احمد'), { ...person('two', 'د احمد'), branch: 'الشامي' }];
    expect(findStaffIdentityForSalesRow({ saleDate: '2026-10-25', sellerName: 'د احمد', branch: 'شكري', netTotal: 10, invoicesCount: 1, uniqueCustomers: 1, avgInvoice: 10 }, rows)).toBeNull();
  });
  it('pending/rejected attendance cannot become accepted evaluation evidence', () => {
    expect(normalizeAcceptedAttendanceLogs([
      { staff_id: 'doctor', shift_date: '2026-10-25', status: 'pending', attendance_type: 'check_in' },
      { staff_id: 'doctor', shift_date: '2026-10-25', status: 'rejected', attendance_type: 'check_in' },
    ])).toEqual([]);
  });
  it('one manually assigned purchase invoice no longer creates a global alias behind the scenes', () => {
    const page = readFileSync('src/pages/PurchaseInvoiceAccuracy.tsx', 'utf8');
    expect(page).not.toContain('resolveAndSaveAlias');
    expect(page).toContain('await assignPurchaseInvoiceStaff(row.id, staff.id)');
  });
});
