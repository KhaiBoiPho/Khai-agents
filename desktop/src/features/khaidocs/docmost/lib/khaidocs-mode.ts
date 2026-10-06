/*
 * Original KhaiDocs code, MIT.
 *
 * KhaiDocs runs Docmost for one person. With SINGLE_USER on, the client
 * hides everything about other people and about choosing between spaces:
 * members, groups, invites, public sharing, the spaces list and the space
 * switcher. Nothing is deleted on the server; the screens are just not
 * reachable (their routes redirect to the default space).
 *
 * Docmost still needs every page to live in a space, so one "default space"
 * stands in for the whole wiki: the oldest space the user belongs to.
 */

import type { ISpace } from "@/features/space/types/space.types.ts";

export const SINGLE_USER = true;

/** Settings pages that are about other people or many spaces. */
export const SINGLE_USER_HIDDEN_SETTINGS = [
  "/settings/members",
  "/settings/groups",
  "/settings/spaces",
  "/settings/sharing",
  "/settings/billing",
];

/** The oldest space, by creation time (ties broken by id for stability). */
export function pickDefaultSpace<T extends Pick<ISpace, "id" | "createdAt">>(
  spaces: readonly T[] | null | undefined,
): T | undefined {
  if (!spaces?.length) return undefined;
  const time = (space: T) => {
    const value = new Date(space.createdAt as unknown as string).getTime();
    return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
  };
  return [...spaces].sort(
    (a, b) => time(a) - time(b) || a.id.localeCompare(b.id),
  )[0];
}
