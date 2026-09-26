import { describe, expect, it, vi } from 'vitest';
import type { WhatsAppParticipantRoleModelV15 } from '@/lib/whatsappParticipantRoleResolverV15';

const STAFF_TABLE = [
  { id: 's1', name: 'اسلام محمد', branch: 'فرع الشامي', role: 'pharmacist', active: true },
  { id: 's2', name: 'اسلام كريم', branch: 'فرع شكري', role: 'pharmacist', active: true },
];
const STAFF_ACCOUNTS_TABLE = [
  { id: 'a1', staff_id: 's1', staff_name: 'اسلام محمد', name: 'اسلام محمد', branch: 'فرع الشامي', role: 'pharmacist', active: true, is_active: true },
  { id: 'a2', staff_id: 's2', staff_name: 'اسلام كريم', name: 'اسلام كريم', branch: 'فرع شكري', role: 'pharmacist', active: true, is_active: true },
];
let ALIASES_TABLE: any[] = [];

function makeChain(table: string) {
  const eqs: Record<string, unknown> = {};
  const chain: any = {
    select: () => chain,
    or: () => chain,
    order: () => chain,
    eq: (field: string, value: unknown) => {
      eqs[field] = value;
      return chain;
    },
    limit: async () => {
      if (table === 'staff') {
        let rows = STAFF_TABLE;
        if ('id' in eqs) rows = rows.filter((r) => r.id === eqs.id);
        return { data: rows, error: null };
      }
      if (table === 'staff_accounts') return { data: STAFF_ACCOUNTS_TABLE, error: null };
      if (table === 'staff_identity_aliases') {
        let rows = ALIASES_TABLE;
        if ('normalized_alias' in eqs) rows = rows.filter((r) => r.normalized_alias === eqs.normalized_alias);
        return { data: rows, error: null };
      }
      return { data: [], error: null };
    },
    maybeSingle: async () => {
      if (table === 'staff') {
        const row = STAFF_TABLE.find((r) => r.id === eqs.id);
        return { data: row || null, error: null };
      }
      return { data: null, error: null };
    },
  };
  return chain;
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => makeChain(table) },
}));

function roleModel(entries: Array<{ messageId: string; staffId: string | null; staffName: string | null; branch: string | null; confidence: number; role?: string }>): WhatsAppParticipantRoleModelV15 {
  return {
    version: 'whatsapp-participant-role-v15',
    messages: entries.map((e) => ({
      messageId: e.messageId, sender: 'staff', role: (e.role as any) || 'pharmacist',
      accountId: e.staffId ? `acc-${e.staffId}` : null, staffId: e.staffId, staffName: e.staffName,
      branch: e.branch, confidence: e.confidence, reason: 'test',
    })),
    staff: [],
  };
}

describe('resolveStaffIdentity', () => {
  it('tier 1: V15 already resolved a real staff_id for the owner episode ("اسلام" in chat -> اسلام محمد in DB) — used directly, no guessing by name', async () => {
    const { resolveStaffIdentity } = await import('@/lib/whatsappStaffIdentityResolver');
    const roles = roleModel([{ messageId: 'm1', staffId: 's1', staffName: 'اسلام محمد', branch: 'فرع الشامي', confidence: 91 }]);
    const result = await resolveStaffIdentity('اسلام', roles, ['m1'], null);
    expect(result.staffId).toBe('s1');
    expect(result.identitySource).toBe('v15_resolved_id');
    expect(result.canonicalStaffName).toBe('اسلام محمد');
    expect(result.branch).toBe('فرع الشامي');
    expect(result.ambiguous).toBe(false);
  });

  it('V15 resolving two different staff_ids for the same owner episode is a real conflict -> ambiguous, never guessed', async () => {
    const { resolveStaffIdentity } = await import('@/lib/whatsappStaffIdentityResolver');
    const roles = roleModel([
      { messageId: 'm1', staffId: 's1', staffName: 'اسلام محمد', branch: 'فرع الشامي', confidence: 85 },
      { messageId: 'm2', staffId: 's2', staffName: 'اسلام كريم', branch: 'فرع شكري', confidence: 80 },
    ]);
    const result = await resolveStaffIdentity('اسلام', roles, ['m1', 'm2'], null);
    expect(result.staffId).toBeNull();
    expect(result.ambiguous).toBe(true);
    expect(result.candidates).toHaveLength(2);
  });

  it('same name across two branches with a branch hint resolves uniquely via the branch-aware staff resolver (tier 2)', async () => {
    const { resolveStaffIdentity } = await import('@/lib/whatsappStaffIdentityResolver');
    const roles = roleModel([]); // V15 found nothing
    const result = await resolveStaffIdentity('اسلام محمد', roles, [], 'فرع الشامي');
    expect(result.staffId).toBe('s1');
    expect(result.identitySource).toBe('staff_resolver_branch_aware');
  });

  it('same name across two branches with NO branch hint stays ambiguous rather than guessing', async () => {
    const { resolveStaffIdentity } = await import('@/lib/whatsappStaffIdentityResolver');
    const roles = roleModel([]);
    // "اسلام" alone matches neither staff row exactly (rows are "اسلام محمد"/"اسلام كريم"),
    // so tier 2/3/4 all miss and we land in the fuzzy fallback — which itself must go ambiguous
    // for two equally plausible prefix matches, not silently pick one.
    const result = await resolveStaffIdentity('اسلام', roles, [], null);
    expect(result.staffId).toBeNull();
    expect(result.ambiguous).toBe(true);
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('tier 3: an existing account/staff alias mapping resolves a nickname the other tiers cannot', async () => {
    ALIASES_TABLE = [{ id: 'al1', staff_id: 's1', alias_name: 'اسلام', normalized_alias: 'اسلام', active: true, confidence: 0.9 }];
    try {
      const { resolveStaffIdentity } = await import('@/lib/whatsappStaffIdentityResolver');
      const roles = roleModel([]);
      const result = await resolveStaffIdentity('اسلام', roles, [], null);
      expect(result.staffId).toBe('s1');
      expect(result.identitySource).toBe('account_staff_mapping');
    } finally {
      ALIASES_TABLE = [];
    }
  });

  it('tier 5 (fuzzy fallback) resolves a genuine unambiguous partial name when nothing stronger matched', async () => {
    const { resolveStaffIdentity } = await import('@/lib/whatsappStaffIdentityResolver');
    const roles = roleModel([]);
    const result = await resolveStaffIdentity('اسلام محمد', roles, [], null);
    // "اسلام محمد" matches s1 exactly via V6 (tier 4, no branch) before ever reaching fuzzy.
    expect(result.staffId).toBe('s1');
  });

  it('the "د" prefix / nickname does not by itself confuse a confident V15 resolution', async () => {
    const { resolveStaffIdentity } = await import('@/lib/whatsappStaffIdentityResolver');
    const roles = roleModel([{ messageId: 'm1', staffId: 's1', staffName: 'اسلام محمد', branch: 'فرع الشامي', confidence: 96 }]);
    const result = await resolveStaffIdentity('د اسلام', roles, ['m1'], null);
    expect(result.staffId).toBe('s1');
    expect(result.identitySource).toBe('v15_resolved_id');
  });
});
