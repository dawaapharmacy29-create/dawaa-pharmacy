# Customer requests live sync hardening

This change strengthens the one-way synchronization of CustomerOrder records from DawaaWael (Base44) into the management app on Supabase.

## Included

- Live sync health panel inside customer request insights.
- Sync health RPCs covering lag, latest arrivals, branch distribution, conflicts, missing branch and unlinked customers.
- Safer customer matching that only links unambiguous records, preferring same-branch matches.
- Preservation of richer source fields such as quantity, request type, requested timestamp and recorded-by information.
- Source-side immediate event sync plus periodic reconciliation in DawaaWael to repair missed events.

## Operational goal

Every Base44 customer order should become visible in the management app quickly, without duplicate requests and without unsafe customer linking.
