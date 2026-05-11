"use client";

import {
  Download,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  RefreshCw,
  Save,
  SquarePen
} from "lucide-react";
import { useState, useTransition } from "react";
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
  eyebrow = "LLM Wiki",
  graphHref,
  initialError,
  initialPage,
  projectId,
  showExport = true,
  showSync = true,
  tree
}: WikiEditorProps) {
  const files = flattenTree(tree);
  const treeItems = displayTree(tree);
  const [selectedPath, setSelectedPath] = useState(initialPage?.filePath ?? files[0]?.path ?? "");
  const [page, setPage] = useState<WikiPage | null>(initialPage ?? null);
  const [content, setContent] = useState(initialPage?.content ?? "");
  const [error, setError] = useState(initialError ?? "");
  const [status, setStatus] = useState(initialPage ? "Loaded" : "Idle");
  const [mode, setMode] = useState<ViewMode>("edit");
  const [isPending, startTransition] = useTransition();
  const graphUrl = graphHref ?? (projectId ? `/dashboard/graph?projectId=${projectId}` : "/dashboard/graph");

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

  return (
    <div className="wiki-workspace">
      <aside className="wiki-tree" aria-label="Wiki pages">
        <div className="wiki-panel-header">
          <FileText size={17} strokeWidth={1.8} />
          <span>Pages</span>
        </div>
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
              <a aria-label="Export wiki" className="btn-icon" href={wikiUrl(`${apiBase}/export`)} title="Export wiki">
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
