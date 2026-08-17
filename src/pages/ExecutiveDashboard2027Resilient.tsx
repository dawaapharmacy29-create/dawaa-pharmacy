import ExecutiveDashboard2027 from '@/pages/ExecutiveDashboard2027';

/**
 * The executive/branch-manager dashboard now uses server-side aggregate sales
 * paths and per-section loading/error guards. Older builds globally rewrote
 * every 7-second window timeout to 45 seconds while this page was mounted.
 * That could delay unrelated section failures and keep stale/loading values on
 * screen for far longer than intended.
 *
 * Keep this route wrapper for backwards-compatible lazy routing, but leave the
 * browser timer implementation untouched. Each section owns its timeout and
 * fallback semantics inside ExecutiveDashboard2027.
 */
export default function ExecutiveDashboard2027Resilient() {
  return <ExecutiveDashboard2027 />;
}
