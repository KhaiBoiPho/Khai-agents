/*
 * Original KhaiDocs code, MIT.
 *
 * The workspace home in single-user mode, after Notion's: a greeting, a row
 * of "Recently visited" cards, quick actions, and the recently edited pages.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useAtomValue } from "jotai";
import { Skeleton } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconClock,
  IconFilePlus,
  IconFolderPlus,
  IconLayoutGrid,
  IconTemplate,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom.ts";
import { useRecentChangesQuery } from "@/features/page/queries/page-query.ts";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import { useTimeAgo } from "@/hooks/use-time-ago.tsx";
import type { ISpace } from "@/features/space/types/space.types.ts";
import { DocumentTitle } from "@/components/ui/document-title.tsx";
import TemplateGalleryModal from "../templates/TemplateGalleryModal";
import { PageIcon } from "./PageIcon";
import { coverBackground, parseCover, getPageCover } from "./covers";
import { RecentPage, useRecentPages } from "./recents";
import { useCreateNode } from "./tree-actions";
import classes from "./home.module.css";

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return "Good evening";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** The home shows the five most recent pages, no more. */
const RECENT_CARDS = 5;

interface CardPage {
  id: string;
  slugId: string;
  title: string;
  icon: string | null;
  isBase?: boolean;
  when?: string | Date;
}

export function KhaiDocsHome({ space }: { space: ISpace }) {
  const { t } = useTranslation();
  const currentUser = useAtomValue(currentUserAtom);
  // Vietnamese names put the given name last: "Nguyễn Quang Khải" → "Khải".
  const firstName = currentUser?.user?.name?.trim().split(/\s+/).pop();
  const visits = useRecentPages();
  const { data, isLoading } = useRecentChangesQuery(space.id);
  const edited = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const createNode = useCreateNode(space);
  const [templatesOpened, templates] = useDisclosure(false);

  // Recently visited first, topped up with recent edits.
  const cards: CardPage[] = useMemo(() => {
    const fromVisits: CardPage[] = visits
      .filter((v: RecentPage) => v.spaceSlug === space.slug)
      .map((v) => ({ id: v.id, slugId: v.slugId, title: v.title, icon: v.icon, when: v.visitedAt }));
    const seen = new Set(fromVisits.map((c) => c.id));
    const fromEdits: CardPage[] = edited
      .filter((p) => !seen.has(p.id))
      .map((p) => ({ id: p.id, slugId: p.slugId, title: p.title, icon: p.icon, isBase: p.isBase, when: p.updatedAt }));
    return [...fromVisits, ...fromEdits].slice(0, RECENT_CARDS);
  }, [visits, edited, space.slug]);

  return (
    <div className={classes.home}>
      <DocumentTitle title={t("Home")} />
      <h1 className={classes.greeting}>
        {t(greeting())}
        {firstName ? `, ${firstName}` : ""}
      </h1>

      <section className={classes.block}>
        <h2 className={classes.blockTitle}>
          <IconClock size={14} stroke={2} /> {t("Recently visited")}
        </h2>
        {isLoading && cards.length === 0 ? (
          <div className={classes.cards}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className={classes.card} height={136} radius={12} />
            ))}
          </div>
        ) : cards.length === 0 ? (
          <p className={classes.emptyText}>{t("Pages you open will show up here.")}</p>
        ) : (
          <div className={classes.cards}>
            {cards.map((c) => (
              <RecentCard key={c.id} page={c} spaceSlug={space.slug} />
            ))}
          </div>
        )}
      </section>

      <section className={classes.block}>
        <h2 className={classes.blockTitle}>
          <IconLayoutGrid size={14} stroke={2} /> {t("Get started")}
        </h2>
        <div className={classes.actions}>
          <button type="button" className={classes.action} onClick={() => createNode(null, "page")}>
            <IconFilePlus size={18} stroke={1.75} />
            <span>{t("New page")}</span>
          </button>
          <button type="button" className={classes.action} onClick={() => createNode(null, "folder")}>
            <IconFolderPlus size={18} stroke={1.75} />
            <span>{t("New folder")}</span>
          </button>
          <button type="button" className={classes.action} onClick={templates.open}>
            <IconTemplate size={18} stroke={1.75} />
            <span>{t("From a template")}</span>
          </button>
        </div>
      </section>

      <section className={classes.block}>
        <h2 className={classes.blockTitle}>{t("Recently edited")}</h2>
        {isLoading ? (
          <Skeleton height={160} radius={8} />
        ) : edited.length === 0 ? (
          <p className={classes.emptyText}>{t("No pages yet.")}</p>
        ) : (
          <div className={classes.list}>
            {edited.slice(0, 12).map((p) => (
              <ListRow
                key={p.id}
                page={{ id: p.id, slugId: p.slugId, title: p.title, icon: p.icon, isBase: p.isBase, when: p.updatedAt }}
                spaceSlug={space.slug}
              />
            ))}
          </div>
        )}
      </section>

      {templatesOpened && (
        <TemplateGalleryModal
          opened={templatesOpened}
          onClose={templates.close}
          spaceId={space.id}
          spaceSlug={space.slug}
        />
      )}
    </div>
  );
}

function RecentCard({ page, spaceSlug }: { page: CardPage; spaceSlug: string }) {
  const { t } = useTranslation();
  const when = useTimeAgo(page.when);
  const cover = parseCover(getPageCover(page.id));
  return (
    <Link to={buildPageUrl(spaceSlug, page.slugId, page.title)} className={classes.card}>
      <div
        className={classes.cardTop}
        style={cover ? { background: coverBackground(cover) } : undefined}
        data-has-cover={!!cover || undefined}
      />
      <div className={classes.cardIcon}>
        <PageIcon icon={page.icon} isBase={page.isBase} size={26} />
      </div>
      <div className={classes.cardBody}>
        <div className={classes.cardTitle}>{page.title || t("Untitled")}</div>
        {when && <div className={classes.cardMeta}>{when}</div>}
      </div>
    </Link>
  );
}

function ListRow({ page, spaceSlug }: { page: CardPage; spaceSlug: string }) {
  const { t } = useTranslation();
  const when = useTimeAgo(page.when);
  return (
    <Link to={buildPageUrl(spaceSlug, page.slugId, page.title)} className={classes.row}>
      <PageIcon icon={page.icon} isBase={page.isBase} size={20} />
      <span className={classes.rowTitle}>{page.title || t("Untitled")}</span>
      <span className={classes.rowMeta}>{when}</span>
    </Link>
  );
}
