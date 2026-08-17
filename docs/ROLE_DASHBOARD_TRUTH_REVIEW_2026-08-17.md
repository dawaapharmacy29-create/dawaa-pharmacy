# Role dashboard truth review — 2026-08-17

Verified production truth paths for doctor, customer-service manager, and branch-manager dashboards.

## Sales truth
- Shamy current cycle through 2026-08-17: 2,937 invoices / 824,016.40 EGP.
- Shokry current cycle through 2026-08-17: 3,273 invoices / 1,180,157.25 EGP.
- Doctor branch-cycle RPC now clamps requested end date to current_date and uses canonical amount precedence.

## Customer service
- Active customer-service managers: Dr Doha (Shamy), Dr Donia (Shokry). Disabled duplicate accounts cannot log in.
- Dr Donia current cycle: 232 followups, 47 completed, 210 reviews authored, avg review score 94.7.
- Dr Doha current cycle: 87 followups, 2 completed, 323 reviews authored, avg review score 96.7.
- Review identity aggregation now prioritizes known staff IDs, maps legacy IDs to a unique active branch identity only when safe, and otherwise uses a unique identity observed in the same branch/cycle.
- Arabic identity normalization used by these RPCs canonicalizes alef variants, ya/maqsura, and ta marbuta without changing the older indexed normalize_cs_name function.

## Branch targets
- Shamy active target: 1,200,000 EGP; achievement 68.67%.
- Shokry active target: 1,550,000 EGP; achievement 76.14%.

## Known non-blocking note
ExecutiveDashboard2027 still contains legacy numeric fallback target constants used only if the live target source is unavailable. Normal production reads use branch_sales_targets and were verified correct. This fallback should be removed in a future safe frontend patch rather than replacing the large dashboard file through a whole-file connector write.
