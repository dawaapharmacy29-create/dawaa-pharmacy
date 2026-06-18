export function debounce<T extends (...args: any[]) => any>(fn: T, wait = 200) {
  let t: any;
  return (...args: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
// NOTE: The file previously contained a second, duplicate `PerformanceCache` class
// definition which caused a TypeScript `Duplicate identifier` error. The duplicate
// was removed above and a single `PerformanceCache` implementation is retained
// below (further in the file) to preserve existing usage across the codebase.
/**
 * تحسينات الأداء العامة للتطبيق
 * 2026 - Dawaa Pharmacy Performance Optimization
 */

/**
 * استخدام Memoization لتجنب إعادة الحساب غير الضرورية
 */
export const memoizeSelector = <T, R>(selector: (data: T) => R): ((data: T) => R) => {
  let lastInput: T;
  let lastOutput: R;
  
  return (data: T) => {
    if (data !== lastInput) {
      lastInput = data;
      lastOutput = selector(data);
    }
    return lastOutput;
  };
};

/**
 * تحسين استعلامات قاعدة البيانات
 */
export const createBatchQuery = <T>(items: T[], batchSize: number = 100): T[][] => {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
};

/**
 * تحسين البحث والفلترة
 */
export const createSearchIndex = <T extends Record<string, unknown>>(
  items: T[],
  fields: (keyof T)[]
): Map<string, T> => {
  const index = new Map<string, T>();
  items.forEach((item, idx) => {
    const key = fields
      .map((field) => String(item[field] || "").toLowerCase().trim())
      .filter(Boolean)
      .join("|");
    if (key) index.set(key, item);
  });
  return index;
};

/**
 * تحسين معالجة البيانات الكبيرة
 */
export const debounceOperation = <T extends unknown[], R>(
  fn: (...args: T) => R,
  delay: number = 300
): ((...args: T) => void) => {
  let timeoutId: NodeJS.Timeout;
  
  return (...args: T) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      fn(...args);
    }, delay);
  };
};

/**
 * تخزين مؤقت محسّن
 */
export class PerformanceCache<T> {
  private cache = new Map<string, { value: T; timestamp: number }>();
  private ttl: number;

  constructor(ttl: number = 5 * 60 * 1000) {
    this.ttl = ttl;
  }

  get(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }

  set(key: string, value: T): void {
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * تحسين تحميل الصور
 */
export const lazyLoadImages = (): void => {
  if ("IntersectionObserver" in window) {
    const imageObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target as HTMLImageElement;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            imageObserver.unobserve(img);
          }
        }
      });
    });

    document.querySelectorAll("img[data-src]").forEach((img) => {
      imageObserver.observe(img);
    });
  }
};

/**
 * تحسين إعادة الاتصال
 */
export const createRetryStrategy = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T | null> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, i)));
    }
  }
  return null;
};

/**
 * تحسين معالجة الأخطاء
 */
export class ErrorBoundary {
  static wrapAsync<T extends unknown[], R>(
    fn: (...args: T) => Promise<R>,
    fallback: R
  ): (...args: T) => Promise<R> {
    return async (...args: T) => {
      try {
        return await fn(...args);
      } catch (error) {
        console.error("Error in wrapped function:", error);
        return fallback;
      }
    };
  }

  static wrap<T extends unknown[], R>(
    fn: (...args: T) => R,
    fallback: R
  ): (...args: T) => R {
    return (...args: T) => {
      try {
        return fn(...args);
      } catch (error) {
        console.error("Error in wrapped function:", error);
        return fallback;
      }
    };
  }
}

/**
 * تحسين معالجة الوقت
 */
export const measurePerformance = (label: string, fn: () => void): number => {
  const start = performance.now();
  fn();
  const end = performance.now();
  console.log(`[Performance] ${label}: ${(end - start).toFixed(2)}ms`);
  return end - start;
};

/**
 * تحسين معالجة البيانات الضخمة
 */
export const chunkArray = <T>(array: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

/**
 * فهرسة البيانات للبحث السريع
 */
export const createIndex = <T extends Record<string, unknown>>(
  items: T[],
  keyFn: (item: T) => string
): Map<string, T> => {
  const index = new Map<string, T>();
  items.forEach((item) => {
    const key = keyFn(item);
    if (key) index.set(key, item);
  });
  return index;
};

/**
 * معالج الحد من معدل الطلب
 */
export const rateLimit = (fn: () => void, interval: number = 1000): (() => void) => {
  let lastCall = 0;
  return () => {
    const now = Date.now();
    if (now - lastCall >= interval) {
      lastCall = now;
      fn();
    }
  };
};
