import { describe, expect, it } from 'vitest';
import {
  buildSalesIntelligenceRuntimeContext,
  managerConfirmedIntroStaffId,
  pipelineBaseInputFor,
  prepareSalesIntelligenceConversations,
} from '@/lib/salesIntelligence/runtimeContext';
import { reviewSourceRowToBatchConversation } from '@/lib/salesIntelligence/persistence/reviewSourceBatchAdapter';
import { buildPharmacyProductIndex } from '@/lib/salesIntelligence/pharmacyProducts/pharmacyProductResolverV2';
import type { StaffDirectoryIdentity } from '@/lib/readModels/staffDirectoryReadModel';

const staff = (id: string, name: string, extra: Partial<StaffDirectoryIdentity> = {}): StaffDirectoryIdentity => ({
  id, name, branch: 'فرع الشامي', role: 'صيدلاني', username: null, status: 'active', active: true, source: 'staff', ...extra,
});

// Synthetic directory: an inactive doctor, an archived first-name namesake that owns the bare
// alias, and an active doctor whose full name starts with the same first name.
const DIRECTORY: StaffDirectoryIdentity[] = [
  staff('dr-inactive', 'د/ أحمد عاطف', { active: false, status: 'غير نشط' }),
  staff('dr-archived', 'د/ يوسف', { active: false, status: 'archived' }),
  { ...staff('dr-archived', 'يوسف', { active: false, status: 'archived' }), source: 'alias', normalizedAlias: 'يوسف' },
  staff('dr-night', 'يوسف عصام'),
  staff('dr-dunia', 'د/ دنيا'),
];
const context = buildSalesIntelligenceRuntimeContext({ staffDirectory: DIRECTORY, productIndex: buildPharmacyProductIndex([]) });

function client() {
  const builder = (): any => {
    const target: any = {
      then: (resolve: any, reject: any) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
      maybeSingle: async () => ({ data: null, error: null }),
    };
    const proxy: any = new Proxy(target, { get: (t, key) => (key in t ? t[key] : () => proxy) });
    return proxy;
  };
  return { from: () => builder(), rpc: async () => ({ data: [], error: null }) };
}

const chat = (doctor: string) => [
  '[11/20/26, 12:03:00 AM] Customer: مساء الخير محتاج دوا برد',
  `[11/20/26, 12:04:00 AM] You: مع حضرتك د ${doctor} اقدر اساعد حضرتك ازاي 💊🥼؟`,
  '[11/20/26, 12:05:00 AM] Customer: تمام',
].join('\n');

async function introOwners(raw: string, row: { staff_id: string | null; staff_link_confirmed?: boolean }) {
  const conversation = reviewSourceRowToBatchConversation({
    id: 'source-1', raw_text: raw, conversation_started_at: '2026-11-19T22:03:00.000Z', customer_name: 'عميل تجريبي', ...row,
  });
  const [prepared] = await prepareSalesIntelligenceConversations(client(), [conversation], context);
  return Object.values(prepared.staffIdByIntroductionMessageId);
}

describe('manager-confirmed doctor link credits the greeting name', () => {
  it('credits an inactive doctor when the manager confirmed the link', async () => {
    expect(await introOwners(chat('احمد عاطف'), { staff_id: 'dr-inactive', staff_link_confirmed: true })).toEqual(['dr-inactive']);
  });

  it('credits a first-name greeting to the confirmed doctor, not the archived namesake', async () => {
    expect(await introOwners(chat('يوسف'), { staff_id: 'dr-night', staff_link_confirmed: true })).toEqual(['dr-night']);
  });

  it('never promotes a greeting from an unconfirmed staff_id (invoice seller or legacy fill)', async () => {
    expect(await introOwners(chat('احمد عاطف'), { staff_id: 'dr-inactive' })).toEqual([]);
    expect(await introOwners(chat('يوسف'), { staff_id: 'dr-night', staff_link_confirmed: false })).toEqual([]);
  });

  it('never credits a confirmed doctor whose name does not contain the greeting name', async () => {
    expect(await introOwners(chat('علا'), { staff_id: 'dr-night', staff_link_confirmed: true })).toEqual([]);
  });

  it('keeps the normal resolution for an active doctor with an exact directory name', async () => {
    expect(managerConfirmedIntroStaffId('دنيا', 'dr-dunia', context.staffNamesById)).toBe('dr-dunia');
    expect(managerConfirmedIntroStaffId('نيا', 'dr-dunia', context.staffNamesById)).toBeNull();
    expect(managerConfirmedIntroStaffId('يوسف', null, context.staffNamesById)).toBeNull();
  });

  it('lends the inactive doctor a profile only inside the confirmed conversation', async () => {
    expect(context.staffProfilesById?.['dr-inactive']).toBeUndefined();
    const confirmed = reviewSourceRowToBatchConversation({
      id: 'source-2', raw_text: chat('احمد عاطف'), conversation_started_at: '2026-11-19T22:03:00.000Z',
      customer_name: 'عميل تجريبي', staff_id: 'dr-inactive', staff_link_confirmed: true,
    });
    const unconfirmed = { ...confirmed, conversationId: 'source-3', managerConfirmedStaffId: null };
    const [a, b] = await prepareSalesIntelligenceConversations(client(), [confirmed, unconfirmed], context);
    expect(pipelineBaseInputFor(a, context).staffProfilesById?.['dr-inactive']?.name).toBe('د/ أحمد عاطف');
    expect(pipelineBaseInputFor(b, context).staffProfilesById?.['dr-inactive']).toBeUndefined();
  });
});
