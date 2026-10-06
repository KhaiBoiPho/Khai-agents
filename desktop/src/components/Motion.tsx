import type { ReactNode } from "react";

import styles from "./Motion.module.css";

const join = (...names: Array<string | undefined | false>) =>
  names.filter(Boolean).join(" ");

/** A label whose text carries a light sweep while `active`. */
export function ShimmerText({
  active = true,
  className,
  children,
}: {
  active?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return <span className={join(active && styles.shimmer, className)}>{children}</span>;
}

/** Three breathing dots in the current text colour. */
export function LoadingDots({ className }: { className?: string }) {
  return (
    <span className={join(styles.dots, className)} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

/** A dot sending out a ripple: something is live right now. */
export function LiveDot({ className }: { className?: string }) {
  return <span className={join(styles.liveDot, className)} aria-hidden="true" />;
}

/** A thin ring for the one step that is currently running. */
export function StepSpinner({ className }: { className?: string }) {
  return <span className={join(styles.stepSpinner, className)} aria-hidden="true" />;
}

/** Pops its content in on mount — e.g. a check replacing a step ring. */
export function PopIn({ children }: { children: ReactNode }) {
  return <span className={styles.pop}>{children}</span>;
}
