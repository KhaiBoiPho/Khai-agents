/**
 * App Authorization — which third-party apps the agent may act in.
 *
 * The shapes follow Composio's model so the real client can drop in behind
 * the same interface: a *toolkit* is an app (Gmail, GitHub…) with a set of
 * tools; a *connected account* is one authorized identity in it; connecting
 * starts an auth flow that returns a redirect URL and settles to ACTIVE.
 * Once connected, the toolkit's tools reach the agent through Composio's MCP
 * server rather than through anything in this file.
 *
 * TODO(backend): `mockAppAuthClient` is preview data. Replace it with a client
 * that calls Composio (via the App Server, which holds the API key — never the
 * webview) and keep the interface.
 */

import { MOCK_ACCOUNT } from "../../mocks/preview";

export type AuthScheme = "oauth2" | "api_key";

/** Composio's connected-account states, lower-cased. */
export type ConnectionStatus = "initiated" | "active" | "expired" | "failed";

export type ToolkitCategory =
  | "Productivity"
  | "Communication"
  | "Developer"
  | "Design"
  | "CRM & Sales"
  | "Commerce";

export interface Toolkit {
  /** Composio toolkit slug, also the simple-icons key for its mark. */
  slug: string;
  name: string;
  category: ToolkitCategory;
  description: string;
  authScheme: AuthScheme;
  toolCount: number;
  /** What the agent can do once authorized, shown on the consent sheet. */
  scopes: readonly string[];
}

export interface ConnectedAccount {
  id: string;
  toolkitSlug: string;
  status: ConnectionStatus;
  /** The identity authorized, e.g. an email or workspace name. */
  accountLabel: string;
  connectedAt: string;
}

export interface ConnectRequest {
  connection: ConnectedAccount;
  /** Where the user completes OAuth; null for schemes with no redirect. */
  redirectUrl: string | null;
}

export interface AppAuthClient {
  listToolkits(): Promise<Toolkit[]>;
  listConnections(): Promise<ConnectedAccount[]>;
  /** Starts the flow; the returned connection is `initiated`. */
  connect(slug: string): Promise<ConnectRequest>;
  /** Resolves once the flow settles, as Composio's waitForConnection does. */
  waitForConnection(id: string): Promise<ConnectedAccount>;
  disconnect(id: string): Promise<void>;
}

const TOOLKITS: readonly Toolkit[] = [
  { slug: "gmail", name: "Gmail", category: "Communication", authScheme: "oauth2", toolCount: 23, description: "Read, draft, label and send email.", scopes: ["Read your messages and labels", "Create and send drafts", "Manage labels"] },
  { slug: "googlecalendar", name: "Google Calendar", category: "Productivity", authScheme: "oauth2", toolCount: 18, description: "Find free time, create and update events.", scopes: ["See your calendars", "Create, edit and delete events"] },
  { slug: "googledrive", name: "Google Drive", category: "Productivity", authScheme: "oauth2", toolCount: 21, description: "Search, read and organize files.", scopes: ["See and download your files", "Create and move files"] },
  { slug: "googlesheets", name: "Google Sheets", category: "Productivity", authScheme: "oauth2", toolCount: 15, description: "Read ranges, append rows and build sheets.", scopes: ["Read your spreadsheets", "Edit cells and create sheets"] },
  { slug: "googledocs", name: "Google Docs", category: "Productivity", authScheme: "oauth2", toolCount: 9, description: "Create and edit documents.", scopes: ["Read your documents", "Create and edit documents"] },
  { slug: "googlemeet", name: "Google Meet", category: "Communication", authScheme: "oauth2", toolCount: 6, description: "Schedule meetings and fetch recordings.", scopes: ["Create meeting spaces", "Read recordings and transcripts"] },
  { slug: "notion", name: "Notion", category: "Productivity", authScheme: "oauth2", toolCount: 27, description: "Query databases, write pages and comments.", scopes: ["Read pages you share", "Create and update pages"] },
  { slug: "github", name: "GitHub", category: "Developer", authScheme: "oauth2", toolCount: 64, description: "Issues, pull requests, repos and Actions.", scopes: ["Read repositories", "Open issues and pull requests", "Comment and review"] },
  { slug: "linear", name: "Linear", category: "Developer", authScheme: "oauth2", toolCount: 19, description: "Create and triage issues and projects.", scopes: ["Read your workspace", "Create and update issues"] },
  { slug: "jira", name: "Jira", category: "Developer", authScheme: "oauth2", toolCount: 31, description: "Search, create and transition tickets.", scopes: ["Read projects and issues", "Create and transition issues"] },
  { slug: "supabase", name: "Supabase", category: "Developer", authScheme: "api_key", toolCount: 14, description: "Query tables and manage projects.", scopes: ["Run queries in your projects", "Read project settings"] },
  { slug: "figma", name: "Figma", category: "Design", authScheme: "oauth2", toolCount: 11, description: "Read files, frames and comments.", scopes: ["Read files you can view", "Post comments"] },
  { slug: "discord", name: "Discord", category: "Communication", authScheme: "oauth2", toolCount: 12, description: "Post messages and read channels.", scopes: ["Read channels the bot joins", "Send messages"] },
  { slug: "telegram", name: "Telegram", category: "Communication", authScheme: "api_key", toolCount: 8, description: "Send messages through your bot.", scopes: ["Send messages as your bot", "Read updates"] },
  { slug: "hubspot", name: "HubSpot", category: "CRM & Sales", authScheme: "oauth2", toolCount: 42, description: "Contacts, deals and pipelines.", scopes: ["Read CRM records", "Create and update contacts and deals"] },
  { slug: "airtable", name: "Airtable", category: "Productivity", authScheme: "api_key", toolCount: 13, description: "Read and write records in your bases.", scopes: ["Read your bases", "Create and update records"] },
  { slug: "shopify", name: "Shopify", category: "Commerce", authScheme: "oauth2", toolCount: 36, description: "Orders, products and customers.", scopes: ["Read orders and products", "Update inventory"] },
  { slug: "stripe", name: "Stripe", category: "Commerce", authScheme: "api_key", toolCount: 29, description: "Payments, customers and invoices.", scopes: ["Read payments and customers", "Create invoices"] },
];

const SEEDED: readonly ConnectedAccount[] = [
  { id: "ca_github", toolkitSlug: "github", status: "active", accountLabel: MOCK_ACCOUNT.name.toLowerCase(), connectedAt: "2026-09-21T09:12:00Z" },
  { id: "ca_gdrive", toolkitSlug: "googledrive", status: "active", accountLabel: MOCK_ACCOUNT.email, connectedAt: "2026-09-30T02:40:00Z" },
  { id: "ca_notion", toolkitSlug: "notion", status: "expired", accountLabel: "Mosaic workspace", connectedAt: "2026-07-02T11:05:00Z" },
];

const STORAGE_KEY = "khai-agents.app-auth.mock";
const SETTLE_MS = 1400;

function load(): ConnectedAccount[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ConnectedAccount[];
  } catch {
    // Storage can be unavailable; the seed then stands in.
  }
  return [...SEEDED];
}

function save(connections: ConnectedAccount[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
  } catch {
    // Without storage the preview simply resets on reload.
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createMockClient(): AppAuthClient {
  let connections = load();
  const update = (next: ConnectedAccount[]) => {
    connections = next;
    save(next);
  };

  return {
    async listToolkits() {
      await delay(180);
      return [...TOOLKITS];
    },
    async listConnections() {
      await delay(120);
      return [...connections];
    },
    async connect(slug) {
      const connection: ConnectedAccount = {
        id: `ca_${slug}_${Date.now().toString(36)}`,
        toolkitSlug: slug,
        status: "initiated",
        accountLabel: "Authorizing…",
        connectedAt: new Date().toISOString(),
      };
      // A reconnect replaces the toolkit's expired or failed account.
      update([...connections.filter((item) => item.toolkitSlug !== slug), connection]);
      const scheme = TOOLKITS.find((toolkit) => toolkit.slug === slug)?.authScheme;
      return {
        connection,
        redirectUrl:
          scheme === "oauth2" ? `https://connect.composio.dev/link/mock-${slug}` : null,
      };
    },
    async waitForConnection(id) {
      await delay(SETTLE_MS);
      const settled = connections.map((item) =>
        item.id === id
          ? { ...item, status: "active" as const, accountLabel: MOCK_ACCOUNT.email }
          : item,
      );
      update(settled);
      const result = settled.find((item) => item.id === id);
      if (!result) throw new Error("Connection was removed while authorizing.");
      return result;
    },
    async disconnect(id) {
      await delay(250);
      update(connections.filter((item) => item.id !== id));
    },
  };
}

export const mockAppAuthClient: AppAuthClient = createMockClient();
