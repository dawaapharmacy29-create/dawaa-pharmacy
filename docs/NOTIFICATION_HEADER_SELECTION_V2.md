# Notification header selection V2

The application header is a notification consumer only. It does not own notification family classification, operational ranking, or balancing rules.

Header feed selection lives under `src/lib/notifications/headerNotificationSelection.ts` and depends on the canonical notification domain for type normalization and operational scoring.

Current balancing policy for a 10-item header feed:
- 2 task items
- 3 customer items
- 1 conversation review
- 2 system/manager items
- 1 other operational item
- remaining capacity filled by the freshest unseen events

This prevents one noisy producer (for example VIP customer alerts) from hiding tasks, reviews, Team Alpha work, or system/manager alerts while preserving global unread counts and canonical navigation.
