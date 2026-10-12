import { ThemeIcon } from "@mantine/core";
import { IconFileDescription, IconTable } from "@tabler/icons-react";
import { PageIcon } from "../../../notion/PageIcon"; // KhaiDocs

type Props = {
  icon?: string | null;
  isBase?: boolean;
};

export function PageListIcon({ icon, isBase }: Props) {
  if (icon) {
    // KhaiDocs: PageIcon renders emoji and line icons.
    return <PageIcon icon={icon} size={18} />;
  }
  return (
    <ThemeIcon variant="transparent" color="gray" size={18}>
      {isBase ? <IconTable size={18} /> : <IconFileDescription size={18} />}
    </ThemeIcon>
  );
}
