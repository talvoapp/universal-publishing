
/**
 * Debounce hooks.
 */

import { useEffect, useState, useRef, useCallback } from 'react';

/**
 * Returns a debounced version of value.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

/**
 * Returns a debounced version of a callback.
 */
export function useDebouncedCallback<
  T extends (...args: any[]) => void
>(
  callback: T,
  delayMs = 300,
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const debounced = useCallback(
    (...args: Parameters<T>) => {
      cancel();

      timerRef.current = setTimeout(() => {
        callbackRef.current(...args);
        timerRef.current = null;
      }, delayMs);
    },
    [delayMs, cancel],
  );

  useEffect(() => {
    return cancel;
  }, [cancel]);

  return Object.assign(debounced, { cancel });
}
