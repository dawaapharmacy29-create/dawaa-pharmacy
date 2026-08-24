// Compatibility bridge while customer-request callers migrate to the feature domain.
// New code should import from @/features/customer-requests/domain.
export {
  customerRequestBranchAliases,
  customerRequestBranchIdentity,
  customerRequestBranchKey,
  customerRequestBranchLabel,
  customerRequestSourceBranch,
  type CustomerRequestBranchKey,
} from '@/features/customer-requests/domain/branch';
