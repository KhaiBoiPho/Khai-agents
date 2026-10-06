// The typed boundary to KhaiDocs. vite.config.ts aliases "khaidocs-app" to
// src/features/khaidocs/KhaiDocsApp.tsx; the app's own tsc sees only this
// declaration, so Docmost's code is checked under tsconfig.khaidocs.json
// with the loose settings it was written for, not the app's strict ones.
declare module "khaidocs-app" {
  import type { ComponentType } from "react";

  const KhaiDocsApp: ComponentType<{ view?: "app" | "settings" }>;
  export default KhaiDocsApp;
}
