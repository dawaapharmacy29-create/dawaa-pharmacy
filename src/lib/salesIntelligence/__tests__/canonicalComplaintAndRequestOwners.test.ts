import { describe, expect, it } from 'vitest';
import { deriveCanonicalComplaintAssessment } from '../complaintAssessmentEngine';
import { deriveCanonicalCustomerRequestAssessment } from '../customerRequestQualificationEngine';
import type {
  CanonicalSalesOutcomeAssessment,
  CustomerNeedModel,
  LostOpportunityAssessment,
  UnavailableDemand,
} from '../types';

const confidence = {
  level: 'proven', score: 0.98, evidence: [], ruleIds: ['fixture'],
} as const;

function demand(overrides: Partial<UnavailableDemand> = {}): UnavailableDemand {
  return {
    demandKey: 'case-1:demand:product:prod-1', caseId: 'case-1', conversationId: 'conv-1',
    sourceCaseIdV22: null, customerId: '33333333-3333-4333-8333-333333333333',
    customerIdentityStatus: 'resolved', branchId: null, branchNameRaw: 'فرع شكري',
    requestedAt: '2026-10-17T10:00:00Z', productKey: 'panadol', requestedProductRaw: 'Panadol',
    resolvedProductId: '55555555-5555-4555-8555-555555555555', quantityRequested: 2,
    availabilityState: 'unavailable', availabilityMessageId: 's1', statedByStaffName: 'د/ موظف',
    statedByStaffId: null, alternativeOffered: false, alternativeProductKey: null,
    alternativeProductRaw: null, alternativeProductId: null, alternativeOfferedByStaffName: null,
    alternativeOfferedByStaffId: null, alternativeResponse: null, followUpCandidate: true,
    followUpReason: 'original_unavailable_no_alternative', followUpSuppressedBy: null,
    evidenceMessageIds: ['c1','s1'], confidence: confidence as any, blockers: [], ...overrides,
  };
}

function need(overrides: Partial<CustomerNeedModel> = {}): CustomerNeedModel {
  return {
    caseId:'case-1', primaryNeed:'عايز بانادول', primaryNeedMessageId:'c1',
    products:[{
      key:'panadol', productNameRaw:'Panadol', productId:'55555555-5555-4555-8555-555555555555',
      productCode:'P1', canonicalName:'Panadol', requestedQuantity:2, offeredQuantity:null, finalQuantity:null,
      roles:['requested'], availability:'unavailable', availabilityEvidence:[], alternatives:[],
      evidenceMessageIds:['c1','s1'], confidence: confidence as any,
    }],
    unlinkedAvailability:[], unlinkedAlternatives:[], objections:[], unresolvedNeed:true,
    needDeclined:false, needDeclineMessageIds:[], evidenceMessageIds:['c1','s1'],
    confidence: confidence as any, needsHumanReview:false, humanReviewReasons:[], ...overrides,
  };
}

const openSale = {
  caseId:'case-1', outcome:'open_opportunity', saleProofState:'unknown', isSaleCountable:false,
  isRevenueCountable:false, isOrderConfirmed:false, needsHumanReview:false, reasonCodes:[],
} as CanonicalSalesOutcomeAssessment;

const openLost = {
  caseId:'case-1', state:'recoverable', waitingOn:'stock', reason:'stock_unavailable', stage:'availability',
  responsibility:'inventory', recoverability:'high', productKeys:['panadol'], productLosses:[{
    productKey:'panadol', requestedProductRaw:'Panadol', productId:'55555555-5555-4555-8555-555555555555',
    outcome:'recoverable', reason:'stock_unavailable', demandKey:'case-1:demand:product:prod-1',
    evidenceMessageIds:['c1','s1'],
  }], staffFacts:[], evidenceMessageIds:['c1','s1'], confidence: confidence as any,
  explanation:'fixture',
} as LostOpportunityAssessment;

describe('canonical complaint owner', () => {
  it('does not treat dispatch/in-transit language as complaint resolution', () => {
    const result = deriveCanonicalComplaintAssessment({ caseId:'case-1', messages:[
      {id:'c1',role:'customer',text:'انا زعلان من مشكلة التوصيل',meaningful:true},
      {id:'s1',role:'staff',text:'حقك علينا، هتابع بنفسي',meaningful:true},
      {id:'s2',role:'staff',text:'المندوب في الطريق وجاري الإرسال',meaningful:true},
    ]});
    expect(result.state).toBe('recovery_attempted');
    expect(result.resolutionMessageIds).toEqual([]);
  });

  it('marks resolved only on explicit closure evidence', () => {
    const result = deriveCanonicalComplaintAssessment({ caseId:'case-1', messages:[
      {id:'c1',role:'customer',text:'انا متضايق من المشكلة دي',meaningful:true},
      {id:'s1',role:'staff',text:'بنعتذر وهراجع الموضوع',meaningful:true},
      {id:'s2',role:'staff',text:'تم حل المشكلة يا فندم',meaningful:true},
    ]});
    expect(result.state).toBe('resolved');
    expect(result.resolutionMessageIds).toEqual(['s2']);
  });

  it('keeps no-response complaint explicitly unresolved', () => {
    const result = deriveCanonicalComplaintAssessment({ caseId:'case-1', messages:[
      {id:'c1',role:'customer',text:'بشتكي من الخدمة السيئة',meaningful:true},
    ]});
    expect(result.state).toBe('unresolved');
    expect(result.staffResponseMessageIds).toEqual([]);
  });
});

describe('canonical customer request qualification owner', () => {
  it('qualifies a resolved-customer confirmed shortage with canonical product identity', () => {
    const result = deriveCanonicalCustomerRequestAssessment({
      caseId:'case-1', customerNeed:need(), unavailableDemand:[demand()], salesOutcome:openSale, lostOpportunity:openLost,
    });
    expect(result.decision).toBe('qualified');
    expect(result.requests[0]).toMatchObject({
      status:'qualified', requestKey:'cr1|case-1:demand:product:prod-1', productId:'55555555-5555-4555-8555-555555555555',
      suppressedBy:null, blockers:[],
    });
  });

  it('does not turn a pending availability check into a procurement request', () => {
    const result = deriveCanonicalCustomerRequestAssessment({
      caseId:'case-1', customerNeed:need(), unavailableDemand:[demand({availabilityState:'check_pending'})], salesOutcome:openSale, lostOpportunity:openLost,
    });
    expect(result.decision).toBe('not_needed');
    expect(result.requests[0]).toMatchObject({status:'suppressed',suppressedBy:'availability_check_pending'});
  });

  it('suppresses an accepted alternative but keeps original demand as analytics', () => {
    const result = deriveCanonicalCustomerRequestAssessment({
      caseId:'case-1', customerNeed:need(), unavailableDemand:[demand({alternativeResponse:'accepted'})], salesOutcome:openSale, lostOpportunity:openLost,
    });
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]).toMatchObject({status:'suppressed',suppressedBy:'alternative_accepted'});
  });

  it('fails closed to review when customer or product identity is unresolved', () => {
    const result = deriveCanonicalCustomerRequestAssessment({
      caseId:'case-1', customerNeed:need(), unavailableDemand:[demand({
        customerId:null, customerIdentityStatus:'unresolved', resolvedProductId:null,
      })], salesOutcome:openSale, lostOpportunity:openLost,
    });
    expect(result.decision).toBe('review_required');
    expect(result.requests[0].blockers).toEqual(expect.arrayContaining(['customer_identity_unresolved','product_identity_unresolved']));
  });
});
