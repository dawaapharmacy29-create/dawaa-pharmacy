import { calculatePermissionPolicy } from '@/lib/performance/performanceRulesEngine';

export function getPermissionCycleImpact(approvedPermissionsInCycle: number) {
  return calculatePermissionPolicy(approvedPermissionsInCycle);
}
