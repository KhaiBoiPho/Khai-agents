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
  listAccounts,
  reviewAccount,
  setAccountExecution,
  setAccountRole,
  signOutEverywhere,
  type Account,
  type AdminAction,
} from "../../account/accountApi";
import type { SettingsSectionProps } from "../settingsSections";
import { Badge, Button, Group, Page, Row, Table, TextInput, Toggle } from "../ui/SettingsUI";
import styles from "./Pages.module.css";

const message = (error: unknown) =>
  error instanceof AccountError ? error.message : String(error);

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
      <Group title={t("account.sessions", "Sessions")}>
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
            <span key="actions">{actions(account)}</span>,
          ])}
        />
      </Group>
    </Page>
  );
}
