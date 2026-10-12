/*
 * KhaiDocs stand-in for an enterprise module. Original code, MIT.
 * A check button on a comment thread that resolves / re-opens it.
 */

import { ActionIcon, Tooltip } from "@mantine/core";
import { IconCircleCheck, IconCircleCheckFilled } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { isEditorReady } from "@khaidocs/editor-ext";
import { useResolveCommentMutation } from "@/ee/comment/queries/comment-query";

interface ResolveCommentProps {
  editor: any;
  commentId: string;
  pageId: string;
  resolvedAt?: Date | string | null;
}

const ResolveComment = ({ editor, commentId, pageId, resolvedAt }: ResolveCommentProps) => {
  const { t } = useTranslation();
  const mutation = useResolveCommentMutation();
  const resolved = resolvedAt != null;

  const toggle = async () => {
    try {
      await mutation.mutateAsync({ commentId, pageId, resolved: !resolved });
      if (isEditorReady(editor)) {
        editor.commands.setCommentResolved(commentId, !resolved);
      }
    } catch (error) {
      console.error("Failed to toggle resolved state:", error);
    }
  };

  return (
    <Tooltip label={resolved ? t("Re-open comment") : t("Resolve comment")} withArrow>
      <ActionIcon
        variant="default"
        style={{ border: "none" }}
        onClick={toggle}
        loading={mutation.isPending}
        aria-label={resolved ? t("Re-open comment") : t("Resolve comment")}
      >
        {resolved ? <IconCircleCheckFilled size={18} /> : <IconCircleCheck size={18} />}
      </ActionIcon>
    </Tooltip>
  );
};

export default ResolveComment;
