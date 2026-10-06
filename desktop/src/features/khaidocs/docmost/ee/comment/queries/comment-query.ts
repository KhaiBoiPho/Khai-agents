/*
 * KhaiDocs stand-in for a Docmost Enterprise module. Original code, MIT.
 * Docmost's Enterprise Edition is not included: it is licensed separately
 * and may not be used without a Docmost subscription. Every enterprise
 * feature reports as unavailable.
 */

import { useMutation } from "@tanstack/react-query";

export function useResolveCommentMutation() {
  return useMutation<any, Error, any>({
    mutationFn: async () => {
      throw new Error("Comment resolution is not available in KhaiDocs.");
    },
  });
}
