/**
 * Settings sections whose data has no backend yet. Values come from
 * src/mocks/preview.ts and every section is tagged "Preview" until the
 * App Server can supply the real thing.
 */

import {
  MOCK_ACCOUNT,
  MOCK_USAGE_LIMITS,
  percent,
} from "../../../mocks/preview";
import type { SettingsSectionProps } from "../settingsSections";
import styles from "./PreviewSections.module.css";

function PreviewTag() {
  return <em className={styles.tag}>Preview</em>;
}

export function AccountSection(_props: SettingsSectionProps) {
  return (
    <div className={styles.section}>
      <div className={styles.profile}>
        <span className={styles.avatar} aria-hidden="true">
          {MOCK_ACCOUNT.name.charAt(0)}
        </span>
        <span>
          <strong>{MOCK_ACCOUNT.name}</strong>
          <small>{MOCK_ACCOUNT.email}</small>
        </span>
        <PreviewTag />
      </div>
      <h3>Profile</h3>
      <div className={styles.row}>
        <span>
          <strong>Display name</strong>
          <small>Shown in the sidebar account menu.</small>
        </span>
        <span>{MOCK_ACCOUNT.name}</span>
      </div>
      <div className={styles.row}>
        <span>
          <strong>Plan</strong>
          <small>Khai-Agents runs locally with your own API keys.</small>
        </span>
        <span>{MOCK_ACCOUNT.plan}</span>
      </div>
    </div>
  );
}

export function UsageSection({ settings }: SettingsSectionProps) {
  const connection =
    (settings?.agents.defaults as { connection?: string } | undefined)
      ?.connection ?? "default connection";
  return (
    <div className={styles.section}>
      <h3>
        Provider limits <PreviewTag />
      </h3>
      <p className={styles.note}>
        Limits for {connection}. Real figures appear once the service reports
        provider usage.
      </p>
      {MOCK_USAGE_LIMITS.map((limit) => {
        const share = percent(limit.used, limit.total);
        return (
          <div className={styles.limit} key={limit.label}>
            <div className={styles.limitHead}>
              <strong>{limit.label}</strong>
              <span>
                {limit.detail} · {share}%
              </span>
            </div>
            <div className={styles.bar}>
              <span style={{ width: `${share}%` }} />
            </div>
            <small>
              {limit.used.toLocaleString()} of {limit.total.toLocaleString()}
            </small>
          </div>
        );
      })}
    </div>
  );
}
