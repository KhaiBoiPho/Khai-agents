/*
 * Original KhaiDocs code, MIT.
 *
 * The template gallery in a modal: "New page from template" from the
 * sidebar and the space menu. Pages are created in the given space (the
 * current one, or the default space in single-user mode).
 */

import { Modal, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import TemplateGallery from "./TemplateGallery";
import { useCreatePageFromTemplate } from "./use-create-from-template";

interface TemplateGalleryModalProps {
  opened: boolean;
  onClose: () => void;
  spaceId?: string;
  spaceSlug?: string;
}

export default function TemplateGalleryModal({
  opened,
  onClose,
  spaceId,
  spaceSlug,
}: TemplateGalleryModalProps) {
  const { t } = useTranslation();
  const { create, creatingId } = useCreatePageFromTemplate({
    id: spaceId,
    slug: spaceSlug,
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size={1040}
      centered
      title={
        <Text fw={600} size="lg">
          {t("New page from template")}
        </Text>
      }
    >
      <TemplateGallery
        height="min(560px, 62cqh)"
        canCreate={!!spaceId}
        creatingId={creatingId}
        onUse={async (template) => {
          const page = await create(template);
          if (page) onClose();
        }}
      />
    </Modal>
  );
}
