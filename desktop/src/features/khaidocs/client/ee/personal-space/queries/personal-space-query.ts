/*
 * KhaiDocs stand-in for an enterprise module. Original code, MIT.
 * The upstream Enterprise Edition is not included: it is licensed separately
 * and may not be used without a subscription. Every enterprise
 * feature reports as unavailable.
 */

import { useQuery } from "@tanstack/react-query";

export function usePersonalSpaceQuery(..._args: any[]) {
  return useQuery<any>({ queryKey: ["khaidocs-no-personal-space"], queryFn: async () => null, enabled: false });
}
