/*
 * Original KhaiDocs code, MIT.
 *
 * The single-user, Notion-style sidebar: workspace row, Search and Home,
 * then Recents, Favorites and "Private" (the default space's page tree, with
 * folders), and Templates / Trash at the bottom. Replaces Docmost's space
 * sidebar in single-user mode (see space-sidebar.tsx).
 */

import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAtom } from "jotai";
import { Menu, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconArrowDown,
  IconChevronsLeft,
  IconFileExport,
  IconFilePlus,
  IconFolderPlus,
  IconHome,
  IconPlus,
  IconSearch,
  IconSettings,
  IconTemplate,
  IconTrash,
  IconDots,
  IconEdit,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { WorkspaceBadge } from "./WorkspaceBadge";
import SpaceTree from "@/features/page/tree/components/space-tree.tsx";
import PageImportModal from "@/features/page/components/page-import-modal.tsx";
import ExportModal from "@/components/common/export-modal";
import SpaceSettingsModal from "@/features/space/components/settings-modal.tsx";
import { searchSpotlight } from "@/features/search/constants";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import { getSpaceUrl } from "@/lib/config.ts";
import { useFavoritesQuery } from "@/features/favorite/queries/favorite-query";
import {
  desktopSidebarAtom,
  mobileSidebarAtom,
} from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { useToggleSidebar } from "@/components/layouts/global/hooks/hooks/use-toggle-sidebar.ts";
import type { ISpace } from "@/features/space/types/space.types.ts";
import TemplateGalleryModal from "../templates/TemplateGalleryModal";
import { PageIcon } from "./PageIcon";
import { pruneRecents, useRecentPages } from "./recents";
import { getPageById } from "@/features/page/services/page-service.ts";
import { useCreateNode } from "./tree-actions";
import classes from "./sidebar.module.css";

const COLLAPSED_KEY = "khaidocs:sidebar-sections";

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function useSectionState() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  return { collapsed, toggle };
}

export function KhaiDocsSidebar({
  space,
  canManagePages,
}: {
  space: ISpace;
  canManagePages: boolean;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const { collapsed, toggle } = useSectionState();
  const [templatesOpened, templates] = useDisclosure(false);
  const [settingsOpened, settings] = useDisclosure(false);
  const [importOpened, importModal] = useDisclosure(false);
  const [exportOpened, exportModal] = useDisclosure(false);
  const [mobileOpened] = useAtom(mobileSidebarAtom);
  const toggleMobile = useToggleSidebar(mobileSidebarAtom);
  const toggleDesktop = useToggleSidebar(desktopSidebarAtom);
  const createNode = useCreateNode(space);
  const allRecents = useRecentPages();
  const recents = allRecents.filter((r) => r.spaceSlug === space.slug);
  useEffect(() => {
    void pruneRecents((pageId) => getPageById({ pageId }));
  }, [allRecents]);
  const { data: favData } = useFavoritesQuery("page", space.id);
  const favorites = favData?.pages.flatMap((p) => p.items).filter((f) => f.page) ?? [];

  const closeMobile = () => mobileOpened && toggleMobile();
  const homeUrl = getSpaceUrl(space.slug);
  const path = location.pathname.toLowerCase();

  return (
    <div className={classes.sidebar}>
      <div className={classes.workspaceRow}>
        <div className={classes.workspaceMenu}>
          <WorkspaceBadge />
        </div>
        <Tooltip label={t("Close sidebar")} openDelay={400}>
          <button
            type="button"
            className={classes.collapseButton}
            onClick={() => {
              if (mobileOpened) toggleMobile();
              else toggleDesktop();
            }}
            aria-label={t("Close sidebar")}
          >
            <IconChevronsLeft size={18} stroke={1.75} />
          </button>
        </Tooltip>
        {canManagePages && (
          <Tooltip label={t("New page")} openDelay={400}>
            <button
              type="button"
              className={classes.collapseButton}
              data-always
              onClick={() => {
                createNode(null, "page");
                closeMobile();
              }}
              aria-label={t("New page")}
            >
              <IconEdit size={17} stroke={1.75} />
            </button>
          </Tooltip>
        )}
      </div>

      <nav className={classes.navRows}>
        <NavRow icon={<IconSearch size={18} stroke={1.75} />} label={t("Search")} onClick={searchSpotlight.open} />
        <NavRow
          icon={<IconHome size={18} stroke={1.75} />}
          label={t("Home")}
          to={homeUrl}
          active={path === homeUrl.toLowerCase()}
          onClick={closeMobile}
        />
        {canManagePages && (
          <NavRow
            icon={<IconTemplate size={18} stroke={1.75} />}
            label={t("Templates")}
            onClick={() => {
              templates.open();
              closeMobile();
            }}
          />
        )}
        <NavRow
          icon={<IconTrash size={18} stroke={1.75} />}
          label={t("Trash")}
          to={`/s/${space.slug}/trash`}
          active={path === `/s/${space.slug}/trash`.toLowerCase()}
          onClick={closeMobile}
        />
      </nav>

      <div className={classes.scroll}>
        {recents.length > 0 && (
          <Section id="recents" title={t("Recents")} collapsed={collapsed} onToggle={toggle}>
            {recents.slice(0, 5).map((r) => (
              <PageLinkRow
                key={r.id}
                to={buildPageUrl(r.spaceSlug, r.slugId, r.title)}
                icon={r.icon}
                title={r.title || t("Untitled")}
                active={path.endsWith(`-${r.slugId}`.toLowerCase()) || path.endsWith(`/${r.slugId}`.toLowerCase())}
                onClick={closeMobile}
              />
            ))}
          </Section>
        )}

        {favorites.length > 0 && (
          <Section id="favorites" title={t("Favorites")} collapsed={collapsed} onToggle={toggle}>
            {favorites.map((f) => (
              <PageLinkRow
                key={f.id}
                to={buildPageUrl(space.slug, f.page.slugId, f.page.title)}
                icon={f.page.icon}
                isBase={f.page.isBase}
                title={f.page.title || t("Untitled")}
                onClick={closeMobile}
              />
            ))}
          </Section>
        )}

        <Section
          id="private"
          title={t("Private")}
          collapsed={collapsed}
          onToggle={toggle}
          actions={
            canManagePages && (
              <>
                <Menu position="bottom-start" width={220} withinPortal>
                  <Menu.Target>
                    <button type="button" className={classes.sectionAction} aria-label={t("Space menu")}>
                      <IconDots size={15} stroke={1.75} />
                    </button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item leftSection={<IconFolderPlus size={16} />} onClick={() => createNode(null, "folder")}>
                      {t("New folder")}
                    </Menu.Item>
                    <Menu.Item leftSection={<IconTemplate size={16} />} onClick={templates.open}>
                      {t("New from template")}
                    </Menu.Item>
                    <Menu.Divider />
                    <Menu.Item leftSection={<IconArrowDown size={16} />} onClick={importModal.open}>
                      {t("Import pages")}
                    </Menu.Item>
                    <Menu.Item leftSection={<IconFileExport size={16} />} onClick={exportModal.open}>
                      {t("Export space")}
                    </Menu.Item>
                    <Menu.Item leftSection={<IconSettings size={16} />} onClick={settings.open}>
                      {t("Space settings")}
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
                <Menu position="bottom-start" width={200} withinPortal>
                  <Menu.Target>
                    <button type="button" className={classes.sectionAction} aria-label={t("Add a page")}>
                      <IconPlus size={15} stroke={2} />
                    </button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item leftSection={<IconFilePlus size={16} />} onClick={() => createNode(null, "page")}>
                      {t("New page")}
                    </Menu.Item>
                    <Menu.Item leftSection={<IconFolderPlus size={16} />} onClick={() => createNode(null, "folder")}>
                      {t("New folder")}
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </>
            )
          }
        >
          <div className={classes.treeHost}>
            <SpaceTree spaceId={space.id} readOnly={!canManagePages} />
          </div>
        </Section>

      </div>

      {templatesOpened && (
        <TemplateGalleryModal
          opened={templatesOpened}
          onClose={templates.close}
          spaceId={space.id}
          spaceSlug={space.slug}
        />
      )}
      <SpaceSettingsModal opened={settingsOpened} onClose={settings.close} spaceId={space.slug} />
      {canManagePages && (
        <>
          <PageImportModal spaceId={space.id} open={importOpened} onClose={importModal.close} />
          <ExportModal type="space" id={space.id} open={exportOpened} onClose={exportModal.close} />
        </>
      )}
    </div>
  );
}

function NavRow({
  icon,
  label,
  to,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  to?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className={classes.navIcon}>{icon}</span>
      <span className={classes.navLabel}>{label}</span>
    </>
  );
  return to ? (
    <Link to={to} className={classes.navRow} data-active={active || undefined} onClick={onClick}>
      {content}
    </Link>
  ) : (
    <button type="button" className={classes.navRow} onClick={onClick}>
      {content}
    </button>
  );
}

function PageLinkRow({
  to,
  icon,
  isBase,
  title,
  active,
  onClick,
}: {
  to: string;
  icon: string | null;
  isBase?: boolean;
  title: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link to={to} className={classes.navRow} data-active={active || undefined} onClick={onClick}>
      <span className={classes.navIcon}>
        <PageIcon icon={icon} isBase={isBase} size={18} />
      </span>
      <span className={classes.navLabel}>{title}</span>
    </Link>
  );
}

function Section({
  id,
  title,
  collapsed,
  onToggle,
  actions,
  children,
}: {
  id: string;
  title: string;
  collapsed: Record<string, boolean>;
  onToggle: (id: string) => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const isCollapsed = !!collapsed[id];
  return (
    <section className={classes.section}>
      <div className={classes.sectionHeader}>
        <button
          type="button"
          className={classes.sectionTitle}
          onClick={() => onToggle(id)}
          aria-expanded={!isCollapsed}
        >
          {title}
        </button>
        {actions && <div className={classes.sectionActions}>{actions}</div>}
      </div>
      {!isCollapsed && children}
    </section>
  );
}
