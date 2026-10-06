/*
 * Original KhaiDocs code, MIT.
 *
 * The built-in page templates. Each one is a Markdown file in ./builtin,
 * written for KhaiDocs; "New page from template" imports it through
 * Docmost's core Markdown import (POST /api/pages/import). This is not
 * Docmost Enterprise's template feature.
 */

import bugReport from "./builtin/bug-report.md?raw";
import dailyJournal from "./builtin/daily-journal.md?raw";
import decisionRecord from "./builtin/decision-record.md?raw";
import howToGuide from "./builtin/how-to-guide.md?raw";
import meetingNotes from "./builtin/meeting-notes.md?raw";
import projectPlan from "./builtin/project-plan.md?raw";
import technicalDesign from "./builtin/technical-design.md?raw";
import weeklyReport from "./builtin/weekly-report.md?raw";

export type TemplateCategory =
  | "Meetings"
  | "Planning"
  | "Engineering"
  | "Personal"
  | "Documentation"
  | "My templates";

/** Gallery order of the category filter ("All" comes first in the UI). */
export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  "Meetings",
  "Planning",
  "Engineering",
  "Documentation",
  "Personal",
  "My templates",
];

export interface PageTemplate {
  id: string;
  title: string;
  description: string;
  /**
   * A page icon — a line icon ("ti:<name>:<colour>", see ../notion) or an
   * emoji; also becomes the new page's icon.
   */
  icon: string;
  category: TemplateCategory;
  /** Markdown; the first "# heading" becomes the page title. */
  markdown: string;
  /** True for templates the user saved (stored in localStorage). */
  user?: boolean;
  createdAt?: string;
}

export const BUILTIN_TEMPLATES: PageTemplate[] = [
  {
    id: "meeting-notes",
    title: "Meeting notes",
    description: "Agenda, notes, decisions and action items for any meeting.",
    icon: "ti:clipboard-list:blue",
    category: "Meetings",
    markdown: meetingNotes,
  },
  {
    id: "project-plan",
    title: "Project plan",
    description: "Goals, scope, milestones, tasks and risks on one page.",
    icon: "ti:map-2:green",
    category: "Planning",
    markdown: projectPlan,
  },
  {
    id: "technical-design",
    title: "Technical design (RFC)",
    description:
      "Propose a design: background, proposal, alternatives and rollout.",
    icon: "ti:code:purple",
    category: "Engineering",
    markdown: technicalDesign,
  },
  {
    id: "weekly-report",
    title: "Weekly report",
    description: "Highlights, progress, blockers and next week's plan.",
    icon: "ti:chart-bar:orange",
    category: "Planning",
    markdown: weeklyReport,
  },
  {
    id: "bug-report",
    title: "Bug report",
    description: "Steps to reproduce, expected vs. actual, and a fix checklist.",
    icon: "ti:bug:red",
    category: "Engineering",
    markdown: bugReport,
  },
  {
    id: "decision-record",
    title: "Decision record (ADR)",
    description: "Capture a decision, the options weighed and its consequences.",
    icon: "ti:road-sign:brown",
    category: "Engineering",
    markdown: decisionRecord,
  },
  {
    id: "daily-journal",
    title: "Daily journal",
    description: "Morning priorities, a running log and an evening review.",
    icon: "ti:notebook:yellow",
    category: "Personal",
    markdown: dailyJournal,
  },
  {
    id: "how-to-guide",
    title: "How-to guide",
    description: "Step-by-step instructions with checks and troubleshooting.",
    icon: "ti:book-2:blue",
    category: "Documentation",
    markdown: howToGuide,
  },
];
