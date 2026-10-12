/*
 * Original KhaiDocs code, MIT.
 *
 * KhaiDocs' own settings — workspace and preferences — shown inside
 * the app's Settings window instead of a menu in the KhaiDocs sidebar.
 */

import { lazy, Suspense, useState } from "react";
import { Loader, SegmentedControl } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { UserProvider } from "@/features/user/user-provider.tsx";

const WorkspaceSettings = lazy(() => import("@/pages/settings/workspace/workspace-settings"));
const AccountPreferences = lazy(() => import("@/pages/settings/account/account-preferences.tsx"));

// No profile tab: the account (name, password) is Khai's own, in Khai's Settings.
type Tab = "workspace" | "preferences";

export function KhaiDocsSettings() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("workspace");
  return (
    <UserProvider>
      <div className="khaidocs-settings">
        <SegmentedControl
          value={tab}
          onChange={(value) => setTab(value as Tab)}
          data={[
            { value: "workspace", label: t("Workspace") },
            { value: "preferences", label: t("My preferences") },
          ]}
          mb="lg"
        />
        <Suspense fallback={<Loader size="sm" />}>
          {tab === "workspace" && <WorkspaceSettings />}
          {tab === "preferences" && <AccountPreferences />}
        </Suspense>
      </div>
    </UserProvider>
  );
}
