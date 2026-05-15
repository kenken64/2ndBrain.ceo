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
  RefreshCw,
  Save,
  SquarePen
} from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useRef, useState, useTransition } from "react";
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

function markdownBlocks(value: string) {
  return value.split(/\n{2,}/g).map((block, index) => {
    const trimmed = block.trim();
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);

    if (heading) {
      const Tag = heading[1].length === 1 ? "h1" : heading[1].length === 2 ? "h2" : "h3";

      return <Tag key={`${trimmed}-${index}`}>{heading[2]}</Tag>;
    }

    if (trimmed.startsWith("- ")) {
      return (
        <ul key={`${trimmed}-${index}`}>
          {trimmed.split("\n").map((item) => (
            <li key={item}>{item.replace(/^-\s+/, "")}</li>
          ))}
        </ul>
      );
    }

    return <p key={`${trimmed}-${index}`}>{trimmed}</p>;
  });
}

export function WikiEditor({
  apiBase = "/api/wiki",
  eyebrow = "Second Brain",
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const graphUrl = graphHref ?? (projectId ? `/dashboard/graph?projectId=${projectId}` : "/dashboard/graph");
  const canUploadDocuments = Boolean(projectId);
  const isBusy = isPending || isUploading;

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
      window.location.assign(graphUrl);
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

  async function ingestDocuments(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!projectId) {
      setUploadError("Open a generated Second Brain before uploading documents.");
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

  return (
    <div className="wiki-workspace">
      <aside className="wiki-tree" aria-label="Second Brain pages">
        <div className="wiki-panel-header">
          <FileText size={17} strokeWidth={1.8} />
          <span>Pages</span>
        </div>
        {canUploadDocuments ? (
          <form aria-busy={isUploading} className="wiki-upload-form" encType="multipart/form-data" noValidate onSubmit={ingestDocuments}>
            <div className="wiki-upload-form__header">
              <strong>Upload to this Second Brain</strong>
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
                placeholder="Ask the AI to decide where these sources belong, update existing pages if useful, and modify the Second Brain index/log."
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
              {isUploading ? "Uploading..." : "Upload into Second Brain"}
            </button>
          </form>
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
              <a aria-label="Export Second Brain" className="btn-icon" href={wikiUrl(`${apiBase}/export`)} title="Export Second Brain">
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
            <button
              className="wiki-graph-action"
              disabled={files.length === 0 || isPending}
              onClick={syncProjectGraph}
              type="button"
            >
              <GitBranch size={15} strokeWidth={1.8} />
              {isPending && status.startsWith("Indexing") ? "Generating graph..." : "Generate knowledge graph"}
            </button>
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
