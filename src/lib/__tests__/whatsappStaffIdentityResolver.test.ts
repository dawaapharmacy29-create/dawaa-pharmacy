import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffDirectoryIdentity } from '@/lib/readModels/staffDirectoryReadModel';
import type { WhatsAppParticipantRoleModelV15 } from '@/lib/whatsappParticipantRoleResolverV15';
const state = vi.hoisted(() => ({ rows: [] as StaffDirectoryIdentity[], error: false }));
vi.mock('@/lib/readModels/staffDirectoryReadModel', () => ({ readStaffDirectory: vi.fn(async () => {
  if(state.error) throw new Error('directory outage'); return state.rows;
}) }));
vi.mock('@/lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }));
import { resolveStaffIdentity } from '@/lib/whatsappStaffIdentityResolver';
import { resolveWhatsAppStaffV6 } from '@/lib/whatsappStaffResolverV6';
import { resolveStaffDirectoryName } from '@/lib/staff/staffIdentityResolver';
const person = (id: string, name: string, role = 'pharmacist', branch = 'شكري'): StaffDirectoryIdentity => ({
  id, name, role, branch, username: null, status: 'active', active: true, source: 'staff',
});
const alias = (id: string, name: string, normalizedAlias: string): StaffDirectoryIdentity => ({ ...person(id,name), source:'alias', normalizedAlias });
const roles = (id?:string): WhatsAppParticipantRoleModelV15 => ({ version:'whatsapp-participant-role-v15', staff:[], messages:id ? [{
  messageId:'m',sender:'staff',role:'pharmacist',accountId:'account',staffId:id,staffName:'د اسلام فاروق',branch:'شكري',confidence:99,reason:'old inference',
}] : [] });
beforeEach(() => { state.error=false; state.rows=[person('doctor','د اسلام فاروق'),person('courier','اسلام السبع','delivery')]; });
describe('one fail-closed employee decision across WhatsApp and seller attribution', () => {
  for(const name of ['اسلام','د اسلام','د/ اسلام','دكتور اسلام','د. إسلام']) {
    it('preserves conflict for '+name+' even with pharmacist episode evidence and branch hint',async()=>{
      state.rows.push(alias('doctor','د اسلام','اسلام'),alias('doctor','د/ اسلام','اسلام'),alias('courier','اسلام','اسلام'));
      expect((await resolveStaffIdentity(name,roles('doctor'),['m'],'شكري')).staffId).toBeNull();
      expect((await resolveWhatsAppStaffV6([name],'شكري')).strategy).toBe('ambiguous');
    });
  }
  it('retains the full doctor name without moving invoice branch',async()=>{
    const result=await resolveStaffIdentity('د إسلام فاروق',roles('doctor'),['m'],'الشامي');
    expect(result.staffId).toBe('doctor'); expect(result.branch).toBe('شكري');
    expect(result.identitySource).toBe('v15_resolved_id');
  });
  it('retains courier identity separately',async()=>{
    expect((await resolveStaffIdentity('اسلام السبع',roles(),[],null)).staffId).toBe('courier');
  });
  it('never resolves a unique partial first name',async()=>{
    state.rows=[person('doctor','د اسلام فاروق')];
    expect((await resolveStaffIdentity('اسلام',roles(),[],null)).status).toBe('unresolved');
  });
  it('a branch hint cannot select one of two identical names',async()=>{
    state.rows=[person('one','احمد محمد','pharmacist','شكري'),person('two','احمد محمد','pharmacist','الشامي')];
    expect((await resolveStaffIdentity('احمد محمد',roles(),[],'شكري')).ambiguous).toBe(true);
  });
  it('retired identity and orphan account cannot become a different active person',async()=>{
    state.rows=[{...person('old','د احمد'),active:false},alias('old','احمد','احمد')];
    expect((await resolveWhatsAppStaffV6(['احمد'])).strategy).toBe('retired');
    state.rows=[{...person('account','لقب'),source:'staff_account'}];
    expect(resolveStaffDirectoryName('لقب',state.rows).staff).toBeNull();
  });
  it('alias outage is unavailable and a later healthy read retries immediately',async()=>{
    state.error=true;
    expect((await resolveWhatsAppStaffV6(['د اسلام فاروق'])).strategy).toBe('unavailable');
    expect((await resolveStaffIdentity('د اسلام فاروق',roles(),[],null)).status).toBe('unavailable');
    state.error=false;
    expect((await resolveWhatsAppStaffV6(['د اسلام فاروق'])).staff?.id).toBe('doctor');
  });
  it('no completed identity cache survives archival',async()=>{
    expect((await resolveWhatsAppStaffV6(['د اسلام فاروق'])).staff?.id).toBe('doctor');
    state.rows[0].active=false;
    expect((await resolveWhatsAppStaffV6(['د اسلام فاروق'])).staff).toBeNull();
  });
  it('a mismatched episode id remains conflict rather than overriding the canonical name',async()=>{
    expect((await resolveStaffIdentity('د اسلام فاروق',roles('courier'),['m'],null)).status).toBe('conflict');
  });
  it('duplicate aliases for the same employee are one identity, not two people',()=>{
    state.rows.push(alias('doctor','اسلام فاروق','اسلامفاروق'),alias('doctor','د. اسلام فاروق','اسلامفاروق'));
    expect(resolveStaffDirectoryName('اسلام فاروق',state.rows).staff?.id).toBe('doctor');
  });
});
