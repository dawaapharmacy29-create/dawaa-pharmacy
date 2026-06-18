/**
 * Web Worker for heavy data processing.
 * Offloads aggregation, filtering, and sorting to prevent blocking UI.
 */

interface WorkerMessage {
  id: string;
  type: 'aggregate' | 'filter' | 'sort' | 'transform';
  payload: unknown;
}

interface WorkerResponse {
  id: string;
  result?: unknown;
  error?: string;
}

// Aggregation: sum, count, avg, min, max
function aggregate(rows: Record<string, unknown>[], field: string, operation: string) {
  const values = rows.map((r) => Number(r[field]) || 0);
  switch (operation) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'count':
      return values.length;
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    default:
      return null;
  }
}

// Grouping: group by field
function groupBy(rows: Record<string, unknown>[], field: string) {
  const groups = new Map<unknown, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = row[field];
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(row);
  }
  return Array.from(groups.entries()).map(([key, rows]) => ({
    _groupKey: key,
    _rows: rows,
    _count: rows.length,
  }));
}

// Sorting: sort by multiple fields
function sort(
  rows: Record<string, unknown>[],
  fields: Array<{ field: string; ascending?: boolean }>
) {
  return [...rows].sort((a, b) => {
    for (const { field, ascending = true } of fields) {
      const aVal = a[field];
      const bVal = b[field];
      if (aVal < bVal) return ascending ? -1 : 1;
      if (aVal > bVal) return ascending ? 1 : -1;
    }
    return 0;
  });
}

// Filtering: filter rows by conditions
function filter(rows: Record<string, unknown>[], conditions: Array<{ field: string; op: string; value: unknown }>) {
  return rows.filter((row) =>
    conditions.every(({ field, op, value }) => {
      const rowVal = row[field];
      switch (op) {
        case 'eq':
          return rowVal === value;
        case 'ne':
          return rowVal !== value;
        case 'gt':
          return Number(rowVal) > Number(value);
        case 'gte':
          return Number(rowVal) >= Number(value);
        case 'lt':
          return Number(rowVal) < Number(value);
        case 'lte':
          return Number(rowVal) <= Number(value);
        case 'contains':
          return String(rowVal).includes(String(value));
        case 'in':
          return (value as unknown[]).includes(rowVal);
        default:
          return true;
      }
    })
  );
}

// Main worker message handler
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { id, type, payload } = event.data;

  try {
    let result: unknown;
    const data = payload as any;

    switch (type) {
      case 'aggregate': {
        const { rows, field, operation } = data;
        result = aggregate(rows, field, operation);
        break;
      }
      case 'filter': {
        const { rows, conditions } = data;
        result = filter(rows, conditions);
        break;
      }
      case 'sort': {
        const { rows, fields } = data;
        result = sort(rows, fields);
        break;
      }
      case 'transform': {
        // Generic transform: map over rows
        const { rows, fn } = data;
        result = rows.map((r: unknown) => eval(`(${fn})`)(r));
        break;
      }
      default:
        throw new Error(`Unknown worker type: ${type}`);
    }

    const response: WorkerResponse = { id, result };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
