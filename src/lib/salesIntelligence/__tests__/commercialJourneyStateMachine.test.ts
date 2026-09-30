import { describe, expect, it } from 'vitest';
import { deriveCommercialJourneyState } from '@/lib/salesIntelligence/commercialJourneyStateMachine';
import type { CanonicalSalesOutcomeAssessment, CommercialConfirmationAssessment, CustomerNeedModel } from '@/lib/salesIntelligence/types';

const need: CustomerNeedModel = {
  caseId:'c', primaryNeed:'عايز فيتامين د', primaryNeedMessageId:'m1', products:[], objections:[],
  unresolvedNeed:true, evidenceMessageIds:['m1'],
  confidence:{level:'strongly_inferred',score:0.8,ruleIds:['need'],evidence:[]},
  needsHumanReview:false,humanReviewReasons:[]
};
const commercial: CommercialConfirmationAssessment = {
  caseId:'c',basketId:'b',basketVersion:1,summaryPresented:false,customerConfirmed:false,staffConfirmed:false,
  announcedTotalPresent:false,modificationAfterConfirmation:false,currentState:'basket_in_progress',primaryMessageIds:[],
  ruleIds:[],confidence:{level:'weakly_inferred',score:0.5,ruleIds:[],evidence:[]},needsHumanReview:false,humanReviewReasons:[]
};
const outcome: CanonicalSalesOutcomeAssessment = {
  caseId:'c',outcome:'open_opportunity',saleProofState:'unknown',isSaleCountable:false,isRevenueCountable:false,
  isOrderConfirmed:false,needsHumanReview:false,reasonCodes:[]
};

describe('Commercial Journey State Machine', () => {
  it('starts at need_identified when that is all we know', () => {
    expect(deriveCommercialJourneyState({caseId:'c',messages:[],customerNeed:need,commercialConfirmation:commercial,salesOutcome:outcome}).currentState).toBe('need_identified');
  });
  it('maps completed chat confirmation to awaiting_invoice, never sale_proven', () => {
    const r=deriveCommercialJourneyState({
      caseId:'c',messages:[],customerNeed:need,
      commercialConfirmation:{...commercial,summaryPresented:true,customerConfirmed:true,staffConfirmed:true,currentState:'commercial_confirmation_complete'},
      salesOutcome:{...outcome,outcome:'order_confirmed_unproven',isOrderConfirmed:true}
    });
    expect(r.currentState).toBe('awaiting_invoice');
    expect(r.reachedStates).not.toContain('sale_proven');
  });
  it('allows sale_proven only from canonical outcome', () => {
    const r=deriveCommercialJourneyState({
      caseId:'c',messages:[],customerNeed:need,commercialConfirmation:commercial,
      salesOutcome:{...outcome,outcome:'sale_proven',saleProofState:'proven',isSaleCountable:true,isRevenueCountable:true}
    });
    expect(r.currentState).toBe('sale_proven');
    expect(r.confidence.level).toBe('proven');
  });
  it('does not reopen a proven sale just because media left the customer need unresolved', () => {
    const r=deriveCommercialJourneyState({
      caseId:'c',messages:[],customerNeed:{...need,needsHumanReview:true,humanReviewReasons:['customer_need_without_resolved_product_context']},
      commercialConfirmation:commercial,
      salesOutcome:{...outcome,outcome:'sale_proven',saleProofState:'proven',isSaleCountable:true,isRevenueCountable:true}
    });
    expect(r.currentState).toBe('sale_proven');
    expect(r.reviewRequired).toBe(false);
  });

  it('keeps review as a side flag instead of replacing business state', () => {
    const r=deriveCommercialJourneyState({caseId:'c',messages:[],customerNeed:{...need,needsHumanReview:true},commercialConfirmation:commercial,salesOutcome:outcome});
    expect(r.currentState).toBe('need_identified');
    expect(r.reviewRequired).toBe(true);
  });
});
