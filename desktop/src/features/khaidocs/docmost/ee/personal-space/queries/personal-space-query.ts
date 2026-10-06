/*
 * KhaiDocs stand-in for a Docmost Enterprise module. Original code, MIT.
 * Docmost's Enterprise Edition is not included: it is licensed separately
 * and may not be used without a Docmost subscription. Every enterprise
 * feature reports as unavailable.
 */

import { useQuery } from "@tanstack/react-query";

export function usePersonalSpaceQuery(..._args: any[]) {
  return useQuery<any>({ queryKey: ["khaidocs-no-personal-space"], queryFn: async () => null, enabled: false });
}
