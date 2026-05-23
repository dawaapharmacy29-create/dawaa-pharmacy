# Dawaa Pharmacy 2027 - Executive Dashboard Upgrade

## What changed

- Rebuilt `src/pages/ExecutiveDashboard2027.tsx` to match the approved dark turquoise executive dashboard design.
- Connected dashboard widgets to live Supabase-backed data sources:
  - `sales_invoices`
  - `daily_followups`
  - `customer_requests`
  - `employee_transactions`
  - `stagnant_medicines`
  - `incentive_medicines`
  - `tasks`
  - `staff`
- Added executive KPI strip:
  - cycle sales
  - average order value
  - order count
  - total customers
  - gross profit estimate
  - customer rating indicator
- Added operational panels:
  - customer follow-up alerts
  - employee performance snapshot
  - stagnant medicines needing action
  - open tasks
  - top doctors by sales
  - customer request processing funnel
  - rewards and penalties overview
  - last seven days sales chart
- Updated navigation so `/` is the main **لوحة القيادة 2027** dashboard.
- Moved the classic dashboard to `/dashboard-classic` in the sidebar.
- Updated page titles for the new 2027 routes.

## Database integration notes

The dashboard reads from existing tables and will show empty states if a table has no records. The `customer_requests` widget requires the customer request SQL migration already provided in the previous final release.

## Validation performed in this environment

- Source files were updated and packaged.
- Full Vite build could not be completed in this Linux sandbox because the available extracted Windows `node_modules` was missing Rollup's Linux optional native package `@rollup/rollup-linux-x64-gnu`, and internet access to install packages was unavailable.
- On your Windows machine, run:

```powershell
pnpm.cmd install
pnpm.cmd approve-builds
pnpm.cmd run build
pnpm.cmd run dev -- --force
```

## Primary files changed

- `src/pages/ExecutiveDashboard2027.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/components/layout/Layout.tsx`
