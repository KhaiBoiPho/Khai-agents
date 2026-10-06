/*
 * KhaiDocs stand-in for a Docmost Enterprise module. Original code, MIT.
 * Docmost's Enterprise Edition is not included: it is licensed separately
 * and may not be used without a Docmost subscription. Every enterprise
 * feature reports as unavailable.
 */

import { useCallback } from "react";

/** AI search is Enterprise-only; this keeps the spotlight's AI mode inert. */
export function useAiSearch() {
  const noop = useCallback(() => {}, []);
  return {
    data: null as any,
    isPending: false,
    mutate: noop as (...args: any[]) => void,
    reset: noop,
    error: null as Error | null,
    streamingAnswer: "",
    streamingSources: [] as any[],
    clearStreaming: noop,
  };
}
