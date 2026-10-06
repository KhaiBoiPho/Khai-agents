/*
 * Original KhaiDocs code, MIT.
 *
 * The workspace's logo and name at the top of the sidebar. It is a label,
 * not a menu: KhaiDocs settings live in the app's Settings window.
 */

import { useAtomValue } from "jotai";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom.ts";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import { AvatarIconType } from "@/features/attachments/types/attachment.types.ts";
import classes from "./sidebar.module.css";

export function WorkspaceBadge() {
  const workspace = useAtomValue(currentUserAtom)?.workspace;
  return (
    <div className={classes.workspaceBadge}>
      <CustomAvatar
        avatarUrl={workspace?.logo}
        name={workspace?.name}
        variant="filled"
        size="sm"
        type={AvatarIconType.WORKSPACE_ICON}
      />
      <span>{workspace?.name}</span>
    </div>
  );
}
