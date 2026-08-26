# Customer cashback safe advanced flow

Primary advanced route: `CustomerCashbackAdvancedSafe.tsx`.

All balance or configuration mutations must use guarded RPC commands:
- `dawaa_customer_cashback_action_v1` for notify / BConnect / redeem / full settlement.
- `dawaa_customer_cashback_account_action_v1` for rate, multiplier and voucher changes.
- `dawaa_customer_cashback_manual_upsert_v1` for controlled manual cycle entries.
- `dawaa_customer_cashback_import_batch_v1` for validated Excel updates.

Direct browser writes to `customer_cashback_cycles`, `customer_cashback_accounts` or `customer_cashback_events` are not allowed in the safe advanced page.

The compatibility index `uq_customer_cashback_accounts_code` can be dropped only after this route is live. The canonical account identity is `(branch, customer_code)`.
