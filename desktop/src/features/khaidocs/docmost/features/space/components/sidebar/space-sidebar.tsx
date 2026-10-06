import {
  ActionIcon,
  Group,
  Menu,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconArrowDown,
  IconDots,
  IconEye,
  IconEyeOff,
  IconFileExport,
  IconHome,
  IconPlus,
  IconSearch,
  IconSettings,
  IconStar,
  IconStarFilled,
  IconTemplate,
  IconTrash,
} from "@tabler/icons-react";
import {
  useSpaceWatchStatusQuery,
  useWatchSpaceMutation,
  useUnwatchSpaceMutation,
} from "@/features/space/queries/space-watcher-query.ts";
import classes from "./space-sidebar.module.css";
import React from "react";
import { useAtom } from "jotai";
import { useTreeMutation } from "@/features/page/tree/hooks/use-tree-mutation.ts";
import { Link, useLocation, useParams } from "react-router-dom";
import clsx from "clsx";
import { useDisclosure } from "@mantine/hooks";
import SpaceSettingsModal from "@/features/space/components/settings-modal.tsx";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query.ts";
import { getSpaceUrl, isBetaPublicSpaces } from "@/lib/config.ts";
import SpaceTree from "@/features/page/tree/components/space-tree.tsx";
import { useSpaceAbility } from "@/features/space/permissions/use-space-ability.ts";
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from "@/features/space/permissions/permissions.type.ts";
import PageImportModal from "@/features/page/components/page-import-modal.tsx";
import { useTranslation } from "react-i18next";
import { SwitchSpace } from "./switch-space";
import ExportModal from "@/components/common/export-modal";
import {
  useFavoriteIds,
  useAddFavoriteMutation,
  useRemoveFavoriteMutation,
} from "@/features/favorite/queries/favorite-query";
import { mobileSidebarAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { useToggleSidebar } from "@/components/layouts/global/hooks/hooks/use-toggle-sidebar.ts";
import { searchSpotlight } from "@/features/search/constants";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import { AvatarIconType } from "@/features/attachments/types/attachment.types.ts";
// KhaiDocs: our own template gallery (MIT) replaces Docmost Enterprise's
// template picker, and single-user mode trims the space chrome.
import TemplateGalleryModal from "../../../../../templates/TemplateGalleryModal";
import { SINGLE_USER } from "@/lib/khaidocs-mode.ts";
import { useDefaultSpace } from "@/components/khaidocs/default-space.tsx";
import { KhaiDocsSidebar } from "../../../../../notion/Sidebar";

export function SpaceSidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const [opened, { open: openSettings, close: closeSettings }] =
    useDisclosure(false);
  const [mobileSidebarOpened] = useAtom(mobileSidebarAtom);
  const toggleMobileSidebar = useToggleSidebar(mobileSidebarAtom);

  const params = useParams();
  // KhaiDocs: outside /s/… routes (single-user mode) show the default space.
  const { space: defaultSpace } = useDefaultSpace();
  const spaceSlug = params.spaceSlug ?? (SINGLE_USER ? defaultSpace?.slug : undefined);
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);
  const [templatesOpened, { open: openTemplates, close: closeTemplates }] =
    useDisclosure(false);

  const spaceRules = space?.membership?.permissions;
  const spaceAbility = useSpaceAbility(spaceRules);
  const { handleCreate } = useTreeMutation(space?.id ?? "");

  if (!space) {
    return <></>;
  }

  // KhaiDocs: single-user mode uses the Notion-style sidebar (MIT,
  // notion/Sidebar.tsx): Search, Home, Recents, Favorites, Private
  // (this page tree, with folders), Templates and Trash.
  if (SINGLE_USER) {
    return (
      <KhaiDocsSidebar
        space={space}
        canManagePages={spaceAbility.can(
          SpaceCaslAction.Manage,
          SpaceCaslSubject.Page,
        )}
      />
    );
  }

  function handleCreatePage() {
    handleCreate(null);
  }

  return (
    <>
      <div className={classes.navbar}>
        <div
          className={classes.section}
          style={{
            border: "none",
            marginTop: 2,
            marginBottom: 3,
          }}
        >
          <Group
            gap={4}
            wrap="nowrap"
            justify="space-between"
            style={{ width: "100%" }}
          >
            {SINGLE_USER ? (
              // KhaiDocs: one space, so its name without the space switcher.
              <SpaceTitle space={space} />
            ) : (
              <SwitchSpace
                spaceName={space?.name}
                spaceSlug={space?.slug}
                spaceIcon={space?.logo}
                isPublished={isBetaPublicSpaces() && space?.isPublished}
              />
            )}
          </Group>
        </div>

        <div className={classes.section}>
          <div className={classes.menuItems}>
            <UnstyledButton
              component={Link}
              to={getSpaceUrl(spaceSlug)}
              className={clsx(
                classes.menu,
                location.pathname.toLowerCase() === getSpaceUrl(spaceSlug)
                  ? classes.activeButton
                  : "",
              )}
            >
              <div className={classes.menuItemInner}>
                <IconHome
                  size={18}
                  className={classes.menuItemIcon}
                  stroke={2}
                />
                <span>{t("Overview")}</span>
              </div>
            </UnstyledButton>

            <UnstyledButton
              className={classes.menu}
              onClick={searchSpotlight.open}
            >
              <div className={classes.menuItemInner}>
                <IconSearch
                  size={18}
                  className={classes.menuItemIcon}
                  stroke={2}
                />
                <span>{t("Search")}</span>
              </div>
            </UnstyledButton>

            {SINGLE_USER ? (
              // KhaiDocs: Favorites instead of space settings (still in the
              // space menu below).
              <UnstyledButton
                component={Link}
                to="/favorites"
                className={clsx(
                  classes.menu,
                  location.pathname === "/favorites" ? classes.activeButton : "",
                )}
              >
                <div className={classes.menuItemInner}>
                  <IconStar size={18} className={classes.menuItemIcon} stroke={2} />
                  <span>{t("Favorites")}</span>
                </div>
              </UnstyledButton>
            ) : (
              <UnstyledButton className={classes.menu} onClick={openSettings}>
                <div className={classes.menuItemInner}>
                  <IconSettings
                    size={18}
                    className={classes.menuItemIcon}
                    stroke={2}
                  />
                  <span>{t("Space settings")}</span>
                </div>
              </UnstyledButton>
            )}

            {spaceAbility.can(
              SpaceCaslAction.Manage,
              SpaceCaslSubject.Page,
            ) && (
              <UnstyledButton
                className={classes.menu}
                onClick={() => {
                  handleCreatePage();
                  if (mobileSidebarOpened) {
                    toggleMobileSidebar();
                  }
                }}
              >
                <div className={classes.menuItemInner}>
                  <IconPlus
                    size={18}
                    className={classes.menuItemIcon}
                    stroke={2}
                  />
                  <span>{t("New page")}</span>
                </div>
              </UnstyledButton>
            )}

            {/* KhaiDocs: new page from one of our templates. */}
            {spaceAbility.can(
              SpaceCaslAction.Manage,
              SpaceCaslSubject.Page,
            ) && (
              <UnstyledButton
                className={classes.menu}
                onClick={() => {
                  openTemplates();
                  if (mobileSidebarOpened) {
                    toggleMobileSidebar();
                  }
                }}
              >
                <div className={classes.menuItemInner}>
                  <IconTemplate
                    size={18}
                    className={classes.menuItemIcon}
                    stroke={2}
                  />
                  <span>{t("Templates")}</span>
                </div>
              </UnstyledButton>
            )}
          </div>
        </div>

        <div className={clsx(classes.section, classes.sectionPages)}>
          <Group className={classes.pagesHeader} justify="space-between">
            <Text size="xs" fw={500} c="dimmed">
              {t("Pages")}
            </Text>

            <Group gap="xs">
              <SpaceMenu
                spaceId={space.id}
                canManagePages={spaceAbility.can(
                  SpaceCaslAction.Manage,
                  SpaceCaslSubject.Page,
                )}
                onSpaceSettings={openSettings}
                onTemplates={openTemplates}
                spaceSlug={space.slug}
              />

              {spaceAbility.can(
                SpaceCaslAction.Manage,
                SpaceCaslSubject.Page,
              ) && (
                <Tooltip label={t("Create page")} withArrow position="right">
                  <ActionIcon
                    variant="default"
                    size={18}
                    onClick={handleCreatePage}
                    aria-label={t("Create page")}
                  >
                    <IconPlus />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          </Group>

          <div className={classes.pages}>
            <SpaceTree
              spaceId={space.id}
              readOnly={spaceAbility.cannot(
                SpaceCaslAction.Manage,
                SpaceCaslSubject.Page,
              )}
            />
          </div>
        </div>
      </div>

      <SpaceSettingsModal
        opened={opened}
        onClose={closeSettings}
        spaceId={space?.slug}
      />

      {templatesOpened && (
        <TemplateGalleryModal
          opened={templatesOpened}
          onClose={closeTemplates}
          spaceId={space.id}
          spaceSlug={space.slug}
        />
      )}
    </>
  );
}

/** KhaiDocs: the space's name and icon, for single-user mode. */
function SpaceTitle({ space }: { space: { name: string; logo?: string } }) {
  return (
    <Group gap="xs" wrap="nowrap" px="sm" py={6} style={{ minWidth: 0 }}>
      <CustomAvatar
        name={space.name}
        avatarUrl={space.logo}
        type={AvatarIconType.SPACE_ICON}
        color="initials"
        variant="filled"
        size={20}
      />
      <Text size="md" fw={500} lineClamp={1}>
        {space.name}
      </Text>
    </Group>
  );
}

interface SpaceMenuProps {
  spaceId: string;
  canManagePages: boolean;
  onSpaceSettings: () => void;
  onTemplates: () => void;
  spaceSlug: string;
}
function SpaceMenu({
  spaceId,
  canManagePages,
  onSpaceSettings,
  onTemplates,
  spaceSlug,
}: SpaceMenuProps) {
  const { t } = useTranslation();
  const [importOpened, { open: openImportModal, close: closeImportModal }] =
    useDisclosure(false);
  const [exportOpened, { open: openExportModal, close: closeExportModal }] =
    useDisclosure(false);

  const { data: watchStatus } = useSpaceWatchStatusQuery(spaceId);
  const watchMutation = useWatchSpaceMutation();
  const unwatchMutation = useUnwatchSpaceMutation();
  const isWatching = watchStatus?.watching ?? false;

  const favoriteIds = useFavoriteIds("space");
  const addFavoriteMutation = useAddFavoriteMutation();
  const removeFavoriteMutation = useRemoveFavoriteMutation();
  const isFavorited = favoriteIds.has(spaceId);

  const handleToggleFavorite = () => {
    const params = { type: "space" as const, spaceId };
    if (isFavorited) {
      removeFavoriteMutation.mutate(params);
    } else {
      addFavoriteMutation.mutate(params);
    }
  };

  const handleToggleWatch = () => {
    if (isWatching) {
      unwatchMutation.mutate(spaceId);
    } else {
      watchMutation.mutate(spaceId);
    }
  };

  return (
    <>
      <Menu width={200} shadow="md" withArrow>
        <Menu.Target>
          <Tooltip label={t("Space menu")} withArrow position="top">
            <ActionIcon
              variant="default"
              size={18}
              aria-label={t("Space menu")}
            >
              <IconDots />
            </ActionIcon>
          </Tooltip>
        </Menu.Target>

        <Menu.Dropdown>
          {/* KhaiDocs: favoriting or watching the only space means nothing
              to a single user. */}
          {!SINGLE_USER && (
          <>
          <Menu.Item
            onClick={handleToggleFavorite}
            leftSection={
              isFavorited ? (
                <IconStarFilled
                  size={16}
                  color="var(--mantine-color-yellow-filled)"
                />
              ) : (
                <IconStar size={16} />
              )
            }
          >
            {isFavorited ? t("Remove from favorites") : t("Add to favorites")}
          </Menu.Item>

          <Menu.Item
            onClick={handleToggleWatch}
            leftSection={
              isWatching ? <IconEyeOff size={16} /> : <IconEye size={16} />
            }
          >
            {isWatching ? t("Stop watching space") : t("Watch space")}
          </Menu.Item>
          </>
          )}

          {canManagePages && (
            <>
              {!SINGLE_USER && <Menu.Divider />}
              {/* KhaiDocs: our template gallery (was Enterprise-only). */}
              <Menu.Item
                onClick={onTemplates}
                leftSection={<IconTemplate size={16} />}
              >
                {t("New from template")}
              </Menu.Item>
            </>
          )}

          {canManagePages && (
            <>
              <Menu.Divider />

              <Menu.Item
                onClick={openImportModal}
                leftSection={<IconArrowDown size={16} />}
              >
                {t("Import pages")}
              </Menu.Item>

              <Menu.Item
                onClick={openExportModal}
                leftSection={<IconFileExport size={16} />}
              >
                {t("Export space")}
              </Menu.Item>

              <Menu.Divider />

              <Menu.Item
                onClick={onSpaceSettings}
                leftSection={<IconSettings size={16} />}
              >
                {t("Space settings")}
              </Menu.Item>

              <Menu.Item
                component={Link}
                to={`/s/${spaceSlug}/trash`}
                leftSection={<IconTrash size={16} />}
              >
                {t("Trash")}
              </Menu.Item>
            </>
          )}
        </Menu.Dropdown>
      </Menu>

      {canManagePages && (
        <>
          <PageImportModal
            spaceId={spaceId}
            open={importOpened}
            onClose={closeImportModal}
          />

          <ExportModal
            type="space"
            id={spaceId}
            open={exportOpened}
            onClose={closeExportModal}
          />
        </>
      )}
    </>
  );
}
