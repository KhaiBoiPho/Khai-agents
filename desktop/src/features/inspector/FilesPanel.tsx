/**
 * Files tab, laid out like Claude Desktop's file viewer: open-file tabs on
 * top, an explorer column on the left (resizable, hideable) and the file on
 * the right, with Markdown shown rendered and a toggle to its source.
 */

import {
  BookOpenCheck,
  ChevronsDownUp,
  Code2,
  Download,
  Eye,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Save,
  Search,
  X,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { useThemeIsDark } from "../../app/useThemeIsDark";
import { confirmAction } from "../../platform/confirmAction";
import { MarkdownContent } from "../thread/MarkdownContent";
import type { CodeWorkbenchController } from "../workbench/useCodeWorkbench";
import { documentKind } from "./documentKinds";
import { subscribeFilePreview, type LineRange } from "./filePreviewRequests";
import { FileIcon } from "./FileIcon";
import { FileTree } from "./FileTree";
import { InspectorEmpty } from "./InspectorEmpty";
import { languageFor } from "./inspectorFormat";
import { ancestorsOf, buildTree, directoryPaths, filterTree } from "./treeModel";
import type { DocumentIndexController } from "./useDocumentIndex";
import { displayFileName } from "../../app/fileNames";
import styles from "./FilesPanel.module.css";

const LocalMonacoEditor = lazy(() => import("../workbench/LocalMonacoEditor"));

/** The parts of a mounted Monaco editor a citation reveal uses. */
interface MonacoEditorInstance {
  getModel(): { getValue(): string; getLineCount(): number } | null;
  revealLinesInCenter(start: number, end: number): void;
  createDecorationsCollection(
    decorations: Array<{
      range: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
      };
      options: { isWholeLine: boolean; className: string };
    }>,
  ): { clear(): void };
}
const DocumentViewer = lazy(() => import("./DocumentViewer"));

const TREE_KEY = "khai-agents.files-tree";
const DEFAULT_TREE_WIDTH = 240;

function readTreeLayout(): { visible: boolean; width: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(TREE_KEY) ?? "null");
    if (saved && typeof saved.width === "number" && typeof saved.visible === "boolean") {
      return { visible: saved.visible, width: Math.min(560, Math.max(160, saved.width)) };
    }
  } catch {
    // Fall through to the default layout.
  }
  return { visible: true, width: DEFAULT_TREE_WIDTH };
}

function saveTreeLayout(layout: { visible: boolean; width: number }) {
  try {
    localStorage.setItem(TREE_KEY, JSON.stringify(layout));
  } catch {
    // The layout just isn't remembered.
  }
}

const isMarkdown = (path: string) => /\.(md|mdx|markdown)$/i.test(path);
const baseName = displayFileName;

interface FilesPanelProps {
  trusted: boolean;
  hasActiveTurn: boolean;
  workbench: CodeWorkbenchController;
  onDownload?: (path: string) => Promise<void>;
  /** Raw bytes of a workspace file, for document previews (web client). */
  readBytes?: (path: string) => Promise<ArrayBuffer>;
  /** Document-search index of this workspace (Knowledge bar + tree badges). */
  knowledge?: DocumentIndexController;
  /** When set, only these files (and their folders) are listed. */
  onlyPaths?: ReadonlySet<string> | null;
}

/** "12 documents indexed", "Indexing 3 of 12…", or why search is off. */
function knowledgeSummary(knowledge: DocumentIndexController): string | null {
  const status = knowledge.status;
  if (!status || status.counts.total === 0) return null;
  const { indexed, pending, failed, total } = status.counts;
  const plural = (n: number) => (n === 1 ? "document" : "documents");
  if (status.state === "indexing" && status.progress) {
    return `Indexing ${Math.min(status.progress.done + 1, status.progress.total)} of ${status.progress.total}…`;
  }
  if (!status.configured) return `${total} ${plural(total)} · search needs an OpenRouter key`;
  const parts = [`${indexed} ${plural(indexed)} indexed`];
  if (pending) parts.push(`${pending} pending`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(" · ");
}

export function FilesPanel({
  trusted,
  hasActiveTurn,
  workbench,
  onDownload,
  readBytes,
  knowledge,
  onlyPaths = null,
}: FilesPanelProps) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [layout, setLayout] = useState(readTreeLayout);
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [showSource, setShowSource] = useState(false);
  // A PDF/Office/CSV document shown in place of the text file; documents
  // never go through the text editor.
  const [activeDoc, setActiveDoc] = useState<string | null>(null);
  // Lines a citation asked to show, revealed once that file is in the editor.
  const [reveal, setReveal] = useState<{ path: string; lines: LineRange } | null>(null);
  const [editor, setEditor] = useState<MonacoEditorInstance | null>(null);
  const highlightRef = useRef<{ clear(): void } | null>(null);
  const revealedRef = useRef<typeof reveal>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const darkMode = useThemeIsDark();
  const file = workbench.file;
  const dirty = Boolean(file && workbench.draft !== file.content);

  const entries = useMemo(() => {
    if (!onlyPaths) return workbench.entries;
    const folders = new Set([...onlyPaths].flatMap((path) => ancestorsOf(path)));
    return workbench.entries.filter((entry) =>
      entry.kind === "directory" ? folders.has(entry.path) : onlyPaths.has(entry.path),
    );
  }, [onlyPaths, workbench.entries]);
  const tree = useMemo(() => buildTree(entries), [entries]);
  const filtered = useMemo(() => filterTree(tree, query), [tree, query]);
  // While filtering, every surviving folder is shown open.
  const shownExpanded = useMemo(
    () => (query.trim() ? new Set(directoryPaths(filtered)) : expanded),
    [expanded, filtered, query],
  );

  // A file opened from elsewhere (Changes, a chat link) gets a tab and its
  // folders revealed. Adjusted while rendering, React's pattern for state
  // that follows a prop, once per file so folders can be collapsed again.
  const [revealedPath, setRevealedPath] = useState<string | null>(null);
  if (file && file.path !== revealedPath) {
    setRevealedPath(file.path);
    if (!openPaths.includes(file.path)) setOpenPaths([...openPaths, file.path]);
    const missing = ancestorsOf(file.path).filter((path) => !expanded.has(path));
    if (missing.length) {
      missing.forEach((path) => void workbench.loadDirectory(path));
      setExpanded(new Set([...expanded, ...missing]));
    }
  }

  const toggleFolder = (path: string, open?: boolean) => {
    const opening = open ?? !expanded.has(path);
    // Folders past the first two levels are listed when first opened.
    if (opening) void workbench.loadDirectory(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (opening) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  const confirmLeavingDraft = async () =>
    !dirty ||
    (await confirmAction(
      "Discard the unsaved editor draft and open another file? Your edits cannot be recovered.",
      { confirmLabel: "Discard draft" },
    ));

  const activePath = activeDoc ?? file?.path ?? null;

  const openFile = async (path: string) => {
    if (path === activePath) return;
    setOpenPaths((current) => (current.includes(path) ? current : [...current, path]));
    if (documentKind(path)) {
      // The text draft stays in the workbench; switching away loses nothing.
      setActiveDoc(path);
      return;
    }
    if (path !== file?.path && !(await confirmLeavingDraft())) return;
    setActiveDoc(null);
    if (path !== file?.path) await workbench.openFile(path);
  };

  const closeTab = async (path: string) => {
    const index = openPaths.indexOf(path);
    const remaining = openPaths.filter((candidate) => candidate !== path);
    if (path !== activePath) {
      setOpenPaths(remaining);
      if (path === file?.path) workbench.closeFile();
      return;
    }
    if (!activeDoc && !(await confirmLeavingDraft())) return;
    setOpenPaths(remaining);
    setActiveDoc(null);
    const neighbour = remaining[Math.min(index, remaining.length - 1)];
    if (neighbour) await openFile(neighbour);
    else if (file) workbench.closeFile();
  };

  // "Open" on a chat document card: show that file here. The latest openFile
  // is read through a ref so one subscription lives for the panel's lifetime.
  const openFileRef = useRef(openFile);
  useEffect(() => {
    openFileRef.current = openFile;
  });
  useEffect(
    () =>
      subscribeFilePreview((path, lines) => {
        setReveal(lines ? { path, lines } : null);
        void openFileRef.current(path);
      }),
    [],
  );

  useEffect(() => {
    if (!reveal || reveal === revealedRef.current) return;
    if (!editor || file?.path !== reveal.path) return;
    const model = editor.getModel();
    if (!model || model.getValue() !== workbench.draft) return;
    const last = model.getLineCount();
    const start = Math.min(reveal.lines.start, last);
    const end = Math.min(Math.max(reveal.lines.end, start), last);
    editor.revealLinesInCenter(start, end);
    highlightRef.current?.clear();
    highlightRef.current = editor.createDecorationsCollection([
      {
        range: { startLineNumber: start, startColumn: 1, endLineNumber: end, endColumn: 1 },
        options: { isWholeLine: true, className: styles.citedLine },
      },
    ]);
    revealedRef.current = reveal;
  }, [editor, file?.path, reveal, workbench.draft]);

  const loadDoc = useCallback(
    () =>
      readBytes && activeDoc
        ? readBytes(activeDoc)
        : Promise.reject(new Error("Previews of this file type need the web client.")),
    [activeDoc, readBytes],
  );

  const updateLayout = (next: { visible: boolean; width: number }) => {
    setLayout(next);
    saveTreeLayout(next);
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const body = bodyRef.current;
    if (!body) return;
    event.preventDefault();
    const left = body.getBoundingClientRect().left;
    let width = layout.width;
    const move = (moveEvent: PointerEvent) => {
      width = Math.min(560, Math.max(160, moveEvent.clientX - left));
      setLayout({ visible: true, width });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      saveTreeLayout({ visible: true, width });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const fileCount = entries.filter((entry) => entry.kind !== "directory").length;
  const readOnly = !trusted || hasActiveTurn || Boolean(file?.truncated);
  const rendered = Boolean(file && isMarkdown(file.path) && !showSource);

  return (
    <div className={styles.view}>
      <div className={styles.tabBar}>
        {layout.visible ? null : (
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => updateLayout({ ...layout, visible: true })}
            title="Show file tree"
            aria-label="Show file tree"
          >
            <PanelLeftOpen size={15} />
          </button>
        )}
        <div className={styles.fileTabs} role="tablist" aria-label="Open files">
          {openPaths.map((path) => {
            const active = path === activePath;
            return (
              <div key={path} className={styles.fileTab} data-active={active || undefined}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={path}
                  onClick={() => void openFile(path)}
                >
                  <FileIcon name={baseName(path)} size={13} />
                  <span>{baseName(path)}</span>
                  {active && dirty ? <i className={styles.dirtyDot} aria-label="Unsaved" /> : null}
                </button>
                <button
                  type="button"
                  className={styles.closeTab}
                  onClick={() => void closeTab(path)}
                  aria-label={`Close ${baseName(path)}`}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className={styles.body}
        ref={bodyRef}
        style={{
          gridTemplateColumns: layout.visible
            ? `${layout.width}px 5px minmax(0, 1fr)`
            : "minmax(0, 1fr)",
        }}
      >
        {layout.visible ? (
          <>
            <aside className={styles.explorer} aria-label="Explorer">
              <div className={styles.explorerTools}>
                <label className={styles.filter}>
                  <Search size={13} aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={`Filter ${fileCount} files`}
                    aria-label="Filter files"
                    spellCheck={false}
                  />
                  {query ? (
                    <button type="button" onClick={() => setQuery("")} aria-label="Clear filter">
                      <X size={12} />
                    </button>
                  ) : null}
                </label>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => setExpanded(new Set())}
                  title="Collapse folders"
                  aria-label="Collapse folders"
                >
                  <ChevronsDownUp size={14} />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => updateLayout({ ...layout, visible: false })}
                  title="Hide file tree"
                  aria-label="Hide file tree"
                >
                  <PanelLeftClose size={15} />
                </button>
              </div>
              {knowledge ? <KnowledgeBar knowledge={knowledge} trusted={trusted} /> : null}
              <div className={styles.treePane}>
                {filtered.length ? (
                  <FileTree
                    nodes={filtered}
                    expanded={shownExpanded}
                    selectedPath={activePath}
                    onToggle={toggleFolder}
                    onOpen={(path) => void openFile(path)}
                    indexStates={knowledge?.byPath}
                  />
                ) : (
                  <p className={styles.notice}>{query
                      ? "No files match."
                      : onlyPaths
                        ? "No documents in this chat yet. Attach one with + or ask the agent to write one."
                        : "No files yet."}</p>
                )}
                {workbench.entriesTruncated ? (
                  <p className={styles.notice}>Some folders hold more than 5,000 entries; only the first 5,000 are shown.</p>
                ) : null}
              </div>
            </aside>
            <div
              className={styles.splitter}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize file tree"
              onPointerDown={startResize}
              onDoubleClick={() => updateLayout({ visible: true, width: DEFAULT_TREE_WIDTH })}
            />
          </>
        ) : null}

        <section className={styles.viewer} aria-label="File">
          {activeDoc ? (
            <>
              <header>
                <nav className={styles.breadcrumb} aria-label="File path" title={activeDoc}>
                  {activeDoc.split("/").map((part, index, parts) =>
                    index === parts.length - 1 ? (
                      <strong key={index}>{part}</strong>
                    ) : (
                      <span key={index}>
                        {part}
                        <i aria-hidden="true">/</i>
                      </span>
                    ),
                  )}
                </nav>
                {onDownload ? (
                  <button
                    type="button"
                    className={styles.iconButton}
                    title="Download"
                    aria-label="Download file"
                    onClick={() => {
                      setDownloadError(null);
                      void onDownload(activeDoc).catch((error) => setDownloadError(String(error)));
                    }}
                  >
                    <Download size={15} />
                  </button>
                ) : null}
              </header>
              <div className={styles.editorBody}>
                <Suspense fallback={<div className={styles.loading}>Opening document…</div>}>
                  <DocumentViewer key={activeDoc} path={activeDoc} load={loadDoc} />
                </Suspense>
              </div>
            </>
          ) : file ? (
            <>
              <header>
                <nav className={styles.breadcrumb} aria-label="File path" title={file.path}>
                  {file.path.split("/").map((part, index, parts) =>
                    index === parts.length - 1 ? (
                      <strong key={index}>{part}</strong>
                    ) : (
                      <span key={index}>
                        {part}
                        <i aria-hidden="true">/</i>
                      </span>
                    ),
                  )}
                </nav>
                {file.truncated ? (
                  <small className={styles.status}>Truncated · read-only</small>
                ) : dirty ? (
                  <small className={styles.status} data-dirty>
                    Unsaved
                  </small>
                ) : null}
                {isMarkdown(file.path) ? (
                  <button
                    type="button"
                    className={styles.iconButton}
                    data-active={showSource || undefined}
                    onClick={() => setShowSource(!showSource)}
                    title={showSource ? "Show rendered" : "Show source"}
                    aria-label={showSource ? "Show rendered Markdown" : "Show Markdown source"}
                  >
                    {showSource ? <Eye size={15} /> : <Code2 size={15} />}
                  </button>
                ) : null}
                {onDownload ? (
                  <button
                    type="button"
                    className={styles.iconButton}
                    title="Download"
                    aria-label="Download file"
                    onClick={() => {
                      setDownloadError(null);
                      void onDownload(file.path).catch((error) => setDownloadError(String(error)));
                    }}
                  >
                    <Download size={15} />
                  </button>
                ) : null}
                {!rendered ? (
                  <button
                    type="button"
                    className={styles.saveButton}
                    onClick={() => void workbench.saveFile()}
                    disabled={readOnly || !dirty || workbench.loading}
                  >
                    <Save size={13} />
                    Save
                  </button>
                ) : null}
              </header>
              {downloadError ? (
                <p role="alert" className={styles.alert}>
                  {downloadError}
                </p>
              ) : null}
              <div className={styles.editorBody}>
                {rendered ? (
                  <article className={styles.preview}>
                    <MarkdownContent>{workbench.draft}</MarkdownContent>
                  </article>
                ) : (
                  <Suspense fallback={<div className={styles.loading}>Loading editor…</div>}>
                    <LocalMonacoEditor
                      height="100%"
                      language={languageFor(file.path)}
                      value={workbench.draft}
                      onChange={(value) => workbench.setDraft(value ?? "")}
                      onMount={(mounted) => setEditor(mounted)}
                      theme={darkMode ? "vs-dark" : "vs-light"}
                      options={{
                        minimap: { enabled: false },
                        readOnly,
                        fontSize: 12,
                        lineHeight: 20,
                        renderLineHighlight: "line",
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        automaticLayout: true,
                      }}
                    />
                  </Suspense>
                )}
              </div>
              {hasActiveTurn && !rendered ? (
                <p className={styles.lockNotice}>Editing is locked until the active Turn finishes.</p>
              ) : null}
            </>
          ) : (
            <InspectorEmpty label="Select a file in the explorer to open it." />
          )}
        </section>
      </div>
    </div>
  );
}

function KnowledgeBar({
  knowledge,
  trusted,
}: {
  knowledge: DocumentIndexController;
  trusted: boolean;
}) {
  const summary = knowledgeSummary(knowledge);
  const status = knowledge.status;
  if (!summary || !status) return null;
  const indexing = status.state === "indexing";
  const problem = !status.configured
    ? status.error
    : status.state === "error"
      ? status.error
      : null;
  return (
    <div
      className={styles.knowledge}
      data-state={status.state}
      title={problem ?? `Document search · ${status.embeddingModel}`}
    >
      <BookOpenCheck size={13} aria-hidden="true" />
      <span className={styles.knowledgeLabel}>
        <strong>Knowledge</strong>
        <span aria-live="polite">{summary}</span>
      </span>
      {status.configured && trusted ? (
        <button
          type="button"
          className={styles.knowledgeAction}
          disabled={indexing || knowledge.busy}
          onClick={() => void knowledge.reindex()}
          title="Index new and changed documents"
        >
          <RefreshCw size={12} aria-hidden="true" data-spinning={indexing || undefined} />
          Re-index
        </button>
      ) : null}
    </div>
  );
}
