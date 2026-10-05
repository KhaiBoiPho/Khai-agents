/**
 * Settings section registry — the dialog shell renders whatever is listed
 * here and owns no section knowledge of its own (the dsh composition rule,
 * sized for a single desktop app: an array, not a plugin slot system).
 * Adding a section is one entry + one component; the shell never changes.
 */

import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import {
  CircleGauge,
  CircleUserRound,
  Cpu,
  Plug,
  Puzzle,
  ScrollText,
  Settings as SettingsIcon,
  SquareStack,
} from "lucide-react";

import type {
  ConfigScope,
  JsonObject,
  Project,
  SettingsSnapshot,
  SkillInfo,
} from "../../generated/app-server";
import type { ClientRuntime } from "../../rpc/contracts";
import { SkillsPage } from "../extensions/SkillsPage";
import { McpPage } from "../mcp/McpPage";
import { GeneralSection } from "./sections/GeneralSection";
import { AccountSection, UsageSection } from "./sections/PreviewSections";
import { ModelsSection } from "./sections/ModelsSection";
import { PluginsSection } from "./sections/PluginsSection";
import { PresetsSection } from "./sections/PresetsSection";

export type SettingsSectionId =
  | "general"
  | "account"
  | "usage"
  | "agent-presets"
  | "models"
  | "skills"
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
  onCreateSkill?: (skill: SkillInfo) => Promise<void>;
}

export interface SettingsSection {
  id: SettingsSectionId;
  order: number;
  /** i18n key; `label` is the English source of truth (the defaultValue). */
  labelKey: string;
  label: string;
  icon: LucideIcon;
  component: ComponentType<SettingsSectionProps>;
  /** Rail heading the entry sits under. */
  group: "settings" | "customize";
  /** Full pages carry their own heading; the dialog adds none for them. */
  ownsTitle?: boolean;
}

function McpSection({ runtime, project }: SettingsSectionProps) {
  return <McpPage runtime={runtime} project={project} />;
}

function SkillsSection({ runtime, project, onCreateSkill }: SettingsSectionProps) {
  return (
    <SkillsPage
      runtime={runtime}
      project={project}
      onCreateSkill={onCreateSkill ?? (async () => undefined)}
    />
  );
}

// Grouped like a desktop settings window: app settings, then customization.
const SECTIONS: readonly SettingsSection[] = [
  {
    id: "general",
    order: 0,
    labelKey: "settings.section.general",
    label: "General",
    icon: SettingsIcon,
    component: GeneralSection,
    group: "settings",
  },
  {
    id: "account",
    order: 2,
    labelKey: "settings.section.account",
    label: "Account",
    icon: CircleUserRound,
    component: AccountSection,
    group: "settings",
  },
  {
    id: "usage",
    order: 4,
    labelKey: "settings.section.usage",
    label: "Usage",
    icon: CircleGauge,
    component: UsageSection,
    group: "settings",
  },
  {
    id: "agent-presets",
    order: 10,
    labelKey: "settings.section.agents",
    label: "Agents",
    icon: Cpu,
    component: PresetsSection,
    group: "settings",
  },
  {
    id: "models",
    order: 20,
    labelKey: "settings.section.providers",
    label: "Providers",
    icon: SquareStack,
    component: ModelsSection,
    group: "settings",
  },
  {
    id: "skills",
    order: 25,
    labelKey: "settings.section.skills",
    label: "Skills",
    icon: ScrollText,
    component: SkillsSection,
    group: "customize",
    ownsTitle: true,
  },
  {
    id: "mcp",
    order: 30,
    labelKey: "settings.section.mcp",
    label: "Connectors",
    icon: Plug,
    component: McpSection,
    group: "customize",
    ownsTitle: true,
  },
  {
    id: "plugins",
    order: 40,
    labelKey: "settings.section.plugins",
    label: "Plugins",
    icon: Puzzle,
    component: PluginsSection,
    group: "customize",
    ownsTitle: true,
  },
];

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [...SECTIONS].sort(
  (left, right) => left.order - right.order,
);
