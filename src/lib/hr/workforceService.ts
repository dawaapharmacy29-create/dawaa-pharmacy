// Compatibility router: keep every existing HR/workforce export intact,
// while routing payroll finalization reads/writes through the delivery-aware
// current endpoints. The legacy implementation remains available internally
// for all unrelated workforce functions.
export * from './workforceServiceLegacy';

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
