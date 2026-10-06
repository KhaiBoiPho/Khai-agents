import { useCallback } from "react";

import { INIT_PROMPT, type ComposerCommand } from "../features/execution/commands";
import type { DesktopUiController } from "./useDesktopUi";
import type { WorkspaceController } from "./useWorkspaceController";

export function useComposerCommands(
  controller: WorkspaceController,
  ui: DesktopUiController,
) {
  return useCallback(
    async (command: ComposerCommand) => {
      switch (command.type) {
        case "new":
          if (!(await ui.confirmDiscardInspectorDraft())) return false;
          await controller.createThread();
          return true;
        case "init":
          if (!controller.selectedThread) return false;
          return (await controller.sendTurn(INIT_PROMPT)) !== null;
        case "paper":
          if (!(await ui.confirmDiscardInspectorDraft())) return false;
          await controller.createThread("paper");
          return true;
        case "review":
          ui.openInspector("changes");
          return true;
        case "fork":
          if (!(await ui.confirmDiscardInspectorDraft())) return false;
          await controller.forkThread();
          return true;
        case "rename":
          if (controller.selectedThread) {
            await controller.renameThread(
              controller.selectedThread.id,
              command.title,
            );
          }
          return true;
        case "model":
          await controller.setThreadModel(command.model);
          return true;
        case "compact":
          if (!controller.selectedThread) return false;
          return controller.compactThread(command.instructions ?? undefined);
        case "permission":
          return controller.setAccessPreset(command.accessPreset);
      }
    },
    [controller, ui],
  );
}
