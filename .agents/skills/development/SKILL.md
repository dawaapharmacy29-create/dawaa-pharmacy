---
name: dawaa-pharmacy-development
description: Development setup, testing, and deployment knowledge for the dawaa-pharmacy-2027 project.
---

# Development

- **Stack**: Vite + React + TypeScript + Supabase
- **Dev server**: `npm run dev`
- **Build**: `npm run build` (uses `node scripts/build-vite.mjs`)
- **Lint**: `npm run lint` (ESLint)
- **No test framework** (vitest/jest not configured)

# Environment Variables

- `VITE_SUPABASE_URL` — Supabase project URL (required for data)
- `VITE_SUPABASE_ANON_KEY` — Supabase anon key (required for data)
- `VITE_SHOW_DEMO_CREDENTIALS` — set to `"true"` to show demo login credentials on the login page
- Without Supabase credentials, the app falls back to placeholder config and no data loads.

# Authentication

- Login is via username + password, calling Supabase RPC `staff_account_login`.
- Demo credentials (when enabled): `admin / admin123`, `yasmine.farouk / pass123`
- Auth state stored in localStorage under key `dawaa_auth_user_v2`.
- All routes except `/login` are wrapped in `ProtectedRoute`.

# Deployment

- Deployed to **Vercel** — preview deployments are behind **Vercel deployment protection (SSO)**.
- To test preview deployments, you need either:
  1. Vercel account credentials to pass SSO, or
  2. Supabase credentials to run locally (`npm run dev`)
- CI: Vercel build + preview comments (2 checks).

# Key Files

- Customer segmentation logic: `src/lib/customerAnalyticsService.ts`
- Customer API / stats: `src/lib/api/customers.ts`
- Customer page + modal: `src/pages/Customers.tsx`
- Invoice fetching + cache: `src/lib/salesInvoiceSource.ts`
- Invoice import + cache invalidation: `src/lib/invoiceImporter.ts`
- Analytics page: `src/pages/Analytics.tsx`
- Supabase client: `src/lib/supabase.ts`
- Auth hook: `src/hooks/useAuth.ts`

# Customer Segmentation Thresholds

- مهم جدًا (VIP): `avgMonthly >= 8000`
- مهم (Important): `avgMonthly >= 4000`
- متوسط (Medium): `avgMonthly >= 1500`
- عادي (Normal): `avgMonthly < 1500`

These thresholds must be consistent across `normalizeCustomerSegment`, `classifyCustomer` (utils.ts), and `Analytics.tsx`.

# Path Aliases

- `@/` maps to `src/` (configured in vite and tsconfig).
