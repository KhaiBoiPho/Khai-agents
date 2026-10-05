import type { Project, Thread } from "../generated/app-server";

/** The hidden project created by `chats/workspace` for plain chats. */
export function isChatsProject(project: Project | null | undefined): boolean {
  if (!project) return false;
  const path = project.canonicalPath.replaceAll("\\", "/");
  return project.displayName === "Chats" && path.endsWith("/chats");
}

export interface DayGroup {
  label: string;
  threads: Thread[];
}

/** ChatGPT-style buckets: Today, Yesterday, Previous 7 days, ... */
export function groupByDay(threads: readonly Thread[], now = new Date()): DayGroup[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  const buckets: Array<[string, (time: number) => boolean]> = [
    ["Today", (time) => time >= startOfToday],
    ["Yesterday", (time) => time >= startOfToday - day],
    ["Previous 7 days", (time) => time >= startOfToday - 7 * day],
    ["Previous 30 days", (time) => time >= startOfToday - 30 * day],
    ["Older", () => true],
  ];
  const sorted = [...threads].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  const groups = new Map<string, Thread[]>();
  for (const thread of sorted) {
    const time = Date.parse(thread.updatedAt);
    const label = buckets.find(([, test]) => test(time))?.[0] ?? "Older";
    groups.set(label, [...(groups.get(label) ?? []), thread]);
  }
  return buckets
    .map(([label]) => ({ label, threads: groups.get(label) ?? [] }))
    .filter((group) => group.threads.length > 0);
}
