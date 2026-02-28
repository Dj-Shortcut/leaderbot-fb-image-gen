import { useRef } from "react";

type GenericFunction = (...args: unknown[]) => unknown;

/**
 * usePersistFn instead of useCallback to reduce cognitive load
 */
export function usePersistFn<T extends GenericFunction>(
  fn: T,
): (...args: Parameters<T>) => ReturnType<T> {
  const fnRef = useRef<T>(fn);
  fnRef.current = fn;

  const persistFnRef = useRef<((...args: Parameters<T>) => ReturnType<T>) | null>(null);

  if (persistFnRef.current === null) {
    persistFnRef.current = (...args: Parameters<T>) => {
      return fnRef.current(...args) as ReturnType<T>;
    };
  }

  return persistFnRef.current;
}
