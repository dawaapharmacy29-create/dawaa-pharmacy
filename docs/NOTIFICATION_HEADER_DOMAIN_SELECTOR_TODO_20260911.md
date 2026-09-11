# Notification header selector follow-up

The balanced header feed introduced earlier is working, but its category-bucket selector currently lives in `Header.tsx`. Notification Architecture V2 intends domain classification and selection policy to live under `src/lib/notifications/notificationDomain.ts`, leaving the header as a consumer only.

This follow-up documents the architectural cleanup so the selector can be moved into the domain boundary without changing visible behavior. No new notification writer, reader, scheduler, or route path should be introduced.