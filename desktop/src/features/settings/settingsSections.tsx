/**
 * Settings section registry — the dialog shell renders whatever is listed
 * here and owns no section knowledge of its own (the dsh composition rule,
 * sized for a single desktop app: an array, not a plugin slot system).
 * Adding a section is one entry + one component; the shell never changes.
 */

import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BookOpenText,
  Brain,
  BriefcaseBusiness,
  CircleGauge,
  CircleUserRound,
  Code,
  Cpu,
  KeyRound,
  Monitor,
  Plug,
  Puzzle,
  ScrollText,
  Settings as SettingsIcon,
  Shield,
  ShieldCheck,
  Users,
} from "lucide-react";

import type {
  ConfigScope,
  JsonObject,
  Project,
  SettingsSnapshot,
  SkillInfo,
} from "../../generated/app-server";
import type { ClientRuntime } from "../../rpc/contracts";
import {
  AccountPage,
  CapabilitiesPage,
  MemoryPage,
  PrivacyPage,
  UsagePage,
} from "./pages/AccountPages";
import { DeveloperPage, SystemPage } from "./pages/ComputerPages";
import {
  AgentsPage,
  ConnectorsPage,
  PluginsSettingsPage,
  SkillsSettingsPage,
} from "./pages/CustomizePages";
import { GeneralPage } from "./pages/GeneralPage";
import { KhaiDocsSettingsPage } from "./pages/KhaiDocsSettingsPage";
import { ModelsSection } from "./sections/ModelsSection";
import { SecurityPage, UsersPage } from "./pages/UsersPages";

export type SettingsSectionId =
  | "general"
  | "account"
  | "security"
  | "users"
  | "privacy"
  | "usage"
  | "capabilities"
  | "memory"
  | "khaidocs"
  | "system"
  | "developer"
  | "agent-presets"
  | "skills"
  | "mcp"
  | "plugins"
  | "models";

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
  group: "settings" | "computer" | "customize" | "platform";
  /** Full pages carry their own heading; the dialog adds none for them. */
  ownsTitle?: boolean;
  /** Shown only when signed in to the hosted gateway. */
  requiresAccount?: boolean;
  /** Shown only to administrators. */
  adminOnly?: boolean;
}

// Grouped like a desktop settings window.
const SECTIONS: readonly SettingsSection[] = [
  {
    id: "security",
    order: 1.1,
    labelKey: "settings.section.security",
    label: "Sign-in & security",
    icon: ShieldCheck,
    component: SecurityPage,
    group: "settings",
    requiresAccount: true,
  },
  {
    id: "users",
    order: 1.2,
    labelKey: "settings.section.users",
    label: "Users",
    icon: Users,
    component: UsersPage,
    group: "settings",
    requiresAccount: true,
    adminOnly: true,
  },
  {
    id: "general",
    order: 0,
    labelKey: "settings.section.general",
    label: "General",
    icon: SettingsIcon,
    component: GeneralPage,
    group: "settings",
    ownsTitle: true,
  },
  {
    id: "account",
    order: 1,
    labelKey: "settings.section.account",
    label: "Account",
    icon: CircleUserRound,
    component: AccountPage,
    group: "settings",
    ownsTitle: true,
  },
  {
    id: "privacy",
    order: 2,
    labelKey: "settings.section.privacy",
    label: "Privacy",
    icon: Shield,
    component: PrivacyPage,
    group: "settings",
    ownsTitle: true,
  },
  {
    id: "usage",
    order: 3,
    labelKey: "settings.section.usage",
    label: "Usage",
    icon: CircleGauge,
    component: UsagePage,
    group: "settings",
    ownsTitle: true,
  },
  {
    id: "capabilities",
    order: 4,
    labelKey: "settings.section.capabilities",
    label: "Capabilities",
    icon: BriefcaseBusiness,
    component: CapabilitiesPage,
    group: "settings",
    ownsTitle: true,
  },
  {
    id: "memory",
    order: 5,
    labelKey: "settings.section.memory",
    label: "Memory",
    icon: Brain,
    component: MemoryPage,
    group: "settings",
    ownsTitle: true,
  },
  {
    id: "khaidocs",
    order: 6,
    labelKey: "settings.section.khaidocs",
    label: "KhaiDocs",
    icon: BookOpenText,
    component: KhaiDocsSettingsPage,
    group: "settings",
  },
  {
    id: "system",
    order: 10,
    labelKey: "settings.section.system",
    label: "System",
    icon: Monitor,
    component: SystemPage,
    group: "computer",
    ownsTitle: true,
  },
  {
    id: "developer",
    order: 11,
    labelKey: "settings.section.developer",
    label: "Developer",
    icon: Code,
    component: DeveloperPage,
    group: "computer",
    ownsTitle: true,
  },
  {
    id: "agent-presets",
    order: 20,
    labelKey: "settings.section.agents",
    label: "Agents",
    icon: Cpu,
    component: AgentsPage,
    group: "customize",
    ownsTitle: true,
  },
  {
    id: "skills",
    order: 21,
    labelKey: "settings.section.skills",
    label: "Skills",
    icon: ScrollText,
    component: SkillsSettingsPage,
    group: "customize",
    ownsTitle: true,
  },
  {
    id: "mcp",
    order: 22,
    labelKey: "settings.section.mcp",
    label: "Connectors",
    icon: Plug,
    component: ConnectorsPage,
    group: "customize",
    ownsTitle: true,
  },
  {
    id: "plugins",
    order: 23,
    labelKey: "settings.section.plugins",
    label: "Plugins",
    icon: Puzzle,
    component: PluginsSettingsPage,
    group: "customize",
    ownsTitle: true,
  },
  {
    id: "models",
    order: 30,
    labelKey: "settings.section.providers",
    label: "API keys",
    icon: KeyRound,
    component: ModelsSection,
    group: "platform",
  },
];

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [...SECTIONS].sort(
  (left, right) => left.order - right.order,
);
