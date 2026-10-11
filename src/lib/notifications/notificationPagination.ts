export const NOTIFICATION_PAGE_SIZE = 50;

export function getNotificationPageRange(page: number, pageSize = NOTIFICATION_PAGE_SIZE) {
  const normalizedPage = Math.max(Math.trunc(Number.isFinite(page) ? page : 1), 1);
  const normalizedPageSize = Math.min(
    Math.max(Math.trunc(Number.isFinite(pageSize) ? pageSize : NOTIFICATION_PAGE_SIZE), 1),
    NOTIFICATION_PAGE_SIZE
  );
  const from = (normalizedPage - 1) * normalizedPageSize;
  return { from, to: from + normalizedPageSize - 1 };
}

export function mergeNotificationPages<T extends { id: string; created_at: string }>(
  ...pages: ReadonlyArray<ReadonlyArray<T>>
) {
  const uniqueRows = new Map<string, T>();
  for (const page of pages) {
    for (const row of page) {
      if (!uniqueRows.has(row.id)) uniqueRows.set(row.id, row);
    }
  }

  return [...uniqueRows.values()].sort((left, right) =>
    new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  );
}
