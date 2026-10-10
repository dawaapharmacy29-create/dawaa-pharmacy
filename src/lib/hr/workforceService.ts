// Compatibility router: keep every existing HR/workforce export intact,
// while routing payroll finalization reads/writes through the delivery-aware
// current endpoints. The legacy implementation remains available internally
// for all unrelated workforce functions.
import { runPayrollHeavyRequest } from './payrollRequestCoordinator';
import {
  getPayrollCycleFinalizationOverview as getPayrollCycleFinalizationOverviewLegacy,
} from './workforceServiceLegacy';

export * from './workforceServiceLegacy';

export async function getPayrollCycleFinalizationOverview(
  args: Parameters<typeof getPayrollCycleFinalizationOverviewLegacy>[0]
): ReturnType<typeof getPayrollCycleFinalizationOverviewLegacy> {
  const key = `cycle-overview:${args.monthCycle}:${args.branch || 'all'}:${args.limit ?? 100}`;
  return runPayrollHeavyRequest(key, () => getPayrollCycleFinalizationOverviewLegacy(args));
}

export {
  comparePayrollStagedSnapshot,
  getPayrollFinalizationGate,
  getPayrollFinalSnapshotPreview,
  listPayrollSnapshotAudit,
  listPayrollSnapshotReviews,
  listPayrollStagedSnapshots,
  reviewPayrollStagedSnapshot,
  stagePayrollFinalSnapshot,
} from './payrollCurrentFinalizationService';
