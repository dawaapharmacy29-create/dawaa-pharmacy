# Checklist: customer follow-up classification sync

- Importance uses `avg_monthly` thresholds from `src/lib/customerMetrics.ts`.
- Activity status uses `last_purchase` age from the same module.
- `segment`, `classification`, `customer_status`, `last_purchase`, and `days_since_last_purchase` are synchronized for open follow-ups.
