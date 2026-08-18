export const QUERY_KEYS = {
  auth: {
    user: ['auth', 'user'] as const,
  },
  staff: {
    active: ['staff', 'active'] as const,
    byId: (id: string) => ['staff', 'byId', id] as const,
  },
  customers: {
    list: (filters: Record<string, unknown> = {}) => ['customers', 'list', stableKeyValue(filters)] as const,
    byId: (id: string) => ['customers', 'byId', id] as const,
  },
  invoices: {
    list: (branch?: string, cycle?: string) => ['invoices', 'list', branch ?? 'all', cycle ?? 'all'] as const,
    byId: (id: string) => ['invoices', 'byId', id] as const,
    summary: (branch?: string, cycle?: string) => ['invoices', 'summary', branch ?? 'all', cycle ?? 'all'] as const,
  },
  sales: {
    summary: (branch?: string, cycle?: string) => ['sales', 'summary', branch ?? 'all', cycle ?? 'all'] as const,
  },
  followUps: {
    list: (branch?: string, status?: string) => ['followUps', 'list', branch ?? 'all', status ?? 'all'] as const,
    byId: (id: string) => ['followUps', 'byId', id] as const,
  },
  customerRequests: {
    list: (status?: string, branch?: string) => ['customerRequests', 'list', status ?? 'all', branch ?? 'all'] as const,
    byId: (id: string) => ['customerRequests', 'byId', id] as const,
  },
  branches: {
    list: ['branches', 'list'] as const,
  },
  metadata: {
    branches: ['metadata', 'branches'] as const,
    permissions: ['metadata', 'permissions'] as const,
  },
} as const;

export function stableKeyValue(value: unknown): string {
  if (value == null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(stableKeyValue).join('|');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${key}:${stableKeyValue(item)}`)
      .join('|');
  }
  return 'unknown';
}
