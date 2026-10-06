/**
 * The people planner items can be assigned to.
 *
 * Yuvomi plans for a household; here the "household" is whoever shares this
 * workspace, plus the agent itself, which can be handed tasks too.
 *
 * TODO(backend): preview data — there is no account or team system yet.
 */

import { MOCK_ACCOUNT } from "../../../mocks/preview";

export interface Member {
  id: string;
  name: string;
  /** Avatar fill; chosen to carry white initials at 4.5:1. */
  color: string;
  isAgent?: boolean;
}

export const MEMBERS: readonly Member[] = [
  { id: "me", name: MOCK_ACCOUNT.name, color: "#6c3aed" },
  { id: "agent", name: "Khai Agent", color: "#00668f", isAgent: true },
  { id: "linh", name: "Linh", color: "#ce2a63" },
  { id: "minh", name: "Minh", color: "#157f3d" },
];

export function memberById(id: string | null | undefined): Member | null {
  return MEMBERS.find((member) => member.id === id) ?? null;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}
