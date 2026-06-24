## QA Checklist — Production-grade repair

Pre-reqs
- Ensure Node 18+ and project deps installed: `npm ci`.
- (Optional) Configure Supabase in `.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for full integration tests.

Automated checks
- `npm run typecheck` — should pass with no errors.
- `npm run build` — build succeeds and `dist/` is produced.
- `npm run test` — all tests pass locally.

Manual smoke tests (critical pages)
1. Start dev server: `npm run dev`.
2. Open and exercise pages:
   - Executive dashboard (`/executive-2027`): KPIs load without console exceptions.
   - Activity Log (`/activity-log`): list loads, no uncaught exceptions.
   - Reviews (`/reviews`): create/update a review flow; verify saved and no crashes.
   - Customers (`/customers`): open customer profile, metrics render.
   - Followups / Daily followups: list, create, update — verify graceful failure if Supabase not configured.

Specific validations
- Verify console/network: no uncaught exceptions; blocked requests should be logged but not crash the UI.
- Verify analytics: metrics use `sendBeacon` when supported — if endpoint absent, failure is logged but non-fatal.
- Verify realtime fallback: when Supabase realtime blocked, app should fallback to polling (see console warning `realtime unavailable`).
- Verify sidebar scroll restore/save behavior and that it doesn't flood `localStorage`.

Edge cases
- Run import flows for shifts using Arabic-Indic digits and 24h ranges — parser should normalize correctly.
- Test customer followups enrichment with missing columns — `safeInsert`/`safeUpdate` should remove problematic fields and succeed or surface clear errors.

Notes for PR
- Include link to this QA file and `PR_NOTES.md` in PR description.
- Tag `frontend`, `backend`, and `db-admin` for review and DB migration advice.
