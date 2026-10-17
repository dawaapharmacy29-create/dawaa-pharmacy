# Batch 3 — reader map before implementation

Parent: aabfd48fd3c97249898bc65a351f935ffda39412. Completed before application edits.

| Surface | Reader/source | Sale/revenue rule before | Attribution | Classification / action |
|---|---|---|---|---|
| Doctor Eye customer impact | doctorPerformanceIntelligenceService.customerImpactWindow → whatsapp_doctor_cycle_intelligence_v1 | invoice_match_status=verified; dedup matched_invoice_value | source.staff_id | LEGACY: replace read boundary |
| Doctor Eye conversation conversion | get_doctor_sales_reconciliation_v1 → verifiedConversion | invoice/customer/time/seller verification ÷ verified+recorded no-sale reviews | invoice seller | TRANSACTION RECONCILIATION: preserve productivity, retire as official conversation conversion; explicitly name canonical denominator |
| SI management overview | sales_intelligence_invoice_staff_truth_v1 | count rows/sum invoice_amount as official sales/revenue | invoice canonical seller | INVOICE EVIDENCE promoted to sales: separate and gate via canonical persisted outcomes |
| SI staff performance | same invoice staff view + whatsapp_product_demand_detail_v22 | same proof-only sales; leakage_code counted as missed opportunity | invoice seller; fallback name match for opportunity owner | PARALLEL: use shared persisted KPI reader, unresolved staff fails closed |
| SI opportunity center / product demand leakage | whatsapp_product_demand_monthly_v22, whatsapp_sales_leakage_monthly_v22, unresolved/detail_v22 | leakage codes include silence, no invoice, unavailable; acceptance is stage ratio | legacy attributed_staff_id/name | LEGACY stage evidence: retire official loss claims; canonical lost state only |
| /whatsapp-doctor-performance | whatsapp_doctor_performance_v1 | commercial_eligible/all sources called conversion | regex-cleaned source staff name | LEGACY hidden URL still active: retire reader |
| /whatsapp-branch-comparison | whatsapp_branch_comparison_v1 | same intent share; no customer-name invoice in 7d means loss | source branch | LEGACY hidden URL still active: retire reader |
| /whatsapp-lost-opportunities | whatsapp_lost_opportunities_v1 | intent + missing customer-name/phone invoice in 7d means loss | source staff | LEGACY hidden URL still active: retire reader |
| WhatsappAnalytics | current conversation_sales_reviews + salesInvoiceTruth | linked invoice number revenue; per-review generated_sales/sales_value/invoice_amount | review identity resolver | review quality remains; canonical reader replaces conversation revenue, transaction evidence labelled separately |
| DoctorPerformanceAnalysis (customer service) | supplied daily followups | purchase_amount sum, assigned_to/responsible_name | followup assignee name | MANUAL FOLLOWUP EVIDENCE: must not be labelled official WhatsApp revenue/credit |
| V4 journey classifier | mapSaleState → commercialEligible OR chatSuggestedSold | eligibility/politeness can create chat_sale_signal; verified legacy invoice can create invoice_verified_sale | none | HISTORICAL signal: remove eligibility→sale promotion; not canonical SI |
| V4 performance helpers | whatsappPerformanceV4 + unifiedV4 summary | suggested sold / eligible | names | no runtime callers of exported cycle helpers found; weak historical signals, never official KPI |
| selected QA detail / case workspace | current analysis canonicalSalesOutcome + V22 canonicalSaleProof via canonicalCaseTruth | separate persisted isSaleCountable/isRevenueCountable; proof doesn't promote outcome | persisted staff facts separate | CANONICAL, preserve Batch 1/2 |
| monthly review/quality and invoice productivity | review-quality projections / invoice analytics | service-quality assessments or transaction productivity, not WhatsApp official sales | existing domain | preserve financial/incentive writers and settled history; do not reinterpret review-quality flags as canonical sale |

## Official read contract

Extend the existing canonical persisted case boundary, not SQL and not another writer. One batch reader
loads current analyses, their case envelopes and linked V22 ledgers. Reuse canonicalCaseTruth's outcome
and ledger readers. Global sale count reads isSaleCountable only; revenue additionally requires
isRevenueCountable and the same case's proven ledger with a known value. Missing values remain unknown.
Staff credit requires a single canonical staff id in persisted confirmed_order evidence; invoice seller,
reviewer, request receiver, recommender and follow-up owner do not become the closer automatically.
No unresolved identity is awarded or penalized. Preserve participants/facts as evidence.

Conversion uses the existing canonicalConversionV1 eligible case types and checkable-evidence denominator;
label this as canonical sales-opportunity conversion, distinct from the retired review-invoice ratio and
product-stage acceptance. Official loss counts read persisted lostOpportunity.state=lost only. Pending,
recoverable, unknown and insufficient evidence remain separate; no staff penalty is inferred.

Production observations (read-only, 2026-10-17): legacy cycle aggregate 14 / 6101.50 EGP; current
canonical isSaleCountable flags 10, with 2305 EGP linked proven countable revenue. These are different
populations and visibility/proof coverage, not a demand to force totals to match. 189 active case flags,
136 current-view analyses, 53 missing-view cases: 39 archived/no V22 and 14 nonarchived/no published pointer.
Detailed diagnosis and remediation will be recorded separately. No writes or backfill authorized.
