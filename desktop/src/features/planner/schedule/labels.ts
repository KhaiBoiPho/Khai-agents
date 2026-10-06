import { memberById } from "../shared/members";

export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

export function memberName(memberId: string): string {
  return memberById(memberId)?.name ?? memberId;
}
