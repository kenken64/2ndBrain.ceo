"use client";
import { useEffect, useRef, useState } from "react";
import { FolderOpen, X } from "lucide-react";
import type { SavedChatFile } from "@/lib/chat-files-shared";

type Page = { files: SavedChatFile[]; page: number; hasMore: boolean };
export function ChatSavedFiles({ disabled, onSelect, label = "Saved files", triggerClass = "btn-ghost" }: { disabled: boolean; onSelect?: (file: SavedChatFile) => void; label?: string; triggerClass?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function load(number: number) {
    abort.current?.abort(); const current = new AbortController(); abort.current = current;
    setError(""); setLoading(true);
    try {
      const response = await fetch(`/api/chat/files?page=${number}`, { cache: "no-store", signal: current.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load saved files.");
      setPage(result as Page);
    } catch (reason) { if (!current.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load saved files."); }
    finally { if (!current.signal.aborted) setLoading(false); }
  }
  return <>
    <button className={triggerClass} type="button" disabled={disabled} onClick={() => { setPage(null); dialog.current?.showModal(); void load(1); }}><FolderOpen size={16} aria-hidden="true" /> {label}</button>
    <dialog className="chat-usage-dialog chat-files-dialog" ref={dialog} aria-labelledby="chat-files-title" onClose={() => abort.current?.abort()}>
      <div className="chat-usage-header"><div><p className="chat-usage-eyebrow">YOUR LIBRARY</p><h2 id="chat-files-title">My files</h2><p>Files uploaded or generated in AI Chat are available on your other devices.</p></div><button type="button" className="chat-usage-close" aria-label="Close My files" onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      {error ? <p className="chat-usage-error" role="alert">{error} <button type="button" className="text-link" onClick={() => void load(page?.page ?? 1)}>Try again</button></p> : null}
      {loading && !page ? <p role="status">Loading saved files…</p> : null}
      {page && !page.files.length ? <p>No saved files yet. Attach a file in chat to save it here.</p> : null}
      {page?.files.length ? <div className="chat-files-list">{page.files.map(file => <article key={file.id}><div><strong>{file.name}</strong><small>{file.origin === "output" ? "Generated output" : "Original upload"} · {(file.size / (1024 * 1024)).toFixed(2)} MB · {new Date(file.createdAt).toLocaleDateString()}</small></div><div className="chat-files-actions"><a href={`/api/chat/files/${encodeURIComponent(file.id)}`} className="btn-ghost">Download</a>{onSelect && (file.origin !== "output" || /\.pptx$/i.test(file.name)) ? <button type="button" className="btn-ghost" onClick={() => { onSelect(file); dialog.current?.close(); }}>Attach</button> : null}</div></article>)}</div> : null}
      {page ? <div className="chat-usage-pagination"><button className="btn-ghost" type="button" disabled={loading || page.page <= 1} onClick={() => void load(page.page - 1)}>Previous</button><span>Page {page.page}{loading ? " · Loading…" : ""}</span><button className="btn-ghost" type="button" disabled={loading || !page.hasMore} onClick={() => void load(page.page + 1)}>Next</button></div> : null}
    </dialog>
  </>;
}
