/*
 * Original KhaiDocs code, MIT.
 *
 * Single-user mode (see lib/khaidocs-mode.ts): one default space stands in
 * for the whole wiki, and routes about other people or other spaces land on
 * its home instead.
 */

import React from "react";
import { Navigate } from "react-router-dom";
import { useGetSpacesQuery } from "@/features/space/queries/space-query.ts";
import { ISpace } from "@/features/space/types/space.types.ts";
import { getSpaceUrl } from "@/lib/config.ts";
import { pickDefaultSpace } from "@/lib/khaidocs-mode.ts";

/** The default (oldest) space, plus whether the spaces list is loading. */
export function useDefaultSpace(): {
  space: ISpace | undefined;
  isPending: boolean;
} {
  const { data, isPending } = useGetSpacesQuery({ limit: 100 });
  return { space: pickDefaultSpace(data?.items), isPending };
}

/**
 * Sends the user to the default space's home. With no space yet (a fresh
 * workspace), renders `fallback` — the normal Docmost home, which offers to
 * create one.
 */
export function DefaultSpaceRedirect({
  fallback = null,
}: {
  fallback?: React.ReactNode;
}) {
  const { space, isPending } = useDefaultSpace();
  if (isPending) return null;
  if (space) return <Navigate to={getSpaceUrl(space.slug)} replace />;
  return <>{fallback}</>;
}
