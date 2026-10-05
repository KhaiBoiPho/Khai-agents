import { useEffect, useState } from "react";
import { App } from "./App";
import { BrowserRuntime } from "./rpc/browserRuntime";
import { FolderPicker } from "./components/FolderPicker";
import styles from "./webShell.module.css";

declare const __WEB_BUILD_ID__: string;

export function BrowserShell() {
  const [picker, setPicker] = useState<{
    resolve(value: string | null): void;
  } | null>(null);
  const [runtime] = useState(
    () =>
      new BrowserRuntime({
        buildId: __WEB_BUILD_ID__,
        chooseDirectory: () =>
          new Promise((resolve) => {
            setPicker({ resolve });
          }),
      }),
  );
  useEffect(() => {
    const dispose = () => runtime.dispose();
    // Opening a fresh access link in this tab only changes its fragment.
    // Reload so the new document exchanges the ticket before connecting.
    const openAccessLink = () => {
      if (new URLSearchParams(location.hash.slice(1)).has("ticket"))
        location.reload();
    };
    window.addEventListener("pagehide", dispose);
    window.addEventListener("hashchange", openAccessLink);
    return () => {
      window.removeEventListener("pagehide", dispose);
      window.removeEventListener("hashchange", openAccessLink);
      dispose();
    };
  }, [runtime]);
  const closePicker = (value: string | null) => {
    picker?.resolve(value);
    setPicker(null);
  };
  return (
    <div className={styles.shell}>
      <div className={styles.app}>
        <App
          runtime={runtime}
          onSignOut={() =>
            void runtime
              .logout()
              .catch(() => undefined)
              .finally(() => location.reload())
          }
        />
      </div>
      {picker && (
        <FolderPicker
          runtime={runtime}
          onChoose={(chosen) => closePicker(chosen)}
          onCancel={() => closePicker(null)}
        />
      )}
    </div>
  );
}
