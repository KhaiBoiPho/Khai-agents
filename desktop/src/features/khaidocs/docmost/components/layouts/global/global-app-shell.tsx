import { AppShell, Container } from "@mantine/core";
import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import SettingsSidebar from "@/components/settings/settings-sidebar.tsx";
import { useAtom } from "jotai";
import {
  asideStateAtom,
  desktopSidebarAtom,
  mobileSidebarAtom,
  sidebarWidthAtom,
} from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { SpaceSidebar } from "@/features/space/components/sidebar/space-sidebar.tsx";

const AiChatSidebar = React.lazy(
  () => import("@/ee/ai-chat/components/ai-chat-sidebar.tsx"),
);
import { AppHeader } from "@/components/layouts/global/app-header.tsx";
import Aside from "@/components/layouts/global/aside.tsx";
import classes from "./app-shell.module.css";
import { useTrialEndAction } from "@/ee/hooks/use-trial-end-action.tsx";
import { useToggleSidebar } from "@/components/layouts/global/hooks/hooks/use-toggle-sidebar.ts";
import GlobalSidebar from "@/components/layouts/global/global-sidebar.tsx";
import { ASIDE_PANEL_ID } from "@/hooks/use-toggle-aside.tsx";
import { MAIN_CONTENT_ID, SkipToMain } from "@/components/ui/skip-to-main.tsx";
// KhaiDocs: single-user mode shows the default space's sidebar everywhere.
import { SINGLE_USER } from "@/lib/khaidocs-mode.ts";
import { useDefaultSpace } from "@/components/khaidocs/default-space.tsx";
import { SidebarOpener } from "../../../../notion/SidebarOpener";

export default function GlobalAppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  useTrialEndAction();
  const [mobileOpened] = useAtom(mobileSidebarAtom);
  const toggleMobile = useToggleSidebar(mobileSidebarAtom);
  const [desktopOpened] = useAtom(desktopSidebarAtom);
  const [{ isAsideOpen, tab: asideTab }] = useAtom(asideStateAtom);
  const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef(null);

  const startResizing = React.useCallback((mouseDownEvent) => {
    mouseDownEvent.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = React.useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = React.useCallback(
    (mouseMoveEvent) => {
      if (isResizing) {
        const newWidth =
          sidebarRef.current.getBoundingClientRect().right -
          mouseMoveEvent.clientX;
        if (newWidth < 220) {
          setSidebarWidth(220);
          return;
        }
        if (newWidth > 600) {
          setSidebarWidth(600);
          return;
        }
        setSidebarWidth(newWidth);
      }
    },
    [isResizing],
  );

  useEffect(() => {
    //https://codesandbox.io/p/sandbox/kz9de
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [resize, stopResizing]);

  const location = useLocation();
  const isSettingsRoute = location.pathname.startsWith("/settings");
  const isSpaceRoute = location.pathname.startsWith("/s/");
  const isAiRoute = location.pathname.startsWith("/ai");
  const isPageRoute = location.pathname.includes("/p/");
  // KhaiDocs: with one user and one space, the space sidebar (page tree,
  // search, templates) replaces the global one on every non-settings route;
  // the global sidebar only remains while no space exists yet.
  const { space: defaultSpace } = useDefaultSpace();
  const showDefaultSpaceSidebar =
    SINGLE_USER && !!defaultSpace && !isSpaceRoute && !isSettingsRoute && !isAiRoute;
  const showSpaceSidebar = isSpaceRoute || showDefaultSpaceSidebar;
  const showGlobalSidebar =
    !showSpaceSidebar && !isSettingsRoute && !isAiRoute;
  // KhaiDocs: like Notion, no top header beside the single-user sidebar
  // (its workspace row has the account menu and the collapse button).
  const headerless = SINGLE_USER && showSpaceSidebar;

  return (
    <>
      <SkipToMain />
      <AppShell
      className={showSpaceSidebar ? classes.rightSidebar : undefined}
      // KhaiDocs: headerless single-user layout (see above).
      header={headerless ? undefined : { height: 45 }}
      data-kd-headerless={headerless || undefined}
      data-kd-sidebar-collapsed={(headerless && !desktopOpened) || undefined}
      data-kd-aside-collapsed={(isPageRoute && !isAsideOpen) || undefined}
      navbar={{
        width: showSpaceSidebar ? sidebarWidth : 300,
        breakpoint: "sm",
        collapsed: {
          mobile: !mobileOpened,
          desktop: !desktopOpened,
        },
      }}
      aside={
        isPageRoute && {
          width: 350,
          breakpoint: "sm",
          collapsed: { mobile: !isAsideOpen, desktop: !isAsideOpen },
        }
      }
      padding="md"
    >
      {headerless ? (
        <SidebarOpener side="right" />
      ) : (
      <AppShell.Header px="md" className={classes.header}>
        <AppHeader />
      </AppShell.Header>
      )}
      <AppShell.Navbar
        className={classes.navbar}
        dir={showSpaceSidebar ? "rtl" : undefined}
        withBorder={false}
        ref={sidebarRef}
        aria-label={
          showSpaceSidebar
            ? t("Space navigation")
            : isSettingsRoute
              ? t("Settings navigation")
              : isAiRoute
                ? t("AI navigation")
                : t("Main navigation")
        }
      >
        {showSpaceSidebar && (
          <div className={classes.resizeHandle} onMouseDown={startResizing} />
        )}
        {showSpaceSidebar && <SpaceSidebar />}
        {isSettingsRoute && <SettingsSidebar />}
        {isAiRoute && (
          <React.Suspense fallback={null}>
            <AiChatSidebar />
          </React.Suspense>
        )}
        {showGlobalSidebar && <GlobalSidebar />}
      </AppShell.Navbar>
      <AppShell.Main id={MAIN_CONTENT_ID} tabIndex={-1}>
        {isSettingsRoute ? (
          <Container size={900} pb={80}>
            {children}
          </Container>
        ) : (
          children
        )}
      </AppShell.Main>

      {isPageRoute && (
        <AppShell.Aside
          id={ASIDE_PANEL_ID}
          tabIndex={-1}
          className={classes.aside}
          p="md"
          withBorder={false}
          aria-label={
            asideTab === "comments"
              ? t("Comments")
              : asideTab === "toc"
                ? t("Table of contents")
                : asideTab === "chat"
                  ? t("AI Chat")
                  : asideTab === "details"
                    ? t("Details")
                    : undefined
          }
        >
          <Aside />
        </AppShell.Aside>
      )}
    </AppShell>
    </>
  );
}
