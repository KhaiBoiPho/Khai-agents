/**
 * Agents, Skills, Connectors and Plugins. Lists come from the real catalogs
 * where the service has one; Discover tabs, connector suggestions and the
 * agent table are preview data from src/mocks/preview.ts (TODO(backend)).
 */

import {
  ArrowUpDown,
  Check,
  ChevronDown,
  Folder,
  Github,
  MoreVertical,
  Plug,
  Plus,
  Puzzle,
  ScrollText,
  Send,
  SlidersHorizontal,
} from "lucide-react";
import { useMemo, useState } from "react";

import { BrandIcon } from "../../../components/BrandIcon";
import { Dropdown } from "../../../components/Dropdown";
import { useSkillManagement } from "../../extensions/useSkillManagement";
import { useMcpCatalog } from "../../mcp/useMcpCatalog";
import { usePluginCatalog } from "../../plugins/usePluginCatalog";
import {
  MOCK_AGENTS,
  MOCK_CONNECTOR_SUGGESTIONS,
  MOCK_DISCOVER_PLUGINS,
  MOCK_DISCOVER_SKILLS,
} from "../../../mocks/preview";
import type { SettingsSectionProps } from "../settingsSections";
import { PresetsSection } from "../sections/PresetsSection";
import {
  Badge,
  Banner,
  Button,
  Count,
  Group,
  ListItem,
  Page,
  PageHeader,
  Table,
  Toggle,
} from "../ui/SettingsUI";
import styles from "./Pages.module.css";

function AddMenu({ items }: { items: Array<{ id: string; label: string; onSelect(): void }> }) {
  return (
    <Dropdown
      triggerClassName={styles.addButton}
      align="end"
      trigger={
        <>
          <Plus size={15} /> Add <ChevronDown size={13} />
        </>
      }
      sections={[{ items }]}
    />
  );
}

/* ---- Agents ------------------------------------------------------------- */

export function AgentsPage(props: SettingsSectionProps) {
  const [query, setQuery] = useState("");
  const agents = MOCK_AGENTS.filter((agent) =>
    `${agent.name} ${agent.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Page>
      <PageHeader
        title="Agents"
        search={query}
        onSearch={setQuery}
        actions={
          <AddMenu
            items={[
              { id: "new", label: "New agent", onSelect: () => undefined },
              { id: "import", label: "Import from file", onSelect: () => undefined },
            ]}
          />
        }
      />
      <Banner
        title="Agents shape how a Session works"
        text="Each agent combines instructions, a model and the tools it may use. Pick one from the composer before the first message."
        art={<Send size={44} strokeWidth={1.1} />}
      />
      <Group title={<>Built-in <Count>{agents.length}</Count></>}>
        <Table
          columns={[
            { label: "Agent", width: "2.2fr" },
            { label: "Model" },
            { label: "Tools" },
            { label: "", width: "40px", align: "end" },
          ]}
          rows={agents.map((agent) => [
            <span key="a" className={styles.connectorName}>
              <span className={styles.connectorIcon}>
                <Puzzle size={14} />
              </span>
              <span>
                {agent.name}
                {agent.id === "default" ? <Badge>Default</Badge> : null}
              </span>
            </span>,
            agent.model,
            agent.tools,
            <MoreVertical key="m" size={15} className={styles.check} />,
          ])}
        />
      </Group>
      <PresetsSection {...props} />
    </Page>
  );
}

/* ---- Skills ------------------------------------------------------------- */

export function SkillsSettingsPage({ runtime, project, onCreateSkill }: SettingsSectionProps) {
  const catalog = useSkillManagement(runtime, project?.id ?? null);
  const [tab, setTab] = useState("Yours");
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const byOrigin = new Map<string, typeof catalog.skills>();
    for (const skill of catalog.skills) {
      const text = `${skill.displayName ?? skill.name} ${skill.description}`.toLowerCase();
      if (normalized && !text.includes(normalized)) continue;
      const key = skill.originLabel || "Local";
      byOrigin.set(key, [...(byOrigin.get(key) ?? []), skill]);
    }
    return [...byOrigin.entries()];
  }, [catalog.skills, normalized]);
  const creator = catalog.skills.find(
    (skill) => skill.id === catalog.authoringSkillId && skill.selectable && skill.enabled,
  );

  return (
    <Page>
      <PageHeader
        title="Skills"
        tabs={["Yours", "Discover"]}
        tab={tab}
        onTab={setTab}
        search={query}
        onSearch={setQuery}
        actions={
          <>
            <button type="button" className={styles.iconAction} aria-label="Filter">
              <SlidersHorizontal size={16} />
            </button>
            <button type="button" className={styles.iconAction} aria-label="Sort">
              <ArrowUpDown size={16} />
            </button>
            <AddMenu
              items={[
                {
                  id: "create",
                  label: "Create a Skill",
                  onSelect: () => {
                    if (creator && onCreateSkill) void onCreateSkill(creator);
                  },
                },
                { id: "reload", label: "Reload Skills", onSelect: () => void catalog.refresh() },
              ]}
            />
          </>
        }
      />
      {tab === "Yours" ? (
        <>
          <Banner
            title="Add your own Skills"
            text="Skills teach the agent how you work. Add them from Discover, or create your own."
            action={
              <Button variant="primary" onClick={() => setTab("Discover")}>
                Discover Skills
              </Button>
            }
            art={<Send size={44} strokeWidth={1.1} />}
          />
          {catalog.loading && !catalog.skills.length ? (
            <p className={styles.muted}>Loading Skills…</p>
          ) : null}
          {groups.map(([origin, skills]) => (
            <Group
              key={origin}
              title={
                <>
                  {origin} <Count>{skills.length}</Count>
                </>
              }
            >
              {skills.map((skill) => (
                <ListItem
                  key={skill.id}
                  icon={<ScrollText size={16} />}
                  title={skill.displayName ?? skill.name}
                  meta={`from ${skill.originLabel} · ${skill.shortDescription ?? skill.description}`}
                  aside={
                    <>
                      {skill.status !== "active" ? skill.status : null}
                      <Toggle
                        label={`Enable ${skill.name}`}
                        checked={skill.enabled}
                        disabled={!project}
                        onChange={(value) =>
                          void catalog.setEnabled(skill.id, value, project ? "project" : "user")
                        }
                      />
                    </>
                  }
                />
              ))}
            </Group>
          ))}
        </>
      ) : (
        <div className={styles.grid}>
          {MOCK_DISCOVER_SKILLS.filter((skill) =>
            `${skill.name} ${skill.description}`.toLowerCase().includes(normalized),
          ).map((skill) => (
            <div className={styles.card} key={skill.name}>
              <strong>{skill.name}</strong>
              <p>{skill.description}</p>
              <div className={styles.cardFoot}>
                <small>by {skill.by}</small>
                <Button>Add</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}

/* ---- Connectors --------------------------------------------------------- */

export function ConnectorsPage({ runtime, project }: SettingsSectionProps) {
  const catalog = useMcpCatalog(runtime, project);
  const [tab, setTab] = useState("Yours");
  const [query, setQuery] = useState("");
  const [connected, setConnected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(MOCK_CONNECTOR_SUGGESTIONS.map((entry) => [entry.id, entry.connected])),
  );
  const normalized = query.trim().toLowerCase();
  const servers = (catalog.inventory?.servers ?? []).filter((server) =>
    server.name.toLowerCase().includes(normalized),
  );
  const suggestions = MOCK_CONNECTOR_SUGGESTIONS.filter((entry) =>
    entry.name.toLowerCase().includes(normalized),
  );

  const status = (on: boolean, connect: () => void) =>
    on ? (
      <Check size={15} className={styles.check} aria-label="Connected" />
    ) : (
      <Button onClick={connect}>Connect</Button>
    );

  return (
    <Page>
      <PageHeader
        title="Connectors"
        tabs={["Yours", "Discover"]}
        tab={tab}
        onTab={setTab}
        search={query}
        onSearch={setQuery}
        actions={
          <>
            <button type="button" className={styles.iconAction} aria-label="Filter">
              <SlidersHorizontal size={16} />
            </button>
            <AddMenu
              items={[
                { id: "custom", label: "Custom connector", onSelect: () => undefined },
                { id: "reload", label: "Reload", onSelect: () => void catalog.refresh() },
              ]}
            />
          </>
        }
      />
      {tab === "Yours" ? (
        <Table
          columns={[
            { label: "Connector", width: "2.4fr" },
            { label: "Type", width: "1.4fr" },
            { label: "Status", width: "1fr" },
          ]}
          rows={[
            ...servers.map((server) => [
              <span key="n" className={styles.connectorName}>
                <span className={styles.connectorIcon}>
                  <Plug size={14} />
                </span>
                {server.name}
              </span>,
              <span key="t">
                {server.transport === "stdio" ? "Local" : "Web"}
                <Badge>MCP</Badge>
              </span>,
              status(server.enabled, () => void catalog.setEnabled(server.name, true)),
            ]),
            ...suggestions
              .filter((entry) => connected[entry.id])
              .map((entry) => [
                <span key="n" className={styles.connectorName}>
                  <span className={styles.connectorIcon}>
                    <BrandIcon name={entry.icon} />
                  </span>
                  {entry.name}
                </span>,
                <span key="t">
                  {entry.type}
                  {"badge" in entry ? <Badge>{entry.badge}</Badge> : null}
                </span>,
                status(true, () => undefined),
              ]),
            ...suggestions
              .filter((entry) => !connected[entry.id])
              .slice(0, 4)
              .map((entry) => [
                <span key="n" className={styles.connectorName}>
                  <span className={styles.connectorIcon}>
                    <BrandIcon name={entry.icon} />
                  </span>
                  {entry.name}
                </span>,
                entry.type,
                status(false, () => setConnected((current) => ({ ...current, [entry.id]: true }))),
              ]),
          ]}
          empty="No connectors match your search."
        />
      ) : (
        <div className={styles.grid}>
          {suggestions.map((entry) => (
            <div className={styles.card} key={entry.id}>
              <span className={styles.connectorName}>
                <span className={styles.connectorIcon}>
                  <BrandIcon name={entry.icon} />
                </span>
                <strong>{entry.name}</strong>
              </span>
              <p>Connect {entry.name} so the agent can read and act on it during a Session.</p>
              <div className={styles.cardFoot}>
                <small>{entry.type}</small>
                {connected[entry.id] ? (
                  <Check size={15} className={styles.check} />
                ) : (
                  <Button onClick={() => setConnected((current) => ({ ...current, [entry.id]: true }))}>
                    Connect
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}

/* ---- Plugins ------------------------------------------------------------ */

export function PluginsSettingsPage({ runtime, project }: SettingsSectionProps) {
  const catalog = usePluginCatalog(runtime);
  const [query, setQuery] = useState("");
  const [discover, setDiscover] = useState(false);
  const normalized = query.trim().toLowerCase();
  const plugins = catalog.plugins.filter((plugin) =>
    `${plugin.name} ${plugin.description}`.toLowerCase().includes(normalized),
  );
  return (
    <Page>
      <PageHeader
        title="Plugins"
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search skills and plugins"
        actions={
          <>
            <Button onClick={() => setDiscover((on) => !on)}>
              {discover ? "Installed" : "Discover"}
            </Button>
            <AddMenu
              items={[
                { id: "folder", label: "Link a plugin folder", onSelect: () => undefined },
                { id: "reload", label: "Reload", onSelect: () => void catalog.refresh() },
              ]}
            />
          </>
        }
      />
      {discover ? (
        <div className={styles.grid}>
          {MOCK_DISCOVER_PLUGINS.map((plugin) => (
            <div className={styles.card} key={plugin.name}>
              <strong>{plugin.name}</strong>
              <p>{plugin.description}</p>
              <div className={styles.cardFoot}>
                <small>Preview</small>
                <Button>Install</Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <Banner
            title="Add your first plugins"
            text="Give the agent role-level expertise with plugins: bundles of Skills, connectors and agents."
            art={<Puzzle size={44} strokeWidth={1.1} />}
          />
          <Group
            title={
              <>
                In this project <Count>{plugins.length}</Count>
              </>
            }
            aside={
              project ? (
                <span className={styles.repoChip}>
                  <Github size={13} /> {project.displayName}
                </span>
              ) : null
            }
          >
            {plugins.length ? (
              plugins.map((plugin) => (
                <ListItem
                  key={plugin.id}
                  icon={<Puzzle size={16} />}
                  title={plugin.name}
                  meta={plugin.description}
                  aside={
                    <Toggle
                      label={`Enable ${plugin.name}`}
                      checked={plugin.enabled}
                      onChange={(value) => void catalog.setEnabled(plugin.id, value)}
                    />
                  }
                />
              ))
            ) : (
              <ListItem
                icon={<Folder size={16} />}
                title="No plugins installed for this project yet."
              />
            )}
          </Group>
        </>
      )}
    </Page>
  );
}
