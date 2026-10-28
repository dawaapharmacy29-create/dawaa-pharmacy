import type { WhatsAppParticipantRoleModelV15 } from '@/lib/whatsappParticipantRoleResolverV15';
import { readStaffDirectory } from '@/lib/readModels/staffDirectoryReadModel';
import { resolveStaffDirectoryName } from '@/lib/staff/staffIdentityResolver';

export type StaffIdentitySource = 'v15_resolved_id' | 'staff_resolver_branch_aware' | 'account_staff_mapping' | 'staff_resolver_no_branch' | 'none';
export interface StaffIdentityCandidate { staffId: string; canonicalStaffName: string; role: string | null; branch: string | null; confidence: number; }
export interface ResolvedStaffIdentity {
  staffId: string | null; accountId: string | null; canonicalStaffName: string | null;
  displayName: string; role: string | null; branch: string | null; identityConfidence: number;
  identitySource: StaffIdentitySource; ambiguous: boolean; candidates: StaffIdentityCandidate[];
  status?: 'resolved' | 'conflict' | 'retired' | 'unresolved' | 'unavailable';
}

export async function resolveStaffIdentity(displayName: string, roles: WhatsAppParticipantRoleModelV15,
  ownerMessageIds: string[], branchHint: string | null): Promise<ResolvedStaffIdentity> {
  const empty: ResolvedStaffIdentity = { staffId: null, accountId: null, canonicalStaffName: null, displayName,
    role: null, branch: null, identityConfidence: 0, identitySource: 'none', ambiguous: false, candidates: [] };
  let directory;
  try { directory = await readStaffDirectory({ requireComplete: true }); }
  catch { return { ...empty, status: 'unavailable' }; }
  const decision = resolveStaffDirectoryName(displayName, directory);
  const candidates = decision.candidates.map(row => ({ staffId: row.id!, canonicalStaffName: row.name || '', role: row.role, branch: row.branch, confidence: 0 }));
  if (decision.status !== 'resolved' || !decision.staff?.id) return { ...empty, status: decision.status, candidates, ambiguous: decision.status === 'conflict' };
  const staff = decision.staff;
  const episodeIds = new Set(roles.messages.filter(m => ownerMessageIds.includes(m.messageId) && m.staffId && !['customer', 'system'].includes(m.role)).map(m => m.staffId!));
  if ([...episodeIds].some(id => id !== staff.id)) return { ...empty, status: 'conflict', ambiguous: true, candidates };
  const account = directory.find(row => row.source === 'staff_account' && row.id === staff.id && row.active);
  return { ...empty, staffId: staff.id, accountId: account?.accountId || null, canonicalStaffName: staff.name,
    role: account?.role || staff.role, branch: staff.branch, identityConfidence: 94, status: 'resolved',
    identitySource: episodeIds.size ? 'v15_resolved_id' : decision.source !== 'name' ? 'account_staff_mapping' : branchHint ? 'staff_resolver_branch_aware' : 'staff_resolver_no_branch' };
}
