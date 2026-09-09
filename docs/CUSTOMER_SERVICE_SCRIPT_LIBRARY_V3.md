# Customer Service Script Library V3

The customer-service quick-reply fallback is intentionally aligned with the active production library.

## Invariants
- 40 active fallback scripts with unique shortcuts.
- Customer-service follow-ups use the Heba / Dawaa customer-service identity where appropriate.
- Every customer-engagement script has a clear response prompt or next action.
- Medication substitutions, interactions, dosage, and adverse-effect flows route through pharmacist review.
- Retention and VIP scripts must not tell customers that their purchases declined or imply surveillance.
- Supported placeholders only; cashback fallback uses `{{points_balance}}`.
- Supabase remains the runtime source of truth when available; fallback is used only when configuration/data loading fails.
