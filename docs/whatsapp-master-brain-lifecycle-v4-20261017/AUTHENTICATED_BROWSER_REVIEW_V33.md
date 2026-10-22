# V33 — authenticated browser acceptance review (partial)
Date: 2026-10-19. Preview runtime 6431f417c5148043d4f7fcf217a7b57a19a898a9; deployment dpl_6uU5xFCRrgHYC7ZqLG1ajVc77KbL.
Actual staff session, role general_manager; no credentials inspected. Read-only business review.

## Cases opened
1. b2ee2661-3788-489e-860f-a803c29d3fbd:interaction:0
   Original conversation requests forwarded Isis teenderm gel, staff confirms availability and dispatch; customer asks about courier, staff promises follow-up. Detail truth: invoice 73006, 675 EGP, sale/revenue countable. Invoice item ISIS TEEN DERM GEL SENSITIVE 250ML, code 70271, quantity 1. Delivery remains unresolved with required high priority follow-up. A sale does not prove delivery.
2. bdf68bbd-664e-4d6a-a9e9-3cd3e6cb5fe4:interaction:0:session:0
   Hero Baby 2 request, invoice 74857, 290 EGP. Sale/revenue countable; no human review required for this segment.
3. bdf68bbd-664e-4d6a-a9e9-3cd3e6cb5fe4:interaction:1:session:0
   Customer complains about courier conduct; staff apologizes/escalates and offers callback. Not counted as another sale/revenue. Human review required, recoverable delivery issue; follow-up customer-requested later contact, date manually specified, owner customer service. Explicit formal complaint materialization/resolution has not been tested.
4. bdf68bbd-664e-4d6a-a9e9-3cd3e6cb5fe4:interaction:0:session:1
   Late closing greeting only. Information segment, no sale/revenue/follow-up. UI says V22 proof belongs to another segment, avoiding duplicate attribution.

## Findings still open
- Definite explanatory copy defect: first case need tab claims product name absent due to image/voice despite visible forwarded text naming product. Source located at CaseIntelligenceWorkspace.tsx trusted-invoice fallback: unresolvedNeed is used as a blanket basis for this media assertion. This is not evidence that invoice/sale truth is wrong.
- Raw follow-up owner displayed as "You (فريق التوصيل)" on first case. Needs explicit raw-sender versus resolved-staff labeling/review; no proof of a wrong persisted staff ID from this browser observation.
- Lists label both invoiced cases "مدعوم بقوة (إحصائي)" while details say invoice-proven. This may expose attribution confidence versus sale-proof state under one ambiguous column; trace field contract before changing decision logic.
- Existing Customer Requests shows medicine "." and a complete confirmation message as medicine_name. Read-only provenance check: source_system=dawaawael, source_entity=CustomerOrder, channel WhatsApp; no matching whatsapp_conversation_actions target for the sampled rows. Do not attribute these rows to new canonical projectors.
  Sample request IDs: 78a23a9c-887e-40dc-9727-609e1eb300fc and 4f05bfd5-00da-4259-99fd-95a7dbc18a61.
- Requests and customer service load successfully. Service queue includes old overdue records/unassigned owners. No historical cleanup performed and queue contents are not proof of new writer behavior.

## Isolated semantic checks
Existing syntheticCanonicalDecisionMatrix.test.ts: 33 passed / 0 failed.
Existing invoiceBackedSaleProof.test.ts: 20 passed / 0 failed.
Executed with existing matrix.vitest.config.mjs and invoice-proof.vitest.config.mjs. Initial attempt referenced absent vitest.config.ts and failed before test collection; corrected to existing configs. No source changes or test suppression.
These checks supplement browser observations; they are not live creation/materialization tests.

## Boundaries / next work
No business writes, refreshes, uploads, action approvals, historical repair, main merge or deployments in this review.
No new customer conversations stored in Production. No Mohamed Elgendy sources opened as smoke cases.
Coverage remains partial: full authorized request creation, complaint resolution, follow-up materialization/retry and live end-to-end performance still need controlled acceptance. Do not mark the whole structure CLOSED or merge-ready based on this report.
Next smallest source work: correct explanatory fallback copy, clarify owner/list field meaning with focused assertions, then validate remaining semantic scenarios in isolation before any explicitly approved live operational write.
