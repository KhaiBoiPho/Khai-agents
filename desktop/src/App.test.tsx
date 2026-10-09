import {
  act,
  renderHook,
  waitFor,
} from "@testing-library/react";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  Approval,
  Automation,
  AutomationRun,
  DiagnosticsSnapshot,
  Event,
  ExecutionSecurityProfile,
  Goal,
  GoalOutcome,
  Item,
  JsonValue,
  MethodParams,
  MethodResults,
  Project,
  SettingsSnapshot,
  Thread,
  Turn,
} from "./generated/app-server";
import { useWorkspaceController } from "./app/useWorkspaceController";
import type {
  AnyRpcNotification,
  ClientRuntime,
  DesktopUpdateInfo,
  DesktopUpdateProgress,
  RpcMethod,
  SidecarStatus,
} from "./rpc/contracts";

const readyStatus: SidecarStatus = {
  phase: "ready",
  message: null,
  launchSource: "test",
  serverInfo: {
    protocolVersion: "1.0",
    serverInfo: { name: "deepcode-app-server", version: "test" },
    clientInfo: { name: "desktop-test", version: "test" },
    capabilities: {
      methods: [],
      eventReplay: true,
      liveEvents: true,
      maxMessageBytes: 1024 * 1024,
    },
  },
};

const askSecurityProfile: ExecutionSecurityProfile = {
  accessPreset: "ask",
  permissionMode: "default",
  commandSandbox: true,
  filesystemScope: "workspace",
  approvalPolicy: "on_request",
  permissionRules: [],
};

const fullAccessSecurityProfile: ExecutionSecurityProfile = {
  accessPreset: "full_access",
  permissionMode: "full_auto",
  commandSandbox: false,
  filesystemScope: "unrestricted",
  approvalPolicy: "never",
  permissionRules: [],
};

const readOnlySecurityProfile: ExecutionSecurityProfile = {
  accessPreset: "read_only",
  permissionMode: "plan",
  commandSandbox: true,
  filesystemScope: "workspace",
  approvalPolicy: "never",
  permissionRules: [],
};

const desktopSettings: SettingsSnapshot = {
  configPath: "/tmp/deepcode_config.json",
  configRevision: "rev-test-1",
  agents: {
    defaults: {
      model: "gpt-5",
    },
  },
  security: {
    permissionMode: "full_auto",
    permissions: {},
    sandbox: true,
  },
  permissionModeExplicit: false,
  userAccessPreset: null,
  projectAccessPreset: null,
  resolvedDefaultSecurityProfile: askSecurityProfile,
  resolvedDefaultSecuritySource: "built_in",
  providers: [
    {
      id: "openai",
      name: "openai",
      label: "OpenAI",
      configured: true,
      credentialSource: "environment",
      apiBase: null,
      local: false,
    },
  ],
  models: [
    {
      id: "gpt-5",
      contextWindow: 400000,
      maxOutputTokens: 128000,
      source: "catalog",
    },
    {
      id: "gpt-5-mini",
      contextWindow: 400000,
      maxOutputTokens: 128000,
      source: "catalog",
    },
  ],
};

const SKILL_ID = "sk_0123456789abcdef01234567";
const VERIFY_SKILL_ID = "sk_89abcdef0123456701234567";
const CREATOR_SKILL_ID = "sk_111111111111111111111111";
const SKILL_REVISION = `sha256:${"a".repeat(64)}`;
const CATALOG_REVISION = `sha256:${"b".repeat(64)}`;
const reviewSkill = {
  id: SKILL_ID,
  name: "review",
  description: "Review a change carefully",
  allowedTools: ["read", "grep"],
  scope: "project",
  sourceRoot: "agents",
  source: "project:agents",
  location: "project/.agents/skills/review",
  originKind: "local",
  originLabel: "project:agents",
  providerKind: "local",
  providerId: "local",
  packageId: SKILL_ID,
  status: "active",
  enabled: true,
  selectable: true,
  revision: SKILL_REVISION,
  byteSize: 137,
  shadowedBy: null,
  error: null,
  displayName: null,
  shortDescription: null,
  iconSmall: null,
  iconLarge: null,
  brandColor: null,
  defaultPrompt: null,
  allowImplicitInvocation: true,
  configurableScopes: ["project", "user"],
  deletable: true,
} as const;
const verifySkill = {
  ...reviewSkill,
  id: VERIFY_SKILL_ID,
  packageId: VERIFY_SKILL_ID,
  name: "verify",
  description: "Run the focused verification",
  allowedTools: ["bash"],
  revision: `sha256:${"c".repeat(64)}`,
  byteSize: 121,
  location: "project/.agents/skills/verify",
} as const;
const creatorSkill = {
  ...reviewSkill,
  id: CREATOR_SKILL_ID,
  name: "skill-creator",
  displayName: "Skill Creator",
  description: "Create reusable Agent Skills",
  shortDescription: "Create and validate reusable Agent Skills",
  scope: "system",
  sourceRoot: "system",
  source: "system:system",
  location: "system/bundled/skills/skill-creator",
  originKind: "bundled",
  originLabel: "DeepCode bundled",
  packageId: CREATOR_SKILL_ID,
  revision: `sha256:${"d".repeat(64)}`,
  defaultPrompt:
    "Use $skill-creator to create a focused reusable Skill for this project.",
  deletable: false,
} as const;

const diagnostics: DiagnosticsSnapshot = {
  appVersion: "1.2.0",
  pythonVersion: "3.12.9",
  pythonExecutable: "/usr/bin/python3",
  platform: "macOS-15",
  architecture: "arm64",
  processId: 1234,
  databasePath: "/tmp/deepcode.sqlite3",
  databaseSchemaVersion: 5,
  databaseBytes: 4096,
  sessionStorePath: "/tmp/sessions",
  sessionCount: 4,
  projectCount: 1,
  threadCount: 2,
  workflowCount: 0,
  automationCount: 1,
  userConfigPath: "/tmp/deepcode_config.json",
  projectConfigPath: "/workspace/deepcode/deepcode_config.json",
  projectPath: "/workspace/deepcode",
  projectTrust: "trusted",
  configError: null,
  checks: [
    {
      id: "database",
      label: "Desktop database",
      status: "ok",
      detail: "SQLite integrity check passed",
    },
  ],
};

class TestRuntime implements ClientRuntime {
  readonly notifications = new Set<(notification: AnyRpcNotification) => void>();
  readonly statuses = new Set<(status: SidecarStatus) => void>();
  readonly calls: string[] = [];
  readonly requests: Array<{ method: string; params: unknown }> = [];
  readonly diagnosticsExports: DiagnosticsSnapshot[] = [];
  readonly openedPaths: string[] = [];
  updateInstallCount = 0;
  private readonly threadState: Thread[];
  private settingsState: SettingsSnapshot = {
    ...desktopSettings,
    agents: { ...desktopSettings.agents },
    security: { ...desktopSettings.security },
    providers: desktopSettings.providers.map((provider) => ({ ...provider })),
    models: desktopSettings.models.map((model) => ({ ...model })),
  };
  private automationStatus: Automation["status"] = "enabled";
  private goalState: Goal | null;
  private goalOutcomeState: GoalOutcome | null;
  private readonly disabledSkillIds = new Set<string>();
  private readonly deletedSkillIds = new Set<string>();

  constructor(
    private readonly projects: Project[] = [],
    threads: Thread[] = [],
    private readonly events: Event[] = [],
    private readonly contextFiles: string[] = [],
    private readonly availableUpdate: DesktopUpdateInfo | null = null,
    initialGoal: Goal | null = null,
    initialGoalOutcome: GoalOutcome | null = null,
  ) {
    this.threadState = threads.map((candidate) => ({ ...candidate }));
    this.goalState = initialGoal;
    this.goalOutcomeState = initialGoalOutcome;
  }

  readonly presetState = new Map<string, string>();

  async request<M extends RpcMethod>(
    method: M,
    params: MethodParams[M],
  ): Promise<MethodResults[M]> {
    void params;
    this.calls.push(method);
    this.requests.push({ method, params });
    switch (method) {
      case "provider/list":
        return {
          connections: [
            {
              id: "openai",
              label: "OpenAI",
              providerName: "openai",
              adapter: "openai_compat",
              apiBase: "https://api.openai.com/v1",
              apiKeyEnv: "OPENAI_API_KEY",
              modelCatalog: "openai",
              manualModels: [],
              manualModelEntries: [],
              configured: true,
              credentialSource: "environment",
              local: false,
              enabled: true,
              explicit: false,
            },
            {
              id: "anthropic",
              label: "Anthropic",
              providerName: "anthropic",
              adapter: "anthropic",
              apiBase: "https://api.anthropic.com",
              apiKeyEnv: "ANTHROPIC_API_KEY",
              modelCatalog: "anthropic",
              manualModels: [],
              manualModelEntries: [],
              configured: false,
              credentialSource: "missing",
              local: false,
              enabled: true,
              explicit: false,
            },
          ],
          templates: [
            {
              name: "openai",
              label: "OpenAI",
              adapter: "openai_compat",
              defaultApiBase: "https://api.openai.com/v1",
              apiKeyEnv: "OPENAI_API_KEY",
              requiresApiBase: false,
              local: false,
            },
            {
              name: "openrouter",
              label: "OpenRouter",
              adapter: "openai_compat",
              defaultApiBase: "https://openrouter.ai/api/v1",
              apiKeyEnv: "OPENROUTER_API_KEY",
              requiresApiBase: false,
              local: false,
            },
            {
              name: "anthropic",
              label: "Anthropic",
              adapter: "anthropic",
              defaultApiBase: "https://api.anthropic.com",
              apiKeyEnv: "ANTHROPIC_API_KEY",
              requiresApiBase: false,
              local: false,
            },
          ],
          configPath: "/tmp/deepcode_config.json",
          credentialPath: "/tmp/credentials.json",
        } as unknown as MethodResults[M];
      case "model/list": {
        const request = params as MethodParams["model/list"];
        return {
          connectionId: request.connectionId,
          models: desktopSettings.models.map((model) => ({
            id: model.id,
            name: model.id,
            contextWindow: model.contextWindow,
            maxOutputTokens: model.maxOutputTokens,
            supportedParameters: [],
            reasoning: {
              supportedEfforts: ["low", "medium", "high"],
              defaultEffort: "medium",
              defaultEnabled: true,
              mandatory: false,
              supportsSummary: true,
            },
          })),
          source: "test",
          stale: false,
          error: null,
          refreshedAt: 1_768_000_000,
        } as unknown as MethodResults[M];
      }
      case "provider/discover":
        return {
          models: desktopSettings.models.map((model) => ({
            id: model.id,
            name: model.id,
            contextWindow: model.contextWindow,
            maxOutputTokens: model.maxOutputTokens,
            supportedParameters: [],
            reasoning: null,
          })),
          error: null,
        } as unknown as MethodResults[M];
      case "provider/upsert": {
        const request = params as MethodParams["provider/upsert"];
        const connection = request.connection;
        return {
          connections: [
            {
              id: "openai",
              label: "OpenAI",
              providerName: "openai",
              adapter: "openai_compat",
              apiBase: "https://api.openai.com/v1",
              apiKeyEnv: "OPENAI_API_KEY",
              modelCatalog: "openai",
              manualModels: [],
              manualModelEntries: [],
              configured: true,
              credentialSource: "environment",
              local: false,
              enabled: true,
              explicit: false,
            },
            {
              id: connection.id,
              label: connection.label ?? connection.id,
              providerName: connection.template ?? "custom",
              adapter: connection.adapter ?? "openai_compat",
              apiBase: connection.apiBase ?? null,
              apiKeyEnv: connection.apiKeyEnv ?? null,
              modelCatalog:
                connection.modelCatalog === "auto" ||
                connection.modelCatalog === undefined
                  ? "openrouter"
                  : connection.modelCatalog,
              manualModels: connection.manualModels ?? [],
              configured: Boolean(connection.apiKey || connection.apiKeyEnv),
              credentialSource: connection.apiKey
                ? "credential_store"
                : "environment",
              local: false,
              enabled: connection.enabled ?? true,
              explicit: true,
            },
          ],
          templates: [],
          configPath: "/tmp/deepcode_config.json",
          credentialPath: "/tmp/credentials.json",
        } as unknown as MethodResults[M];
      }
      case "provider/test": {
        const request = params as MethodParams["provider/test"];
        return {
          connectionId: request.connectionId,
          status: request.model ? "ready" : "connected",
          ok: true,
          latencyMs: 42,
          modelCount: 2,
          error: null,
          stages: [
            {
              id: "credential",
              status: "passed",
              detail: "Credential loaded from DeepCode private storage",
              latencyMs: null,
              modelCount: null,
              modelId: null,
            },
            {
              id: "catalog",
              status: "passed",
              detail: "Discovered 2 models",
              latencyMs: 12,
              modelCount: 2,
              modelId: null,
            },
            {
              id: "model",
              status: request.model ? "passed" : "not_run",
              detail: request.model
                ? "The provider accepted a real inference request"
                : "Choose a model to run a minimal verification request",
              latencyMs: request.model ? 30 : null,
              modelCount: null,
              modelId: request.model ?? null,
            },
          ],
        } as unknown as MethodResults[M];
      }
      case "provider/remove":
        return {
          removed: true,
          connections: [],
          templates: [],
          configPath: "/tmp/deepcode_config.json",
          credentialPath: "/tmp/credentials.json",
        } as unknown as MethodResults[M];
      case "project/list":
        return { projects: this.projects } as MethodResults[M];
      case "project/update": {
        const request = params as MethodParams["project/update"];
        const index = this.projects.findIndex(
          (candidate) => candidate.id === request.projectId,
        );
        if (index === -1) {
          throw new Error(`Missing test project: ${request.projectId}`);
        }
        this.projects[index] = {
          ...this.projects[index],
          ...(request.displayName ? { displayName: request.displayName } : {}),
          ...(request.trustState ? { trustState: request.trustState } : {}),
        };
        return { project: this.projects[index] } as MethodResults[M];
      }
      case "settings/read":
        return { settings: this.settingsState } as MethodResults[M];
      case "settings/update": {
        const request = params as MethodParams["settings/update"];
        const security = request.patch.security;
        const accessPreset =
          typeof security === "object" &&
          security !== null &&
          !Array.isArray(security) &&
          Object.hasOwn(security, "accessPreset")
            ? security.accessPreset
            : undefined;
        const updatesPermissionMode =
          typeof security === "object" &&
          security !== null &&
          !Array.isArray(security) &&
          Object.hasOwn(security, "permissionMode");
        this.settingsState = {
          ...this.settingsState,
          security:
            typeof security === "object" &&
            security !== null &&
            !Array.isArray(security)
              ? { ...this.settingsState.security, ...security }
              : this.settingsState.security,
          permissionModeExplicit:
            this.settingsState.permissionModeExplicit || updatesPermissionMode,
          ...(accessPreset !== undefined
            ? {
                [request.scope === "project"
                  ? "projectAccessPreset"
                  : "userAccessPreset"]:
                  accessPreset === "ask" ||
                  accessPreset === "read_only" ||
                  accessPreset === "full_access"
                    ? accessPreset
                    : null,
                resolvedDefaultSecurityProfile:
                  accessPreset === "full_access"
                    ? fullAccessSecurityProfile
                    : accessPreset === "read_only"
                      ? readOnlySecurityProfile
                      : askSecurityProfile,
                resolvedDefaultSecuritySource:
                  request.scope === "project" ? "project" : "user",
              }
            : {}),
        };
        return { settings: this.settingsState } as MethodResults[M];
      }
      case "preset/list":
        return {
          presets: [
            {
              id: "code-reader",
              trust: "system",
              name: "Code reader",
              description: "Read-only investigator",
              tools: ["read", "grep", "glob", "skill"],
              broken: null,
            },
            {
              id: "damaged",
              trust: "project",
              name: "damaged",
              description: "",
              tools: null,
              broken: "missing YAML frontmatter block",
            },
          ],
        } as unknown as MethodResults[M];
      case "preset/current": {
        const request = params as MethodParams["preset/current"];
        return {
          agentPreset: this.presetState.get(request.threadId) ?? null,
        } as MethodResults[M];
      }
      case "preset/select": {
        const request = params as MethodParams["preset/select"];
        if (request.agentPreset === null) {
          this.presetState.delete(request.threadId);
        } else {
          this.presetState.set(request.threadId, request.agentPreset);
        }
        return { agentPreset: request.agentPreset } as MethodResults[M];
      }
      case "skills/list":
        return this.skillCatalog() as unknown as MethodResults[M];
      case "skill/read": {
        const request = params as MethodParams["skill/read"];
        const skill =
          [reviewSkill, verifySkill, creatorSkill].find(
            (candidate) =>
              candidate.id === request.skillId ||
              candidate.name === request.name,
          ) ?? reviewSkill;
        return {
          skill: {
            ...skill,
            ...(this.disabledSkillIds.has(skill.id)
              ? {
                  status: "disabled" as const,
                  enabled: false,
                  selectable: false,
                }
              : {}),
            instructions:
              "Inspect the change and report **concrete evidence**.",
            truncated: false,
          },
        } as unknown as MethodResults[M];
      }
      case "skills/set-enabled": {
        const request = params as MethodParams["skills/set-enabled"];
        if (request.enabled) {
          this.disabledSkillIds.delete(request.skillId);
        } else {
          this.disabledSkillIds.add(request.skillId);
        }
        return this.skillCatalog() as unknown as MethodResults[M];
      }
      case "skills/delete": {
        const request = params as MethodParams["skills/delete"];
        this.deletedSkillIds.add(request.skillId);
        return { removed: true } as MethodResults[M];
      }
      case "skills/reload":
        return this.skillCatalog() as unknown as MethodResults[M];
      case "plugins/list":
        return {
          plugins: [],
          diagnostics: [],
          revision: `sha256:${"0".repeat(64)}`,
        } as unknown as MethodResults[M];
      case "mcp/list":
        return {
          servers: [],
          userConfigPath: "/tmp/deepcode_config.json",
          projectConfigPath: "/workspace/deepcode/deepcode_config.json",
        } as unknown as MethodResults[M];
      case "diagnostics/read":
        return { diagnostics } as MethodResults[M];
      case "automation/list":
        return {
          automations: [{ ...automation, status: this.automationStatus }],
          latestRuns: [automationRun],
          schedulerActive: true,
          executionMode: "requires_live_runtime",
          hasMore: false,
          nextOffset: null,
        } as unknown as MethodResults[M];
      case "automation/create":
        return {
          automation,
          thread: goalThread,
        } as unknown as MethodResults[M];
      case "automation/update": {
        const request = params as MethodParams["automation/update"];
        if (request.status) this.automationStatus = request.status;
        return {
          automation: {
            ...automation,
            status: this.automationStatus,
          },
        } as unknown as MethodResults[M];
      }
      case "automation/remove":
        return { removed: true } as MethodResults[M];
      case "automation/run":
        return {
          run: { ...automationRun, status: "queued", completedAt: null },
          turn: {
            ...turn,
            id: "turn-automation",
            threadId: goalThread.id,
            status: "queued",
            prompt: automation.prompt,
            completedAt: null,
            stopReason: null,
          },
        } as unknown as MethodResults[M];
      case "automation/runs":
        return {
          runs: [automationRun],
          hasMore: false,
          nextOffset: null,
        } as unknown as MethodResults[M];
      case "thread/list":
        return {
          threads: this.threadState.filter(
            (candidate) => candidate.status !== "archived",
          ),
        } as MethodResults[M];
      case "thread/start": {
        const request = params as MethodParams["thread/start"];
        const created = {
          ...thread,
          id: `thread-created-${this.threadState.length + 1}`,
          projectId: request.projectId,
          workspacePath:
            this.projects.find(
              (candidate) => candidate.id === request.projectId,
            )?.canonicalPath ?? thread.workspacePath,
          title: request.title,
          mode: request.mode ?? "code",
        };
        this.threadState.push(created);
        return { thread: created } as MethodResults[M];
      }
      case "thread/resume": {
        const sessionId = (params as MethodParams["thread/resume"]).sessionId;
        const resumed = this.threadState.find(
          (candidate) => candidate.id === sessionId,
        );
        if (!resumed) throw new Error(`Missing test thread: ${sessionId}`);
        return { thread: resumed } as MethodResults[M];
      }
      case "thread/rename": {
        const request = params as MethodParams["thread/rename"];
        const index = this.threadState.findIndex(
          (candidate) => candidate.id === request.threadId,
        );
        if (index === -1)
          throw new Error(`Missing test thread: ${request.threadId}`);
        this.threadState[index] = {
          ...this.threadState[index],
          title: request.title,
        };
        return { thread: this.threadState[index] } as MethodResults[M];
      }
      case "thread/model": {
        const request = params as MethodParams["thread/model"];
        const index = this.threadState.findIndex(
          (candidate) => candidate.id === request.threadId,
        );
        if (index === -1)
          throw new Error(`Missing test thread: ${request.threadId}`);
        this.threadState[index] = {
          ...this.threadState[index],
          connectionId:
            request.connectionId === undefined
              ? this.threadState[index].connectionId
              : request.connectionId,
          model: request.model,
        };
        return { thread: this.threadState[index] } as MethodResults[M];
      }
      case "thread/execution/update": {
        const request = params as MethodParams["thread/execution/update"];
        const index = this.threadState.findIndex(
          (candidate) => candidate.id === request.threadId,
        );
        if (index === -1)
          throw new Error(`Missing test thread: ${request.threadId}`);
        this.threadState[index] = {
          ...this.threadState[index],
          connectionId: request.connectionId,
          model: request.model,
          reasoningEffort: request.reasoningEffort,
          contextWindow:
            request.contextWindow === undefined
              ? this.threadState[index].contextWindow
              : request.contextWindow,
        };
        return { thread: this.threadState[index] } as MethodResults[M];
      }
      case "thread/permission/update": {
        const request = params as MethodParams["thread/permission/update"];
        const index = this.threadState.findIndex(
          (candidate) => candidate.id === request.threadId,
        );
        if (index === -1)
          throw new Error(`Missing test thread: ${request.threadId}`);
        this.threadState[index] = {
          ...this.threadState[index],
          accessPresetOverride: request.accessPreset,
        };
        return { thread: this.threadState[index] } as MethodResults[M];
      }
      case "thread/goal/get":
        return {
          goal: this.goalState,
          outcome: this.goalOutcomeState,
        } as MethodResults[M];
      case "thread/goal/set": {
        const request = params as MethodParams["thread/goal/set"];
        const now = "2026-07-16T02:00:00Z";
        this.goalState = {
          id: this.goalState?.id ?? "goal-desktop",
          threadId: request.threadId,
          objective: request.objective ?? this.goalState?.objective ?? "Goal",
          status: this.goalState?.status ?? "active",
          tokenBudget:
            request.tokenBudget !== undefined
              ? request.tokenBudget
              : (this.goalState?.tokenBudget ?? null),
          tokensUsed: this.goalState?.tokensUsed ?? 0,
          timeUsedSeconds: this.goalState?.timeUsedSeconds ?? 0,
          skillIds: request.skills ?? this.goalState?.skillIds ?? [],
          createdAt: this.goalState?.createdAt ?? now,
          updatedAt: now,
        } as Goal;
        return {
          goal: this.goalState,
          outcome: this.goalOutcomeState,
        } as MethodResults[M];
      }
      case "thread/goal/pause":
      case "thread/goal/resume": {
        if (!this.goalState) {
          throw new Error("Missing test Goal");
        }
        this.goalState = {
          ...this.goalState,
          status: method === "thread/goal/pause" ? "paused" : "active",
          updatedAt: "2026-07-16T02:01:00Z",
        };
        this.goalOutcomeState = null;
        return {
          goal: this.goalState,
          outcome: this.goalOutcomeState,
        } as MethodResults[M];
      }
      case "thread/goal/continue": {
        if (!this.goalState) {
          throw new Error("No Goal");
        }
        return {
          goal: this.goalState,
          disposition: "started",
          turnId: "turn-goal-continuation",
          outcome: this.goalOutcomeState,
        } as MethodResults[M];
      }
      case "thread/goal/clear":
        this.goalState = null;
        this.goalOutcomeState = null;
        return { goal: null, outcome: null } as MethodResults[M];
      case "thread/archive": {
        const request = params as MethodParams["thread/archive"];
        const index = this.threadState.findIndex(
          (candidate) => candidate.id === request.threadId,
        );
        if (index === -1)
          throw new Error(`Missing test thread: ${request.threadId}`);
        this.threadState[index] = {
          ...this.threadState[index],
          status: "archived",
          archivedAt: "2026-07-16T02:00:00Z",
        };
        return { thread: this.threadState[index] } as MethodResults[M];
      }
      case "thread/delete": {
        const request = params as MethodParams["thread/delete"];
        const index = this.threadState.findIndex(
          (candidate) => candidate.id === request.threadId,
        );
        if (index === -1)
          throw new Error(`Missing test thread: ${request.threadId}`);
        this.threadState.splice(index, 1);
        return {
          threadId: request.threadId,
          cleanupPending: false,
        } as MethodResults[M];
      }
      case "turn/start": {
        const request = params as MethodParams["turn/start"];
        const startedTurn: Turn = {
          id: "turn-retry",
          threadId: request.threadId,
          ordinal: 2,
          prompt: request.prompt,
          skillIds: request.skills,
          status: "queued",
          stopReason: null,
          errorCode: null,
          errorMessage: null,
          startedAt: null,
          completedAt: null,
        };
        const userItem: Item = {
          id: "item-retry-user",
          threadId: request.threadId,
          turnId: startedTurn.id,
          ordinal: 1,
          kind: "user_message",
          status: "completed",
          summary: request.prompt,
          payload: {
            text: request.prompt,
            skillIds: request.skills ?? [],
            skills: (request.skills ?? []).map((skillId) => ({
              skillId,
              name:
                skillId === SKILL_ID
                  ? reviewSkill.name
                  : skillId === VERIFY_SKILL_ID
                    ? verifySkill.name
                    : skillId,
              revision: SKILL_REVISION,
              invocation: "explicit",
            })),
          },
          createdAt: "2026-07-16T02:00:00Z",
          updatedAt: "2026-07-16T02:00:00Z",
        };
        return {
          turn: startedTurn,
          items: [userItem],
          approvals: [],
        } as unknown as MethodResults[M];
      }
      case "turn/enqueue": {
        const request = params as MethodParams["turn/enqueue"];
        const queuedTurn: Turn = {
          id: "turn-queued",
          threadId: request.threadId,
          ordinal: 2,
          prompt: request.prompt,
          skillIds: request.skills,
          status: "queued",
          stopReason: null,
          errorCode: null,
          errorMessage: null,
          startedAt: null,
          completedAt: null,
        };
        const userItem: Item = {
          id: "item-queued-user",
          threadId: request.threadId,
          turnId: queuedTurn.id,
          ordinal: 1,
          kind: "user_message",
          status: "completed",
          summary: request.prompt,
          payload: {
            text: request.prompt,
            skillIds: request.skills ?? [],
            skills: (request.skills ?? []).map((skillId) => ({
              skillId,
              name:
                skillId === SKILL_ID
                  ? reviewSkill.name
                  : skillId === VERIFY_SKILL_ID
                    ? verifySkill.name
                    : skillId,
              revision: SKILL_REVISION,
              invocation: "explicit",
            })),
          },
          createdAt: "2026-07-16T02:00:00Z",
          updatedAt: "2026-07-16T02:00:00Z",
        };
        return {
          turn: queuedTurn,
          items: [userItem],
          approvals: [],
        } as unknown as MethodResults[M];
      }
      case "turn/steer": {
        const request = params as MethodParams["turn/steer"];
        return {
          messageId: request.messageId ?? "desktop-steer",
          delivery: "current_turn",
          duplicate: false,
          turn: runningTurn,
        } as MethodResults[M];
      }
      case "turn/retry": {
        const request = params as MethodParams["turn/retry"];
        return {
          turn: {
            ...failedTurn,
            id: "turn-retry",
            ordinal: failedTurn.ordinal + 1,
            status: "queued",
            stopReason: null,
            errorCode: null,
            errorMessage: null,
            startedAt: null,
            completedAt: null,
          },
          items: [],
          approvals: [],
          originalTurnId: request.turnId,
        } as unknown as MethodResults[M];
      }
      case "turn/interrupt": {
        const request = params as MethodParams["turn/interrupt"];
        const interrupted: Turn = {
          id: request.turnId,
          threadId: thread.id,
          ordinal: request.turnId === "turn-queued" ? 2 : 1,
          prompt: request.turnId === "turn-queued" ? "queued" : "active",
          status: "interrupted",
          stopReason: "interrupted",
          errorCode: null,
          errorMessage: null,
          startedAt: null,
          completedAt: "2026-07-16T02:00:01Z",
        };
        return {
          accepted: true,
          turn: interrupted,
        } as unknown as MethodResults[M];
      }
      case "approval/respond": {
        const request = params as MethodParams["approval/respond"];
        return {
          approval: {
            ...pendingApproval,
            status: request.decision,
            decision: { status: request.decision },
            resolvedAt: "2026-07-16T02:00:00Z",
          },
        } as unknown as MethodResults[M];
      }
      case "event/replay": {
        const { threadId, after = 0, through, limit = 500 } = params as MethodParams["event/replay"];
        const history = this.events.filter((event) => event.threadId === threadId);
        const headSequence = Math.min(through ?? Infinity, history.at(-1)?.sequence ?? 0);
        const remaining = history.filter((event) => event.sequence > after && event.sequence <= headSequence);
        const events = remaining.slice(0, limit);
        return {
          events,
          nextAfter: remaining.length > limit ? events.at(-1)!.sequence : null,
          hasMore: remaining.length > limit,
          headSequence,
        } as MethodResults[M];
      }
      case "file/list":
        return { entries: [], truncated: false } as unknown as MethodResults[M];
      case "git/status":
        return {
          status: {
            repositoryRoot: "/workspace/deepcode",
            branch: null,
            upstream: null,
            ahead: 0,
            behind: 0,
            detached: false,
            entries: [],
          },
        } as unknown as MethodResults[M];
      case "git/diff":
        return { files: [] } as unknown as MethodResults[M];
      case "test/discover":
        return { commands: [] } as unknown as MethodResults[M];
      default:
        throw new Error(`Unexpected test RPC method: ${method}`);
    }
  }

  async status() {
    return readyStatus;
  }

  async restart() {
    return readyStatus;
  }

  async pickDirectory() {
    return null;
  }

  async pickFile() {
    return null;
  }

  async pickContextFiles() {
    return [...this.contextFiles];
  }

  async exportDiagnostics(snapshot: DiagnosticsSnapshot) {
    this.diagnosticsExports.push(snapshot);
    return "/tmp/deepcode-diagnostics-test.json";
  }

  async openPath(path: string) {
    this.openedPaths.push(path);
  }

  async checkForUpdate() {
    return this.availableUpdate;
  }

  async installUpdate(listener: (progress: DesktopUpdateProgress) => void) {
    this.updateInstallCount += 1;
    listener({
      phase: "finished",
      downloadedBytes: 100,
      totalBytes: 100,
    });
  }

  async onNotification(listener: (notification: AnyRpcNotification) => void) {
    this.notifications.add(listener);
    return () => { this.notifications.delete(listener); };
  }

  async onStatus(listener: (status: SidecarStatus) => void) {
    this.statuses.add(listener);
    return () => { this.statuses.delete(listener); };
  }

  async onLog(listener: (message: string) => void) {
    void listener;
    return () => undefined;
  }

  private skillCatalog() {
    return {
      skills: [reviewSkill, verifySkill, creatorSkill]
        .filter((skill) => !this.deletedSkillIds.has(skill.id))
        .map((skill) =>
          this.disabledSkillIds.has(skill.id)
            ? {
                ...skill,
                status: "disabled" as const,
                enabled: false,
                selectable: false,
              }
            : skill,
        ),
      warnings: [],
      catalogRevision: CATALOG_REVISION,
      authoringSkillId: CREATOR_SKILL_ID,
    };
  }
}

const project: Project = {
  id: "project-1",
  canonicalPath: "/workspace/deepcode",
  displayName: "DeepCode",
  trustState: "trusted",
  settings: {},
  createdAt: "2026-07-16T00:00:00Z",
  updatedAt: "2026-07-16T00:00:00Z",
  lastOpenedAt: "2026-07-16T00:00:00Z",
};

const thread: Thread = {
  id: "thread-1",
  projectId: project.id,
  parentThreadId: null,
  title: "Recovered task",
  mode: "code",
  status: "idle",
  model: null,
  connectionId: null,
  reasoningEffort: null,
  contextWindow: null,
  accessPresetOverride: null,
  workspacePath: project.canonicalPath,
  worktreePath: null,
  createdAt: "2026-07-16T00:00:00Z",
  updatedAt: "2026-07-16T00:00:00Z",
  archivedAt: null,
};

const goalThread: Thread = {
  ...thread,
  id: "thread-goal",
  title: "Repository caretaker",
  mode: "goal",
};

const automation: Automation = {
  id: "auto-test",
  projectId: project.id,
  threadId: goalThread.id,
  name: "Repository caretaker",
  currentRevisionId: "arev-test",
  prompt: "Review and maintain the repository",
  status: "enabled",
  scheduleKind: "interval",
  intervalSeconds: 3600,
  nextRunAt: "2026-07-16T03:00:00Z",
  lastRunAt: "2026-07-16T02:00:00Z",
  createdAt: "2026-07-16T00:00:00Z",
  updatedAt: "2026-07-16T02:00:00Z",
};

const automationRun: AutomationRun = {
  id: "arun-test",
  automationId: automation.id,
  revisionId: automation.currentRevisionId,
  occurrenceId: "aocc-test",
  goalId: "goal-automation",
  threadId: goalThread.id,
  turnId: "turn-automation",
  trigger: "scheduled",
  status: "completed",
  scheduledFor: "2026-07-16T02:00:00Z",
  detail: "completed",
  createdAt: "2026-07-16T02:00:00Z",
  updatedAt: "2026-07-16T02:00:05Z",
  startedAt: "2026-07-16T02:00:01Z",
  completedAt: "2026-07-16T02:00:05Z",
};

const turn: Turn = {
  id: "turn-1",
  threadId: thread.id,
  ordinal: 1,
  prompt: "Inspect the repository",
  status: "completed",
  stopReason: "completed",
  errorCode: null,
  errorMessage: null,
  startedAt: "2026-07-16T00:00:01Z",
  completedAt: "2026-07-16T00:00:03Z",
};

const failedTurn: Turn = {
  ...turn,
  status: "interrupted",
  stopReason: "application_restarted",
  completedAt: "2026-07-16T00:00:04Z",
};

const runningTurn: Turn = {
  ...turn,
  status: "running",
  stopReason: null,
  completedAt: null,
};

const pendingApproval: Approval = {
  id: "apr-1",
  threadId: thread.id,
  turnId: turn.id,
  itemId: "item-approval",
  category: "command",
  status: "pending",
  request: {
    toolName: "execute_bash",
    arguments: { command: "pytest -q" },
    reason: "Run the project test suite.",
  },
  decision: null,
  requestedAt: "2026-07-16T00:00:02Z",
  resolvedAt: null,
};

const recoveryEvents: Event[] = [
  {
    eventId: "event-1",
    sequence: 1,
    type: "turn.completed",
    threadId: thread.id,
    turnId: turn.id,
    itemId: null,
    timestamp: "2026-07-16T00:00:03Z",
    payload: { turn: turn as unknown as JsonValue },
  },
  {
    eventId: "event-2",
    sequence: 2,
    type: "item.created",
    threadId: thread.id,
    turnId: turn.id,
    itemId: "item-1",
    timestamp: "2026-07-16T00:00:02Z",
    payload: {
      item: {
        id: "item-1",
        threadId: thread.id,
        turnId: turn.id,
        ordinal: 1,
        kind: "assistant_message",
        status: "completed",
        summary: "Recovered final answer",
        payload: { text: "Recovered final answer", streaming: false },
        createdAt: "2026-07-16T00:00:02Z",
        updatedAt: "2026-07-16T00:00:02Z",
      },
    },
  },
];

function liveDelta(sequence: number, delta: string): Event {
  return {
    ...recoveryEvents[1],
    eventId: `event-${sequence}`,
    sequence,
    type: "item.delta",
    payload: { delta },
  };
}

describe("workspace event recovery", () => {
  it("repairs skipped deltas and a dropped approval without resetting the selected item", async () => {
    const events = [...recoveryEvents];
    const runtime = new TestRuntime([project], [thread], events);
    const { result } = renderHook(() => useWorkspaceController(runtime));
    await waitFor(() => expect(result.current.state.items).toHaveLength(1));
    act(() => result.current.selectItem("item-1"));
    events.push(liveDelta(3, " A"), liveDelta(4, "B"));
    act(() =>
      runtime.notifications.forEach((receive) =>
        receive({ jsonrpc: "2.0", method: "item.delta", params: events[3] }),
      ),
    );
    await waitFor(() =>
      expect(result.current.state.items[0].payload.text).toBe(
        "Recovered final answer AB",
      ),
    );
    expect(result.current.state.selectedItemId).toBe("item-1");
    const approval = {
      ...recoveryEvents[0],
      eventId: "event-5",
      sequence: 5,
      type: "approval.requested",
      payload: { approval: pendingApproval as unknown as JsonValue },
    };
    events.push(approval);
    act(() =>
      runtime.notifications.forEach((receive) =>
        receive({
          jsonrpc: "2.0",
          method: "server.warning",
          params: {
            code: "EVENT_QUEUE_OVERFLOW",
            dropped: 1,
            replayRequired: true,
          },
        }),
      ),
    );
    await waitFor(() => expect(result.current.state.approvals).toHaveLength(1));
    expect(result.current.state.selectedItemId).toBe("item-1");
    const replayRequests = runtime.requests.filter(
      (request) => request.method === "event/replay",
    );
    expect(
      replayRequests.map(
        (request) => (request.params as MethodParams["event/replay"]).after,
      ),
    ).toEqual([0, 2, 4]);
  });

  it("holds a newer live delta until its replayed base exists", async () => {
    const events = [...recoveryEvents];
    const runtime = new TestRuntime([project], [thread], events);
    const original = runtime.request.bind(runtime);
    let resolve!: (value: MethodResults["event/replay"]) => void;
    const first = new Promise<MethodResults["event/replay"]>((yes) => {
      resolve = yes;
    });
    let paused = false;
    vi.spyOn(runtime, "request").mockImplementation(async (method, params) => {
      if (method === "event/replay" && !paused) {
        paused = true;
        return first as Promise<MethodResults[typeof method]>;
      }
      return original(method, params);
    });
    const { result } = renderHook(() => useWorkspaceController(runtime));
    await waitFor(() => expect(paused).toBe(true));
    const delta = liveDelta(3, " appended once");
    events.push(delta);
    act(() =>
      runtime.notifications.forEach((receive) =>
        receive({ jsonrpc: "2.0", method: "item.delta", params: delta }),
      ),
    );
    expect(result.current.state.items).toHaveLength(0);
    await act(async () =>
      resolve({
        events: recoveryEvents,
        nextAfter: null,
        hasMore: false,
        headSequence: 2,
      }),
    );
    await waitFor(() =>
      expect(result.current.state.items[0]?.payload.text).toBe(
        "Recovered final answer appended once",
      ),
    );
    act(() =>
      runtime.notifications.forEach((receive) =>
        receive({ jsonrpc: "2.0", method: "item.delta", params: delta }),
      ),
    );
    expect(result.current.state.items[0].payload.text).toBe(
      "Recovered final answer appended once",
    );
  });

  it.each(["stopped", "starting"] as const)(
    "replays missed events when a %s runtime becomes ready again",
    async (phase) => {
      const events = [...recoveryEvents];
      const runtime = new TestRuntime([project], [thread], events);
      const { result } = renderHook(() => useWorkspaceController(runtime));
      await waitFor(() => expect(runtime.calls).toContain("settings/read"));
      act(() =>
        runtime.statuses.forEach((receive) =>
          receive({ ...readyStatus, phase }),
        ),
      );
      events.push(liveDelta(3, " after reconnect"));
      act(() => runtime.statuses.forEach((receive) => receive(readyStatus)));
      await waitFor(() =>
        expect(result.current.state.items[0]?.payload.text).toBe(
          "Recovered final answer after reconnect",
        ),
      );
      expect(
        runtime.calls.filter((method) => method === "project/list"),
      ).toHaveLength(2);
    },
  );

  it("cleans up a notification subscription that resolves after unmount", async () => {
    const runtime = new TestRuntime();
    let resolve!: (cleanup: () => void) => void;
    vi.spyOn(runtime, "onNotification").mockImplementation(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const cleanup = vi.fn();
    const { unmount } = renderHook(() => useWorkspaceController(runtime));
    unmount();
    await act(async () => resolve(cleanup));
    expect(cleanup).toHaveBeenCalledOnce();
    expect(runtime.calls).toEqual([]);
  });
});
