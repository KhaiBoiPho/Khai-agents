/*
 * KhaiDocs stand-in for an enterprise module. Original code, MIT.
 * The upstream Enterprise Edition is not included: it is licensed separately
 * and may not be used without a subscription. Every enterprise
 * feature reports as unavailable.
 */

import { useMutation, useQuery } from "@tanstack/react-query";

export function useBaseQuery(..._args: any[]) {
  return useQuery<any>({ queryKey: ["khaidocs-no-bases"], queryFn: async () => null, enabled: false });
}

export function useConvertPageToBaseMutation() {
  return useMutation<any, Error, any>({
    mutationFn: async () => {
      throw new Error("Bases are not available in KhaiDocs.");
    },
  });
}
