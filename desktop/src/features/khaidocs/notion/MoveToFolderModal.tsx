/*
 * Original KhaiDocs code, MIT.
 *
 * "Move to folder…": pick one of the space's folders (or the top level) for
 * a page. Docmost's own "Move" moves between spaces, which single-user mode
 * doesn't have.
 */

import { useMemo, useState } from "react";
import {
  Loader,
  Modal,
  ScrollArea,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { IconLayoutList, IconSearch } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import { PageIcon } from "./PageIcon";
import { listFolders, useMoveToFolder } from "./tree-actions";
import classes from "./sidebar.module.css";

export interface MoveToFolderModalProps {
  opened: boolean;
  onClose: () => void;
  page: { id: string; parentPageId?: string | null; spaceId: string; title?: string };
}

export function MoveToFolderModal({ opened, onClose, page }: MoveToFolderModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const moveToFolder = useMoveToFolder(page.spaceId);
  const { data: folders, isLoading } = useQuery({
    queryKey: ["khaidocs-folders", page.spaceId],
    queryFn: () => listFolders(page.spaceId),
    enabled: opened,
    staleTime: 0,
  });

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (folders ?? [])
      .filter((f) => f.id !== page.id && !f.ancestorIds.includes(page.id))
      .filter((f) => !q || `${f.path.join(" ")} ${f.title}`.toLowerCase().includes(q));
  }, [folders, query, page.id]);

  const move = async (folderId: string | null) => {
    setBusy(true);
    try {
      await moveToFolder(page.id, folderId);
      notifications.show({
        message: folderId ? t("Moved to folder") : t("Moved to the top level"),
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("Move to folder")}
      size={440}
      radius="md"
      onClick={(e) => e.stopPropagation()}
    >
      <TextInput
        placeholder={t("Search folders…")}
        leftSection={<IconSearch size={14} />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        data-autofocus
        mb="xs"
        variant="filled"
      />
      <ScrollArea.Autosize mah={320} type="auto">
        {page.parentPageId && !query && (
          <UnstyledButton
            className={classes.pickRow}
            onClick={() => move(null)}
            disabled={busy}
          >
            <IconLayoutList size={18} stroke={1.75} color="var(--kd-icon-muted)" />
            <span className={classes.pickTitle}>{t("Top level (no folder)")}</span>
          </UnstyledButton>
        )}
        {isLoading && (
          <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
            <Loader size="sm" />
          </div>
        )}
        {!isLoading && options.length === 0 && (
          <Text size="sm" c="dimmed" ta="center" py="lg">
            {folders?.length ? t("No matching folders") : t("No folders yet. Create one with “New folder”.")}
          </Text>
        )}
        {options.map((folder) => {
          const current = folder.id === page.parentPageId;
          return (
            <UnstyledButton
              key={folder.id}
              className={classes.pickRow}
              data-current={current || undefined}
              disabled={busy || current}
              onClick={() => move(folder.id)}
            >
              <PageIcon icon={folder.icon} size={18} />
              <span className={classes.pickTitle}>{folder.title || t("Untitled")}</span>
              {folder.path.length > 0 && (
                <span className={classes.pickPath}>{folder.path.join(" / ")}</span>
              )}
              {current && <span className={classes.pickPath}>{t("Current")}</span>}
            </UnstyledButton>
          );
        })}
      </ScrollArea.Autosize>
    </Modal>
  );
}
