/**
 * Account, Privacy, Capabilities and Memory. None of these have a backend
 * yet: values come from src/mocks/preview.ts and edits live in this
 * page only (TODO(backend)).
 */

import { Trash2 } from "lucide-react";
import { useState } from "react";

import mascotUrl from "../../../assets/khai-mascot.png";
import { Select } from "../../../components/Select";
import {
  MOCK_CAPABILITIES,
  MOCK_LOCAL_DEVICES,
  MOCK_MEMORIES,
  MOCK_PRIVACY,
  MOCK_PROFILE,
  MOCK_TRUSTED_DEVICES,
  MOCK_WORK_ROLES,
} from "../../../mocks/preview";
import type { SettingsSectionProps } from "../settingsSections";
import {
  Badge,
  Button,
  Group,
  Page,
  Row,
  Table,
  TextArea,
  TextInput,
  Toggle,
} from "../ui/SettingsUI";
import styles from "./Pages.module.css";

export function AccountPage(_props: SettingsSectionProps) {
  const [fullName, setFullName] = useState<string>(MOCK_PROFILE.fullName);
  const [callMe, setCallMe] = useState<string>(MOCK_PROFILE.callMe);
  const [work, setWork] = useState<string>(MOCK_PROFILE.work);
  const [instructions, setInstructions] = useState<string>(MOCK_PROFILE.instructions);
  const [trustedOnly, setTrustedOnly] = useState(false);
  return (
    <Page>
      <Group title="Profile">
        <Row label="Profile photo" description="PNG, JPEG or WebP, up to 10 MB.">
          <img src={mascotUrl} alt="" className={styles.avatar} />
        </Row>
        <Row label="Full name">
          <TextInput label="Full name" value={fullName} onChange={setFullName} />
        </Row>
        <Row label="What should Khai-Agents call you?">
          <TextInput label="Preferred name" value={callMe} onChange={setCallMe} />
        </Row>
        <Row label="What best describes your work?">
          <Select
            variant="plain"
            value={work}
            onChange={(event) => setWork(event.target.value)}
            aria-label="Work"
          >
            {MOCK_WORK_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </Select>
        </Row>
        <Row
          stacked
          label="Instructions for Khai-Agents"
          description="The agent keeps these in mind in every Session on this machine."
        >
          <TextArea label="Instructions" value={instructions} onChange={setInstructions} />
        </Row>
      </Group>

      <Group title="Account">
        <Row label="Log out of all devices">
          <Button>Log out</Button>
        </Row>
        <Row label="Delete local data" description="Remove Sessions, settings and stored credentials from this machine.">
          <Button variant="danger">Delete data</Button>
        </Row>
        <Row label="Organization ID">
          <code className={styles.code}>{MOCK_PROFILE.organizationId}</code>
        </Row>
      </Group>

      <Group>
        <Row
          label="Require trusted devices"
          description="Verify each new device before it can connect to this computer remotely."
        >
          <Toggle label="Require trusted devices" checked={trustedOnly} onChange={setTrustedOnly} />
        </Row>
      </Group>

      <Group
        title="Local devices"
        description="Computers that can run tasks with access to local files, browser use and local connectors."
      >
        <Table
          columns={[
            { label: "Name", width: "2fr" },
            { label: "Platform" },
            { label: "Added" },
            { label: "Last seen" },
          ]}
          rows={MOCK_LOCAL_DEVICES.map((device) => [
            <span key="n">
              {device.name}
              {"current" in device && device.current ? <Badge>This computer</Badge> : null}
            </span>,
            device.platform,
            device.added,
            device.seen,
          ])}
        />
      </Group>

      <Group title="Trusted devices" description="Devices that can control this machine through remote Sessions.">
        <Table
          columns={[{ label: "Device", width: "3fr" }, { label: "Added", align: "end" }]}
          rows={MOCK_TRUSTED_DEVICES.map((device) => [device.name, device.added])}
        />
      </Group>
    </Page>
  );
}

function ToggleList({
  items,
}: {
  items: ReadonlyArray<{ id: string; label: string; description: string; on: boolean }>;
}) {
  const [state, setState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((item) => [item.id, item.on])),
  );
  return (
    <>
      {items.map((item) => (
        <Row key={item.id} label={item.label} description={item.description}>
          <Toggle
            label={item.label}
            checked={state[item.id]}
            onChange={(value) => setState((current) => ({ ...current, [item.id]: value }))}
          />
        </Row>
      ))}
    </>
  );
}

export function PrivacyPage(_props: SettingsSectionProps) {
  return (
    <Page>
      <Group title="Privacy" description="Khai-Agents runs on your machine. These choices control what stays local.">
        <ToggleList items={MOCK_PRIVACY} />
      </Group>
      <Group title="Your data">
        <Row label="Export data" description="Download every Session, setting and memory as a ZIP archive.">
          <Button>Export</Button>
        </Row>
        <Row label="Clear chat history" description="Delete all Session transcripts on this machine.">
          <Button variant="danger">Clear history</Button>
        </Row>
      </Group>
    </Page>
  );
}

export function CapabilitiesPage(_props: SettingsSectionProps) {
  return (
    <Page>
      <Group title="Capabilities" description="Turn agent abilities on or off for every new Session.">
        <ToggleList items={MOCK_CAPABILITIES} />
      </Group>
    </Page>
  );
}

export function MemoryPage(_props: SettingsSectionProps) {
  const [memories, setMemories] = useState([...MOCK_MEMORIES]);
  const [enabled, setEnabled] = useState(true);
  return (
    <Page>
      <Group title="Memory">
        <Row
          label="Remember across Sessions"
          description="Let the agent keep short notes about you and your projects and use them in later Sessions."
        >
          <Toggle label="Remember across Sessions" checked={enabled} onChange={setEnabled} />
        </Row>
      </Group>
      <Group title="Saved memories" aside={<Button variant="ghost" onClick={() => setMemories([])}>Clear all</Button>}>
        {memories.length ? (
          memories.map((memory) => (
            <Row key={memory.id} label={memory.text} description={`Added ${memory.added}`}>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Forget this memory"
                onClick={() =>
                  setMemories((current) => current.filter((entry) => entry.id !== memory.id))
                }
              >
                <Trash2 size={15} />
              </button>
            </Row>
          ))
        ) : (
          <p className={styles.muted}>No memories yet.</p>
        )}
      </Group>
    </Page>
  );
}

// Usage reads real data from the service; it lives in its own module.
export { UsagePage } from "./UsagePage";
