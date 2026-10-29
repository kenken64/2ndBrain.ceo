"use client";

import { Localized, useLanguage, LocalizedMessage } from "@/components/language-provider";

import { useEffect, useRef, useState } from "react";
import { FolderOpen, Play, X } from "lucide-react";
import { ChatFilePreview } from "@/components/chat-file-preview";
import type { SavedChatFile } from "@/lib/chat-files-shared";

type Page = { files: SavedChatFile[]; page: number; hasMore: boolean };
export function ChatSavedFiles({ disabled, onSelect, label = "Saved files", triggerClass = "btn-ghost" }: { disabled: boolean; onSelect?: (file: SavedChatFile) => void; label?: string; triggerClass?: string }) {
  const { language } = useLanguage();
  const zh = language === "zh";
  const dialog = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<SavedChatFile | null>(null);
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
    <button className={triggerClass} type="button" disabled={disabled} onClick={() => { setPage(null); dialog.current?.showModal(); void load(1); }}><FolderOpen size={16} aria-hidden="true" /> {zh ? (label === "My files" ? "我的文件" : label === "Saved files" ? "已保存的文件" : label) : label}</button>
    <dialog className="chat-usage-dialog chat-files-dialog" ref={dialog} aria-labelledby="chat-files-title" onClose={() => { abort.current?.abort(); setPreviewFile(null); }}>
      <div className="chat-usage-header"><div><p className="chat-usage-eyebrow"><Localized en="YOUR LIBRARY" zh="您的文件库" /></p><h2 id="chat-files-title"><Localized en="My files" zh="我的文件" /></h2><p><Localized en="Files uploaded or generated in AI Chat are available on your other devices." zh="在 AI 对话中上传或生成的文件可在您的其他设备上使用。" /></p></div><button type="button" className="chat-usage-close" aria-label={zh ? "关闭我的文件" : "Close My files"} onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      {error ? <p className="chat-usage-error" role="alert"><LocalizedMessage text={error} /> <button type="button" className="text-link" onClick={() => void load(page?.page ?? 1)}><Localized en="Try again" zh="重试" /></button></p> : null}
      {loading && !page ? <p role="status"><Localized en="Loading saved files…" zh="正在加载保存的文件…" /></p> : null}
      {page && !page.files.length ? <p><Localized en="No saved files yet. Attach a file in chat to save it here." zh="暂无保存的文件。在对话中添加文件后即可保存在这里。" /></p> : null}
      {page?.files.length ? <div className="chat-files-list">{page.files.map(file => <article key={file.id}><div><strong>{file.name}</strong><small>{file.origin === "output" ? (zh ? "生成的文件" : "Generated output") : (zh ? "原始上传文件" : "Original upload")} · {(file.size / (1024 * 1024)).toFixed(2)} MB · {new Date(file.createdAt).toLocaleDateString(zh ? "zh-CN" : "en")}</small></div><div className="chat-files-actions">{file.origin === "output" && file.mime === "video/mp4" ? <button type="button" className="btn-ghost" aria-label={zh ? `播放 ${file.name}` : `Play ${file.name}`} onClick={() => setPreviewFile(file)}><Play size={15} aria-hidden="true" /> {zh ? "播放" : "Play"}</button> : null}<a href={`/api/chat/files/${encodeURIComponent(file.id)}`} className="btn-ghost"><Localized en="Download" zh="下载" /></a>{onSelect && (file.origin !== "output" || /\.pptx$/i.test(file.name)) ? <button type="button" className="btn-ghost" onClick={() => { onSelect(file); dialog.current?.close(); }}><Localized en="Attach" zh="添加" /></button> : null}</div></article>)}</div> : null}
      {page ? <div className="chat-usage-pagination"><button className="btn-ghost" type="button" disabled={loading || page.page <= 1} onClick={() => void load(page.page - 1)}><Localized en="Previous" zh="上一页" /></button><span>{zh ? `第 ${page.page} 页` : `Page ${page.page}`}{loading ? (zh ? " · 加载中…" : " · Loading…") : ""}</span><button className="btn-ghost" type="button" disabled={loading || !page.hasMore} onClick={() => void load(page.page + 1)}><Localized en="Next" zh="下一页" /></button></div> : null}
    </dialog>
    {previewFile ? <ChatFilePreview file={previewFile} onClose={() => setPreviewFile(null)} /> : null}
  </>;
}
