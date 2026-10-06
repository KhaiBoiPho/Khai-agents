/*
 * Original KhaiDocs code, MIT.
 *
 * "Save as template" from a page's ••• menu: stores the page's Markdown
 * (see page-markdown.ts) under "My templates" in this browser.
 */

import { useEffect, useState } from "react";
import { Button, Group, Modal, Stack, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { addUserTemplate } from "./user-templates";

interface SaveAsTemplateModalProps {
  opened: boolean;
  onClose: () => void;
  pageTitle?: string;
  pageIcon?: string | null;
  /** Reads the page's Markdown (title heading included) when saving. */
  getMarkdown: () => Promise<string>;
}

export default function SaveAsTemplateModal({
  opened,
  onClose,
  pageTitle,
  pageIcon,
  getMarkdown,
}: SaveAsTemplateModalProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (opened) {
      setTitle(pageTitle?.trim() || t("Untitled"));
      setDescription("");
    }
  }, [opened, pageTitle, t]);

  const save = async () => {
    let markdown: string;
    setSaving(true);
    try {
      markdown = await getMarkdown();
    } catch (error) {
      console.error("KhaiDocs: reading the page as Markdown failed", error);
      notifications.show({ color: "red", message: t("Could not read this page.") });
      return;
    } finally {
      setSaving(false);
    }
    const saved = addUserTemplate({
      title,
      description,
      icon: pageIcon,
      markdown,
    });
    if (!saved) {
      notifications.show({
        color: "red",
        message: t("Could not save the template (browser storage is unavailable or full)."),
      });
      return;
    }
    notifications.show({
      message: t('Saved "{{title}}" to My templates', { title: saved.title }),
    });
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title={t("Save as template")} centered>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Stack gap="sm">
          <TextInput
            label={t("Template name")}
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            required
            data-autofocus
          />
          <TextInput
            label={t("Description")}
            placeholder={t("Optional")}
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={!title.trim()} loading={saving}>
              {t("Save template")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
