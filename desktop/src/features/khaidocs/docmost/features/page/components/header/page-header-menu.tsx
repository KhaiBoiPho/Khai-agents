import { ActionIcon, Group, Menu, Text, ThemeIcon, Tooltip } from "@mantine/core";
import {
  IconArrowRight,
  IconArrowsHorizontal,
  IconDots,
  IconEye,
  IconEyeOff,
  IconFileExport,
  IconHistory,
  IconLink,
  IconList,
  IconMarkdown,
  IconMessage,
  IconPaperclip,
  IconPrinter,
  IconStar,
  IconStarFilled,
  IconTrash,
  IconWifiOff,
} from "@tabler/icons-react";
import React, { useEffect, useRef, useState } from "react";
import { useAsideTriggerProps } from "@/hooks/use-toggle-aside.tsx";
import { useAtom, useAtomValue } from "jotai";
import { historyAtoms } from "@/features/page-history/atoms/history-atoms.ts";
import { useDisclosure, useHotkeys } from "@mantine/hooks";
import { useClipboard } from "@/hooks/use-clipboard";
import { useParams } from "react-router-dom";
import { usePageQuery } from "@/features/page/queries/page-query.ts";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import { notifications } from "@mantine/notifications";
import { getAppUrl } from "@/lib/config.ts";
import { extractPageSlugId } from "@/lib";
import { useTreeMutation } from "@/features/page/tree/hooks/use-tree-mutation.ts";
import { useDeletePageModal } from "@/features/page/hooks/use-delete-page-modal.tsx";
import { PageWidthToggle } from "@/features/user/components/page-width-pref.tsx";
import { Trans, useTranslation } from "react-i18next";
import ExportModal from "@/components/common/export-modal";
import { htmlToMarkdown } from "@docmost/editor-ext";
import {
  pageEditorAtom,
  yjsConnectionStatusAtom,
} from "@/features/editor/atoms/editor-atoms.ts";
import { formattedDate } from "@/lib/time.ts";
import { PageEditModeToggle } from "@/features/user/components/page-state-pref.tsx";
import MovePageModal from "@/features/page/components/move-page-modal.tsx";
import PageAttachmentsModal from "@/features/attachments/components/page-attachments-modal.tsx";
import { useTimeAgo } from "@/hooks/use-time-ago.tsx";
import { PageShareModal } from "@/ee/page-permission";
import {
  PageVerificationMenuItem,
  PageVerificationModal,
} from "@/ee/page-verification";
import {
  useFavoriteIds,
  useAddFavoriteMutation,
  useRemoveFavoriteMutation,
} from "@/features/favorite/queries/favorite-query";
import {
  useWatchStatusQuery,
  useWatchPageMutation,
  useUnwatchPageMutation,
} from "@/features/page/queries/watcher-query";
// KhaiDocs: single-user mode, and "Save as template" (our MIT templates).
import { SINGLE_USER } from "@/lib/khaidocs-mode.ts";
import { IconTemplate } from "@tabler/icons-react";
import SaveAsTemplateModal from "../../../../../templates/SaveAsTemplateModal";
import { readPageMarkdown } from "../../../../../templates/page-markdown";
// KhaiDocs: Notion-style top bar and folder actions (MIT, ../../../../../notion).
import {
  IconFileText,
  IconFolder,
  IconFolderSymlink,
} from "@tabler/icons-react";
import { MoveToFolderModal } from "../../../../../notion/MoveToFolderModal";
import { useSetPageIcon } from "../../../../../notion/use-page-icon";
import { folderIcon, isFolderIcon } from "../../../../../notion/page-icon-codec";

interface PageHeaderMenuProps {
  readOnly?: boolean;
}
export default function PageHeaderMenu({ readOnly }: PageHeaderMenuProps) {
  const { t } = useTranslation();
  const commentsTriggerProps = useAsideTriggerProps("comments");
  const tocTriggerProps = useAsideTriggerProps("toc");
  const { pageSlug } = useParams();
  const { data: page } = usePageQuery({
    pageId: extractPageSlugId(pageSlug),
  });
  const isDeleted = !!page?.deletedAt;

  useHotkeys(
    [
      [
        "mod+F",
        () => {
          const event = new CustomEvent("openFindDialogFromEditor", {});
          document.dispatchEvent(event);
        },
      ],
      [
        "Escape",
        () => {
          const event = new CustomEvent("closeFindDialogFromEditor", {});
          document.dispatchEvent(event);
        },
        { preventDefault: false },
      ],
    ],
    [],
  );

  if (isDeleted) {
    return null;
  }

  return (
    <>
      <ConnectionWarning />

      {/* KhaiDocs: Notion's top bar has no edit/read switch; it shows when
          the page was last edited and a favorite star instead. */}
      {SINGLE_USER ? (
        <EditedLabel updatedAt={page?.updatedAt} />
      ) : (
        !readOnly && !page?.isBase && <PageEditModeToggle size="xs" />
      )}

      {/* KhaiDocs: no sharing in single-user mode. */}
      {!SINGLE_USER && <PageShareModal readOnly={readOnly} />}

      <Tooltip label={t("Comments")} openDelay={250} withArrow>
        <ActionIcon
          variant="subtle"
          color="dark"
          aria-label={t("Comments")}
          {...commentsTriggerProps}
        >
          <IconMessage size={20} stroke={2} />
        </ActionIcon>
      </Tooltip>

      {SINGLE_USER && <FavoriteStar pageId={page?.id} spaceId={page?.spaceId} />}

      {/* KhaiDocs: the table of contents moves into the "…" menu. */}
      {!SINGLE_USER && !page?.isBase && (
        <Tooltip label={t("Table of contents")} openDelay={250} withArrow>
          <ActionIcon
            variant="subtle"
            color="dark"
            aria-label={t("Table of contents")}
            {...tocTriggerProps}
          >
            <IconList size={20} stroke={2} />
          </ActionIcon>
        </Tooltip>
      )}

      <PageActionMenu readOnly={readOnly} />
    </>
  );
}

interface PageActionMenuProps {
  readOnly?: boolean;
}
function PageActionMenu({ readOnly }: PageActionMenuProps) {
  const { t } = useTranslation();
  const [, setHistoryModalOpen] = useAtom(historyAtoms);
  const clipboard = useClipboard({ timeout: 500 });
  const { pageSlug, spaceSlug } = useParams();
  const { data: page, isLoading } = usePageQuery({
    pageId: extractPageSlugId(pageSlug),
  });
  const { openDeleteModal } = useDeletePageModal();
  const { handleDelete } = useTreeMutation(page?.spaceId ?? "");
  const [exportOpened, { open: openExportModal, close: closeExportModal }] =
    useDisclosure(false);
  const [
    movePageModalOpened,
    { open: openMovePageModal, close: closeMoveSpaceModal },
  ] = useDisclosure(false);
  const [
    verificationOpened,
    { open: openVerificationModal, close: closeVerificationModal },
  ] = useDisclosure(false);
  const [
    attachmentsOpened,
    { open: openAttachmentsModal, close: closeAttachmentsModal },
  ] = useDisclosure(false);
  const [
    saveTemplateOpened,
    { open: openSaveTemplateModal, close: closeSaveTemplateModal },
  ] = useDisclosure(false);
  const [pageEditor] = useAtom(pageEditorAtom);
  const pageUpdatedAt = useTimeAgo(page?.updatedAt);
  const favoriteIds = useFavoriteIds("page", page?.spaceId);
  const addFavoriteMutation = useAddFavoriteMutation();
  const removeFavoriteMutation = useRemoveFavoriteMutation();
  const isFavorited = page?.id ? favoriteIds.has(page.id) : false;
  const { data: watchStatus } = useWatchStatusQuery(page?.id);
  // KhaiDocs: folders.
  const tocTriggerProps = useAsideTriggerProps("toc");
  const setPageIcon = useSetPageIcon();
  const [folderMoveOpened, { open: openFolderMove, close: closeFolderMove }] =
    useDisclosure(false);
  const isFolder = isFolderIcon(page?.icon);
  const watchPage = useWatchPageMutation();
  const unwatchPage = useUnwatchPageMutation();

  const handleCopyLink = () => {
    const pageUrl =
      getAppUrl() + buildPageUrl(spaceSlug, page.slugId, page.title);

    clipboard.copy(pageUrl);
    notifications.show({ message: t("Link copied") });
  };

  const handleCopyAsMarkdown = () => {
    if (!pageEditor) return;
    const html = pageEditor.getHTML();
    const markdown = htmlToMarkdown(html);
    const title = page?.title ? `# ${page.title}\n\n` : "";
    clipboard.copy(`${title}${markdown}`);
    notifications.show({ message: t("Copied") });
  };

  // KhaiDocs: the page as Markdown, for "Save as template".
  const getPageMarkdown = () =>
    readPageMarkdown({
      pageId: page.id,
      title: page?.title ?? "",
      editor: pageEditor,
    });

  const handlePrint = () => {
    setTimeout(() => {
      window.print();
    }, 250);
  };

  const openHistoryModal = () => {
    setHistoryModalOpen(true);
  };

  const handleDeletePage = () => {
    openDeleteModal({ onConfirm: () => handleDelete(page.id) });
  };

  const handleToggleFavorite = () => {
    if (!page?.id) return;
    const params = { type: "page" as const, pageId: page.id };
    if (isFavorited) {
      removeFavoriteMutation.mutate(params);
    } else {
      addFavoriteMutation.mutate(params);
    }
  };

  return (
    <>
      <Menu
        shadow="xl"
        position="bottom-end"
        offset={20}
        width={230}
        withArrow
        arrowPosition="center"
      >
        <Menu.Target>
          <ActionIcon
            variant="subtle"
            color="dark"
            aria-label={t("Page actions")}
          >
            <IconDots size={20} />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconLink size={16} />}
            onClick={handleCopyLink}
          >
            {t("Copy link")}
          </Menu.Item>

          {!page?.isBase && (
            <Menu.Item
              leftSection={<IconMarkdown size={16} />}
              onClick={handleCopyAsMarkdown}
            >
              {t("Copy as Markdown")}
            </Menu.Item>
          )}

          <Menu.Item
            leftSection={
              isFavorited ? (
                <IconStarFilled size={16} color="var(--mantine-color-yellow-5)" />
              ) : (
                <IconStar size={16} />
              )
            }
            onClick={handleToggleFavorite}
          >
            {isFavorited ? t("Remove from favorites") : t("Add to favorites")}
          </Menu.Item>

          {/* KhaiDocs: watching notifies about other people's edits. */}
          {SINGLE_USER ? null : watchStatus?.watching ? (
            <Menu.Item
              leftSection={<IconEyeOff size={16} />}
              onClick={() => unwatchPage.mutate(page.id)}
            >
              {t("Stop watching")}
            </Menu.Item>
          ) : (
            <Menu.Item
              leftSection={<IconEye size={16} />}
              onClick={() => watchPage.mutate(page.id)}
            >
              {t("Watch page")}
            </Menu.Item>
          )}

          {!page?.isBase && <Menu.Divider />}

          {/* KhaiDocs: table of contents (was a top-bar button). */}
          {SINGLE_USER && !page?.isBase && !isFolder && (
            <Menu.Item
              leftSection={<IconList size={16} />}
              onClick={tocTriggerProps.onClick}
            >
              {t("Table of contents")}
            </Menu.Item>
          )}

          {!page?.isBase && (
            <Menu.Item leftSection={<IconArrowsHorizontal size={16} />}>
              <Group wrap="nowrap">
                <PageWidthToggle label={t("Full width")} />
              </Group>
            </Menu.Item>
          )}

          {!page?.isBase && (
            <Menu.Item
              leftSection={<IconHistory size={16} />}
              onClick={openHistoryModal}
            >
              {t("Page history")}
            </Menu.Item>
          )}

          {!page?.isBase && (
            <Menu.Item
              leftSection={<IconPaperclip size={16} />}
              onClick={openAttachmentsModal}
            >
              {t("Attachments")}
            </Menu.Item>
          )}

          {!page?.isBase && (
            <Menu.Item
              leftSection={<IconTemplate size={16} />}
              onClick={openSaveTemplateModal}
            >
              {t("Save as template")}
            </Menu.Item>
          )}

          {!readOnly && !page?.isBase && (
            <PageVerificationMenuItem
              pageId={page?.id}
              onClick={openVerificationModal}
            />
          )}

          <Menu.Divider />

          {/* KhaiDocs: one space — move between folders instead, and turn
              a page into a folder or back. */}
          {!readOnly && SINGLE_USER && !page?.isBase && (
            <>
              <Menu.Item
                leftSection={<IconFolderSymlink size={16} />}
                onClick={openFolderMove}
              >
                {t("Move to folder…")}
              </Menu.Item>
              <Menu.Item
                leftSection={isFolder ? <IconFileText size={16} /> : <IconFolder size={16} />}
                onClick={() =>
                  setPageIcon(
                    { id: page.id, spaceId: page.spaceId },
                    isFolder ? null : folderIcon("gray"),
                  )
                }
              >
                {isFolder ? t("Turn into page") : t("Turn into folder")}
              </Menu.Item>
            </>
          )}
          {!readOnly && !SINGLE_USER && (
            <Menu.Item
              leftSection={<IconArrowRight size={16} />}
              onClick={openMovePageModal}
            >
              {t("Move")}
            </Menu.Item>
          )}

          <Menu.Item
            leftSection={<IconFileExport size={16} />}
            onClick={openExportModal}
          >
            {t("Export")}
          </Menu.Item>

          <Menu.Item
            leftSection={<IconPrinter size={16} />}
            onClick={handlePrint}
          >
            {t("Print PDF")}
          </Menu.Item>

          {!readOnly && (
            <>
              <Menu.Divider />
              <Menu.Item
                color={"red"}
                leftSection={<IconTrash size={16} />}
                onClick={handleDeletePage}
              >
                {t("Move to trash")}
              </Menu.Item>
            </>
          )}

          <Menu.Divider />

          <>
            <Group px="sm" wrap="nowrap" style={{ cursor: "pointer" }}>
              <Tooltip
                label={t("Edited by {{name}} {{time}}", {
                  name: page.lastUpdatedBy.name,
                  time: pageUpdatedAt,
                })}
                position="left-start"
              >
                <div style={{ width: 210 }}>
                  <Text size="xs" c="dimmed" truncate="end">
                    {t("Word count: {{wordCount}}", {
                      wordCount: pageEditor?.storage?.characterCount?.words(),
                    })}
                  </Text>

                  <Text size="xs" c="dimmed" lineClamp={1}>
                    <Trans
                      defaults="Created by: <b>{{creatorName}}</b>"
                      values={{ creatorName: page?.creator?.name }}
                      components={{ b: <Text span fw={500} /> }}
                    />
                  </Text>
                  <Text size="xs" c="dimmed" truncate="end">
                    {t("Created at: {{time}}", {
                      time: formattedDate(page.createdAt),
                    })}
                  </Text>
                </div>
              </Tooltip>
            </Group>
          </>
        </Menu.Dropdown>
      </Menu>

      <ExportModal
        type="page"
        id={page.id}
        open={exportOpened}
        onClose={closeExportModal}
      />

      <MovePageModal
        pageId={page.id}
        slugId={page.slugId}
        currentSpaceSlug={spaceSlug}
        onClose={closeMoveSpaceModal}
        open={movePageModalOpened}
      />

      <PageVerificationModal
        pageId={page.id}
        opened={verificationOpened}
        onClose={closeVerificationModal}
      />

      <PageAttachmentsModal
        pageId={page.id}
        open={attachmentsOpened}
        onClose={closeAttachmentsModal}
      />

      {/* KhaiDocs */}
      {folderMoveOpened && (
        <MoveToFolderModal
          opened={folderMoveOpened}
          onClose={closeFolderMove}
          page={{
            id: page.id,
            parentPageId: page.parentPageId,
            spaceId: page.spaceId,
          }}
        />
      )}

      <SaveAsTemplateModal
        opened={saveTemplateOpened}
        onClose={closeSaveTemplateModal}
        pageTitle={page?.title}
        pageIcon={page?.icon}
        getMarkdown={getPageMarkdown}
      />
    </>
  );
}

function ConnectionWarning() {
  const { t } = useTranslation();
  const yjsConnectionStatus = useAtomValue(yjsConnectionStatusAtom);
  const [showWarning, setShowWarning] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const isDisconnected = ["disconnected", "connecting"].includes(
      yjsConnectionStatus,
    );

    if (isDisconnected) {
      if (!timeoutRef.current) {
        timeoutRef.current = setTimeout(() => setShowWarning(true), 5000);
      }
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setShowWarning(false);
    }
  }, [yjsConnectionStatus]);

  // Cleanup only on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  if (!showWarning) return null;

  return (
    <Tooltip
      label={t("Real-time editor connection lost. Retrying...")}
      openDelay={250}
      withArrow
    >
      <ThemeIcon
        variant="default"
        c="red"
        role="status"
        aria-label={t("Real-time editor connection lost. Retrying...")}
        style={{ border: "none" }}
      >
        <IconWifiOff size={20} stroke={2} />
      </ThemeIcon>
    </Tooltip>
  );
}

/** KhaiDocs: "Edited 5 minutes ago", as in Notion's top bar. */
function EditedLabel({ updatedAt }: { updatedAt?: Date }) {
  const { t } = useTranslation();
  const ago = useTimeAgo(updatedAt);
  if (!updatedAt) return null;
  return (
    <Text size="sm" c="dimmed" visibleFrom="sm" style={{ whiteSpace: "nowrap" }}>
      {t("Edited {{time}}", { time: ago })}
    </Text>
  );
}

/** KhaiDocs: the favorite star in the top bar. */
function FavoriteStar({ pageId, spaceId }: { pageId?: string; spaceId?: string }) {
  const { t } = useTranslation();
  const favoriteIds = useFavoriteIds("page", spaceId);
  const addFavorite = useAddFavoriteMutation();
  const removeFavorite = useRemoveFavoriteMutation();
  if (!pageId) return null;
  const isFavorited = favoriteIds.has(pageId);
  const label = isFavorited ? t("Remove from favorites") : t("Add to favorites");
  return (
    <Tooltip label={label} openDelay={250} withArrow>
      <ActionIcon
        variant="subtle"
        color="dark"
        aria-label={label}
        aria-pressed={isFavorited}
        onClick={() =>
          (isFavorited ? removeFavorite : addFavorite).mutate({
            type: "page",
            pageId,
          })
        }
      >
        {isFavorited ? (
          <IconStarFilled size={19} color="var(--mantine-color-yellow-5)" />
        ) : (
          <IconStar size={19} stroke={1.75} />
        )}
      </ActionIcon>
    </Tooltip>
  );
}
