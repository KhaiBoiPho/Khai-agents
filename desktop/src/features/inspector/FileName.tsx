import styles from "./FileName.module.css";

interface Props {
  name: string;
  className?: string;
}

/**
 * A file name that truncates in the middle of its stem and always keeps the
 * extension: `bao_cao_kinh_te…2026.md`, so look-alike files stay apart.
 */
export function FileName({ name, className }: Props) {
  const dot = name.lastIndexOf(".");
  const hasExt = dot > 0 && name.length - dot <= 8;
  const stem = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : "";
  // The stem's last few characters stay visible beside the extension.
  const tail = stem.length > 12 ? stem.slice(-4) : "";
  const head = tail ? stem.slice(0, -4) : stem;
  return (
    <span className={`${styles.name} ${className ?? ""}`} title={name}>
      <span className={styles.head}>{head}</span>
      <span className={styles.tail}>{tail}{ext}</span>
    </span>
  );
}
