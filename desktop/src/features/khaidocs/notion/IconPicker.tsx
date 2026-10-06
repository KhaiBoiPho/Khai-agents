/*
 * Original KhaiDocs code, MIT.
 *
 * The page-icon picker: an "Icons" tab (curated Tabler line icons, search,
 * colour swatches) next to Docmost's emoji picker (emoji-mart), plus Remove.
 * Icons are the default tab. The value handed to onChange is what goes into
 * the page's `icon` field: an emoji, or "ti:<name>:<colour>".
 */

import React, {
  ReactElement,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Popover,
  ScrollArea,
  TextInput,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
} from "@mantine/core";
import { useClickOutside, useDisclosure } from "@mantine/hooks";
import { IconSearch } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { CURATED_ICONS } from "./icon-set";
import { filterIcons } from "./icon-search";
import {
  ICON_COLORS,
  IconColor,
  encodeTablerIcon,
  isIconColor,
  parsePageIcon,
} from "./page-icon-codec";
import { iconColorVar } from "./PageIcon";
import classes from "./notion.module.css";

const EmojiMart = React.lazy(async () => {
  const [pickerModule, dataModule] = await Promise.all([
    import("@slidoapp/emoji-mart-react"),
    import("@slidoapp/emoji-mart-data"),
  ]);
  const PickerComp = pickerModule.default;
  const data = dataModule.default;
  return {
    default: (props: any) => <PickerComp {...props} data={data} />,
  };
});

const COLOR_KEY = "khaidocs:icon-color";
const TAB_KEY = "khaidocs:icon-tab";

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export interface IconPickerProps {
  value?: string | null;
  onChange: (icon: string) => void;
  onRemove?: () => void;
  readOnly?: boolean;
  /** The clickable target; must accept a ref (a Mantine button works). */
  children: ReactElement;
  position?: "bottom" | "bottom-start" | "bottom-end" | "right-start";
  /** Starts opened (e.g. right after "Add icon"). */
  opened?: boolean;
  onOpenChange?: (opened: boolean) => void;
}

export function IconPicker({
  value,
  onChange,
  onRemove,
  readOnly,
  children,
  position = "bottom-start",
  opened: controlledOpened,
  onOpenChange,
}: IconPickerProps) {
  const { t } = useTranslation();
  const [innerOpened, handlers] = useDisclosure(false);
  const opened = controlledOpened ?? innerOpened;
  const setOpened = (next: boolean) => {
    if (controlledOpened === undefined) {
      next ? handlers.open() : handlers.close();
    }
    onOpenChange?.(next);
  };
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [dropdown, setDropdown] = useState<HTMLDivElement | null>(null);
  useClickOutside(() => opened && setOpened(false), ["mousedown", "touchstart"], [
    dropdown,
    target,
  ]);

  const [tab, setTab] = useState<"icons" | "emoji">(
    readPref(TAB_KEY) === "emoji" ? "emoji" : "icons",
  );
  const switchTab = (next: "icons" | "emoji") => {
    setTab(next);
    writePref(TAB_KEY, next);
  };

  const choose = (icon: string) => {
    onChange(icon);
    setOpened(false);
  };

  const remove = () => {
    onRemove?.();
    setOpened(false);
  };

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={372}
      position={position}
      disabled={readOnly}
      shadow="md"
      radius="md"
      offset={6}
      trapFocus={false}
      closeOnEscape
      onClose={() => setOpened(false)}
    >
      <Popover.Target ref={setTarget}>
        {React.cloneElement(children as ReactElement<any>, {
          onClick: (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (!readOnly) setOpened(!opened);
          },
          "aria-haspopup": "dialog",
          "aria-expanded": opened,
        })}
      </Popover.Target>
      <Popover.Dropdown
        p={0}
        ref={setDropdown}
        className={classes.pickerDropdown}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={classes.pickerTabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "icons"}
            className={classes.pickerTab}
            data-active={tab === "icons" || undefined}
            onClick={() => switchTab("icons")}
          >
            {t("Icons")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "emoji"}
            className={classes.pickerTab}
            data-active={tab === "emoji" || undefined}
            onClick={() => switchTab("emoji")}
          >
            {t("Emoji")}
          </button>
          <div style={{ flex: 1 }} />
          {onRemove && value && (
            <button type="button" className={classes.pickerRemove} onClick={remove}>
              {t("Remove")}
            </button>
          )}
        </div>
        {opened && tab === "icons" && <IconGrid value={value} onSelect={choose} />}
        {opened && tab === "emoji" && <EmojiTab onSelect={choose} />}
      </Popover.Dropdown>
    </Popover>
  );
}

function IconGrid({
  value,
  onSelect,
}: {
  value?: string | null;
  onSelect: (icon: string) => void;
}) {
  const { t } = useTranslation();
  const current = parsePageIcon(value);
  const [query, setQuery] = useState("");
  const [color, setColor] = useState<IconColor>(() => {
    if (current?.kind === "tabler") return current.color;
    const saved = readPref(COLOR_KEY);
    return isIconColor(saved) ? saved : "default";
  });
  const icons = useMemo(() => filterIcons(CURATED_ICONS, query), [query]);

  const pickColor = (next: IconColor) => {
    setColor(next);
    writePref(COLOR_KEY, next);
  };

  return (
    <div className={classes.iconTab}>
      <div className={classes.iconTabTop}>
        <TextInput
          size="xs"
          radius="sm"
          variant="filled"
          placeholder={t("Filter…")}
          leftSection={<IconSearch size={14} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          data-autofocus
          autoFocus
          style={{ flex: 1 }}
        />
        <div className={classes.swatches} role="radiogroup" aria-label={t("Colour")}>
          {ICON_COLORS.map((c) => (
            <Tooltip key={c} label={t(c[0].toUpperCase() + c.slice(1))} openDelay={400}>
              <button
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                className={classes.swatch}
                data-active={color === c || undefined}
                style={{ background: iconColorVar(c) }}
                onClick={() => pickColor(c)}
              />
            </Tooltip>
          ))}
        </div>
      </div>
      <ScrollArea h={264} type="auto" offsetScrollbars>
        {icons.length === 0 ? (
          <div className={classes.iconEmpty}>{t("No icons found")}</div>
        ) : (
          <div className={classes.iconGrid}>
            {icons.map(({ name, Icon }) => {
              const selected =
                current?.kind === "tabler" && current.name === name;
              return (
                <Tooltip key={name} label={name.replace(/-/g, " ")} openDelay={500}>
                  <UnstyledButton
                    className={classes.iconCell}
                    data-selected={selected || undefined}
                    aria-label={name}
                    onClick={() => onSelect(encodeTablerIcon(name, color))}
                  >
                    <Icon size={20} stroke={1.75} color={iconColorVar(color)} />
                  </UnstyledButton>
                </Tooltip>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function EmojiTab({ onSelect }: { onSelect: (icon: string) => void }) {
  const scheme = useComputedColorScheme("light");
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  // Focus emoji-mart's search without scrolling the page (see Docmost's
  // emoji-picker.tsx for why).
  useEffect(() => {
    if (!host) return;
    let cancelled = false;
    let raf = 0;
    const tryFocus = (attempts: number) => {
      if (cancelled) return;
      const input = host
        .querySelector("em-emoji-picker")
        ?.shadowRoot?.querySelector<HTMLInputElement>('input[type="search"]');
      if (input) return input.focus({ preventScroll: true });
      if (attempts < 60) raf = requestAnimationFrame(() => tryFocus(attempts + 1));
    };
    raf = requestAnimationFrame(() => tryFocus(0));
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [host]);

  return (
    <div ref={setHost} className={classes.emojiTab}>
      <Suspense fallback={<div style={{ height: 300 }} />}>
        <EmojiMart
          onEmojiSelect={(emoji: { native: string }) => onSelect(emoji.native)}
          perLine={9}
          skinTonePosition="search"
          previewPosition="none"
          theme={scheme}
        />
      </Suspense>
    </div>
  );
}

export default IconPicker;
