import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { settingsProductAccessPreset } from "../../../app/accessPreset";
import { THEME_PREFERENCES, type ThemePreference } from "../../../app/appearance";
import { useComposerBehavior } from "../../../app/composerBehavior";
import { LOCALES, setLocale, type Locale } from "../../../app/i18n";
import { useAppearance } from "../../../app/useAppearance";
import { Select } from "../../../components/Select";
import type { ExecutionAccessPreset } from "../../../generated/app-server";
import { confirmAction } from "../../../platform/confirmAction";
import type { SettingsSectionProps } from "../settingsSections";
import { DefaultPresetCard } from "../sections/DefaultPresetCard";
import { Button, Group, Page, Row, Segmented, Toggle } from "../ui/SettingsUI";

const FONT_CHOICES = [
  { value: "", label: "Source Sans (default)" },
  { value: "system-ui", label: "System" },
  { value: "Georgia, 'Times New Roman', serif", label: "Serif" },
  { value: "Inconsolata, monospace", label: "Monospace" },
];

const TEXT_SIZES = [
  { value: "small", label: "Small", px: 13 },
  { value: "medium", label: "Medium", px: 14 },
  { value: "large", label: "Large", px: 16 },
] as const;

const WIDTHS = [
  { value: "narrow", label: "Narrow", percent: 60 },
  { value: "medium", label: "Medium", percent: 80 },
  { value: "wide", label: "Wide", percent: 100 },
] as const;

const THEME_LABELS: Record<ThemePreference, string> = {
  system: "Match system",
  light: "Light",
  dark: "Dark",
  paper: "Paper",
  midnight: "Midnight",
  claude: "Ivory",
  "claude-dark": "Slate",
  lagoon: "Lagoon",
  "lagoon-dark": "Lagoon Dark",
  contrast: "High contrast",
  imported: "Imported theme",
};

function nearest<T extends { value: string }>(
  options: readonly T[],
  measure: (option: T) => number,
  current: number,
): T["value"] {
  return options.reduce((best, option) =>
    Math.abs(measure(option) - current) < Math.abs(measure(best) - current)
      ? option
      : best,
  ).value;
}

/** Local-only preview preference (no backend yet). */
function useLocalFlag(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(`khai-agents.${key}`);
      return stored === null ? initial : stored === "1";
    } catch {
      return initial;
    }
  });
  return [
    value,
    (next) => {
      setValue(next);
      try {
        localStorage.setItem(`khai-agents.${key}`, next ? "1" : "0");
      } catch {
        // Preview preference only.
      }
    },
  ];
}

export function GeneralPage(props: SettingsSectionProps) {
  const { settings, busy, scope, onUpdate } = props;
  const { i18n } = useTranslation();
  const { appearance, set } = useAppearance();
  const { busyEnter, setBusyEnter } = useComposerBehavior();
  const [reducedMotion, setReducedMotion] = useLocalFlag("reduced-motion", false);
  const [backgroundRun, setBackgroundRun] = useLocalFlag("background-run", false);
  const [dictation, setDictation] = useLocalFlag("dictation", true);
  const [browser, setBrowser] = useState("chrome");
  const [voice, setVoice] = useState("calm");
  const access = settingsProductAccessPreset(settings) ?? "ask";
  const baseTheme: "system" | "light" | "dark" =
    appearance.theme === "light" || appearance.theme === "dark"
      ? appearance.theme
      : "system";

  const changeAccess = async (preset: ExecutionAccessPreset) => {
    if (preset === access) return;
    if (
      preset === "full_access" &&
      !(await confirmAction(
        "Full access lets new Sessions run without workspace sandbox and protected-path guards. Continue?",
        { confirmLabel: "Use Full access" },
      ))
    ) {
      return;
    }
    await onUpdate({ security: { accessPreset: preset } }, scope, preset === "full_access");
  };

  return (
    <Page>
      <Group title="Appearance">
        <Row label="Theme">
          <Segmented
            label="Theme"
            value={baseTheme}
            onChange={(value) => set("theme", value)}
            options={[
              { value: "system", icon: <Monitor size={15} />, title: "Match system" },
              { value: "light", icon: <Sun size={15} />, title: "Light" },
              { value: "dark", icon: <Moon size={15} />, title: "Dark" },
            ]}
          />
        </Row>
        <Row label="Color theme" description="More palettes beyond light and dark.">
          <Select
            variant="plain"
            value={appearance.theme}
            onChange={(event) => set("theme", event.target.value as ThemePreference)}
            aria-label="Color theme"
          >
            {THEME_PREFERENCES.filter(
              (theme) => theme !== "imported" || appearance.importedTheme,
            ).map((theme) => (
              <option key={theme} value={theme}>
                {THEME_LABELS[theme]}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Chat font">
          <Select
            variant="plain"
            value={appearance.fontFamily}
            onChange={(event) => set("fontFamily", event.target.value)}
            aria-label="Chat font"
          >
            {FONT_CHOICES.map((font) => (
              <option key={font.label} value={font.value}>
                {font.label}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Transcript text size" description="Size of the conversation transcript text.">
          <Segmented
            label="Transcript text size"
            value={nearest(TEXT_SIZES, (option) => option.px, appearance.fontSize)}
            onChange={(value) =>
              set("fontSize", TEXT_SIZES.find((option) => option.value === value)?.px ?? 14)
            }
            options={TEXT_SIZES}
          />
        </Row>
        <Row
          label="Transcript width"
          description="Maximum width of the transcript and composer columns."
        >
          <Segmented
            label="Transcript width"
            value={nearest(WIDTHS, (option) => option.percent, appearance.conversationWidth)}
            onChange={(value) =>
              set(
                "conversationWidth",
                WIDTHS.find((option) => option.value === value)?.percent ?? 100,
              )
            }
            options={WIDTHS}
          />
        </Row>
        <Row
          label="Motion"
          description="Reduce animation in streaming responses and other interface elements."
        >
          <Segmented
            label="Motion"
            value={reducedMotion ? "reduced" : "system"}
            onChange={(value) => setReducedMotion(value === "reduced")}
            options={[
              { value: "system", label: "System" },
              { value: "reduced", label: "Reduced" },
            ]}
          />
        </Row>
      </Group>

      <Group title="Tasks">
        <Row
          label="Default access"
          description="Tool access for new Sessions. A Session can still pick its own mode from the composer."
        >
          <Select
            variant="plain"
            value={access}
            disabled={busy}
            onChange={(event) =>
              void changeAccess(event.target.value as ExecutionAccessPreset)
            }
            aria-label="Default access"
          >
            <option value="ask">Ask before changes</option>
            <option value="read_only">Read only</option>
            <option value="full_access">Full access</option>
          </Select>
        </Row>
        <Row
          label="Trusted folders"
          description="When you trust a folder, the agent may run tools inside it and its subfolders. Trusting a folder doesn't add it to new Sessions."
        >
          <Button>Manage</Button>
        </Row>
        <Row
          label="Only on this computer"
          description="Stop running tasks when the window closes or this computer sleeps."
        >
          <Toggle
            label="Only on this computer"
            checked={backgroundRun}
            onChange={setBackgroundRun}
          />
        </Row>
        <Row
          label="Preferred browser"
          description="The agent uses this browser when it needs to open or test a page."
        >
          <Select
            value={browser}
            onChange={(event) => setBrowser(event.target.value)}
            aria-label="Preferred browser"
          >
            <option value="chrome">Chrome</option>
            <option value="firefox">Firefox</option>
            <option value="edge">Microsoft Edge</option>
            <option value="system">System default</option>
          </Select>
        </Row>
      </Group>

      <Group title="Composer">
        <Row
          label="Enter while a turn runs"
          description="What a plain Enter does when the agent is busy. Ctrl+Enter does the other."
        >
          <Segmented
            label="Enter while a turn runs"
            value={busyEnter}
            onChange={setBusyEnter}
            options={[
              { value: "steer", label: "Steer" },
              { value: "queue", label: "Queue" },
            ]}
          />
        </Row>
      </Group>

      <Group title="Voice">
        <Row label="Language">
          <Select
            variant="plain"
            value={LOCALES.some((locale) => locale.value === i18n.language) ? i18n.language : "en"}
            onChange={(event) => setLocale(event.target.value as Locale)}
            aria-label="Interface language"
          >
            {LOCALES.map((locale) => (
              <option key={locale.value} value={locale.value}>
                {locale.label}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Dictation" description="Show the microphone in the composer.">
          <Toggle label="Dictation" checked={dictation} onChange={setDictation} />
        </Row>
        <Row label="Style">
          <Select
            variant="plain"
            value={voice}
            onChange={(event) => setVoice(event.target.value)}
            aria-label="Voice style"
          >
            <option value="calm">Calm</option>
            <option value="bright">Bright</option>
            <option value="warm">Warm</option>
          </Select>
        </Row>
      </Group>

      <Group title="Advanced">
        <DefaultPresetCard {...props} />
      </Group>
    </Page>
  );
}
