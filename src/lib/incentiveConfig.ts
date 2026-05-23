export const INCENTIVE_CONFIG = {
  defaultTargetPoints: 500,
  pointValueEgp: 3,
  maxBaseIncentiveEgp: 1500,
  deductionRate: 0.5,
  rewardRate: 1,
} as const;

// Central fallback only. If a Supabase settings/reward_rules source is added,
// read it in one service and keep page components free of scattered constants.
