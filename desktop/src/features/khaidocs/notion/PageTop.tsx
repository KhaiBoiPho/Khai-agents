/*
 * Original KhaiDocs code, MIT.
 *
 * The Notion-style top of a page: an optional cover band (full width of the
 * content area), the big page icon overlapping the cover's lower edge, and
 * the hover-revealed "Add icon" / "Add cover" buttons above the title.
 * Covers are kept per page on this device (see ./covers).
 */

import { ReactElement, useEffect, useRef, useState } from "react";
import {
  Button,
  FileButton,
  Loader,
  Popover,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useClickOutside, useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconMoodSmile, IconPhoto, IconUpload } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { uploadFile } from "@/features/page/services/page-service.ts";
import { getFileUrl } from "@/lib/config.ts";
import type { IPage } from "@/features/page/types/page.types.ts";
import {
  BUILTIN_COVERS,
  builtinCoverValue,
  coverBackground,
  imageCoverValue,
  parseCover,
  randomBuiltinCover,
  setPageCover,
  usePageCover,
} from "./covers";
import { IconPicker } from "./IconPicker";
import { PageIcon } from "./PageIcon";
import { useSetPageIcon } from "./use-page-icon";
import { recordVisit, removeRecentPage } from "./recents";
import { CURATED_ICONS } from "./icon-set";
import { encodeTablerIcon, ICON_COLORS } from "./page-icon-codec";
import classes from "./notion.module.css";

type PageLike = Pick<IPage, "id" | "slugId" | "title" | "icon" | "spaceId" | "deletedAt"> & {
  space?: { slug?: string };
};

/** Remembers the visit for Recents; renders nothing. */
export function useRecordVisit(page: PageLike | undefined) {
  useEffect(() => {
    if (!page?.id || !page.space?.slug) return;
    // A page in Trash is not a place to go back to.
    if (page.deletedAt) {
      removeRecentPage(page.id);
      return;
    }
    recordVisit({
      id: page.id,
      slugId: page.slugId,
      title: page.title ?? "",
      icon: page.icon ?? null,
      spaceSlug: page.space.slug,
    });
  }, [page?.id, page?.title, page?.icon, page?.space?.slug, page?.deletedAt]);
}

export function PageCover({
  pageId,
  editable,
}: {
  pageId: string;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const cover = parseCover(usePageCover(pageId));
  if (!cover) return null;

  return (
    <div className={classes.cover} data-kd-cover>
      {cover.kind === "image" ? (
        <img className={classes.coverImage} src={getFileUrl(cover.url)} alt="" draggable={false} />
      ) : (
        <div className={classes.coverFill} style={{ background: coverBackground(cover) }} />
      )}
      {editable && (
        <div className={classes.coverActions}>
          <CoverPicker pageId={pageId}>
            <button type="button" className={classes.coverButton}>
              {t("Change cover")}
            </button>
          </CoverPicker>
          <button
            type="button"
            className={classes.coverButton}
            onClick={() => setPageCover(pageId, null)}
          >
            {t("Remove")}
          </button>
        </div>
      )}
    </div>
  );
}

function CoverPicker({ pageId, children }: { pageId: string; children: ReactElement }) {
  const { t } = useTranslation();
  const [opened, { toggle, close }] = useDisclosure(false);
  const [uploading, setUploading] = useState(false);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [dropdown, setDropdown] = useState<HTMLDivElement | null>(null);
  const fileOpenRef = useRef(false);
  useClickOutside(() => !fileOpenRef.current && close(), ["mousedown", "touchstart"], [target, dropdown]);

  const upload = async (file: File | null) => {
    fileOpenRef.current = false;
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      notifications.show({ message: t("Choose an image file"), color: "red" });
      return;
    }
    setUploading(true);
    try {
      const attachment = await uploadFile(file, pageId);
      const url = `/api/files/${attachment.id}/${encodeURIComponent(attachment.fileName)}`;
      setPageCover(pageId, imageCoverValue(url));
      close();
    } catch {
      notifications.show({ message: t("Failed to upload image"), color: "red" });
    } finally {
      setUploading(false);
    }
  };

  const groups = ["Gradients", "Colours"] as const;

  return (
    <Popover opened={opened} onClose={close} position="bottom-end" width={420} shadow="md" radius="md">
      <Popover.Target ref={setTarget}>
        <span onClick={toggle} style={{ display: "inline-flex" }}>
          {children}
        </span>
      </Popover.Target>
      <Popover.Dropdown ref={setDropdown} p="sm">
        {groups.map((group) => (
          <div key={group} style={{ marginBottom: 10 }}>
            <Text size="xs" c="dimmed" fw={500} mb={6}>
              {t(group)}
            </Text>
            <div className={classes.coverGrid}>
              {BUILTIN_COVERS.filter((c) => c.group === group).map((c) => (
                <UnstyledButton
                  key={c.id}
                  className={classes.coverSwatch}
                  style={{ background: c.css }}
                  aria-label={c.label}
                  title={c.label}
                  onClick={() => {
                    setPageCover(pageId, builtinCoverValue(c.id));
                    close();
                  }}
                />
              ))}
            </div>
          </div>
        ))}
        <FileButton onChange={upload} accept="image/png,image/jpeg,image/gif,image/webp">
          {(props) => (
            <Button
              {...props}
              onClick={(e) => {
                fileOpenRef.current = true;
                props.onClick();
                // The file dialog gives no "cancel" event; stop ignoring
                // outside clicks once focus returns.
                window.addEventListener("focus", () => setTimeout(() => (fileOpenRef.current = false), 300), { once: true });
              }}
              variant="default"
              size="xs"
              fullWidth
              leftSection={uploading ? <Loader size={12} /> : <IconUpload size={14} />}
              disabled={uploading}
            >
              {t("Upload image")}
            </Button>
          )}
        </FileButton>
        <Text size="xs" c="dimmed" mt={6}>
          {t("Covers are saved on this device.")}
        </Text>
      </Popover.Dropdown>
    </Popover>
  );
}

/**
 * Big icon + "Add icon" / "Add cover" controls; sits in the editor column
 * just above the title.
 */
export function PageHead({ page, editable }: { page: PageLike; editable: boolean }) {
  const { t } = useTranslation();
  const setIcon = useSetPageIcon();
  const hasCover = !!parseCover(usePageCover(page.id));
  const [pickerOpen, setPickerOpen] = useState(false);

  const change = (icon: string | null) => {
    setIcon({ id: page.id, spaceId: page.spaceId }, icon).catch(() =>
      notifications.show({ message: t("Failed to update icon"), color: "red" }),
    );
  };

  const addRandomIcon = () => {
    // Notion adds a random icon and opens nothing; we open the picker so the
    // choice is quick to change.
    const pick = CURATED_ICONS[Math.floor(Math.random() * 40)];
    const color = ICON_COLORS[1 + Math.floor(Math.random() * (ICON_COLORS.length - 1))];
    change(encodeTablerIcon(pick.name, color));
    setPickerOpen(true);
  };

  return (
    <div
      className={classes.pageHead}
      data-has-cover={hasCover || undefined}
      data-has-icon={!!page.icon || undefined}
    >
      {page.icon && (
        <IconPicker
          value={page.icon}
          onChange={change}
          onRemove={() => change(null)}
          readOnly={!editable}
          opened={pickerOpen}
          onOpenChange={setPickerOpen}
        >
          <UnstyledButton className={classes.bigIcon} aria-label={t("Change icon")}>
            <PageIcon icon={page.icon} size={72} />
          </UnstyledButton>
        </IconPicker>
      )}
      {editable && (!page.icon || !hasCover) && (
        <div className={classes.headControls}>
          {!page.icon && (
            <button type="button" className={classes.headButton} onClick={addRandomIcon}>
              <IconMoodSmile size={16} stroke={1.75} />
              {t("Add icon")}
            </button>
          )}
          {!hasCover && (
            <button
              type="button"
              className={classes.headButton}
              onClick={() => setPageCover(page.id, builtinCoverValue(randomBuiltinCover().id))}
            >
              <IconPhoto size={16} stroke={1.75} />
              {t("Add cover")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
