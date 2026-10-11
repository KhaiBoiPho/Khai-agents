/** The planner's starting tasks: none. The user adds their own. */

import type { TasksState } from "./types";

export function createSeed(): TasksState {
  // A fresh planner starts empty: no sample tasks.
  return { tasks: [], completions: [] };
}
