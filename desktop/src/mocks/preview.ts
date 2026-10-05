/**
 * Placeholder data for UI that has no backend yet.
 *
 * Every export here stands in for a value the App Server does not provide.
 * Surfaces that read from this module show a "Preview" tag so the numbers are
 * never mistaken for real ones. When the backend lands, replace the export
 * with the real source and drop the tag at its call site.
 */

/** TODO(backend): current git branch of the thread's workspace. */
export const MOCK_GIT = {
  branch: "main",
} as const;

/** TODO(backend): tokens the thread's context currently holds. */
export const MOCK_CONTEXT_USED_TOKENS = 0;

export interface MockLimit {
  label: string;
  detail: string;
  used: number;
  total: number;
}

/** TODO(backend): provider rate-limit and quota usage per connection. */
export const MOCK_USAGE_LIMITS: readonly MockLimit[] = [
  { label: "Requests today", detail: "Resets at 00:00 UTC", used: 42, total: 1500 },
  { label: "Tokens per minute", detail: "Rolling window", used: 18_000, total: 250_000 },
];

/** TODO(backend): local profile; there is no account system yet. */
export const MOCK_ACCOUNT = {
  name: "Khai",
  email: "khai@local",
  plan: "Local",
} as const;

export function percent(used: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

/* ---- Settings pages (all TODO(backend)) -------------------------------- */

export const MOCK_PROFILE = {
  fullName: "Khai Nguyen",
  callMe: "Khai",
  work: "Software engineer",
  instructions:
    "Short, direct answers. Assume technical knowledge. Ask before acting when a request is ambiguous.",
  organizationId: "kh41-a9e2-7ecb-4589-9ca6-7d04d21b2153",
} as const;

export const MOCK_WORK_ROLES = [
  "Software engineer",
  "Data scientist",
  "Researcher",
  "Student",
  "Designer",
  "Product manager",
  "Other",
] as const;

export const MOCK_LOCAL_DEVICES = [
  { name: "khai-D520MT", platform: "Linux", added: "Oct 1, 2026", seen: "Now", current: true },
  { name: "Khai-Agents Desktop", platform: "Windows", added: "Aug 21, 2026", seen: "3d ago" },
  { name: "DESKTOP-NA8D9I4", platform: "Windows", added: "Sep 18, 2026", seen: "last wk." },
  { name: "khai-macbook", platform: "macOS", added: "Sep 15, 2026", seen: "3w ago" },
] as const;

export const MOCK_TRUSTED_DEVICES = [
  { name: "Chrome on Linux · Ho Chi Minh City", added: "Oct 2, 2026" },
  { name: "Safari on iOS · Ho Chi Minh City", added: "Sep 10, 2026" },
  { name: "Chrome on Windows · Da Nang", added: "Jul 15, 2026" },
] as const;

export const MOCK_USAGE = {
  headline: "On track. You should reach today's reset with room to spare.",
  session: { used: 48, resets: "Resets at 5:10 AM" },
  week: { used: 57, resets: "Resets Monday at 2:00 PM" },
  providers: [
    { name: "Gemini", detail: "Requests today · resets 00:00 UTC", used: 412, total: 1500 },
    { name: "Gemini", detail: "Tokens per minute", used: 61_000, total: 250_000 },
    { name: "NVIDIA NIM", detail: "Requests this hour", used: 38, total: 200 },
    { name: "Firecrawl", detail: "Credits this month", used: 2, total: 1000 },
  ],
  credits: { granted: 5, spent: 0.42, remaining: 4.58 },
  daily: [12, 30, 22, 41, 18, 55, 48],
} as const;

export const MOCK_PRIVACY = [
  { id: "improve", label: "Help improve Khai-Agents", description: "Share anonymous usage statistics such as feature use and crash reports. Never your code or prompts.", on: false },
  { id: "location", label: "Location metadata", description: "Let the agent use your approximate location for time zones and local results.", on: true },
  { id: "history", label: "Keep chat history", description: "Store Session transcripts on this machine so they can be resumed later.", on: true },
  { id: "redact", label: "Redact secrets in transcripts", description: "Mask tokens and keys that appear in tool output before they are saved.", on: true },
] as const;

export const MOCK_CAPABILITIES = [
  { id: "search", label: "Web search", description: "Look things up on the web through connected search tools.", on: true },
  { id: "code", label: "Run commands", description: "Execute shell commands inside the trusted workspace.", on: true },
  { id: "files", label: "Create and edit files", description: "Write files in the workspace; changes appear in Review.", on: true },
  { id: "artifacts", label: "Artifacts", description: "Produce standalone documents, diagrams and pages next to the chat.", on: true },
  { id: "browser", label: "Browser control", description: "Drive a local browser to test web apps.", on: false },
  { id: "vision", label: "Image understanding", description: "Read screenshots and images you attach.", on: true },
] as const;

export const MOCK_MEMORIES = [
  { id: "m1", text: "Prefers concise, technical answers without pleasantries.", added: "Oct 4, 2026" },
  { id: "m2", text: "Works mainly in Python and TypeScript on Linux.", added: "Oct 2, 2026" },
  { id: "m3", text: "Uses Gemini 3.6 Flash and NVIDIA NIM as model providers.", added: "Oct 1, 2026" },
  { id: "m4", text: "Projects live under ~/Desktop.", added: "Sep 29, 2026" },
] as const;

export const MOCK_AGENTS = [
  { id: "default", name: "Default", description: "General coding agent with every enabled tool.", model: "Inherit", tools: "All" },
  { id: "reviewer", name: "Code reviewer", description: "Reads diffs and leaves findings; never edits files.", model: "gemini-3.6-flash", tools: "Read only" },
  { id: "researcher", name: "Researcher", description: "Searches the web and docs, then summarizes with sources.", model: "nemotron-3-super", tools: "Search, read" },
  { id: "planner", name: "Planner", description: "Breaks work into steps and asks before acting.", model: "Inherit", tools: "Read, plan" },
  { id: "tester", name: "Test writer", description: "Writes and runs tests for the current change.", model: "Inherit", tools: "Edit, run" },
] as const;

export const MOCK_DISCOVER_SKILLS = [
  { name: "docs", by: "Community", description: "Write editable documents people can share and comment on." },
  { name: "deep-research", by: "Community", description: "Research a topic across many sources and write a cited report." },
  { name: "pdf", by: "Community", description: "Read, merge, split and fill PDF files." },
  { name: "xlsx", by: "Community", description: "Create and clean spreadsheets with formulas and charts." },
  { name: "frontend-design", by: "Khai-Agents", description: "Distinctive, intentional UI design guidance." },
  { name: "mcp-builder", by: "Khai-Agents", description: "Build high-quality MCP servers for external services." },
] as const;

export const MOCK_CONNECTOR_SUGGESTIONS = [
  { id: "github", name: "GitHub Integration", icon: "github", type: "Web", connected: true },
  { id: "drive", name: "Google Drive", icon: "googledrive", type: "Web", connected: true },
  { id: "drawio", name: "draw.io", icon: "diagramsdotnet", type: "Web", badge: "Community", connected: true },
  { id: "gmail", name: "Gmail", icon: "gmail", type: "Web", connected: false },
  { id: "calendar", name: "Google Calendar", icon: "googlecalendar", type: "Web", connected: false },
  { id: "notion", name: "Notion", icon: "notion", type: "Web", connected: false },
  { id: "linear", name: "Linear", icon: "linear", type: "Web", connected: false },
  { id: "figma", name: "Figma", icon: "figma", type: "Web", connected: false },
  { id: "supabase", name: "Supabase", icon: "supabase", type: "Web", connected: false },
  { id: "postman", name: "Postman", icon: "postman", type: "Web", connected: false },
] as const;

export const MOCK_DISCOVER_PLUGINS = [
  { name: "Frontend engineer", description: "React, CSS and accessibility expertise with matching Skills." },
  { name: "Data analyst", description: "Notebooks, SQL and charting tools in one bundle." },
  { name: "DevOps", description: "Docker, CI and deployment helpers." },
  { name: "Technical writer", description: "Docs, changelogs and API references." },
] as const;
