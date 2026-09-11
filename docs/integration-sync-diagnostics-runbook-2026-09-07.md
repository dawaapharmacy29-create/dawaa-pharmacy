# Integration sync diagnostics runbook

- Biometrics: inspect Agent heartbeat, Watermark, ingestion freshness, then mapping quality in that order.
- Customer orders: quiet traffic alone is not an outage; alert only on pending/backlog or failed/conflict evidence.
- Purchase invoices: Base44 reconciliation run is the heartbeat; match quality is a separate concern.
- UI should show a diagnosis and next action, not only a generic offline badge.
