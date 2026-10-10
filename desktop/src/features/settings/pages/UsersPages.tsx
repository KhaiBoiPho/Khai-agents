/**
 * Hosted-gateway account pages: the signed-in user's own sign-in and
 * security, and (administrators only) the people who may use this server.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAccount } from "../../account/AccountContext";
import {
  AccountError,
  changePassword,
  listAccountDevices,
  listAccounts,
  listDevices,
  reviewAccount,
  setAccountExecution,
  setAccountRole,
  signOutAccountDevice,
  signOutDevice,
  signOutEverywhere,
  type Account,
  type AdminAction,
  type Device,
} from "../../account/accountApi";
import type { SettingsSectionProps } from "../settingsSections";
import { Badge, Button, Group, Page, Row, Table, TextInput, Toggle } from "../ui/SettingsUI";
import styles from "./Pages.module.css";

const message = (error: unknown) =>
  error instanceof AccountError ? error.message : String(error);

/** "Chrome on Windows" from a User-Agent header. */
function describeAgent(agent: string): string {
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /OPR\//.test(agent)
      ? "Opera"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Firefox\//.test(agent)
          ? "Firefox"
          : /Safari\//.test(agent)
            ? "Safari"
            : "Browser";
  const system = /iPhone|iPad/.test(agent)
    ? "iOS"
    : /Android/.test(agent)
      ? "Android"
      : /Windows/.test(agent)
        ? "Windows"
        : /Mac OS X/.test(agent)
          ? "macOS"
          : /Linux/.test(agent)
            ? "Linux"
            : "";
  return system ? `${browser} on ${system}` : browser;
}

const when = (seconds: number) => new Date(seconds * 1000).toLocaleString();

function DeviceTable({
  devices,
  current,
  busy,
  onSignOut,
}: {
  devices: Device[] | null;
  current?: string;
  busy: boolean;
  onSignOut(device: Device): void;
}) {
  const { t } = useTranslation();
  return (
    <Table
      columns={[
        { label: t("devices.device", "Device"), width: "2fr" },
        { label: t("devices.lastSeen", "Last active"), width: "1.3fr" },
        { label: t("devices.signedIn", "Signed in"), width: "1.3fr" },
        { label: "", align: "end", width: "1fr" },
      ]}
      empty={devices ? t("devices.empty", "No signed-in devices.") : t("users.loading", "Loading…")}
      rows={(devices ?? []).map((device) => [
        <span key="device" title={device.userAgent}>
          <strong>{describeAgent(device.userAgent)}</strong>
          {device.id === current ? (
            <>
              {" "}
              <Badge>{t("devices.thisDevice", "This device")}</Badge>
            </>
          ) : null}
          <br />
          <small>{device.address || t("devices.unknownAddress", "Unknown address")}</small>
        </span>,
        <span key="seen">{when(device.lastSeenAt)}</span>,
        <span key="created">{when(device.createdAt)}</span>,
        <Button key="out" variant="danger" disabled={busy} onClick={() => onSignOut(device)}>
          {t("devices.signOut", "Sign out")}
        </Button>,
      ])}
    />
  );
}

export function SecurityPage(_props: SettingsSectionProps) {
  const { t } = useTranslation();
  const account = useAccount();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    if (next !== confirm) {
      setStatus({ ok: false, text: t("account.passwordMismatch", "The passwords do not match.") });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setStatus({
        ok: true,
        text: t("account.passwordChanged", "Password changed. Other devices were signed out."),
      });
    } catch (error) {
      setStatus({ ok: false, text: message(error) });
    } finally {
      setBusy(false);
    }
  };

  const [devices, setDevices] = useState<Device[] | null>(null);
  const [currentDevice, setCurrentDevice] = useState<string>("");
  const [deviceError, setDeviceError] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    try {
      const result = await listDevices();
      setDevices(result.sessions);
      setCurrentDevice(result.current);
      setDeviceError(null);
    } catch (error) {
      setDeviceError(message(error));
    }
  }, []);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  const signOutOne = async (device: Device) => {
    setBusy(true);
    try {
      await signOutDevice(device.id);
      if (device.id === currentDevice) {
        location.reload();
        return;
      }
      await loadDevices();
    } catch (error) {
      setDeviceError(message(error));
    } finally {
      setBusy(false);
    }
  };

  const everywhere = async () => {
    setBusy(true);
    try {
      await signOutEverywhere();
    } finally {
      location.reload();
    }
  };

  if (!account) return null;
  return (
    <Page>
      <Group title={t("account.profile", "Account")}>
        <Row label={t("account.username", "Username")}>
          <span>@{account.username}</span>
        </Row>
        <Row label={t("account.displayName", "Display name")}>
          <span>{account.displayName}</span>
        </Row>
        <Row label={t("account.role", "Role")}>
          <Badge>
            {account.role === "admin"
              ? t("account.roleAdmin", "Administrator")
              : t("account.roleMember", "Member")}
          </Badge>
        </Row>
      </Group>
      <Group
        title={t("account.changePassword", "Change password")}
        description={t("account.passwordHint", "At least 10 characters.")}
      >
        {/* The account's username, for password managers: without it the
            browser pairs these password fields with the settings search box
            and fills the username there. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={account.username}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        />
        <Row label={t("account.currentPassword", "Current password")}>
          <TextInput
            type="password"
            autoComplete="current-password"
            label={t("account.currentPassword", "Current password")}
            value={current}
            onChange={setCurrent}
          />
        </Row>
        <Row label={t("account.newPassword", "New password")}>
          <TextInput
            type="password"
            autoComplete="new-password"
            label={t("account.newPassword", "New password")}
            value={next}
            onChange={setNext}
          />
        </Row>
        <Row label={t("account.confirmPassword", "Confirm password")}>
          <TextInput
            type="password"
            autoComplete="new-password"
            label={t("account.confirmPassword", "Confirm password")}
            value={confirm}
            onChange={setConfirm}
          />
        </Row>
        <Row label="">
          <Button
            variant="primary"
            disabled={busy || !current || !next}
            onClick={() => void submit()}
          >
            {t("account.changePassword", "Change password")}
          </Button>
        </Row>
        {status ? (
          <p className={status.ok ? styles.statusOk : styles.statusError} role="status">
            {status.text}
          </p>
        ) : null}
      </Group>
      <Group
        title={t("account.sessions", "Sessions")}
        description={t(
          "devices.description",
          "Browsers signed in to this account. Sign out any you do not recognize.",
        )}
        aside={
          <Button variant="ghost" onClick={() => void loadDevices()}>
            {t("users.refresh", "Refresh")}
          </Button>
        }
      >
        {deviceError ? (
          <p className={styles.statusError} role="alert">
            {deviceError}
          </p>
        ) : null}
        <DeviceTable
          devices={devices}
          current={currentDevice}
          busy={busy}
          onSignOut={(device) => void signOutOne(device)}
        />
        <Row
          label={t("account.signOutEverywhere", "Sign out of all devices")}
          description={t(
            "account.signOutEverywhereHint",
            "Ends every session of this account, including this one.",
          )}
        >
          <Button variant="danger" disabled={busy} onClick={() => void everywhere()}>
            {t("account.signOutEverywhere", "Sign out of all devices")}
          </Button>
        </Row>
      </Group>
    </Page>
  );
}

const STATUS_LABELS: Record<Account["status"], string> = {
  pending: "Waiting for approval",
  active: "Active",
  rejected: "Rejected",
  disabled: "Disabled",
};

export function UsersPage(_props: SettingsSectionProps) {
  const { t } = useTranslation();
  const me = useAccount();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Account | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);

  const showDevices = async (account: Account) => {
    setViewing(account);
    setDevices(null);
    try {
      setDevices(await listAccountDevices(account.id));
    } catch (caught) {
      setError(message(caught));
    }
  };

  const signOutTheirs = async (device: Device) => {
    if (!viewing) return;
    setWorking(viewing.id);
    try {
      await signOutAccountDevice(viewing.id, device.id);
      setDevices(await listAccountDevices(viewing.id));
    } catch (caught) {
      setError(message(caught));
    } finally {
      setWorking(null);
    }
  };

  const load = useCallback(async () => {
    try {
      setAccounts(await listAccounts());
      setError(null);
    } catch (caught) {
      setError(message(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (account: Account, change: () => Promise<Account>) => {
    setWorking(account.id);
    setError(null);
    try {
      const updated = await change();
      setAccounts((list) =>
        list ? list.map((item) => (item.id === updated.id ? updated : item)) : list,
      );
    } catch (caught) {
      setError(message(caught));
    } finally {
      setWorking(null);
    }
  };

  const review = (account: Account, action: AdminAction) =>
    act(account, () => reviewAccount(account.id, action));

  const actions = (account: Account) => {
    const disabled = working === account.id || account.id === me?.id;
    switch (account.status) {
      case "pending":
        return (
          <span className={styles.actions}>
            <Button variant="primary" disabled={disabled} onClick={() => void review(account, "approve")}>
              {t("users.approve", "Approve")}
            </Button>
            <Button variant="ghost" disabled={disabled} onClick={() => void review(account, "reject")}>
              {t("users.reject", "Reject")}
            </Button>
          </span>
        );
      case "rejected":
        return (
          <Button disabled={disabled} onClick={() => void review(account, "approve")}>
            {t("users.approve", "Approve")}
          </Button>
        );
      case "active":
        return (
          <Button variant="danger" disabled={disabled} onClick={() => void review(account, "disable")}>
            {t("users.disable", "Disable")}
          </Button>
        );
      case "disabled":
        return (
          <Button disabled={disabled} onClick={() => void review(account, "enable")}>
            {t("users.enable", "Enable")}
          </Button>
        );
    }
  };

  const pending = accounts?.filter((account) => account.status === "pending").length ?? 0;
  return (
    <Page>
      <Group
        title={t("users.title", "People on this server")}
        description={
          pending
            ? t("users.pendingCount", "{{count}} waiting for approval.", { count: pending })
            : t(
                "users.description",
                "New registrations wait here until you approve them. Running commands is off for new accounts.",
              )
        }
        aside={
          <Button variant="ghost" onClick={() => void load()}>
            {t("users.refresh", "Refresh")}
          </Button>
        }
      >
        {error ? (
          <p className={styles.statusError} role="alert">
            {error}
          </p>
        ) : null}
        <Table
          columns={[
            { label: t("users.person", "Person"), width: "2fr" },
            { label: t("users.status", "Status") },
            { label: t("users.admin", "Admin"), width: "0.7fr" },
            { label: t("users.commands", "Run commands"), width: "0.9fr" },
            { label: t("users.devices", "Devices"), width: "0.8fr" },
            { label: "", align: "end", width: "1.4fr" },
          ]}
          empty={accounts ? t("users.empty", "No accounts yet.") : t("users.loading", "Loading…")}
          rows={(accounts ?? []).map((account) => [
            <span key="person">
              <strong>{account.displayName}</strong>
              <br />
              <small>@{account.username}</small>
            </span>,
            <Badge key="status">{t(`users.status.${account.status}`, STATUS_LABELS[account.status])}</Badge>,
            <Toggle
              key="admin"
              label={t("users.admin", "Admin")}
              checked={account.role === "admin"}
              disabled={account.status !== "active" || working === account.id || account.id === me?.id}
              onChange={(checked) =>
                void act(account, () => setAccountRole(account.id, checked ? "admin" : "member"))
              }
            />,
            <Toggle
              key="commands"
              label={t("users.commands", "Run commands")}
              checked={account.canExecute}
              disabled={working === account.id}
              onChange={(checked) =>
                void act(account, () => setAccountExecution(account.id, checked))
              }
            />,
            <Button key="devices" variant="ghost" onClick={() => void showDevices(account)}>
              {t("users.viewDevices", "View")}
            </Button>,
            <span key="actions">{actions(account)}</span>,
          ])}
        />
      </Group>
      {viewing ? (
        <Group
          title={t("users.devicesOf", "Devices of {{name}}", { name: viewing.displayName })}
          description={t(
            "users.devicesHint",
            "Signing a device out ends its session at once; the person can sign in again unless you disable the account.",
          )}
          aside={
            <Button variant="ghost" onClick={() => setViewing(null)}>
              {t("users.close", "Close")}
            </Button>
          }
        >
          <DeviceTable
            devices={devices}
            busy={working === viewing.id}
            onSignOut={(device) => void signOutTheirs(device)}
          />
        </Group>
      ) : null}
    </Page>
  );
}
