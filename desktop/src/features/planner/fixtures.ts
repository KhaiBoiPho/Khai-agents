/**
 * Test fixtures: the sample planner data the pages used to start with,
 * written into storage so page tests have something to show. The app itself
 * starts empty.
 */

import { eventsFixture } from "./calendar/events.fixture";
import { notesFixture } from "./notes/notes.fixture";
import { buildFixture } from "./schedule/seed.fixture";
import { isoDate, PLANNER_KEYS } from "./shared/persistentState";
import { createFixture } from "./tasks/seed.fixture";

export function loadPlannerFixtures(now: Date = new Date()): void {
  const today = isoDate(now);
  localStorage.setItem(PLANNER_KEYS.tasks, JSON.stringify(createFixture(now)));
  localStorage.setItem(PLANNER_KEYS.schedule, JSON.stringify(buildFixture(today)));
  localStorage.setItem(PLANNER_KEYS.calendar, JSON.stringify(eventsFixture(today)));
  localStorage.setItem(PLANNER_KEYS.notes, JSON.stringify(notesFixture()));
}
