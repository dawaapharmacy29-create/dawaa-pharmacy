# Test plan

1. Load Quick Replies with Supabase available and confirm production active scripts are shown.
2. Simulate fallback mode and confirm the default library loads with the new customer-service wording.
3. Confirm `/متابعة` renders the approved service-rating script.
4. Confirm retention/VIP scripts do not mention declining purchase behavior.
5. Confirm shortage flows offer a next action (same item, another branch, pharmacist-reviewed alternative).
6. Confirm cashback uses the supported `{{points_balance}}` placeholder.
7. Confirm pharmacist-review scripts remain explicit for interaction, dosage, adverse effects, and substitution.
8. Confirm no duplicate active shortcut exists and every active script has a response question/action.
