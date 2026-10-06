import { lazy, Suspense } from "react";

import { LoadingDots } from "../../../components/Motion";

// Loads Docmost only when this section opens, like the KhaiDocs page does.
const KhaiDocsApp = lazy(() => import("khaidocs-app"));

/** KhaiDocs' workspace, profile and preferences settings. */
export function KhaiDocsSettingsPage() {
  return (
    <Suspense fallback={<LoadingDots />}>
      <KhaiDocsApp view="settings" />
    </Suspense>
  );
}
