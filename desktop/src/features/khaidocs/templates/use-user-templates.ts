/*
 * Original KhaiDocs code, MIT.
 *
 * React view of the saved templates in user-templates.ts; follows changes
 * from this tab (USER_TEMPLATES_EVENT) and other windows (storage event).
 */

import { useEffect, useState } from "react";
import type { PageTemplate } from "./manifest";
import {
  USER_TEMPLATES_EVENT,
  USER_TEMPLATES_KEY,
  loadUserTemplates,
} from "./user-templates";

export function useUserTemplates(): PageTemplate[] {
  const [templates, setTemplates] = useState<PageTemplate[]>(() =>
    loadUserTemplates(),
  );
  useEffect(() => {
    const reload = () => setTemplates(loadUserTemplates());
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === USER_TEMPLATES_KEY) reload();
    };
    window.addEventListener(USER_TEMPLATES_EVENT, reload);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(USER_TEMPLATES_EVENT, reload);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return templates;
}
