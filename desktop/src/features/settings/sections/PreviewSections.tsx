/**
 * Settings sections whose data has no backend yet. Values come from
 * src/mocks/preview.ts and every section is tagged "Preview" until the
 * App Server can supply the real thing.
 */

import { MOCK_ACCOUNT } from "../../../mocks/preview";
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
