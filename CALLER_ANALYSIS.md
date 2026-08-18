# CALLER ANALYSIS - Function Call Graph

## Function Call Chain

```
CustomerService.tsx (line 1698)
  ├─ useCustomerServiceMetricsEnrichment(enrichmentTargets)
  │   └─ batchEnrichCustomerServiceMetrics(items)
  │       └─ For each item: getCustomerServiceLiveMetrics(item)
  │           └─ fetchByStrategies(input)
  │               └─ querySalesInvoices() × 3-5 (sequential per strategy)
  │
  └─ getCustomerServiceLiveMetrics() [direct call line 1479]
      └─ fetchByStrategies(input)
          └─ querySalesInvoices() × 3-5

CustomerQuickDetailsModal.tsx (line 212)
  └─ getCustomerServiceLiveMetrics()
      └─ fetchByStrategies(input)
          └─ querySalesInvoices() × 3-5
```

## Caller Table

| Function | Called From | File:Line | Context | Customers/Call | Critical? |
|----------|------------|-----------|---------|---|---|
| `useCustomerServiceMetricsEnrichment` | CustomerService | CustomerService.tsx:1698 | Page load - enrich 250 followups | 250 | **YES** |
| `getCustomerServiceLiveMetrics` | batchEnrichCustomerServiceMetrics | customerServiceCustomerMetrics.ts:339 | Batch processing | 1 per loop | **YES** |
| `getCustomerServiceLiveMetrics` | CustomerService (direct) | CustomerService.tsx:1479 | Detail panel load | 1 | NO (single) |
| `getCustomerServiceLiveMetrics` | CustomerQuickDetailsModal | CustomerQuickDetailsModal.tsx:212 | Modal open | 1 | NO (single) |
| `fetchByStrategies` | getCustomerServiceLiveMetrics | customerServiceCustomerMetrics.ts:309 | Metric resolution | 1 | **YES** |
| `querySalesInvoices` | fetchByStrategies | (internal loop) | Query execution | 3-5 per customer | **YES** |

## Concurrency Analysis

**PRIMARY HOTSPOT:** CustomerService.tsx line 1698
- Input: 250 customers to enrich
- Function: useCustomerServiceMetricsEnrichment
- Cascades to: batchEnrichCustomerServiceMetrics with concurrency=5
- Each item triggers: getCustomerServiceLiveMetrics → fetchByStrategies → 3-5 sequential queries

**TOTAL ESTIMATED QUERIES:**
- 250 customers × 5 concurrent batches × 3-5 queries per customer
- **750-1250 querySalesInvoices() calls per page load**

## Secondary Calls (Lower Impact)

- CustomerService.tsx:1479 - Direct single customer lookup (1 query)
- CustomerQuickDetailsModal.tsx - Single customer modal (1 query)
- Both are acceptable as they're user-initiated single lookups

## Action Items

1. ✅ Confirm N+1 with actual network monitoring on /customer-service
2. Monitor enrichmentTargets.length to see actual batch size
3. Monitor querySalesInvoices call count over 20+ seconds
4. Benchmark concurrency 5 vs 10 vs 15
