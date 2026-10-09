/**
 * In-panel previews of binary documents: PDF, Word, Excel, CSV and
 * PowerPoint. Each renderer library loads only when a file of its kind is
 * opened, so none of them weighs on the app's start-up.
 */

import { useEffect, useRef, useState } from "react";

import { LoadingDots } from "../../components/Motion";
import { documentKind, mediaType, type DocumentKind } from "./documentKinds";
import styles from "./DocumentViewer.module.css";

/** Rows shown per sheet; enough to read, bounded so huge files stay fast. */
const MAX_ROWS = 1000;
const MAX_PDF_PAGES = 60;

interface DocumentViewerProps {
  path: string;
  load(): Promise<ArrayBuffer>;
}

export default function DocumentViewer({ path, load }: DocumentViewerProps) {
  const kind = documentKind(path)!;
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Keyed by path in FilesPanel, so a new file mounts a fresh viewer.
    let live = true;
    load()
      .then((data) => live && setBytes(data))
      .catch((reason: unknown) => live && setError(String(reason)));
    return () => {
      live = false;
    };
  }, [load, path]);

  if (error) return <p className={styles.problem}>Could not load this file: {error}</p>;
  if (!bytes) return <Loading />;
  return (
    <div className={styles.viewer} data-kind={kind}>
      <Renderer kind={kind} bytes={bytes} path={path} />
    </div>
  );
}

function Loading() {
  return (
    <div className={styles.loading}>
      <LoadingDots /> Opening document
    </div>
  );
}

function Renderer({
  kind,
  bytes,
  path,
}: {
  kind: DocumentKind;
  bytes: ArrayBuffer;
  path: string;
}) {
  switch (kind) {
    case "image":
    case "video":
    case "audio":
      return <MediaView kind={kind} bytes={bytes} path={path} />;
    case "pdf":
      return <PdfView bytes={bytes} />;
    case "docx":
      return <DocxView bytes={bytes} />;
    case "pptx":
      return <PptxView bytes={bytes} />;
    case "xlsx":
      return <SheetView bytes={bytes} />;
    case "csv":
      return <CsvView bytes={bytes} />;
  }
}

/** Runs an async renderer into a host element and reports its failure. */
function useRender(
  render: (host: HTMLDivElement, isLive: () => boolean) => Promise<void>,
  deps: unknown[],
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<"busy" | "done" | string>("busy");
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let live = true;
    host.replaceChildren();
    setState("busy");
    render(host, () => live)
      .then(() => live && setState("done"))
      .catch((reason: unknown) => live && setState(String(reason)));
    return () => {
      live = false;
    };
    // The renderer closes over `deps` only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { hostRef, state };
}

function Rendered({
  hostRef,
  state,
  className,
}: {
  hostRef: React.RefObject<HTMLDivElement | null>;
  state: string;
  className: string;
}) {
  return (
    <>
      {state === "busy" ? <Loading /> : null}
      {state !== "busy" && state !== "done" ? (
        <p className={styles.problem}>This document could not be displayed: {state}</p>
      ) : null}
      <div ref={hostRef} className={className} />
    </>
  );
}

function PdfView({ bytes }: { bytes: ArrayBuffer }) {
  const [pages, setPages] = useState<{ shown: number; total: number } | null>(null);
  const { hostRef, state } = useRender(
    async (host, isLive) => {
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      // pdf.js transfers the buffer to its worker; hand it a copy.
      const task = pdfjs.getDocument({ data: bytes.slice(0) });
      const pdf = await task.promise;
      const total = pdf.numPages;
      const shown = Math.min(total, MAX_PDF_PAGES);
      const width = Math.max(320, host.clientWidth - 32);
      const ratio = window.devicePixelRatio || 1;
      for (let number = 1; number <= shown && isLive(); number += 1) {
        const page = await pdf.getPage(number);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * ratio });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
        canvas.setAttribute("aria-label", `Page ${number}`);
        host.append(canvas);
        await page.render({ canvas, viewport }).promise;
      }
      if (isLive()) setPages({ shown, total });
      await task.destroy();
    },
    [bytes],
  );
  return (
    <>
      <Rendered hostRef={hostRef} state={state} className={styles.pdf} />
      {pages && pages.shown < pages.total ? (
        <p className={styles.footnote}>
          Showing the first {pages.shown} of {pages.total} pages — download the file to read the rest.
        </p>
      ) : null}
    </>
  );
}

function DocxView({ bytes }: { bytes: ArrayBuffer }) {
  const { hostRef, state } = useRender(
    async (host) => {
      const { renderAsync } = await import("docx-preview");
      await renderAsync(bytes, host, undefined, {
        className: "khai-docx",
        inWrapper: true,
        breakPages: true,
        experimental: true,
      });
      // Word tables often encode their header row without docx-preview
      // promoting it to <thead>. Promote that row so a continued table keeps
      // its column labels when the browser paginates the preview.
      host.querySelectorAll("table").forEach((table) => {
        const rows = Array.from(table.rows);
        if (rows.length < 2 || table.tHead) return;
        const head = table.createTHead();
        head.append(rows[0]);
      });
    },
    [bytes],
  );
  return <Rendered hostRef={hostRef} state={state} className={styles.docx} />;
}

function PptxView({ bytes }: { bytes: ArrayBuffer }) {
  const { hostRef, state } = useRender(
    async (host) => {
      const { init } = await import("pptx-preview");
      const width = Math.max(320, host.clientWidth - 32);
      const previewer = init(host, { width, height: Math.round((width * 9) / 16), mode: "list" });
      await previewer.preview(bytes.slice(0));
    },
    [bytes],
  );
  return <Rendered hostRef={hostRef} state={state} className={styles.pptx} />;
}

type Cell = string | number | boolean | Date | null;

function SheetView({ bytes }: { bytes: ArrayBuffer }) {
  const [sheets, setSheets] = useState<Array<{ sheet: string; data: Cell[][] }> | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    import("read-excel-file/browser")
      .then(({ default: readExcelFile }) => readExcelFile(new Blob([bytes])))
      .then((result) => live && setSheets(result as Array<{ sheet: string; data: Cell[][] }>))
      .catch((reason: unknown) => live && setError(String(reason)));
    return () => {
      live = false;
    };
  }, [bytes]);
  if (error) return <p className={styles.problem}>This workbook could not be read: {error}</p>;
  if (!sheets) return <Loading />;
  const sheet = sheets[active];
  return (
    <div className={styles.sheet}>
      <Table rows={sheet?.data ?? []} />
      {sheets.length > 1 ? (
        <nav className={styles.sheetTabs} aria-label="Sheets">
          {sheets.map((entry, index) => (
            <button
              key={entry.sheet}
              type="button"
              aria-pressed={index === active}
              onClick={() => setActive(index)}
            >
              {entry.sheet}
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

function CsvView({ bytes }: { bytes: ArrayBuffer }) {
  const [rows, setRows] = useState<Cell[][] | null>(null);
  useEffect(() => {
    let live = true;
    import("papaparse").then(({ default: Papa }) => {
      const text = new TextDecoder().decode(bytes);
      const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true, preview: MAX_ROWS + 1 });
      if (live) setRows(parsed.data);
    });
    return () => {
      live = false;
    };
  }, [bytes]);
  if (!rows) return <Loading />;
  return (
    <div className={styles.sheet}>
      <Table rows={rows} />
    </div>
  );
}

/** "A", "B", … "Z", "AA" — spreadsheet column names. */
function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function formatCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toLocaleDateString();
  return String(value);
}

function Table({ rows }: { rows: Cell[][] }) {
  const shown = rows.slice(0, MAX_ROWS);
  const columns = shown.reduce((max, row) => Math.max(max, row.length), 0);
  if (!columns) return <p className={styles.problem}>This sheet is empty.</p>;
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th aria-hidden="true" />
            {Array.from({ length: columns }, (_, index) => (
              <th key={index} scope="col">
                {columnName(index)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <th scope="row">{rowIndex + 1}</th>
              {Array.from({ length: columns }, (_, index) => (
                <td key={index} data-numeric={typeof row[index] === "number" || undefined}>
                  {formatCell(row[index] ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX_ROWS ? (
        <p className={styles.footnote}>Showing the first {MAX_ROWS} rows.</p>
      ) : null}
    </div>
  );
}

/** Images, video and audio through a blob URL; <img> never runs SVG scripts. */
function MediaView({
  kind,
  bytes,
  path,
}: {
  kind: "image" | "video" | "audio";
  bytes: ArrayBuffer;
  path: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([bytes], { type: mediaType(path) }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [bytes, path]);
  if (!url) return <Loading />;
  const name = path.split("/").at(-1) ?? path;
  return (
    <div className={styles.media}>
      {kind === "image" ? (
        <img src={url} alt={name} />
      ) : kind === "video" ? (
        <video src={url} controls />
      ) : (
        <audio src={url} controls />
      )}
      <small>
        {name} · {formatBytes(bytes.byteLength)}
      </small>
    </div>
  );
}

function formatBytes(size: number): string {
  if (size >= 1_048_576) return `${(size / 1_048_576).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}
