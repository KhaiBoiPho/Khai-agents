/**
 * "This computer": the real service, update and diagnostics cards, plus
 * preview-only toggles (TODO(backend)).
 */

import { useState } from "react";

import type { SettingsSectionProps } from "../settingsSections";
import { DiagnosticsCard } from "../sections/DiagnosticsCard";
import { ServiceCard } from "../sections/ServiceCard";
import { UpdatesCard } from "../sections/UpdatesCard";
import { Group, Page, Row, Toggle } from "../ui/SettingsUI";

export function SystemPage({ runtime }: SettingsSectionProps) {
  const [launch, setLaunch] = useState(true);
  const [awake, setAwake] = useState(false);
  const [tray, setTray] = useState(true);
  return (
    <Page>
      <Group title="System">
        <Row label="Start at login" description="Start the Khai-Agents service when you sign in to this computer.">
          <Toggle label="Start at login" checked={launch} onChange={setLaunch} />
        </Row>
        <Row label="Keep computer awake" description="Prevent sleep while a task is running.">
          <Toggle label="Keep computer awake" checked={awake} onChange={setAwake} />
        </Row>
        <Row label="Show in system tray" description="Keep a quick-access icon while the window is closed.">
          <Toggle label="Show in system tray" checked={tray} onChange={setTray} />
        </Row>
      </Group>
      <Group title="Service">
        <ServiceCard runtime={runtime} />
      </Group>
      <Group title="Updates">
        <UpdatesCard runtime={runtime} />
      </Group>
    </Page>
  );
}

export function DeveloperPage({ runtime, project }: SettingsSectionProps) {
  const [devMode, setDevMode] = useState(false);
  const [verbose, setVerbose] = useState(false);
  return (
    <Page>
      <Group title="Developer">
        <Row label="Developer mode" description="Show raw RPC events and tool payloads in the transcript.">
          <Toggle label="Developer mode" checked={devMode} onChange={setDevMode} />
        </Row>
        <Row label="Verbose logging" description="Write debug-level logs for the service.">
          <Toggle label="Verbose logging" checked={verbose} onChange={setVerbose} />
        </Row>
      </Group>
      <Group title="Diagnostics">
        <DiagnosticsCard runtime={runtime} project={project} />
      </Group>
    </Page>
  );
}
