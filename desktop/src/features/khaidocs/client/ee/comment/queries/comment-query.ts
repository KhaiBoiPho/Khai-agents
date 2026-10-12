/*
 * KhaiDocs stand-in for an enterprise module. Original code, MIT.
 * Resolving comments is native in KhaiDocs: POST /api/comments/resolve.
 */

import { InfiniteData, useMutation, useQueryClient } from "@tanstack/react-query";
import { resolveComment } from "@/features/comment/services/comment-service";
import { RQ_KEY } from "@/features/comment/queries/comment-query";
import { IComment, IResolveComment } from "@/features/comment/types/comment.types";
import { IPagination } from "@/lib/types.ts";

export function useResolveCommentMutation() {
  const queryClient = useQueryClient();

  return useMutation<IComment, Error, IResolveComment>({
    mutationFn: (data) => resolveComment(data),
    onSuccess: (updated) => {
      const cache = queryClient.getQueryData(RQ_KEY(updated.pageId)) as
        | InfiniteData<IPagination<IComment>>
        | undefined;
      if (cache) {
        queryClient.setQueryData(RQ_KEY(updated.pageId), {
          ...cache,
          pages: cache.pages.map((page) => ({
            ...page,
            items: page.items.map((c) => (c.id === updated.id ? updated : c)),
          })),
        });
      }
    },
  });
}
