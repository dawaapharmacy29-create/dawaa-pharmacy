/**
 * Web Vitals Monitoring & Performance Measurement
 * 
 * Tracks Core Web Vitals and custom metrics for production monitoring
 * Integrates with Vercel Analytics and custom analytics endpoint
 */

import { getCLS, getFCP, getFID, getLCP, getTTFB, type Metric } from 'web-vitals';

/**
 * Core Web Vitals to track:
 * - CLS (Cumulative Layout Shift): Visual stability
 * - FCP (First Contentful Paint): First visible content
 * - FID (First Input Delay): Responsiveness
 * - LCP (Largest Contentful Paint): Main content visibility
 * - TTFB (Time to First Byte): Server response time
 */

interface PerformanceReport {
  metric: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  timestamp: number;
  userAgent: string;
  url: string;
}

// Thresholds based on Core Web Vitals guidelines (2024)
const THRESHOLDS = {
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 }, // milliseconds
  FID: { good: 100, poor: 300 },
  LCP: { good: 2500, poor: 4000 },
  TTFB: { good: 600, poor: 1200 },
};

function getRating(metric: string, value: number): 'good' | 'needs-improvement' | 'poor' {
  const threshold = THRESHOLDS[metric as keyof typeof THRESHOLDS];
  if (!threshold) return 'needs-improvement';

  if (value <= threshold.good) return 'good';
  if (value <= threshold.poor) return 'needs-improvement';
  return 'poor';
}

/**
 * Send performance data to analytics endpoint
 */
async function reportMetric(report: PerformanceReport) {
  try {
    // Send to your analytics endpoint
    await fetch('/api/analytics/performance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      // Use sendBeacon for reliability (even on page unload)
      keepalive: true,
    });

    // Also log to Vercel Analytics if available
    if (window.__VERCEL_WEB_VITALS_QUEUE) {
      window.__VERCEL_WEB_VITALS_QUEUE.push({
        name: report.metric,
        value: report.value,
        rating: report.rating,
      });
    }
  } catch (error) {
    console.warn('[PerformanceMonitor] Failed to report metric:', error);
  }
}

/**
 * Custom performance metrics collector
 */
export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics: Map<string, PerformanceReport> = new Map();
  private observer: PerformanceObserver | null = null;

  private constructor() {
    this.setupObservers();
  }

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  /**
   * Setup PerformanceObserver for Long Tasks and other metrics
   */
  private setupObservers() {
    // Monitor Long Tasks (>50ms)
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'longtask') {
            console.warn('[PerformanceMonitor] Long task detected:', {
              duration: (entry as any).duration,
              name: (entry as any).name,
              startTime: entry.startTime,
            });

            // Report long tasks
            this.recordMetric('LongTask', (entry as any).duration, 'poor');
          }
        }
      });

      this.observer.observe({ entryTypes: ['longtask', 'largest-contentful-paint'] });
    } catch (error) {
      console.debug('[PerformanceMonitor] PerformanceObserver not fully supported');
    }
  }

  /**
   * Record a custom metric
   */
  recordMetric(metric: string, value: number, rating?: 'good' | 'needs-improvement' | 'poor') {
    const report: PerformanceReport = {
      metric,
      value,
      rating: rating || getRating(metric, value),
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    };

    this.metrics.set(metric, report);

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[PerformanceMonitor] ${metric}: ${value.toFixed(2)} (${report.rating})`);
    }

    // Report to server
    void reportMetric(report);
  }

  /**
   * Get all recorded metrics
   */
  getMetrics(): PerformanceReport[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Clear metrics
   */
  clear() {
    this.metrics.clear();
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}

/**
 * Setup Web Vitals monitoring
 */
export function setupWebVitalsMonitoring() {
  const monitor = PerformanceMonitor.getInstance();

  // Cumulative Layout Shift
  getCLS((metric: Metric) => {
    monitor.recordMetric('CLS', metric.value);
  });

  // First Contentful Paint
  getFCP((metric: Metric) => {
    monitor.recordMetric('FCP', metric.value);
  });

  // First Input Delay (or INP on newer browsers)
  getFID((metric: Metric) => {
    monitor.recordMetric('FID', metric.value);
  });

  // Largest Contentful Paint
  getLCP((metric: Metric) => {
    monitor.recordMetric('LCP', metric.value);
  });

  // Time to First Byte
  getTTFB((metric: Metric) => {
    monitor.recordMetric('TTFB', metric.value);
  });
}

/**
 * Measure component render time
 * Usage: const time = measureComponentRender(() => <MyComponent />)
 */
export function measureComponentRender(componentFn: () => React.ReactNode): number {
  const startTime = performance.now();
  componentFn();
  const endTime = performance.now();
  return endTime - startTime;
}

/**
 * Profile async function performance
 * Usage: const result = await profileAsync(fetchData, 'Fetch Data')
 */
export async function profileAsync<T>(
  fn: () => Promise<T>,
  label: string
): Promise<T> {
  const startTime = performance.now();
  const result = await fn();
  const duration = performance.now() - startTime;

  console.debug(`[Profile] ${label}: ${duration.toFixed(2)}ms`);
  PerformanceMonitor.getInstance().recordMetric(`AsyncOp-${label}`, duration);

  return result;
}

/**
 * Measure resource timing
 * Usage: printResourceMetrics()
 */
export function printResourceMetrics() {
  if (!performance.getEntriesByType) return;

  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];

  console.table(
    resources.map((r) => ({
      name: r.name.split('/').pop(),
      duration: r.duration.toFixed(2),
      size: ((r.transferSize || 0) / 1024).toFixed(2) + ' KB',
      cached: r.transferSize === 0 ? 'Yes' : 'No',
    }))
  );
}

/**
 * Export metrics to CSV
 */
export function exportMetricsToCSV() {
  const monitor = PerformanceMonitor.getInstance();
  const metrics = monitor.getMetrics();

  const csv = [
    ['Metric', 'Value', 'Rating', 'Timestamp', 'URL'].join(','),
    ...metrics.map((m) =>
      [m.metric, m.value, m.rating, new Date(m.timestamp).toISOString(), m.url].join(',')
    ),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `performance-metrics-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Initialize performance monitoring in main app
 */
export function initializePerformanceMonitoring() {
  if (process.env.NODE_ENV === 'production') {
    setupWebVitalsMonitoring();
    console.debug('[PerformanceMonitoring] Web Vitals monitoring initialized');
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    PerformanceMonitor.getInstance().destroy();
  });
}

/**
 * React hook for component-level performance tracking
 */
import { useEffect, useRef } from 'react';

export function useComponentPerformance(componentName: string) {
  const startTimeRef = useRef(performance.now());

  useEffect(() => {
    const renderTime = performance.now() - startTimeRef.current;
    if (renderTime > 16) {
      // Warn if render took longer than one frame (60fps)
      console.warn(`[Performance] ${componentName} render took ${renderTime.toFixed(2)}ms`);
      PerformanceMonitor.getInstance().recordMetric(`Render-${componentName}`, renderTime);
    }
  }, [componentName]);
}

/**
 * Use in main.tsx or App.tsx:
 * 
 * import { initializePerformanceMonitoring } from '@/lib/performanceMonitoring';
 * 
 * // Call once on app startup
 * initializePerformanceMonitoring();
 * 
 * // Optional: Access monitor from DevTools console
 * window.__PERFORMANCE_MONITOR = PerformanceMonitor.getInstance();
 */

// Export for window access
declare global {
  interface Window {
    __PERFORMANCE_MONITOR?: PerformanceMonitor;
    __VERCEL_WEB_VITALS_QUEUE?: Array<{ name: string; value: number; rating: string }>;
  }
}
