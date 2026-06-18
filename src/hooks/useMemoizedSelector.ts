import { useMemo, useRef } from 'react';

/**
 * Deep memoized selector hook.
 * Prevents unnecessary re-renders by memoizing derived state.
 * Uses shallow equality for dependencies to optimize comparisons.
 */

function shallowEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function useMemoizedSelector<T>(
  selector: (source: T) => unknown,
  source: T,
  equalityCheck: (a: unknown, b: unknown) => boolean = Object.is
) {
  const lastValueRef = useRef<unknown>(undefined);
  const lastSourceRef = useRef<T>(source);

  return useMemo(() => {
    const nextValue = selector(source);
    // Compare using provided equality check
    if (
      lastSourceRef.current === source ||
      !equalityCheck(nextValue, lastValueRef.current)
    ) {
      lastValueRef.current = nextValue;
      lastSourceRef.current = source;
      return nextValue;
    }
    return lastValueRef.current;
  }, [source, selector, equalityCheck]);
}

/**
 * Array memoization with shallow equality.
 * Useful for derived arrays that should not cause downstream re-renders.
 */
export function useMemoizedArray<T>(array: T[] | null | undefined, key?: unknown[]) {
  const previousRef = useRef<T[] | null | undefined>(array);

  return useMemo(() => {
    if (!array) return array;
    if (
      previousRef.current &&
      array.length === previousRef.current.length &&
      shallowEqual(array, previousRef.current)
    ) {
      return previousRef.current;
    }
    previousRef.current = array;
    return array;
  }, [array, ...(key ?? [])]);
}

/**
 * Object memoization with shallow equality on properties.
 * Prevents unnecessary re-renders when object properties haven't changed.
 */
export function useMemoizedObject<T extends Record<string, unknown>>(
  obj: T,
  key?: unknown[]
): T {
  const previousRef = useRef<T>(obj);

  return useMemo(() => {
    const prev = previousRef.current;
    if (prev === obj) return obj;

    // Shallow equality check
    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(obj);
    if (prevKeys.length !== nextKeys.length) {
      previousRef.current = obj;
      return obj;
    }

    for (const k of prevKeys) {
      if (prev[k] !== obj[k]) {
        previousRef.current = obj;
        return obj;
      }
    }

    return prev;
  }, [obj, ...(key ?? [])]);
}

/**
 * Stable callback memoization with multiple dependency arrays.
 * Useful when callback dependencies are complex.
 */
export function useStableCallback<T extends (...args: any[]) => any>(
  callback: T,
  deps?: unknown[]
): T {
  const callbackRef = useRef(callback);

  return useMemo(() => {
    callbackRef.current = callback;
    return ((...args: any[]) => callbackRef.current(...args)) as T;
  }, deps ?? []);
}
