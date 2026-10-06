import type { ExecutionAccessPreset } from "../../generated/app-server";

export type ComposerCommand =
  | { type: "new" }
  | { type: "init" }
  | { type: "paper" }
  | { type: "review" }
  | { type: "fork" }
  | { type: "rename"; title: string }
  | { type: "compact"; instructions: string | null }
  | { type: "model"; model: string | null }
  | { type: "permission"; accessPreset: ExecutionAccessPreset | null };

export interface CommandDefinition {
  name: string;
  usage: string;
  description: string;
}

export const commandDefinitions: CommandDefinition[] = [
  { name: "new", usage: "/new", description: "Create a code Session" },
  { name: "init", usage: "/init", description: "Write AGENTS.md describing this project" },
  { name: "paper", usage: "/paper", description: "Create a Paper2Code Session" },
  { name: "review", usage: "/review", description: "Open the Review workbench" },
  { name: "fork", usage: "/fork", description: "Fork into an isolated worktree" },
  { name: "rename", usage: "/rename ", description: "Rename this Session" },
  {
    name: "compact",
    usage: "/compact ",
    description: "Summarize older turns to free context (optional focus)",
  },
  { name: "model", usage: "/model ", description: "Set a model or use default" },
  {
    name: "permissions",
    usage: "/permissions ",
    description: "Set this Session's tool access",
  },
];

export type CommandParseResult =
  | { ok: true; command: ComposerCommand }
  | { ok: false; message: string };

function requireNoArgument(name: string, argument: string): CommandParseResult | null {
  return argument
    ? { ok: false, message: `/${name} does not accept an argument.` }
    : null;
}

export function parseComposerCommand(value: string): CommandParseResult | null {
  const input = value.trim();
  if (!input.startsWith("/")) return null;
  const separator = input.search(/\s/);
  const name = (
    separator === -1 ? input.slice(1) : input.slice(1, separator)
  ).toLocaleLowerCase();
  const argument = separator === -1 ? "" : input.slice(separator).trim();

  switch (name) {
    case "new":
    case "init":
    case "paper":
    case "review":
    case "fork": {
      const error = requireNoArgument(name, argument);
      return error ?? { ok: true, command: { type: name } };
    }
    case "compact":
      return {
        ok: true,
        command: { type: "compact", instructions: argument || null },
      };
    case "rename":
      return argument
        ? { ok: true, command: { type: "rename", title: argument } }
        : { ok: false, message: "Usage: /rename <Session title>" };
    case "model":
      return argument
        ? {
            ok: true,
            command: {
              type: "model",
              model: argument === "default" ? null : argument,
            },
          }
        : { ok: false, message: "Usage: /model <model id | default>" };
    case "permission":
    case "permissions": {
      const aliases: Record<string, ExecutionAccessPreset | null> = {
        ask: "ask",
        approval: "ask",
        "read-only": "read_only",
        read_only: "read_only",
        plan: "read_only",
        "full-access": "full_access",
        full_access: "full_access",
        inherit: null,
        default: null,
      };
      const key = argument.toLocaleLowerCase();
      return Object.hasOwn(aliases, key)
        ? {
            ok: true,
            command: { type: "permission", accessPreset: aliases[key] ?? null },
          }
        : {
            ok: false,
            message:
              "Usage: /permissions <ask | read-only | full-access | inherit>",
          };
    }
    default:
      return { ok: false, message: `Unknown command: /${name || "…"}` };
  }
}

export function matchingCommands(value: string): CommandDefinition[] {
  const input = value.trimStart();
  if (!input.startsWith("/") || input.includes("\n")) return [];
  const query = input.slice(1).split(/\s/, 1)[0].toLocaleLowerCase();
  return commandDefinitions.filter((definition) =>
    definition.name.startsWith(query),
  );
}

/**
 * `/init` prompt, adapted from OpenAI Codex's prompt_for_init_command.md
 * (github.com/openai/codex, Apache-2.0).
 */
export const INIT_PROMPT = `Generate a file named AGENTS.md that serves as a contributor and agent guide for this repository.
Before writing, check whether AGENTS.md already exists at the workspace root. If it does, do not overwrite or modify it; report that it exists and summarize what it covers instead.
Start by calling repo_map, then read the README, the build manifests and the main entry points so the guide is grounded in the actual code.

Document requirements:
- Title the document "Repository Guidelines" and use Markdown headings.
- Keep it concise: 200-400 words. Be short, direct and specific to this repository, with examples (commands, paths, naming patterns).

Recommended sections (omit those that do not apply, add others that do):
- Project Structure & Module Organization: where source, tests and assets live, and what the main modules do.
- Build, Test, and Development Commands: the key commands and what each does.
- Coding Style & Naming Conventions: formatting, linting tools, naming patterns.
- Testing Guidelines: frameworks, test naming, how to run tests.
- Commit & Pull Request Guidelines: conventions visible in the git history.
- Architecture Overview: how the main parts connect, if it helps a newcomer.`;
