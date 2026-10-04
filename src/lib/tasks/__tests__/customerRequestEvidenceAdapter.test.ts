import {describe,expect,it} from 'vitest';
import {customerRequestToTaskEvidence} from '@/lib/tasks/customerRequestEvidenceAdapter';
const id='11111111-1111-4111-8111-111111111111';
const base={id:'r1',branch:'فرع الشامي',requested_at:'2026-09-20T10:00:00Z',due_date:'2026-09-21'};
describe('customer request evidence adapter',()=>{
 it('requires canonical staff attribution',()=>{expect(customerRequestToTaskEvidence({...base,status:'open'},'2026-09-22T10:00:00Z')).toBeNull();});
 it('maps overdue attributed work to missed',()=>{const e=customerRequestToTaskEvidence({...base,primary_responsible_id:id,status:'open'},'2026-09-22T10:00:00Z');expect(e?.status).toBe('missed');expect(e?.subjectStaffId).toBe(id);});
 it('keeps future work assigned',()=>{const e=customerRequestToTaskEvidence({...base,primary_responsible_id:id,due_date:'2026-09-24',status:'open'},'2026-09-22T10:00:00Z');expect(e?.status).toBe('assigned');});
 it('excludes cancelled work from failure semantics',()=>{expect(customerRequestToTaskEvidence({...base,primary_responsible_id:id,status:'cancelled'},'2026-09-22T10:00:00Z')?.status).toBe('cancelled');});
});
