import { Group, Text, Select } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { setLocale } from "../../../../../../app/i18n";

export default function AccountLanguage() {
  const { t } = useTranslation();

  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <div>
        <Text size="md">{t("Language")}</Text>
        <Text size="sm" c="dimmed">
          {t("Choose your preferred interface language.")}
        </Text>
      </div>
      <LanguageSwitcher />
    </Group>
  );
}

// KhaiDocs: English and Vietnamese only, and one choice for the whole app —
// KhaiDocs follows Khai's interface language (see KhaiDocsApp), so picking one
// here changes Khai's language too.
function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  return (
    <Select
      label={t("Select language")}
      data={[
        { value: "en-US", label: "English (US)" },
        { value: "vi-VN", label: "Tiếng Việt" },
      ]}
      value={i18n.language === "vi-VN" ? "vi-VN" : "en-US"}
      onChange={(value) => value && setLocale(value === "vi-VN" ? "vi" : "en")}
      allowDeselect={false}
      checkIconPosition="right"
    />
  );
}
