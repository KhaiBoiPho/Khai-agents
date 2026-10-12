/*
 * KhaiDocs stand-in for an enterprise module. Original code, MIT.
 * The upstream Enterprise Edition is not included: it is licensed separately
 * and may not be used without a subscription. Every enterprise
 * feature reports as unavailable.
 */

import { useQuery } from "@tanstack/react-query";

import type { Entitlements } from "./entitlement-atom";

export function useEntitlements() {
  return useQuery<Entitlements>({
    queryKey: ["entitlements"],
    queryFn: async () => ({ tier: "free", features: [] }),
    staleTime: Infinity,
  });
}
