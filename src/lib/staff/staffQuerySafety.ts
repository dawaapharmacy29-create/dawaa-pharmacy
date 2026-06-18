/**
 * Query Safety and Performance Utilities
 *
 * This module provides utilities to ensure safe and performant database queries
 * for the staff performance profile system.
 */

export interface QuerySafetyConfig {
  maxRows: number;
  timeoutMs: number;
  enablePagination: boolean;
  enableCaching: boolean;
  cacheTTL: number;
}

export const DEFAULT_QUERY_SAFETY: QuerySafetyConfig = {
  maxRows: 10000,
  timeoutMs: 8000,
  enablePagination: true,
  enableCaching: true,
  cacheTTL: 300000, // 5 minutes
};

export interface QueryMetrics {
  queryName: string;
  executionTime: number;
  rowsReturned: number;
  cacheHit: boolean;
  timedOut: boolean;
  error: boolean;
}

/**
 * Enforces query safety limits
 */
export function enforceQuerySafety(
  query: any,
  config: Partial<QuerySafetyConfig> = {}
): { query: any; limit: number } {
  const safetyConfig = { ...DEFAULT_QUERY_SAFETY, ...config };
  const limit = Math.min(safetyConfig.maxRows, query.options?.limit || safetyConfig.maxRows);

  // Apply limit to query
  const safeQuery = query.limit(limit);

  return { query: safeQuery, limit };
}

/**
 * Wraps a query with timeout and metrics collection
 */
export async function safeQuery<T>(
  queryName: string,
  queryFn: () => Promise<T>,
  config: Partial<QuerySafetyConfig> = {}
): Promise<{ data: T | null; metrics: QueryMetrics }> {
  const safetyConfig = { ...DEFAULT_QUERY_SAFETY, ...config };
  const startTime = Date.now();
  let timedOut = false;
  let error = false;
  let data: T | null = null;

  try {
    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        timedOut = true;
        reject(new Error(`Query timeout: ${queryName}`));
      }, safetyConfig.timeoutMs);
    });

    // Race between query and timeout
    data = await Promise.race([queryFn(), timeoutPromise]);
  } catch (err) {
    error = true;
    console.error(`Query error [${queryName}]:`, err);
  }

  const executionTime = Date.now() - startTime;

  const metrics: QueryMetrics = {
    queryName,
    executionTime,
    rowsReturned: Array.isArray(data) ? data.length : data ? 1 : 0,
    cacheHit: false, // Cache hit tracking would be implemented separately
    timedOut,
    error,
  };

  // Log slow queries
  if (executionTime > 3000) {
    console.warn(`Slow query [${queryName}]: ${executionTime}ms`);
  }

  // Log timed out queries
  if (timedOut) {
    console.error(`Query timed out [${queryName}] after ${safetyConfig.timeoutMs}ms`);
  }

  return { data, metrics };
}

/**
 * Simple in-memory cache with TTL
 */
export class SimpleCache<T> {
  private cache = new Map<string, { data: T; timestamp: number }>();
  private ttl: number;

  constructor(ttl: number = 300000) {
    this.ttl = ttl;
  }

  set(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    const age = Date.now() - entry.timestamp;
    if (age > this.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  clear(): void {
    this.cache.clear();
  }

  clearExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    }
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * Global cache instance for staff performance profile data
 */
export const staffProfileCache = new SimpleCache<any>(300000); // 5 minutes TTL

/**
 * Circuit breaker pattern for failing queries
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private threshold: number;
  private resetTimeout: number;

  constructor(threshold: number = 5, resetTimeout: number = 60000) {
    this.threshold = threshold;
    this.resetTimeout = resetTimeout;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();

      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
      }

      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();

      if (this.failures >= this.threshold) {
        this.state = 'open';
      }

      throw error;
    }
  }

  getState(): string {
    return this.state;
  }

  reset(): void {
    this.failures = 0;
    this.state = 'closed';
  }
}

/**
 * Query metrics collector
 */
export class QueryMetricsCollector {
  private metrics: QueryMetrics[] = [];
  private maxMetrics = 1000;

  add(metric: QueryMetrics): void {
    this.metrics.push(metric);

    // Keep only the most recent metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }
  }

  getMetrics(queryName?: string): QueryMetrics[] {
    if (queryName) {
      return this.metrics.filter((m) => m.queryName === queryName);
    }
    return [...this.metrics];
  }

  getSlowQueries(thresholdMs: number = 3000): QueryMetrics[] {
    return this.metrics.filter((m) => m.executionTime > thresholdMs);
  }

  getTimedOutQueries(): QueryMetrics[] {
    return this.metrics.filter((m) => m.timedOut);
  }

  getFailedQueries(): QueryMetrics[] {
    return this.metrics.filter((m) => m.error);
  }

  getAverageExecutionTime(queryName?: string): number {
    const relevantMetrics = queryName
      ? this.metrics.filter((m) => m.queryName === queryName)
      : this.metrics;

    if (relevantMetrics.length === 0) return 0;

    const total = relevantMetrics.reduce((sum, m) => sum + m.executionTime, 0);
    return total / relevantMetrics.length;
  }

  clear(): void {
    this.metrics = [];
  }

  getSummary(): {
    totalQueries: number;
    slowQueries: number;
    timedOutQueries: number;
    failedQueries: number;
    avgExecutionTime: number;
  } {
    return {
      totalQueries: this.metrics.length,
      slowQueries: this.getSlowQueries().length,
      timedOutQueries: this.getTimedOutQueries().length,
      failedQueries: this.getFailedQueries().length,
      avgExecutionTime: this.getAverageExecutionTime(),
    };
  }
}

/**
 * Global metrics collector instance
 */
export const queryMetricsCollector = new QueryMetricsCollector();

/**
 * Pagination helper for large datasets
 */
export function paginate<T>(
  data: T[],
  page: number,
  pageSize: number
): { data: T[]; totalPages: number; currentPage: number } {
  const totalPages = Math.ceil(data.length / pageSize);
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;

  return {
    data: data.slice(startIndex, endIndex),
    totalPages,
    currentPage,
  };
}

/**
 * Batch processing helper for large operations
 */
export async function batchProcess<T, R>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => Promise<R[]>
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await processor(batch);
    results.push(...batchResults);
  }

  return results;
}

/**
 * Debounce function for preventing excessive queries
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function for limiting query frequency
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;

  return function executedFunction(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Validate query parameters to prevent injection or invalid queries
 */
export function validateQueryParams(params: Record<string, any>): boolean {
  // Check for potentially dangerous patterns
  const dangerousPatterns = [
    /;.*--/,
    /DROP\s+/i,
    /DELETE\s+/i,
    /UPDATE\s+/i,
    /INSERT\s+/i,
    /EXEC\s+/i,
    /UNION\s+/i,
    /SCRIPT\s*>/i,
    /<\s*script/i,
  ];

  const paramString = JSON.stringify(params);

  for (const pattern of dangerousPatterns) {
    if (pattern.test(paramString)) {
      console.warn('Potentially dangerous query pattern detected');
      return false;
    }
  }

  return true;
}

/**
 * Memory usage monitoring
 */
export function getMemoryUsage(): {
  used: number;
  total: number;
  percentage: number;
} {
  // @ts-ignore - Node.js specific
  const used = process.memoryUsage?.()?.heapUsed || 0;
  // @ts-ignore - Node.js specific
  const total = process.memoryUsage?.()?.heapTotal || 0;

  return {
    used,
    total,
    percentage: total > 0 ? (used / total) * 100 : 0,
  };
}

/**
 * Check if memory usage is safe for large operations
 */
export function isMemorySafe(threshold: number = 80): boolean {
  const usage = getMemoryUsage();
  return usage.percentage < threshold;
}

/**
 * Performance monitoring for staff profile loading
 */
export class StaffProfilePerformanceMonitor {
  private startTime: number;
  private checkpoints: Map<string, number> = new Map();

  constructor() {
    this.startTime = Date.now();
  }

  checkpoint(name: string): void {
    this.checkpoints.set(name, Date.now());
  }

  getElapsedTime(checkpoint?: string): number {
    const endTime = checkpoint ? this.checkpoints.get(checkpoint) || Date.now() : Date.now();
    return endTime - this.startTime;
  }

  getCheckpointDuration(checkpoint: string): number | null {
    const checkpointTime = this.checkpoints.get(checkpoint);
    if (!checkpointTime) return null;

    // Find previous checkpoint
    const times = Array.from(this.checkpoints.values()).sort((a, b) => a - b);
    const idx = times.indexOf(checkpointTime);

    if (idx === 0) {
      return checkpointTime - this.startTime;
    }

    return checkpointTime - times[idx - 1];
  }

  getSummary(): {
    totalTime: number;
    checkpoints: Array<{ name: string; time: number; duration: number | null }>;
  } {
    return {
      totalTime: this.getElapsedTime(),
      checkpoints: Array.from(this.checkpoints.entries()).map(([name, time]) => ({
        name,
        time,
        duration: this.getCheckpointDuration(name),
      })),
    };
  }
}
