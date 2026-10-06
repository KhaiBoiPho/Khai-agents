/*
 * Original KhaiDocs code, MIT.
 *
 * The template gallery: search, category filter, a grid of template cards
 * and a read-only preview of the selected one. Built-in templates come from
 * ./manifest; "My templates" are the ones saved from pages (localStorage).
 */

import { useMemo, useState } from "react";
import {
  ActionIcon,
  Box,
  Button,
  Chip,
  Group,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Tooltip,
  Typography,
  UnstyledButton,
} from "@mantine/core";
import { IconFilePlus, IconSearch, IconTrash } from "@tabler/icons-react";
import { modals } from "@mantine/modals";
import { useTranslation } from "react-i18next";
import DOMPurify from "dompurify";
import { markdownToHtml } from "@docmost/editor-ext";
import { PageIcon } from "../notion/PageIcon";
import { BUILTIN_TEMPLATES, PageTemplate, TEMPLATE_CATEGORIES } from "./manifest";
import {
  CategoryFilter,
  buildTemplateDocument,
  filterTemplates,
  splitTitle,
} from "./template-markdown";
import { deleteUserTemplate } from "./user-templates";
import { useUserTemplates } from "./use-user-templates";
import classes from "./template-gallery.module.css";

interface TemplateGalleryProps {
  /** Creates a page from the template; the gallery shows a busy state. */
  onUse: (template: PageTemplate) => void;
  /** Id of the template being created, if any. */
  creatingId?: string | null;
  /** False when there is no space to create in yet. */
  canCreate?: boolean;
  /** Height of the scrolling panes. */
  height?: number | string;
}

function TemplatePreview({ template }: { template: PageTemplate }) {
  const html = useMemo(() => {
    const doc = buildTemplateDocument(template);
    // The title is shown above; the preview is the page body.
    const body = splitTitle(doc.markdown).body;
    try {
      return DOMPurify.sanitize(String(markdownToHtml(body)));
    } catch {
      return "";
    }
  }, [template]);
  return (
    <Typography className={classes.preview}>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </Typography>
  );
}

export default function TemplateGallery({
  onUse,
  creatingId = null,
  canCreate = true,
  height = 520,
}: TemplateGalleryProps) {
  const { t } = useTranslation();
  const userTemplates = useUserTemplates();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("All");
  const [selectedId, setSelectedId] = useState<string>(BUILTIN_TEMPLATES[0].id);

  const all = useMemo(
    () => [...userTemplates, ...BUILTIN_TEMPLATES],
    [userTemplates],
  );
  const categories = useMemo(
    () =>
      TEMPLATE_CATEGORIES.filter((c) =>
        c === "My templates"
          ? userTemplates.length > 0
          : BUILTIN_TEMPLATES.some((b) => b.category === c),
      ),
    [userTemplates.length],
  );
  const visible = filterTemplates(all, query, category);
  const selected =
    visible.find((tpl) => tpl.id === selectedId) ?? visible[0] ?? null;

  const confirmDelete = (template: PageTemplate) => {
    modals.openConfirmModal({
      title: t("Delete template"),
      centered: true,
      children: (
        <Text size="sm">
          {t('Delete "{{title}}" from My templates? Pages made from it are not affected.', {
            title: template.title,
          })}
        </Text>
      ),
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => deleteUserTemplate(template.id),
    });
  };

  return (
    <Stack gap="sm">
      <Group gap="sm" wrap="wrap">
        <TextInput
          className={classes.search}
          leftSection={<IconSearch size={16} />}
          placeholder={t("Search templates")}
          aria-label={t("Search templates")}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          data-autofocus
        />
        <Chip.Group
          multiple={false}
          value={category}
          onChange={(value) => setCategory((value as CategoryFilter) || "All")}
        >
          <Group gap={6} wrap="wrap">
            <Chip value="All" size="xs" variant="light">
              {t("All")}
            </Chip>
            {categories.map((c) => (
              <Chip key={c} value={c} size="xs" variant="light">
                {t(c)}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
      </Group>

      <div className={classes.panes} style={{ height }}>
        <ScrollArea className={classes.gridPane} type="auto" offsetScrollbars>
          {visible.length === 0 ? (
            <Text c="dimmed" size="sm" p="md">
              {t("No templates match your search.")}
            </Text>
          ) : (
            <div className={classes.grid} role="listbox" aria-label={t("Templates")}>
              {visible.map((template) => (
                <UnstyledButton
                  key={template.id}
                  className={classes.card}
                  data-selected={selected?.id === template.id || undefined}
                  role="option"
                  aria-selected={selected?.id === template.id}
                  onClick={() => setSelectedId(template.id)}
                  onDoubleClick={() => canCreate && !creatingId && onUse(template)}
                >
                  <span className={classes.icon} aria-hidden>
                    <PageIcon icon={template.icon} size={24} />
                  </span>
                  <Box style={{ minWidth: 0 }}>
                    <Text fw={500} size="sm" lineClamp={1}>
                      {template.title}
                    </Text>
                    <Text c="dimmed" size="xs" lineClamp={2}>
                      {template.description || t("Saved from a page")}
                    </Text>
                  </Box>
                </UnstyledButton>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className={classes.previewPane}>
          {selected ? (
            <>
              <Group justify="space-between" wrap="nowrap" className={classes.previewHeader}>
                <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                  <span className={classes.previewIcon} aria-hidden>
                    <PageIcon icon={selected.icon} size={20} />
                  </span>
                  <Text fw={600} lineClamp={1}>
                    {selected.title}
                  </Text>
                </Group>
                <Group gap="xs" wrap="nowrap">
                  {selected.user && (
                    <Tooltip label={t("Delete template")} withArrow>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={t("Delete template")}
                        onClick={() => confirmDelete(selected)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                  <Button
                    size="xs"
                    leftSection={<IconFilePlus size={16} />}
                    loading={creatingId === selected.id}
                    disabled={!canCreate || (!!creatingId && creatingId !== selected.id)}
                    onClick={() => onUse(selected)}
                  >
                    {t("Use template")}
                  </Button>
                </Group>
              </Group>
              <ScrollArea className={classes.previewScroll} type="auto">
                <TemplatePreview template={selected} />
              </ScrollArea>
            </>
          ) : (
            <Text c="dimmed" size="sm" p="md">
              {t("Select a template to preview it.")}
            </Text>
          )}
        </div>
      </div>
    </Stack>
  );
}
