import {describe,expect,it} from 'vitest';
import {finalApprovalBlockers,netIncentive,validReopenReason} from '@/lib/incentives/incentiveGovernanceRules';
const valid={cycleClosed:true,openAppeals:0,approvedWeeks:3,coverage:80,targetRequired:true,targetAmount:1000,duplicateSettlements:false,payrollConflict:false};
describe('incentive governance',()=>{
 it('blocks final approval for open appeals, incomplete automatic data, missing target and duplicates',()=>{expect(finalApprovalBlockers({...valid,openAppeals:1,approvedWeeks:2,coverage:79,targetAmount:0,duplicateSettlements:true})).toEqual(expect.arrayContaining(['open_appeal','insufficient_weeks','insufficient_coverage','missing_target','duplicate_settlement']));});
 it('does not block a complete closed cycle',()=>expect(finalApprovalBlockers(valid)).toEqual([]));
 it('calculates payroll without double counting',()=>expect(netIncentive(1500,1000,200,100)).toBe(2600));
 it('requires a documented reopen reason',()=>{expect(validReopenReason('قصير')).toBe(false);expect(validReopenReason('سبب واضح لإعادة فتح الدورة')).toBe(true);});
});
