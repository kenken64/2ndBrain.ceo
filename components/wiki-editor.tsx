"use client";

import { useRouter } from "next/navigation";
import {
  Download,
  Eye,
  FileText,
  FileUp,
  Folder,
  FolderOpen,
  GitBranch,
  ListChecks,
  RefreshCw,
  Save,
  Search,
  SquarePen
} from "lucide-react";
import { ChangeEvent, FormEvent, Fragment, type ReactNode, useEffect, useRef, useState, useTransition } from "react";
import type { WikiPage, WikiTreeItem } from "@/lib/wiki";

type WikiEditorProps = {
  apiBase?: string;
  eyebrow?: string;
  graphHref?: string | null;
  initialError?: string | null;
  initialPage?: WikiPage | null;
  projectId?: string | null;
  showExport?: boolean;
  showSync?: boolean;
  tree: WikiTreeItem[];
};

type ViewMode = "edit" | "preview";
type IngestJobStatus = "failed" | "queued" | "ready" | "running";
type IngestJob = {
  completed_at?: string | null;
  created_at?: string | null;
  error?: string | null;
  id: string;
  started_at?: string | null;
  status: IngestJobStatus;
};
type BrainSearchResult = {
  filePath: string;
  lineNumber: number;
  snippet: string;
  title: string;
};
type BrainFollowUp = {
  filePath: string;
  kind: "follow_up" | "task";
  line: string;
  lineNumber: number;
  title: string;
};
type BrainWorkspacePayload = {
  error?: string;
  followUps?: BrainFollowUp[];
  pageCount?: number;
  query?: string;
  searchResults?: BrainSearchResult[];
};

const WIKI_UPLOAD_ACCEPT = [
  "image/*",
  "application/pdf",
  "text/csv",
  "text/plain",
  "text/markdown",
  ".csv",
  ".doc",
  ".docx",
  ".md",
  ".markdown",
  ".pdf",
  ".txt",
  ".xls",
  ".xlsx",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
].join(",");
const METADATA_LABELS = [
  "Address",
  "Built",
  "Client",
  "Config",
  "District",
  "Price",
  "PSF",
  "Size",
  "Source",
  "Status",
  "Tenure",
  "Type"
];
const METADATA_LABEL_PATTERN = new RegExp(
  String.raw`(?:^|\s+|\|\s*)(?:\*\*)?(${METADATA_LABELS.join("|")}):(?:\*\*)?\s*`,
  "gi"
);

function flattenTree(items: WikiTreeItem[]) {
  const files: WikiTreeItem[] = [];

  function walk(nodes: WikiTreeItem[]) {
    for (const node of nodes) {
      if (node.type === "file") {
        files.push(node);
      }

      if (node.children) {
        walk(node.children);
      }
    }
  }

  walk(items);
  return files;
}

function displayTree(items: WikiTreeItem[]) {
  if (items.length === 1 && items[0].type === "directory" && items[0].name.startsWith("wiki-")) {
    return items[0].children ?? [];
  }

  return items;
}

function TreeNode({
  item,
  level,
  onSelect,
  selectedPath
}: {
  item: WikiTreeItem;
  level: number;
  onSelect: (path: string) => void;
  selectedPath: string;
}) {
  const indent = `${10 + level * 14}px`;

  if (item.type === "directory") {
    return (
      <div className="wiki-tree-branch">
        <div className="wiki-tree-folder" style={{ paddingLeft: indent }}>
          {item.children && item.children.length > 0 ? (
            <FolderOpen size={16} strokeWidth={1.8} />
          ) : (
            <Folder size={16} strokeWidth={1.8} />
          )}
          <span>{item.name}</span>
        </div>
        {item.children?.map((child) => (
          <TreeNode
            item={child}
            key={child.path}
            level={level + 1}
            onSelect={onSelect}
            selectedPath={selectedPath}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      className={`wiki-tree-item${item.path === selectedPath ? " is-active" : ""}`}
      onClick={() => onSelect(item.path)}
      style={{ paddingLeft: indent }}
      title={item.path}
      type="button"
    >
      <FileText size={15} strokeWidth={1.7} />
      <span>{item.name}</span>
    </button>
  );
}

function stripMarkdownFrontmatter(value: string) {
  const trimmed = value.trimStart();

  if (trimmed.startsWith("---\n")) {
    const endIndex = trimmed.indexOf("\n---", 4);

    if (endIndex !== -1) {
      return trimmed.slice(endIndex + 4).replace(/^\s*\n/, "");
    }
  }

  const firstLineEnd = trimmed.indexOf("\n");
  const firstLine = firstLineEnd === -1 ? trimmed : trimmed.slice(0, firstLineEnd);

  if (firstLine.startsWith("--- ") && firstLine.trimEnd().endsWith(" ---")) {
    return firstLineEnd === -1 ? "" : trimmed.slice(firstLineEnd + 1).replace(/^\s*\n/, "");
  }

  return value;
}

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparatorCell(value: string) {
  return /^:?-{2,}:?$/.test(value.trim());
}

function isTableSeparator(line: string) {
  const cells = splitTableRow(line);

  return cells.length > 1 && cells.every(isTableSeparatorCell);
}

function isTableStart(lines: string[], index: number) {
  return Boolean(lines[index]?.includes("|") && lines[index + 1] && isTableSeparator(lines[index + 1]));
}

function splitCompactTableLine(line: string) {
  const trimmed = line.trim();

  if (!trimmed.startsWith("|") || !trimmed.includes("|")) {
    return null;
  }

  const cells = trimmed.split("|").map((cell) => cell.trim());
  let separatorStart = -1;
  let columnCount = 0;

  for (let index = 0; index < cells.length; index += 1) {
    if (!isTableSeparatorCell(cells[index] ?? "")) {
      continue;
    }

    let runLength = 0;

    while (index + runLength < cells.length && isTableSeparatorCell(cells[index + runLength] ?? "")) {
      runLength += 1;
    }

    if (runLength >= 2) {
      separatorStart = index;
      columnCount = runLength;
      break;
    }
  }

  if (separatorStart === -1 || columnCount === 0) {
    return null;
  }

  const headerEnd = cells[separatorStart - 1] === "" ? separatorStart - 1 : separatorStart;
  const headerStart = headerEnd - columnCount;

  if (headerStart < 0) {
    return null;
  }

  const rows = [
    cells.slice(headerStart, headerEnd),
    cells.slice(separatorStart, separatorStart + columnCount)
  ];
  let cursor = separatorStart + columnCount;

  while (cursor < cells.length) {
    while (cursor < cells.length && cells[cursor] === "") {
      cursor += 1;
    }

    const row = cells.slice(cursor, cursor + columnCount);

    if (row.length === columnCount && row.some(Boolean)) {
      rows.push(row);
    }

    cursor += Math.max(row.length, 1);
  }

  return rows.map((row) => `| ${row.join(" | ")} |`);
}

function normalizeCompactTables(value: string) {
  return value
    .split("\n")
    .flatMap((line) => splitCompactTableLine(line) ?? [line])
    .join("\n");
}

function parseMetadataLine(line: string) {
  if (line.trim().startsWith("|") || !line.includes(":")) {
    return null;
  }

  const matches = [...line.matchAll(METADATA_LABEL_PATTERN)];

  if (matches.length < 2) {
    return null;
  }

  const pairs = matches
    .map((match, index) => {
      const label = match[1];
      const start = (match.index ?? 0) + match[0].length;
      const end = matches[index + 1]?.index ?? line.length;
      const value = line
        .slice(start, end)
        .replace(/^\s*\|\s*/, "")
        .replace(/\s*\|\s*$/, "")
        .trim();

      return label && value ? { label, value } : null;
    })
    .filter((pair): pair is { label: string; value: string } => Boolean(pair));

  return pairs.length >= 2 ? pairs : null;
}

function isBlockStart(lines: string[], index: number) {
  const line = lines[index] ?? "";

  return (
    /^#{1,6}\s+/.test(line) ||
    /^```/.test(line) ||
    /^>\s?/.test(line) ||
    /^[-*+]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    /^-{3,}$/.test(line.trim()) ||
    isTableStart(lines, index)
  );
}

function renderInline(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\[\[[^\]]+\]\])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(value.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${token}-${match.index}`;

    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[[")) {
      const wikiLabel = token.slice(2, -2).split("|").pop()?.trim() ?? token.slice(2, -2);
      nodes.push(<span className="wiki-preview-wikilink" key={key}>{wikiLabel}</span>);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = linkMatch?.[2] ?? "";
      const isSafeHref = /^(https?:|mailto:|\/)/.test(href);

      nodes.push(
        isSafeHref ? (
          <a href={href} key={key} rel="noreferrer" target={href.startsWith("http") ? "_blank" : undefined}>
            {linkMatch?.[1] ?? href}
          </a>
        ) : (
          linkMatch?.[1] ?? token
        )
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < value.length) {
    nodes.push(value.slice(lastIndex));
  }

  return nodes;
}

function markdownBlocks(value: string) {
  const lines = normalizeCompactTables(stripMarkdownFrontmatter(value).replace(/\r\n/g, "\n")).split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);

    if (heading) {
      const Tag = heading[1].length === 1 ? "h1" : heading[1].length === 2 ? "h2" : "h3";

      blocks.push(<Tag key={`${trimmed}-${index}`}>{renderInline(heading[2])}</Tag>);
      index += 1;
      continue;
    }

    if (/^```/.test(trimmed)) {
      const language = trimmed.replace(/^```/, "").trim();
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !/^```/.test(lines[index]?.trim() ?? "")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }

      blocks.push(
        <pre className={language ? `language-${language}` : undefined} key={`code-${index}`}>
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(lines[index] ?? "");
      const rows: string[][] = [];
      index += 2;

      while (index < lines.length && lines[index]?.includes("|") && lines[index]?.trim()) {
        rows.push(splitTableRow(lines[index] ?? ""));
        index += 1;
      }

      blocks.push(
        <div className="wiki-preview-table-wrap" key={`table-${index}`}>
          <table>
            <thead>
              <tr>
                {headers.map((cell, cellIndex) => (
                  <th key={`${cell}-${cellIndex}`}>{renderInline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${row.join("|")}-${rowIndex}`}>
                  {headers.map((_, cellIndex) => (
                    <td key={`${rowIndex}-${cellIndex}`}>{renderInline(row[cellIndex] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const metadataPairs = parseMetadataLine(trimmed);

    if (metadataPairs) {
      blocks.push(
        <dl className="wiki-preview-metadata" key={`metadata-${index}`}>
          {metadataPairs.map((pair) => (
            <div className="wiki-preview-metadata__item" key={`${pair.label}-${pair.value}`}>
              <dt>{pair.label}</dt>
              <dd>{renderInline(pair.value)}</dd>
            </div>
          ))}
        </dl>
      );
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];

      while (index < lines.length && /^>\s?/.test(lines[index]?.trim() ?? "")) {
        quoteLines.push((lines[index] ?? "").trim().replace(/^>\s?/, ""));
        index += 1;
      }

      blocks.push(
        <blockquote key={`quote-${index}`}>
          {quoteLines.map((quote, quoteIndex) => (
            <Fragment key={`${quote}-${quoteIndex}`}>
              {quoteIndex > 0 ? <br /> : null}
              {renderInline(quote)}
            </Fragment>
          ))}
        </blockquote>
      );
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed);
      const listItems: string[] = [];
      const listPattern = ordered ? /^\d+\.\s+/ : /^[-*+]\s+/;

      while (index < lines.length && listPattern.test(lines[index]?.trim() ?? "")) {
        listItems.push((lines[index] ?? "").trim().replace(listPattern, ""));
        index += 1;
      }

      const ListTag = ordered ? "ol" : "ul";

      blocks.push(
        <ListTag key={`list-${index}`}>
          {listItems.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`}>{renderInline(item)}</li>
          ))}
        </ListTag>
      );
      continue;
    }

    if (/^-{3,}$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${index}`} />);
      index += 1;
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;

    while (index < lines.length && lines[index]?.trim() && !isBlockStart(lines, index)) {
      paragraphLines.push(lines[index]?.trim() ?? "");
      index += 1;
    }

    blocks.push(<p key={`${trimmed}-${index}`}>{renderInline(paragraphLines.join(" "))}</p>);
  }

  return blocks;
}

export function WikiEditor({
  apiBase = "/api/wiki",
  eyebrow = "Nth Brain",
  graphHref,
  initialError,
  initialPage,
  projectId,
  showExport = true,
  showSync = true,
  tree
}: WikiEditorProps) {
  const router = useRouter();
  const files = flattenTree(tree);
  const treeItems = displayTree(tree);
  const [selectedPath, setSelectedPath] = useState(initialPage?.filePath ?? files[0]?.path ?? "");
  const [page, setPage] = useState<WikiPage | null>(initialPage ?? null);
  const [content, setContent] = useState(initialPage?.content ?? "");
  const [error, setError] = useState(initialError ?? "");
  const [status, setStatus] = useState(initialPage ? "Loaded" : "Idle");
  const [mode, setMode] = useState<ViewMode>("preview");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadJob, setUploadJob] = useState<IngestJob | null>(null);
  const [uploadPrompt, setUploadPrompt] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [brainQuery, setBrainQuery] = useState("");
  const [brainError, setBrainError] = useState("");
  const [brainFollowUps, setBrainFollowUps] = useState<BrainFollowUp[]>([]);
  const [brainPageCount, setBrainPageCount] = useState(0);
  const [brainResults, setBrainResults] = useState<BrainSearchResult[]>([]);
  const [brainStatus, setBrainStatus] = useState("Workspace scan pending");
  const [isBrainLoading, setIsBrainLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const canUploadDocuments = Boolean(projectId);
  const isBusy = isPending || isUploading;

  function graphUrl(pathValue?: string) {
    if (graphHref) {
      return graphHref;
    }

    const params = new URLSearchParams();

    if (projectId) {
      params.set("projectId", projectId);
    }

    if (pathValue) {
      params.set("path", pathValue);
    }

    const suffix = params.toString();

    return suffix ? `/dashboard/graph?${suffix}` : "/dashboard/graph";
  }

  function wikiUrl(pathname: string, pathValue?: string) {
    const params = new URLSearchParams();

    if (projectId) {
      params.set("projectId", projectId);
    }

    if (pathValue) {
      params.set("path", pathValue);
    }

    return `${pathname}?${params.toString()}`;
  }

  function loadPage(pathValue: string) {
    setSelectedPath(pathValue);
    setError("");
    setStatus("Loading");
    startTransition(async () => {
      const response = await fetch(wikiUrl(`${apiBase}/page`, pathValue));
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Page could not be loaded");
        setStatus("Failed");
        return;
      }

      setPage(payload.page);
      setContent(payload.page.content ?? "");
      setStatus("Loaded");
    });
  }

  async function loadBrainWorkspace(queryValue = brainQuery) {
    if (!projectId) {
      return;
    }

    setBrainError("");
    setIsBrainLoading(true);
    setBrainStatus(queryValue.trim() ? "Searching brain" : "Scanning brain");

    try {
      const params = new URLSearchParams({
        projectId
      });

      if (queryValue.trim()) {
        params.set("q", queryValue.trim());
      }

      const response = await fetch(`/api/wiki/workspace?${params.toString()}`, {
        credentials: "same-origin"
      });
      const payload = (await response.json().catch(() => null)) as BrainWorkspacePayload | null;

      if (!response.ok || !payload || payload.error) {
        setBrainError(payload?.error ?? "Brain workspace scan failed");
        setBrainStatus("Workspace scan failed");
        return;
      }

      const results = payload.searchResults ?? [];
      const followUps = payload.followUps ?? [];

      setBrainResults(results);
      setBrainFollowUps(followUps);
      setBrainPageCount(payload.pageCount ?? 0);
      setBrainStatus(
        queryValue.trim()
          ? `${results.length} search result${results.length === 1 ? "" : "s"}`
          : `${followUps.length} open follow-up${followUps.length === 1 ? "" : "s"}`
      );
    } catch (error) {
      setBrainError(error instanceof Error ? error.message : "Brain workspace scan failed");
      setBrainStatus("Workspace scan failed");
    } finally {
      setIsBrainLoading(false);
    }
  }

  function savePage() {
    if (!selectedPath) {
      return;
    }

    setError("");
    setStatus("Saving");
    startTransition(async () => {
      const response = await fetch(`${apiBase}/page`, {
        body: JSON.stringify({
          baseSha: page?.sha ?? null,
          content,
          path: selectedPath,
          projectId
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Page could not be saved");
        setStatus("Failed");
        return;
      }

      setPage(payload.page);
      setContent(payload.page.content ?? content);
      setStatus("Saved and synced");
    });
  }

  function syncPage() {
    if (!selectedPath) {
      return;
    }

    setError("");
    setStatus("Syncing");
    startTransition(async () => {
      const response = await fetch(`${apiBase}/sync`, {
        body: JSON.stringify({
          path: selectedPath,
          projectId
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Page could not be synced");
        setStatus("Failed");
        return;
      }

      setPage(payload.page);
      setContent(payload.page.content ?? content);
      setStatus("Graph synced");
    });
  }

  function syncProjectGraph() {
    if (files.length === 0) {
      return;
    }

    setError("");
    setStatus(`Indexing ${files.length} pages`);
    startTransition(async () => {
      const response = await fetch(`${apiBase}/sync`, {
        body: JSON.stringify({
          projectId,
          scope: "project"
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Project graph could not be generated");
        setStatus("Failed");
        return;
      }

      setStatus(`Graph synced from ${payload.sync?.pageCount ?? files.length} pages`);
      window.location.assign(graphUrl(selectedPath));
    });
  }

  function handleUploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const filesToAdd = Array.from(event.target.files ?? []);

    setUploadFiles((current) => [...current, ...filesToAdd].slice(0, 8));
    setUploadError("");
    setUploadSuccess("");
    event.target.value = "";
  }

  function removeUploadFile(index: number) {
    setUploadFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  useEffect(() => {
    if (!projectId || !uploadJob || (uploadJob.status !== "queued" && uploadJob.status !== "running")) {
      return;
    }

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/wiki/ingest?projectId=${encodeURIComponent(projectId)}`, {
          credentials: "same-origin"
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok || !payload?.job) {
          return;
        }

        const nextJob = payload.job as IngestJob;
        setUploadJob(nextJob);

        if (nextJob.status === "ready") {
          setStatus("Background ingest complete");
          setUploadSuccess("Background upload finished. Refreshing the page tree.");
          setUploadError("");
          window.setTimeout(() => {
            router.refresh();
          }, 1200);
        }

        if (nextJob.status === "failed") {
          setStatus("Background ingest failed");
          setUploadError(nextJob.error ?? "Background upload failed");
          setUploadSuccess("");
        }
      } catch {
        // Keep polling on the next interval.
      }
    }, 5000);

    return () => window.clearInterval(interval);
  }, [projectId, router, uploadJob]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    void loadBrainWorkspace("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function ingestDocuments(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!projectId) {
      setUploadError("Open a generated Nth Brain before uploading documents.");
      return;
    }

    if (uploadFiles.length === 0) {
      setUploadError("Attach at least one document to upload.");
      return;
    }

    const filesToUpload = uploadFiles;

    setError("");
    setUploadError("");
    setUploadSuccess("");
    setUploadJob(null);
    setIsUploading(true);
    setStatus(`Uploading ${filesToUpload.length} document${filesToUpload.length === 1 ? "" : "s"}`);

    try {
      const formData = new FormData();

      formData.set("projectId", projectId);
      formData.set("prompt", uploadPrompt);
      for (const file of filesToUpload) {
        formData.append("attachments", file, file.name);
      }

      const response = await fetch("/api/wiki/ingest", {
        body: formData,
        credentials: "same-origin",
        method: "POST"
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setUploadError(payload?.error ?? "Document upload failed");
        setStatus("Upload failed");
        return;
      }

      const uploadedCount = payload?.acceptedFiles?.length ?? filesToUpload.length;
      const nextJob = (payload?.job as IngestJob | undefined) ?? null;

      setStatus(`Queued ${uploadedCount} document${uploadedCount === 1 ? "" : "s"} for background ingest`);
      setUploadSuccess(
        `Queued ${uploadedCount} document${uploadedCount === 1 ? "" : "s"} for background ingest. You can keep working while OpenClaw processes them.`
      );
      setUploadJob(nextJob);
      setUploadFiles([]);
      setUploadPrompt("");
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Document upload failed");
      setStatus("Upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  function openWorkspaceSource(pathValue: string) {
    loadPage(pathValue);
  }

  return (
    <div className="wiki-workspace">
      <aside className="wiki-tree" aria-label="Nth Brain pages">
        <div className="wiki-panel-header">
          <FileText size={17} strokeWidth={1.8} />
          <span>Pages</span>
        </div>
        {canUploadDocuments ? (
          <form aria-busy={isUploading} className="wiki-upload-form" encType="multipart/form-data" noValidate onSubmit={ingestDocuments}>
            <div className="wiki-upload-form__header">
              <strong>Upload to this Nth Brain</strong>
              <span>DOC, DOCX, Excel, CSV, PDF, images, text, and markdown are converted before OpenClaw sees them.</span>
            </div>
            <input
              accept={WIKI_UPLOAD_ACCEPT}
              className="wiki-upload-form__file"
              disabled={isBusy}
              multiple
              onChange={handleUploadFiles}
              ref={fileInputRef}
              type="file"
            />
            <button
              className="btn-ghost wiki-upload-form__pick"
              disabled={isBusy}
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              <FileUp size={15} strokeWidth={1.8} />
              Attach documents
            </button>
            {uploadFiles.length > 0 ? (
              <div className="wiki-upload-form__files">
                {uploadFiles.map((file, index) => (
                  <button
                    className="wiki-upload-form__file-pill"
                    disabled={isBusy}
                    key={`${file.name}-${file.size}-${index}`}
                    onClick={() => removeUploadFile(index)}
                    title="Remove file"
                    type="button"
                  >
                    {file.name}
                  </button>
                ))}
              </div>
            ) : null}
            <label className="wiki-upload-form__prompt">
              <span>Instruction for AI ingestion</span>
              <textarea
                disabled={isBusy}
                onChange={(event) => setUploadPrompt(event.target.value)}
                placeholder="Ask the AI to decide where these sources belong, update existing pages if useful, and modify the Nth Brain index/log."
                rows={3}
                value={uploadPrompt}
              />
            </label>
            {uploadError ? <p className="form-error">{uploadError}</p> : null}
            {uploadSuccess ? <p className="form-success">{uploadSuccess}</p> : null}
            {uploadJob && (uploadJob.status === "queued" || uploadJob.status === "running") ? (
              <p className="form-success">
                Background ingest is {uploadJob.status}. You can keep editing while the documents are processed.
              </p>
            ) : null}
            {isUploading ? (
              <div
                aria-live="polite"
                aria-valuetext="Upload in progress"
                className="submit-progress wiki-upload-form__progress"
                role="progressbar"
              >
                <div className="submit-progress__meta">
                  <strong>Uploading artifacts</strong>
                  <span>Sending files to the app so they can be queued for background processing.</span>
                </div>
                <div className="submit-progress__track">
                  <span className="submit-progress__bar" />
                </div>
              </div>
            ) : null}
            <button className="btn-primary btn-primary--compact" disabled={isBusy || uploadFiles.length === 0} type="submit">
              {isUploading ? "Uploading..." : "Upload into Nth Brain"}
            </button>
          </form>
        ) : null}
        {projectId ? (
          <section className="wiki-brain-panel" aria-label="Brain search and follow-ups">
            <div className="wiki-brain-panel__header">
              <div>
                <strong>Brain search</strong>
                <span>{brainPageCount > 0 ? `${brainPageCount} markdown pages` : brainStatus}</span>
              </div>
              <button
                aria-label="Refresh brain workspace"
                disabled={isBrainLoading}
                onClick={() => loadBrainWorkspace(brainQuery)}
                type="button"
              >
                <RefreshCw size={14} strokeWidth={1.9} />
              </button>
            </div>
            <form
              className="wiki-brain-search"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void loadBrainWorkspace(brainQuery);
              }}
            >
              <Search size={14} strokeWidth={1.9} />
              <input
                disabled={isBrainLoading}
                onChange={(event) => setBrainQuery(event.target.value)}
                placeholder="Search lessons, notes, tasks..."
                type="search"
                value={brainQuery}
              />
              <button disabled={isBrainLoading} type="submit">
                Search
              </button>
            </form>
            <p className="wiki-brain-panel__status">{isBrainLoading ? "Loading..." : brainStatus}</p>
            {brainError ? <p className="form-error">{brainError}</p> : null}
            {brainResults.length > 0 ? (
              <div className="wiki-brain-results">
                {brainResults.slice(0, 6).map((result) => (
                  <button
                    className="wiki-brain-result"
                    key={`${result.filePath}-${result.lineNumber}-${result.snippet}`}
                    onClick={() => openWorkspaceSource(result.filePath)}
                    type="button"
                  >
                    <strong>{result.title}</strong>
                    <span>{result.snippet}</span>
                    <small>
                      {result.filePath}:{result.lineNumber}
                    </small>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="wiki-brain-followups">
              <div className="wiki-brain-followups__title">
                <ListChecks size={15} strokeWidth={1.9} />
                <strong>Open follow-ups</strong>
              </div>
              {brainFollowUps.length > 0 ? (
                brainFollowUps.slice(0, 8).map((item) => (
                  <button
                    className="wiki-brain-followup"
                    key={`${item.filePath}-${item.lineNumber}-${item.line}`}
                    onClick={() => openWorkspaceSource(item.filePath)}
                    type="button"
                  >
                    <span>{item.line}</span>
                    <small>
                      {item.kind === "follow_up" ? "Follow-up" : "Task"} · {item.title}
                    </small>
                  </button>
                ))
              ) : (
                <p className="wiki-empty-note">No open follow-ups found.</p>
              )}
            </div>
          </section>
        ) : null}
        <div className="wiki-tree-list">
          {files.length > 0 ? (
            treeItems.map((item) => (
              <TreeNode
                item={item}
                key={item.path}
                level={0}
                onSelect={loadPage}
                selectedPath={selectedPath}
              />
            ))
          ) : (
            <p className="wiki-empty-note">No markdown pages returned yet.</p>
          )}
        </div>
      </aside>

      <section className="wiki-editor-panel">
        <header className="wiki-toolbar">
          <div>
            <p className="workspace-status-card__eyebrow">{eyebrow}</p>
            <h1>{page?.title ?? "Markdown workspace"}</h1>
            <span>{selectedPath || "No page selected"}</span>
          </div>
          <div className="wiki-toolbar-actions">
            <div className="segmented-control" aria-label="Editor mode">
              <button className={mode === "edit" ? "is-active" : ""} onClick={() => setMode("edit")} type="button">
                <SquarePen size={15} strokeWidth={1.8} />
                Edit
              </button>
              <button className={mode === "preview" ? "is-active" : ""} onClick={() => setMode("preview")} type="button">
                <Eye size={15} strokeWidth={1.8} />
                Preview
              </button>
            </div>
            {showSync ? (
              <button className="btn-icon" disabled={!selectedPath || isPending} onClick={syncPage} title="Sync graph" type="button">
                <RefreshCw size={17} strokeWidth={1.8} />
              </button>
            ) : null}
            {showExport ? (
              <a aria-label="Export Nth Brain" className="btn-icon" href={wikiUrl(`${apiBase}/export`)} title="Export Nth Brain">
                <Download size={17} strokeWidth={1.8} />
              </a>
            ) : null}
            <button className="btn-primary btn-primary--compact" disabled={!selectedPath || isPending} onClick={savePage} type="button">
              <Save size={16} strokeWidth={1.8} />
              Save
            </button>
          </div>
        </header>

        <div className="wiki-sync-strip">
          <span>{status}</span>
          {graphHref !== null ? (
            <div className="wiki-sync-strip__actions">
              {selectedPath ? (
                <a className="wiki-graph-action" href={graphUrl(selectedPath)}>
                  <GitBranch size={15} strokeWidth={1.8} />
                  View in graph
                </a>
              ) : null}
              <button
                className="wiki-graph-action"
                disabled={files.length === 0 || isPending}
                onClick={syncProjectGraph}
                type="button"
              >
                <GitBranch size={15} strokeWidth={1.8} />
                {isPending && status.startsWith("Indexing") ? "Generating graph..." : "Generate knowledge graph"}
              </button>
            </div>
          ) : null}
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        {mode === "edit" ? (
          <textarea
            className="wiki-markdown-editor"
            disabled={!selectedPath || isPending}
            onChange={(event) => setContent(event.target.value)}
            spellCheck={false}
            value={content}
          />
        ) : (
          <div className="wiki-preview">{content ? markdownBlocks(content) : <p>No content loaded.</p>}</div>
        )}
      </section>
    </div>
  );
}
