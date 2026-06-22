/*
 * Mobile Safari compatibility bootstrap.
 *
 * This file must be imported before the application/router modules so older
 * iPhone Safari versions do not crash during startup when a dependency uses a
 * modern browser API. Keep this file dependency-free and safe to run multiple
 * times.
 */

declare global {
  interface PromiseConstructor {
    withResolvers?<T>(): {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  }

  interface Window {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  }

  interface Crypto {
    randomUUID?: () => string;
  }
}

function defineValue<T extends object>(target: T, key: PropertyKey, value: unknown) {
  try {
    if (!(key in target)) {
      Object.defineProperty(target, key, {
        value,
        configurable: true,
        writable: true,
        enumerable: false,
      });
    }
  } catch {
    // Ignore. Some browsers may lock native prototypes in unusual modes.
  }
}

if (typeof Promise !== 'undefined' && typeof Promise.withResolvers !== 'function') {
  defineValue(Promise, 'withResolvers', function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  });
}

if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  defineValue(crypto, 'randomUUID', function randomUUIDFallback() {
    const bytes = new Uint8Array(16);
    if (typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  });
}

if (typeof Array.prototype.at !== 'function') {
  defineValue(Array.prototype, 'at', function at<T>(this: T[], index: number) {
    const i = Math.trunc(index) || 0;
    return this[i < 0 ? this.length + i : i];
  });
}

if (typeof (Array.prototype as any).toSorted !== 'function') {
  defineValue(Array.prototype, 'toSorted', function toSorted<T>(this: T[], compareFn?: (a: T, b: T) => number) {
    return [...this].sort(compareFn);
  });
}

if (typeof (Array.prototype as any).toReversed !== 'function') {
  defineValue(Array.prototype, 'toReversed', function toReversed<T>(this: T[]) {
    return [...this].reverse();
  });
}

if (typeof (Array.prototype as any).toSpliced !== 'function') {
  defineValue(Array.prototype, 'toSpliced', function toSpliced<T>(this: T[], start: number, deleteCount?: number, ...items: T[]) {
    const copy = [...this];
    copy.splice(start, deleteCount ?? copy.length - start, ...items);
    return copy;
  });
}

if (typeof window !== 'undefined') {
  if (typeof window.requestIdleCallback !== 'function') {
    window.requestIdleCallback = (callback) =>
      window.setTimeout(() => {
        const start = Date.now();
        callback({
          didTimeout: false,
          timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
        });
      }, 1);
  }

  if (typeof window.cancelIdleCallback !== 'function') {
    window.cancelIdleCallback = (handle) => window.clearTimeout(handle);
  }
}

export function isIOSWebKit() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
}
