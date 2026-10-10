export type AuthorizationCacheScope = {
  id: string;
  role: string;
  branch: string;
  permissions?: Record<string, boolean>;
};

export function authorizationCacheScopeKey(scope: AuthorizationCacheScope | null | undefined): string | null {
  if (!scope?.id) return null;
  const permissions = Object.entries(scope.permissions || {}).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([scope.id, scope.role, scope.branch, permissions]);
}

export function hasAuthorizationScopeChanged(
  previous: AuthorizationCacheScope | null | undefined,
  next: AuthorizationCacheScope | null | undefined,
): boolean {
  if (!previous) return false;
  if (!next) return true;
  return authorizationCacheScopeKey(previous) !== authorizationCacheScopeKey(next);
}

export function performanceSalesCacheKey(
  viewerScopeKey: string,
  args: { staffId: string; windowStart: string; windowEnd: string; currentStart: string; elapsedDays: number },
): string {
  return authorizationScopedCacheKey(viewerScopeKey, [
    args.staffId,
    args.windowStart,
    args.windowEnd,
    args.currentStart,
    String(args.elapsedDays),
  ]);
}

export function authorizationScopedCacheKey(viewerScopeKey: string, subjectKey: string[]): string {
  return JSON.stringify([viewerScopeKey, ...subjectKey]);
}
