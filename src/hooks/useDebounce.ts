import { useEffect, useState } from "react";

/**
 * useDebounce — Returns a debounced copy of the value.
 * The returned value only updates after `delay` ms of no changes.
 *
 * @param value  The reactive value to debounce
 * @param delay  Delay in milliseconds (default: 300ms)
 *
 * Usage:
 *   const [search, setSearch] = useState("");
 *   const debouncedSearch = useDebounce(search, 300);
 *   // Use debouncedSearch in queries/filters
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
