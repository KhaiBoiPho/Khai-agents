import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "@/components/layouts/global/layout.tsx";
import { Error404 } from "@/components/ui/error-404.tsx";
import { isCloud } from "@/lib/config.ts";
import { useTranslation } from "react-i18next";
import { useRedirectToCloudSelect } from "@/ee/hooks/use-redirect-to-cloud-select.tsx";
import { useTrackOrigin } from "@/hooks/use-track-origin";
// KhaiDocs: single-user mode and our own templates (MIT, ../templates).
import { SINGLE_USER } from "@/lib/khaidocs-mode.ts";
import { DefaultSpaceRedirect } from "@/components/khaidocs/default-space.tsx";


// KhaiDocs has no sign-in of its own: the Khai session is the identity, so
// there are no login, signup, reset, invite, setup, MFA, SSO, session or
// API-key screens (the routes below send those paths home).
const Home = lazy(() => import("@/pages/dashboard/home"));
const Page = lazy(() => import("@/pages/page/page"));
const WorkspaceMembers = lazy(
  () => import("@/pages/settings/workspace/workspace-members"),
);
const WorkspaceSettings = lazy(
  () => import("@/pages/settings/workspace/workspace-settings"),
);
const Groups = lazy(() => import("@/pages/settings/group/groups"));
const GroupInfo = lazy(() => import("./pages/settings/group/group-info"));
const Spaces = lazy(() => import("@/pages/settings/space/spaces.tsx"));
const AccountPreferences = lazy(
  () => import("@/pages/settings/account/account-preferences.tsx"),
);
const SpaceHome = lazy(() => import("@/pages/space/space-home.tsx"));
const PageRedirect = lazy(() => import("@/pages/page/page-redirect.tsx"));
const Billing = lazy(() => import("@/ee/billing/pages/billing.tsx"));
const SharedPage = lazy(() => import("@/pages/share/shared-page.tsx"));
const PdfRenderPage = lazy(() => import("@/ee/pdf-export/pdf-render-page.tsx"));
const Shares = lazy(() => import("@/pages/settings/shares/shares.tsx"));
const ShareLayout = lazy(
  () => import("@/features/share/components/share-layout.tsx"),
);
const ShareRedirect = lazy(() => import("@/pages/share/share-redirect.tsx"));
const PublicSpacePage = lazy(
  () => import("@/pages/public-space/public-space-page.tsx"),
);
const PublicSpaceLayout = lazy(
  () => import("@/features/public-space/components/public-space-layout.tsx"),
);
const PublicSpaceDirectoryPage = lazy(
  () => import("@/pages/public-space/public-space-directory-page.tsx"),
);
const SpacesPage = lazy(() => import("@/pages/spaces/spaces.tsx"));
const SpaceTrash = lazy(() => import("@/pages/space/space-trash.tsx"));
const AiSettings = lazy(() => import("@/ee/ai/pages/ai-settings.tsx"));
const BasePage = lazy(() => import("@/ee/base/pages/base-page.tsx"));
const AuditLogs = lazy(() => import("@/ee/audit/pages/audit-logs.tsx"));
const VerifiedPages = lazy(
  () => import("@/ee/page-verification/pages/verified-pages.tsx"),
);
// KhaiDocs: /templates is our own gallery, not an enterprise tier's.
const TemplatesPage = lazy(() => import("../templates/TemplatesPage"));
const FavoritesPage = lazy(() => import("@/pages/favorites/favorites-page"));
const AiChat = lazy(() => import("@/ee/ai-chat/pages/ai-chat.tsx"));
const LabelPage = lazy(() => import("@/pages/label/label-page"));

export default function App() {
  const { t } = useTranslation();
  useRedirectToCloudSelect();
  useTrackOrigin();

  useEffect(() => {
    // warm the editor chunk so opening a page doesn't wait on the network
    const timer = setTimeout(() => import("@/pages/page/page"), 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Suspense fallback={null}>
      <Routes>
        <Route index element={<Navigate to="/home" />} />
        {/* No KhaiDocs sign-in: stale links to those screens land home. */}
        {[
          "/login",
          "/login/mfa",
          "/login/mfa/setup",
          "/signup",
          "/forgot-password",
          "/password-reset",
          "/invites/:invitationId",
          "/oauth/consent",
          "/setup/register",
          "/create",
          "/select",
          "/verify-email",
        ].map((path) => (
          <Route key={path} path={path} element={<Navigate to="/home" replace />} />
        ))}

        <Route element={<ShareLayout />}>
          <Route
            path={"/share/:shareId/p/:pageSlug"}
            element={<SharedPage />}
          />
          <Route path={"/share/p/:pageSlug"} element={<SharedPage />} />
        </Route>

        <Route path={"/docs"} element={<PublicSpaceDirectoryPage />} />
        <Route element={<PublicSpaceLayout />}>
          <Route path={"/docs/:spaceSlug"} element={<PublicSpacePage />} />
          <Route
            path={"/docs/:spaceSlug/:pageSlug"}
            element={<PublicSpacePage />}
          />
        </Route>

        <Route path={"/pdf-render/:pageId"} element={<PdfRenderPage />} />
        <Route path={"/share/:shareId"} element={<ShareRedirect />} />
        <Route path={"/p/:pageSlug"} element={<PageRedirect />} />

        <Route element={<Layout />}>
          <Route
            path={"/home"}
            element={
              // KhaiDocs: single-user mode lands on the default space.
              SINGLE_USER ? <DefaultSpaceRedirect fallback={<Home />} /> : <Home />
            }
          />
          <Route path={"/ai"} element={<AiChat />} />
          <Route path={"/ai/chat/:chatId"} element={<AiChat />} />
          <Route
            path={"/spaces"}
            element={SINGLE_USER ? <Navigate to="/home" replace /> : <SpacesPage />}
          />
          <Route path={"/favorites"} element={<FavoritesPage />} />
          <Route path={"/labels/:labelName"} element={<LabelPage />} />
          <Route path={"/templates"} element={<TemplatesPage />} />
          <Route
            path={"/templates/:templateId"}
            element={<Navigate to="/templates" replace />}
          />
          <Route path={"/s/:spaceSlug"} element={<SpaceHome />} />
          <Route path={"/s/:spaceSlug/trash"} element={<SpaceTrash />} />
          <Route
            path={"/s/:spaceSlug/p/:pageSlug"}
            element={<Page />}
          />

          <Route path={"/base/:pageId"} element={<BasePage />} />

          <Route path={"/settings"}>
            {/* The account itself (name, password) is edited in Khai's Settings. */}
            <Route
              path={"account/profile"}
              element={<Navigate to="/settings/account/preferences" replace />}
            />
            <Route
              path={"account/preferences"}
              element={<AccountPreferences />}
            />
            <Route path={"workspace"} element={<WorkspaceSettings />} />
            {/* KhaiDocs: single-user mode has no members, groups, spaces
                list or public sharing; those pages go to the default space. */}
            <Route
              path={"members"}
              element={SINGLE_USER ? <Navigate to="/home" replace /> : <WorkspaceMembers />}
            />
            <Route
              path={"groups"}
              element={SINGLE_USER ? <Navigate to="/home" replace /> : <Groups />}
            />
            <Route
              path={"groups/:groupId"}
              element={SINGLE_USER ? <Navigate to="/home" replace /> : <GroupInfo />}
            />
            <Route
              path={"spaces"}
              element={SINGLE_USER ? <Navigate to="/home" replace /> : <Spaces />}
            />
            <Route
              path={"sharing"}
              element={SINGLE_USER ? <Navigate to="/home" replace /> : <Shares />}
            />
            <Route path={"ai"} element={<AiSettings />} />
            <Route path={"ai/mcp"} element={<AiSettings />} />
            <Route path={"audit"} element={<AuditLogs />} />
            <Route path={"audit/siem"} element={<AuditLogs />} />
            <Route
              path={"siem"}
              element={<Navigate to="/settings/audit/siem" replace />}
            />
            <Route path={"verifications"} element={<VerifiedPages />} />
            {isCloud() && <Route path={"billing"} element={<Billing />} />}
          </Route>
        </Route>

        <Route path="*" element={<Error404 />} />
      </Routes>
    </Suspense>
  );
}
