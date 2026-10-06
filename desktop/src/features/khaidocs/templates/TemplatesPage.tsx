/*
 * Original KhaiDocs code, MIT.
 *
 * The /templates route (the sidebar's Templates entry also opens the
 * gallery as a modal; this page is for direct links). New pages go to the
 * default space.
 */

import { Container, Text, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { DocumentTitle } from "@/components/ui/document-title.tsx";
import { useDefaultSpace } from "@/components/khaidocs/default-space.tsx";
import TemplateGallery from "./TemplateGallery";
import { useCreatePageFromTemplate } from "./use-create-from-template";

export default function TemplatesPage() {
  const { t } = useTranslation();
  const { space } = useDefaultSpace();
  const { create, creatingId } = useCreatePageFromTemplate({
    id: space?.id,
    slug: space?.slug,
  });

  return (
    <>
      <DocumentTitle title={t("Templates")} />
      <Container size={1100} pt="xl">
        <Title order={2} size="h3" mb={4}>
          {t("Templates")}
        </Title>
        <Text c="dimmed" size="sm" mb="lg">
          {t("Start a page from a template. Save any page as a template from its ••• menu.")}
        </Text>
        <TemplateGallery
          height="min(640px, 70cqh)"
          canCreate={!!space}
          creatingId={creatingId}
          onUse={create}
        />
      </Container>
    </>
  );
}
