/**
 * The hosted gateway's account endpoints (app_server/gateway/server.py).
 * Cookies carry the session; every call is same-origin.
 */

export type AccountStatus = "pending" | "active" | "rejected" | "disabled";
export type AccountRole = "admin" | "member";

export interface Account {
  id: string;
  username: string;
  displayName: string;
  role: AccountRole;
  status: AccountStatus;
  canExecute: boolean;
  createdAt: string;
  reviewedAt: string | null;
}

export type AdminAction = "approve" | "reject" | "disable" | "enable";

export class AccountError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: init.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init.headers,
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let body: { code?: string; message?: string } & Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text };
  }
  if (!response.ok)
    throw new AccountError(
      body.code ?? `HTTP_${response.status}`,
      body.message ?? response.statusText,
      response.status,
    );
  return body as T;
}

const post = <T>(path: string, body: unknown = {}) =>
  call<T>(path, { method: "POST", body: JSON.stringify(body) });

/** The signed-in account, or null when nobody is signed in. */
export async function currentAccount(): Promise<Account | null> {
  try {
    const session = await call<{ user?: Account }>("/api/session");
    return session.user ?? null;
  } catch (error) {
    if (error instanceof AccountError && error.status === 401) return null;
    throw error;
  }
}

export const signIn = (username: string, password: string) =>
  post<{ user: Account }>("/auth/login", { username, password }).then(
    (result) => result.user,
  );

export const register = (
  username: string,
  password: string,
  displayName: string,
) =>
  post<{ user: Account; pendingApproval: boolean }>("/auth/register", {
    username,
    password,
    displayName,
  });

export const signOut = () => post("/auth/logout");
export const signOutEverywhere = () => post("/auth/logout-all");
export const changePassword = (currentPassword: string, newPassword: string) =>
  post("/auth/password", { currentPassword, newPassword });

/** A signed-in browser: where it signed in from and when it was last used. */
export interface Device {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  address: string;
  userAgent: string;
}

export const listDevices = () =>
  call<{ sessions: Device[]; current: string }>("/auth/sessions");

export const signOutDevice = (sessionId: string) =>
  post(`/auth/sessions/${encodeURIComponent(sessionId)}/revoke`);

export const listAccountDevices = (userId: string) =>
  call<{ sessions: Device[] }>(
    `/api/admin/users/${encodeURIComponent(userId)}/sessions`,
  ).then((result) => result.sessions);

export const signOutAccountDevice = (userId: string, sessionId: string) =>
  post(
    `/api/admin/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}/revoke`,
  );

export const listAccounts = (status?: AccountStatus) =>
  call<{ users: Account[] }>(
    `/api/admin/users${status ? `?status=${status}` : ""}`,
  ).then((result) => result.users);

export const reviewAccount = (id: string, action: AdminAction) =>
  post<{ user: Account }>(
    `/api/admin/users/${encodeURIComponent(id)}/${action}`,
  ).then((result) => result.user);

export const setAccountRole = (id: string, role: AccountRole) =>
  post<{ user: Account }>(`/api/admin/users/${encodeURIComponent(id)}/role`, {
    role,
  }).then((result) => result.user);

export const setAccountExecution = (id: string, allowed: boolean) =>
  post<{ user: Account }>(
    `/api/admin/users/${encodeURIComponent(id)}/execute`,
    { allowed },
  ).then((result) => result.user);

/** Whether this server has accounts (the hosted gateway) at all. */
export async function accountsEnabled(): Promise<boolean> {
  try {
    const response = await fetch("/auth/config", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { accounts?: boolean };
    return body.accounts === true;
  } catch {
    return false;
  }
}
