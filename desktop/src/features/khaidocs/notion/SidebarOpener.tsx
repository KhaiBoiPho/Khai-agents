/*
 * Original KhaiDocs code, MIT.
 *
 * With Docmost's top header gone (single-user mode), this is how a closed
 * sidebar comes back: a small "»" button in the top-left corner, like
 * Notion's.
 */

import { Tooltip } from "@mantine/core";
import { IconChevronsRight } from "@tabler/icons-react";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import {
  desktopSidebarAtom,
  mobileSidebarAtom,
} from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { useToggleSidebar } from "@/components/layouts/global/hooks/hooks/use-toggle-sidebar.ts";
import classes from "./home.module.css";

export function SidebarOpener({ side = "left" }: { side?: "left" | "right" }) {
  const { t } = useTranslation();
  const [desktopOpened] = useAtom(desktopSidebarAtom);
  const [mobileOpened] = useAtom(mobileSidebarAtom);
  const toggleDesktop = useToggleSidebar(desktopSidebarAtom);
  const toggleMobile = useToggleSidebar(mobileSidebarAtom);

  return (
    <>
      {!desktopOpened && (
        <Tooltip label={t("Open sidebar")} openDelay={300}>
          <button
            type="button"
            className={`${classes.opener} ${classes.openerDesktop} ${side === "right" ? classes.openerRight : ""}`}
            onClick={toggleDesktop}
            aria-label={t("Open sidebar")}
          >
            <IconChevronsRight size={18} stroke={1.75} />
          </button>
        </Tooltip>
      )}
      {!mobileOpened && (
        <button
          type="button"
          className={`${classes.opener} ${classes.openerMobile} ${side === "right" ? classes.openerRight : ""}`}
          onClick={toggleMobile}
          aria-label={t("Open sidebar")}
        >
          <IconChevronsRight size={18} stroke={1.75} />
        </button>
      )}
    </>
  );
}
