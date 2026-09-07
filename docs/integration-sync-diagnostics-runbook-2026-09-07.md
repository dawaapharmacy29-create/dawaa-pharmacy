# Integration sync diagnostics runbook

## Biometrics

1. Check `agent_last_seen_at`.
   - Older than 20 minutes: Windows Fingerprint Agent / main PC / connectivity problem.
2. If the agent is current, check `watermark_complete_through`.
   - Missing: ACK/watermark update is not being written.
   - Stale while ingestion is current: watermark update is stalled.
3. Check `last_ingested_at`.
   - Agent current but ingestion stale: the agent is not reading/uploading fingerprint rows.
4. Check `mapping_rate` and `unmapped_events`.
   - Healthy transport with poor mapping means staff biometric codes need mapping; do not classify it as a transport outage.

## Customer orders

CustomerOrder is event-driven and currently has no dedicated transport heartbeat. Quiet order traffic alone must never be classified as an outage. Alert only when there is concrete pending/backlog or failed/conflict evidence.

## Purchase invoices

Use the Base44 reconciliation run as the heartbeat. Surface the latest run time, status and error separately from invoice match quality (`matched` / `ambiguous` / `unmatched`).

## UI rule

The system integrations page should show the detected diagnosis and the next action, not only a generic `offline` badge.
