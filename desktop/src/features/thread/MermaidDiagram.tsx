import { useEffect, useId, useState, type ReactNode } from "react";

import { useThemeIsDark } from "../../app/useThemeIsDark";
import styles from "./MarkdownContent.module.css";

interface Props {
  code: string;
  /** The plain code block, shown until the diagram renders or if it fails. */
  fallback: ReactNode;
}

/** Wait for the text to stop changing (a diagram still streaming in). */
const SETTLE_MS = 350;

type Mermaid = typeof import("mermaid").default;
let loader: Promise<Mermaid> | null = null;
let initializedFor: boolean | null = null;

function loadMermaid(dark: boolean): Promise<Mermaid> {
  loader ??= import("mermaid").then((module) => module.default);
  return loader.then((mermaid) => {
    if (initializedFor !== dark) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: dark ? "dark" : "default",
        fontFamily: "inherit",
      });
      initializedFor = dark;
    }
    return mermaid;
  });
}

/**
 * A ```mermaid block drawn as a diagram. Mermaid loads on first use only,
 * renders once the code settles, and its SVG is sanitized before insertion.
 * Invalid diagrams fall back to the code with a short note.
 */
export function MermaidDiagram({ code, fallback }: Props) {
  const dark = useThemeIsDark();
  const id = `mmd-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const mermaid = await loadMermaid(dark);
          await mermaid.parse(code);
          const { svg: rendered } = await mermaid.render(`${id}-${Date.now()}`, code);
          const { default: DOMPurify } = await import("dompurify");
          const clean = DOMPurify.sanitize(rendered, {
            USE_PROFILES: { svg: true, svgFilters: true, html: true },
            ADD_TAGS: ["foreignObject"],
          });
          if (alive) { setSvg(clean); setFailed(false); }
        } catch {
          if (alive) { setSvg(null); setFailed(true); }
        }
      })();
    }, SETTLE_MS);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [code, dark, id]);

  if (!svg || showCode) {
    return (
      <div className={styles.mermaid}>
        {failed ? <p className={styles.mermaidNote}>Không vẽ được sơ đồ này — hiển thị mã gốc.</p> : null}
        {svg ? <button type="button" className={styles.mermaidToggle} onClick={() => setShowCode(false)}>Xem sơ đồ</button> : null}
        {fallback}
      </div>
    );
  }
  return (
    <figure className={styles.mermaid}>
      <button type="button" className={styles.mermaidToggle} onClick={() => setShowCode(true)}>Xem mã</button>
      <div className={styles.mermaidCanvas} dangerouslySetInnerHTML={{ __html: svg }} />
    </figure>
  );
}
