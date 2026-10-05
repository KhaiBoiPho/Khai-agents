/**
 * Settings section registry — the dialog shell renders whatever is listed
 * here and owns no section knowledge of its own (the dsh composition rule,
 * sized for a single desktop app: an array, not a plugin slot system).
 * Adding a section is one entry + one component; the shell never changes.
 */

import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Cpu,
  Plug,
  Puzzle,
  Settings as SettingsIcon,
  SquareStack,
} from "lucide-react";

import type {
  ConfigScope,
  JsonObject,
  Project,
  SettingsSnapshot,
} from "../../generated/app-server";
import type { ClientRuntime } from "../../rpc/contracts";
import { McpPage } from "../mcp/McpPage";
import { GeneralSection } from "./sections/GeneralSection";
import { ModelsSection } from "./sections/ModelsSection";
import { PluginsSection } from "./sections/PluginsSection";
import { PresetsSection } from "./sections/PresetsSection";

export type SettingsSectionId =
  | "general"
  | "agent-presets"
  | "models"
  | "mcp"
  | "plugins";

/** Everything a section may need; each uses the subset it cares about. */
export interface SettingsSectionProps {
  runtime: ClientRuntime;
  project: Project | null;
  settings: SettingsSnapshot | null;
  busy: boolean;
  /** The dialog-level "write changes to" choice, already trust-checked. */
  scope: ConfigScope;
  onRefresh(): Promise<void>;
  onUpdate(
    patch: JsonObject,
    scope: ConfigScope,
    riskAcknowledged?: boolean,
  ): Promise<void>;
}

export interface SettingsSection {
  id: SettingsSectionId;
  order: number;
  /** i18n key; `label` is the English source of truth (the defaultValue). */
  labelKey: string;
  label: string;
  icon: LucideIcon;
  component: ComponentType<SettingsSectionProps>;
}

function McpSection({ runtime, project }: SettingsSectionProps) {
  return <McpPage runtime={runtime} project={project} />;
}

// Order and names follow cdesktop's settings rail.
const SECTIONS: readonly SettingsSection[] = [
  {
    id: "general",
    order: 0,
    labelKey: "settings.section.general",
    label: "General",
    icon: SettingsIcon,
    component: GeneralSection,
  },
  {
    id: "agent-presets",
    order: 10,
    labelKey: "settings.section.agents",
    label: "Agents",
    icon: Cpu,
    component: PresetsSection,
  },
  {
    id: "models",
    order: 20,
    labelKey: "settings.section.providers",
    label: "Providers",
    icon: SquareStack,
    component: ModelsSection,
  },
  {
    id: "mcp",
    order: 30,
    labelKey: "settings.section.mcp",
    label: "MCP Servers",
    icon: Plug,
    component: McpSection,
  },
  {
    id: "plugins",
    order: 40,
    labelKey: "settings.section.plugins",
    label: "Plugins",
    icon: Puzzle,
    component: PluginsSection,
  },
];

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [...SECTIONS].sort(
  (left, right) => left.order - right.order,
);
