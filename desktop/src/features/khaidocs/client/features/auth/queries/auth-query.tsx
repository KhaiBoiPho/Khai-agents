import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { ICollabToken } from "../types/auth.types";

/**
 * KhaiDocs: the collaboration socket is authenticated by the Khai session
 * cookie, not by a token, so there is nothing to fetch. The editor only needs
 * a truthy token to start collaborating; the server ignores its value.
 */
export function useCollabToken(): UseQueryResult<ICollabToken, Error> {
  return useQuery({
    queryKey: ["collab-token"],
    queryFn: async (): Promise<ICollabToken> => ({ token: "khai-session" }),
    staleTime: Infinity,
  });
}
