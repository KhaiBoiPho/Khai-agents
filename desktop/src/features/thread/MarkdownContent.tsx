import { Check, Copy } from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import {
  memo,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { useThemeIsDark } from "../../app/useThemeIsDark";
import { CitationLink } from "./CitationLink";
import { linkCitations, parseCitationHref, useCitationHandler } from "./citations";
import styles from "./MarkdownContent.module.css";

interface MarkdownContentProps {
  children: string;
  compact?: boolean;
}

interface CodeBlockProps {
  code: string;
  language: string;
}

function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const darkMode = useThemeIsDark();

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const copy = async () => {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
  };

  return (
    <figure className={styles.codeBlock}>
      <figcaption>
        <span>{language || "text"}</span>
        <button type="button" onClick={() => void copy()} aria-label="Copy code">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
      <Highlight
        theme={darkMode ? themes.vsDark : themes.github}
        code={code}
        language={language || "text"}
      >
        {({ tokens, getLineProps, getTokenProps }) => (
          <pre>
            {tokens.map((line, lineIndex) => (
              <span {...getLineProps({ line })} key={lineIndex}>
                {line.map((token, tokenIndex) => (
                  <span {...getTokenProps({ token })} key={tokenIndex} />
                ))}
                {"\n"}
              </span>
            ))}
          </pre>
        )}
      </Highlight>
    </figure>
  );
}

function ExternalLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
    >
      {children}
    </a>
  );
}

function MarkdownLink({
  node,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
  void node;
  const openCitation = useCitationHandler();
  const citation = openCitation ? parseCitationHref(props.href) : null;
  if (citation && openCitation) {
    return (
      <CitationLink {...citation} onOpen={openCitation}>
        {props.children}
      </CitationLink>
    );
  }
  return <ExternalLink {...props} />;
}

// Module scope keeps these referentially stable: an inline object would hand
// react-markdown new component types on every render and remount every node.
const REMARK_PLUGINS = [remarkGfm];

const MARKDOWN_COMPONENTS: Components = {
  a: MarkdownLink,
  pre: ({ children: preChildren }) => <>{preChildren}</>,
  code: ({ node, className, children: codeChildren, ...props }) => {
    void node;
    const code = String(codeChildren).replace(/\n$/, "");
    const language = /language-([\w-]+)/.exec(className ?? "")?.[1] ?? "";
    const block = Boolean(language) || String(codeChildren).includes("\n");
    if (block) {
      return <CodeBlock code={code} language={language} />;
    }
    return (
      <code {...props} className={className}>
        {codeChildren as ReactNode}
      </code>
    );
  },
};

export const MarkdownContent = memo(function MarkdownContent({
  children,
  compact = false,
}: MarkdownContentProps) {
  const openCitation = useCitationHandler();
  const markdown = useMemo(
    () => (openCitation ? linkCitations(children) : children),
    [children, openCitation],
  );
  return (
    <div className={styles.markdown} data-compact={compact}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        skipHtml
        components={MARKDOWN_COMPONENTS}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
});
