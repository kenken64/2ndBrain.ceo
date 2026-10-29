"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Bot, Download, Eye, FileText, Paperclip, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { CHAT_MAX_MESSAGE_CHARS, CHAT_MAX_MESSAGES, CHAT_MAX_TOTAL_BYTES, CHAT_MODELS, FILE_CHAT_MODEL, isChatModel, type ChatMessage, type ChatModelId } from "@/lib/chat-models";
import { ChatSavedFiles } from "@/components/chat-saved-files";
import { ChatFilePreview } from "@/components/chat-file-preview";
import { CHAT_FILE_MAX_BYTES, type SavedChatFile } from "@/lib/chat-files-shared";
import type { ChatConversation, ChatSummary, HistoryMessage, FileArtifact } from "@/lib/chat-history";

type HistoryApi = typeof import("@/lib/chat-history");
type CacheState = "loading" | "ready" | "unavailable";
// The sidebar lists only the most recent chats; /dashboard/chat/history pages through the rest.
const SIDEBAR_HISTORY_LIMIT = 10;

function newDraft(model: ChatModelId = CHAT_MODELS[0].id): ChatConversation {
  const now = Date.now();
  const id = globalThis.crypto?.randomUUID?.() ?? `session-${now}-${Math.random().toString(36).slice(2)}`;
  return { id, title: "New chat", model, messages: [], revision: 0, createdAt: now, updatedAt: now };
}

function historyForRequest(history: HistoryMessage[]): ChatMessage[] {
  const selected: ChatMessage[] = [];
  let bytes = 0;
  for (const item of history.slice(-CHAT_MAX_MESSAGES).reverse()) {
    const content = item.content.slice(0, CHAT_MAX_MESSAGE_CHARS);
    const length = new TextEncoder().encode(content).length;
    if (bytes + length > CHAT_MAX_TOTAL_BYTES) break;
    selected.unshift({ role: item.role, content });
    bytes += length;
  }
  return selected;
}

export function WorkspaceChat({ userId, configured, initialChatId }: { userId: string; configured: boolean; initialChatId?: string }) {
  const [chat, setChat] = useState<ChatConversation | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [cacheState, setCacheState] = useState<CacheState>("loading");
  const [selecting, setSelecting] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [generationMode, setGenerationMode] = useState<"chat" | "image" | "video" | "pptx">("chat");
  const [imageEstimate, setImageEstimate] = useState<{ credits: number; estimatedUsd: number } | null>(null);
  const [imageEstimateError, setImageEstimateError] = useState(false);
  const [videoEstimate, setVideoEstimate] = useState<{ credits: number; estimatedUsd: number } | null>(null);
  const [videoJobs, setVideoJobs] = useState<Array<{ id: string; status: string; output_file_id: string | null }>>([]);
  const [videoRefresh, setVideoRefresh] = useState(0);
  const [files, setFiles] = useState<SavedChatFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [previewFile, setPreviewFile] = useState<{ id: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<HTMLElement | null>(null);
  const apiRef = useRef<HistoryApi | null>(null);
  const memoryRef = useRef(new Map<string, ChatConversation>());
  const busyRef = useRef(false);
  const newChatRef = useRef<() => void>(() => undefined);
  const threadRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (generationMode !== "image") return;
    const controller = new AbortController();
    setImageEstimate(null); setImageEstimateError(false);
    fetch("/api/chat/generate-image", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("pricing unavailable");
      const result = await response.json() as { credits?: unknown; estimatedUsd?: unknown };
      if (typeof result.credits !== "number" || typeof result.estimatedUsd !== "number") throw new Error("pricing unavailable");
      if (!controller.signal.aborted) setImageEstimate({ credits: result.credits, estimatedUsd: result.estimatedUsd });
    }).catch(() => { if (!controller.signal.aborted) setImageEstimateError(true); });
    return () => controller.abort();
  }, [generationMode]);

  useEffect(() => {
    if (!configured) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const response = await fetch("/api/chat/generate-video", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("jobs unavailable");
        const result = await response.json() as { credits?: unknown; estimatedUsd?: unknown; jobs?: Array<{ id: string; status: string; output_file_id: string | null }> };
        if (controller.signal.aborted) return;
        setVideoEstimate(typeof result.credits === "number" && typeof result.estimatedUsd === "number" ? { credits: result.credits, estimatedUsd: result.estimatedUsd } : null);
        const jobs = Array.isArray(result.jobs) ? result.jobs : [];
        setVideoJobs(jobs);
        const pending = jobs.filter(job => job.status === "pending").slice(0, 3);
        if (pending.length) {
          await Promise.allSettled(pending.map(job => fetch("/api/chat/generate-video", { method: "PATCH", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id }) })));
          if (!controller.signal.aborted) {
            const updated = await fetch("/api/chat/generate-video", { signal: controller.signal, cache: "no-store" });
            if (updated.ok) { const data = await updated.json() as { jobs?: typeof jobs }; if (!controller.signal.aborted && Array.isArray(data.jobs)) setVideoJobs(data.jobs); }
          }
        }
      } catch { /* retry an existing job without submitting a new one */ }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 30_000);
    };
    void refresh();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [configured, videoRefresh]);

  const refreshHistory = useCallback(async () => {
    if (!apiRef.current) return;
    const page = await apiRef.current.listChats(userId, SIDEBAR_HISTORY_LIMIT);
    setChats(page.chats);
  }, [userId]);

  useEffect(() => {
    let disposed = false;
    memoryRef.current.clear();
    setChat(null);
    setChats([]);
    setPrompt("");
    setFiles([]);
    setCacheState("loading");
    (async () => {
      try {
        const api = await import("@/lib/chat-history");
        await api.migrateLegacyChat(userId);
        const page = await api.listChats(userId, SIDEBAR_HISTORY_LIMIT);
        const requested = initialChatId ? await api.getChat(userId, initialChatId) : null;
        const latest = requested ?? (page.chats[0] ? await api.getChat(userId, page.chats[0].id) : null);
        if (disposed) return;
        apiRef.current = api;
        setChats(page.chats);
        const initial = latest ?? newDraft();
        if (latest) memoryRef.current.set(latest.id, latest);
        setChat(initial);
        if (initialChatId && !requested) setError("That chat is not saved in this browser. Showing your latest chat instead.");
        // Drop ?chat= once consumed so a reload opens whichever chat is current, not the one linked to.
        if (initialChatId) window.history.replaceState(null, "", window.location.pathname);
        setCacheState("ready");
      } catch {
        if (disposed) return;
        apiRef.current = null;
        setChat(newDraft());
        setCacheState("unavailable");
      }
    })();
    return () => { disposed = true; apiRef.current = null; };
  }, [initialChatId, userId]);

  useEffect(() => {
    setHistoryTarget(document.getElementById("sidebar-chat-history-slot"));
    const handleNewChat = () => newChatRef.current();
    window.addEventListener("ai-cuber:new-chat", handleNewChat);
    return () => window.removeEventListener("ai-cuber:new-chat", handleNewChat);
  }, []);

  useEffect(() => {
    if (cacheState !== "ready" || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("ai-cuber-chat-history-v1");
    channelRef.current = channel;
    channel.onmessage = (event) => {
      if (event.data?.userId === userId) void refreshHistory().catch(() => undefined);
    };
    return () => { channelRef.current = null; channel.close(); };
  }, [cacheState, refreshHistory, userId]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread && isAtBottomRef.current) thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
  }, [chat?.messages, busy]);

  function handleThreadScroll() {
    const thread = threadRef.current;
    if (!thread) return;
    const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 56;
    isAtBottomRef.current = atBottom;
    setShowJumpToLatest(!atBottom);
  }

  function rememberInMemory(next: ChatConversation) {
    memoryRef.current.set(next.id, next);
    setChats((current) => [{ id: next.id, title: next.title, model: next.model, updatedAt: next.updatedAt }, ...current.filter((item) => item.id !== next.id)].slice(0, SIDEBAR_HISTORY_LIMIT));
    setChat(next);
  }

  async function persist(next: ChatConversation): Promise<ChatConversation> {
    const api = apiRef.current;
    if (api) {
      try {
        const saved = await api.saveChat(userId, next);
        memoryRef.current.set(saved.id, saved);
        setChat(saved);
        await refreshHistory().catch(() => undefined);
        channelRef.current?.postMessage({ userId });
        return saved;
      } catch (reason) {
        if (reason instanceof api.ChatHistoryConflict) throw reason;
        apiRef.current = null;
        setCacheState("unavailable");
      }
    }
    const first = next.messages.find((message) => message.role === "user")?.content.trim().replace(/\s+/g, " ") || "New chat";
    const saved = { ...next, title: first.length > 60 ? `${first.slice(0, 57)}…` : first, updatedAt: Date.now() };
    rememberInMemory(saved);
    return saved;
  }

  async function selectChat(id: string) {
    if (busyRef.current || selecting || uploading) return;
    setSelecting(true);
    setError("");
    setNotice("");
    try {
      const selected = apiRef.current ? await apiRef.current.getChat(userId, id) : memoryRef.current.get(id);
      if (!selected) throw new Error("This chat is unavailable in this browser.");
      memoryRef.current.set(id, selected);
      isAtBottomRef.current = true;
      setShowJumpToLatest(false);
      setChat(selected);
      setFiles([]);
      setPanelOpen(true);
      setPrompt("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to open this chat.");
    } finally { setSelecting(false); }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isPowerPointTransfer = files.length === 2 && files.every(item => /\.pptx$/i.test(item.name));
    const value = isPowerPointTransfer ? "Apply the second PowerPoint's design to the first presentation." : prompt.trim() || (files.length === 2 ? "Fill the document template for each spreadsheet record." : files[0] ? `Extract and review ${files[0].name}` : "");
    if (!chat || !configured || busyRef.current || selecting || cacheState === "loading" || uploading || !value) return;
    if (value.length > CHAT_MAX_MESSAGE_CHARS) { setError(`Messages can contain up to ${CHAT_MAX_MESSAGE_CHARS.toLocaleString()} characters.`); return; }
    busyRef.current = true;
    isAtBottomRef.current = true;
    setShowJumpToLatest(false);
    setBusy(true);
    setError("");
    setNotice("");
    const file = files[0];
    const batch = files.length === 2;
    const model = files.length || generationMode === "pptx" ? FILE_CHAT_MODEL : chat.model;
    const work = async () => {
      const priorArtifact = [...chat.messages].reverse().find(message => message.artifact)?.artifact;
      let pending = await persist({ ...chat, messages: [...chat.messages, { role: "user", content: value, ...(files.length ? { fileRefs: files.map(({ id, name }) => ({ id, name })) } : {}) }] });
      setPrompt("");
      try {
        const fileContext = !files.length && priorArtifact ? `${priorArtifact.content.length > 6000 ? "PARTIAL EXCERPT: remaining file data is not included. Do not infer statistics for the complete file.\n" : ""}${priorArtifact.content.slice(0, 6000)}` : undefined;
        const response = await fetch(generationMode === "image" ? "/api/chat/generate-image" : generationMode === "video" ? "/api/chat/generate-video" : isPowerPointTransfer ? "/api/chat/retheme-pptx" : batch ? "/api/chat/batch-pdf" : "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(generationMode === "image" || generationMode === "video" ? { prompt: value } : isPowerPointTransfer ? { sourceId: files[0].id, templateId: files[1].id } : batch ? { messages: historyForRequest(pending.messages), fileIds: files.map(item => item.id) } : { model, messages: historyForRequest(pending.messages), ...(generationMode === "pptx" ? { outputFormat: "pptx" } : { fileId: file?.id, fileContext }) }) });
        const payload = await response.json().catch(() => null) as { message?: unknown; error?: unknown; model?: unknown; ocr?: { name?: unknown; markdown?: unknown; truncated?: unknown } | null; spreadsheet?: unknown; savedOutput?: { id?: unknown; name?: unknown }; savedOutputs?: Array<{ id?: unknown; name?: unknown }>; batchSaveIncomplete?: boolean; outputSaveFailed?: boolean; usagePending?: boolean; chargedCredits?: unknown; availableCredits?: unknown; quotaExempt?: unknown } | null;
        if (!response.ok || typeof payload?.message !== "string") throw new Error(typeof payload?.error === "string" ? payload.error : "Unable to get a response. Please try again.");
        const responseModel = isChatModel(payload.model) ? payload.model : model;
        let artifact: FileArtifact | undefined;
        if (file && payload.ocr && typeof payload.ocr.markdown === "string") artifact = { name: file.name, kind: "ocr", content: payload.ocr.markdown, truncated: payload.ocr.truncated === true };
        else if (file && typeof payload.spreadsheet === "string") artifact = { name: file.name, kind: "spreadsheet", content: payload.spreadsheet };
        const outputFile = payload.savedOutput && typeof payload.savedOutput.id === "string" && typeof payload.savedOutput.name === "string" ? { id: payload.savedOutput.id, name: payload.savedOutput.name } : undefined;
        const outputFiles = Array.isArray(payload.savedOutputs) ? payload.savedOutputs.filter((item): item is { id: string; name: string } => typeof item.id === "string" && typeof item.name === "string").slice(0, 100) : [];
        pending = await persist({ ...pending, messages: [...pending.messages, { role: "assistant", content: payload.message, ...(generationMode === "chat" && !isPowerPointTransfer ? { model: responseModel } : {}), ...(artifact ? { artifact } : {}), ...(outputFile ? { fileRef: outputFile } : {}), ...(outputFiles.length ? { fileRefs: outputFiles } : {}) }] });
        if (generationMode === "video") setVideoRefresh(current => current + 1);
        const missingOcr = !batch && file && !artifact && /\.(pdf|png|jpe?g|webp)$/i.test(file.name);
        setFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setPanelOpen(true);
        const notices: string[] = [];
        if (payload.outputSaveFailed) notices.push("The response is shown, but its generated file could not be saved. You can still download the extracted data from the side panel.");
        else if (missingOcr) notices.push("The file was processed, but no extracted text was available for the side panel.");
        if (payload.usagePending) notices.push("Usage is unconfirmed. Reserved credits remain held for review; see AI Credits Usage or contact support.");
        else if (payload.quotaExempt === true) notices.push("This account is exempt from AI credit charges.");
        else if (typeof payload.chargedCredits === "number" && typeof payload.availableCredits === "number") notices.push(`${payload.chargedCredits.toLocaleString()} credits used · ${payload.availableCredits.toLocaleString()} available`);
        if (notices.length) setNotice(notices.join(" "));
      } catch (reason) {
        if (apiRef.current && reason instanceof apiRef.current.ChatHistoryConflict) throw reason;
        await persist({ ...pending, messages: pending.messages.slice(0, -1) });
        setPrompt(value);
        throw reason;
      }
    };
    try {
      if (navigator.locks) {
        await navigator.locks.request(`ai-cuber-chat-send:${userId}:${chat.id}`, { ifAvailable: true }, async (lock) => {
          if (!lock) throw new Error("This chat is already sending a message in another tab.");
          await work();
        });
      } else { await work(); }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to get a response. Please try again.");
    } finally { busyRef.current = false; setBusy(false); }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function newChat() {
    if (busyRef.current || selecting || uploading) return;
    const draft = newDraft(chat?.model);
    isAtBottomRef.current = true;
    setShowJumpToLatest(false);
    setChat(draft);
    setFiles([]);
    setPanelOpen(true);
    setPrompt("");
    setError("");
    setNotice("");
    const api = apiRef.current;
    if (!api) return;
    setSelecting(true);
    try {
      const saved = await api.saveChat(userId, draft);
      memoryRef.current.set(saved.id, saved);
      setChat(saved);
      await refreshHistory().catch(() => undefined);
      channelRef.current?.postMessage({ userId });
    } catch (reason) {
      if (reason instanceof api.ChatHistoryConflict) {
        setError(reason.message);
      } else {
        apiRef.current = null;
        setCacheState("unavailable");
        rememberInMemory(draft);
      }
    } finally {
      setSelecting(false);
    }
  }
  newChatRef.current = newChat;

  function isBatchPair(names: string[]) {
    return names.length !== 2 || names.every(name => /\.pptx$/i.test(name)) || (names.some(name => /\.(pdf|docx|pptx)$/i.test(name)) && names.some(name => /\.(xlsx|csv)$/i.test(name)));
  }
  function addSavedFile(selected: SavedChatFile) {
    if (files.some(item => item.id === selected.id)) { setError("That file is already attached."); return; }
    if (files.length >= 2 || !isBatchPair([...files.map(item => item.name), selected.name])) { setError("Choose two PowerPoint files, or one document template and one spreadsheet."); return; }
    if (selected.origin === "output" && files.some(item => /\.(xlsx|csv)$/i.test(item.name))) { setError("Use an uploaded template with a spreadsheet. Generated PowerPoints can be used with another PowerPoint."); return; }
    if (/\.(xlsx|csv)$/i.test(selected.name) && files.some(item => item.origin === "output")) { setError("Use an uploaded template with a spreadsheet. Generated PowerPoints can be used with another PowerPoint."); return; }
    setFiles(current => [...current, selected]); setError("");
  }
  async function uploadFiles(selected: File[]) {
    if (!selected.length) return;
    if (files.length + selected.length > 2 || !isBatchPair([...files.map(item => item.name), ...selected.map(item => item.name)])) { setError("Choose two PowerPoint files, or one document template and one spreadsheet."); if (fileInputRef.current) fileInputRef.current.value = ""; return; }
    if (files.some(item => item.origin === "output") && selected.some(item => /\.(xlsx|csv)$/i.test(item.name))) { setError("Use an uploaded template with a spreadsheet. Generated PowerPoints can be used with another PowerPoint."); if (fileInputRef.current) fileInputRef.current.value = ""; return; }
    if (selected.some(item => item.size === 0 || item.size > CHAT_FILE_MAX_BYTES)) { setError("Choose files between 1 byte and 20 MB each."); if (fileInputRef.current) fileInputRef.current.value = ""; return; }
    setUploading(true); setError("");
    try {
      for (const item of selected) {
        const response = await fetch(`/api/chat/files?${new URLSearchParams({ name: item.name })}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: item });
        const result = await response.json().catch(() => null) as { file?: SavedChatFile; error?: string } | null;
        if (!response.ok || !result?.file) throw new Error(result?.error || "Could not save file.");
        const saved = result.file; setFiles(current => [...current, saved]);
      }
      setNotice("Files saved to your private library.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save file."); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  }

  const activeArtifact = [...(chat?.messages ?? [])].reverse().find(message => message.artifact)?.artifact;
  function downloadArtifact(artifact: FileArtifact) {
    const url = URL.createObjectURL(new Blob([artifact.content], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${artifact.name.replace(/\.[^.]+$/, "")}-extracted.${artifact.kind === "ocr" ? "md" : "json"}`; link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-labelledby="workspace-chat-title" className={`dashboard-workbench workspace-chat${activeArtifact && panelOpen ? " workspace-chat--with-artifact" : ""}`}>
      <div className="workspace-chat__header">
        <div><p className="workspace-status-card__eyebrow">YOUR AI WORKSPACE</p><h1 id="workspace-chat-title">Chat with AI</h1><p>Choose a model and ask a question. An estimated amount of AI credits is reserved first; actual usage determines the final charge.</p></div>
      </div>
      <div className="workspace-chat__layout">
        <div className="workspace-chat__main">
          <div className="workspace-chat__alerts">
            {!configured ? <p className="workspace-chat__warning" role="status">Chat is not configured yet. Contact the administrator to enable it.</p> : null}
            {cacheState === "unavailable" ? <p className="workspace-chat__warning" role="status">Chat history could not be saved in this browser. New conversations are available only until you leave this page; your existing saved data has not been removed.</p> : null}
            {notice ? <p className="workspace-chat__notice" role="status">{notice}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}
            {videoJobs.some(job => job.status === "pending" || job.status === "submitting") ? <p className="workspace-chat__notice" role="status">Video generation or usage confirmation is in progress. Jobs resume checking when you return to chat.</p> : null}
            {videoJobs.filter(job => job.output_file_id).slice(0, 3).map(job => <p className="workspace-chat__notice" key={job.id}>Video ready · <button type="button" className="text-link" onClick={() => setPreviewFile({ id: job.output_file_id!, name: "Generated video.mp4" })}>Preview video</button> · saved in My Files</p>)}
            {videoJobs.some(job => job.status === "uncertain") ? <p className="workspace-chat__warning">A video request could not be confirmed. Check AI Credits Usage or contact support before retrying.</p> : null}
            {videoJobs.some(job => job.status === "failed") ? <p className="workspace-chat__warning">A video job did not complete. Check AI Credits Usage for its recorded cost.</p> : null}
          </div>
          <div className="workspace-chat__conversation">
            <div aria-label="Conversation" aria-live="polite" className="workspace-chat__thread" onScroll={handleThreadScroll} ref={threadRef} role="log">
              {!chat?.messages.length ? <div className="workspace-chat__empty"><span><Bot size={26} /></span><h2>What would you like to work on?</h2><p>Ask a question, explore an idea, or get help with a task.</p></div> : null}
              {chat?.messages.map((message, index) => <article className={`workspace-chat__message workspace-chat__message--${message.role}`} key={`${index}-${message.role}`}><p className="workspace-chat__sender">{message.role === "user" ? "You" : CHAT_MODELS.find((item) => item.id === message.model)?.label ?? "AI"}</p><div className="workspace-chat__content"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ table: ({ children, ...props }) => <div className="workspace-chat__table-wrap"><table {...props}>{children}</table></div> }}>{message.content}</ReactMarkdown>{[...(message.fileRef ? [message.fileRef] : []), ...(message.fileRefs ?? [])].map(reference => <div key={reference.id}>{message.role === "assistant" && /^generated-image-[0-9a-f]+\.(png|jpg|webp)$/i.test(reference.name) ? <img className="workspace-chat__generated-image" src={`/api/chat/files/${encodeURIComponent(reference.id)}/preview?inline=1`} alt="AI-generated image" /> : null}<div className="workspace-chat__file-card"><FileText size={17} aria-hidden="true" /><button type="button" className="workspace-chat__file-name" onClick={() => setPreviewFile(reference)}>{reference.name}</button><button type="button" className="chat-file-icon" aria-label={`Preview ${reference.name}`} title="Preview" onClick={() => setPreviewFile(reference)}><Eye size={17} /></button><a className="chat-file-icon" aria-label={`Download ${reference.name}`} title="Download" href={`/api/chat/files/${encodeURIComponent(reference.id)}`}><Download size={17} /></a></div></div>)}</div></article>)}
              {busy ? <p className="workspace-chat__thinking" role="status">Thinking…</p> : null}
            </div>
            {showJumpToLatest && chat?.messages.length ? <button aria-label="Jump to latest message" className="workspace-chat__jump-latest" onClick={() => threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" })} title="Jump to latest message" type="button"><ArrowDown size={18} /></button> : null}
          </div>
          <form className="workspace-chat__form" onSubmit={send}>
            {files.map(item => <div className="workspace-chat__file" key={item.id}><span>{item.name} · saved{files.length === 2 && files.every(file => /\.pptx$/i.test(file.name)) ? "" : " · Gemini 2.5 Flash"}{files.length === 1 && item.name.toLowerCase().endsWith(".pdf") ? " · Mistral OCR" : files.length === 1 && /\.(png|jpe?g|webp)$/i.test(item.name) ? " · image OCR" : ""}</span><button type="button" aria-label={`Remove ${item.name}`} disabled={busy} onClick={() => { setFiles(current => current.filter(saved => saved.id !== item.id)); if (fileInputRef.current) fileInputRef.current.value = ""; }}><X size={16} /></button></div>)}
            {files.length === 2 && files.every(item => /\.pptx$/i.test(item.name)) ? <div className="workspace-chat__notice"><strong>PowerPoint transfer</strong><p>Content: {files[0].name}<br />Template: {files[1].name}</p><button type="button" className="btn-ghost btn-ghost--compact" disabled={busy} onClick={() => setFiles(current => [...current].reverse())}>Swap content and template</button><p>Review the finished slides for overlapping elements. Transfer does not use AI credits.</p></div> : files.length === 2 ? <p className="workspace-chat__notice">Batch document mode: one {files.some(item => /\.pptx$/i.test(item.name)) ? "PPTX" : files.some(item => /\.docx$/i.test(item.name)) ? "DOCX" : "PDF"} will be created per spreadsheet row. {files.some(item => /\.(docx|pptx)$/i.test(item.name)) ? "Use placeholders such as {{Name}} in the template. " : ""}Review the field mapping and generated files.</p> : null}
            {generationMode === "image" ? <p className="workspace-chat__notice">Generate one image with Seedream 4.5. {imageEstimate ? `Current reservation: ${imageEstimate.credits.toLocaleString()} credits (estimated provider cost $${imageEstimate.estimatedUsd.toFixed(4)}). ` : imageEstimateError ? "Pricing is temporarily unavailable. " : "Checking current pricing… "}The final provider cost is recorded in AI Credits Usage.</p> : null}
            {generationMode === "video" ? <p className="workspace-chat__notice">Generate a 3-second, 480p video with Grok Imagine Video 1.5 Lite. {videoEstimate ? `Current reservation: ${videoEstimate.credits.toLocaleString()} credits (estimated provider cost $${videoEstimate.estimatedUsd.toFixed(4)}). ` : "Pricing is unavailable or still loading. "}Final usage is recorded in AI Credits Usage.</p> : null}
            {generationMode === "pptx" ? <p className="workspace-chat__notice">Create an editable PowerPoint from your prompt with Gemini 2.5 Flash. AI usage is recorded in AI Credits Usage; review the slides and their facts before sharing.</p> : null}
            <textarea aria-label="Your message" disabled={!configured || busy || selecting || uploading || cacheState === "loading" || (files.length === 2 && files.every(item => /\.pptx$/i.test(item.name)))} maxLength={CHAT_MAX_MESSAGE_CHARS} value={files.length === 2 && files.every(item => /\.pptx$/i.test(item.name)) ? "" : prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handleKeyDown} placeholder={generationMode === "image" ? "Describe the image you want to create…" : generationMode === "video" ? "Describe the video you want to create…" : generationMode === "pptx" ? "Describe the PowerPoint you want to create…" : files.length === 2 && files.every(item => /\.pptx$/i.test(item.name)) ? "Use the controls above to confirm the file order." : files.length === 2 ? "Describe how spreadsheet columns match the document fields…" : "Ask anything…"} rows={3} /><div className="workspace-chat__form-footer"><input ref={fileInputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.csv,.docx,.pptx" hidden onChange={(event) => { const selected = Array.from(event.target.files ?? []); if (selected.length) void uploadFiles(selected); }} /><button type="button" className="btn-ghost" disabled={generationMode !== "chat" || busy || selecting || uploading || files.length >= 2} onClick={() => fileInputRef.current?.click()}><Paperclip size={16} /> {uploading ? "Saving…" : "Attach file"}</button><ChatSavedFiles disabled={generationMode !== "chat" || busy || selecting || uploading || files.length >= 2} onSelect={addSavedFile} /><select aria-label="Chat mode" className="workspace-chat__model-select" disabled={busy || selecting || uploading || files.length > 0} value={generationMode} onChange={event => setGenerationMode(event.target.value === "image" ? "image" : event.target.value === "video" ? "video" : event.target.value === "pptx" ? "pptx" : "chat")}><option value="chat">Chat</option><option value="image">Generate image</option><option value="video">Generate 3s video</option><option value="pptx">Generate PowerPoint</option></select>{generationMode === "chat" && !(files.length === 2 && files.every(item => /\.pptx$/i.test(item.name))) ? <select aria-label="AI model" className="workspace-chat__model-select" disabled={busy || selecting || uploading || files.length > 0 || !chat} id="workspace-chat-model" onChange={(event) => { if (chat && isChatModel(event.target.value)) setChat({ ...chat, model: event.target.value }); }} value={files.length || uploading ? FILE_CHAT_MODEL : chat?.model ?? CHAT_MODELS[0].id}>{CHAT_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : null}<button aria-label="Send message" className="workspace-chat__send" disabled={!configured || busy || selecting || uploading || cacheState === "loading" || (!prompt.trim() && !files.length)} type="submit"><ArrowUp size={16} strokeWidth={2.4} /></button></div></form>
          <p className="workspace-chat__privacy">Uploaded files are saved privately to your account. Chat history and extracted data remain on this device. Files are sent for processing; follow-ups include the first 6,000 characters of extracted data.</p>
        </div>
        {activeArtifact && !panelOpen ? <button className="btn-ghost workspace-chat__show-artifact" type="button" onClick={() => setPanelOpen(true)}>Show file</button> : null}
        {historyTarget ? createPortal(<aside aria-label="Chat history" className="workspace-chat-history">
          <div className="workspace-chat-history__header"><h2>Chat history</h2><a className="workspace-chat-history__view-all" href="/dashboard/chat/history">View all</a></div>
          {cacheState === "loading" ? <p className="workspace-chat-history__empty">Loading your chats…</p> : chats.length === 0 ? <p className="workspace-chat-history__empty">Your conversations will appear here.</p> : null}
          <div className="workspace-chat-history__list">{chats.map((item) => <button aria-current={chat?.id === item.id ? "true" : undefined} className={`workspace-chat-history__item${chat?.id === item.id ? " is-active" : ""}`} disabled={busy || selecting} key={item.id} onClick={() => void selectChat(item.id)} type="button"><strong>{item.title}</strong><span>{CHAT_MODELS.find((model) => model.id === item.model)?.label ?? "AI"}</span></button>)}</div>
        </aside>, historyTarget) : null}
      </div>
      {activeArtifact && panelOpen ? <aside className="workspace-chat__artifact" aria-label={activeArtifact.kind === "ocr" ? "Extracted text" : "Spreadsheet data"}>
        <div className="workspace-chat__artifact-header"><div><strong>{activeArtifact.kind === "ocr" ? "Extracted text" : "Spreadsheet data"}</strong><p>{activeArtifact.name}</p></div><button type="button" className="btn-icon" aria-label="Close file panel" onClick={() => setPanelOpen(false)}><X size={18} /></button></div>
        {activeArtifact.truncated ? <p className="workspace-chat__warning">The extraction was truncated. Try a shorter document or image.</p> : null}
        {activeArtifact.content.length > 6000 ? <p>Follow-up questions include only the first 6,000 characters of this data.</p> : null}
        <div className="workspace-chat__artifact-actions"><button type="button" className="btn-ghost" onClick={() => void navigator.clipboard.writeText(activeArtifact.content).catch(() => setError("Could not copy text."))}>Copy</button><button type="button" className="btn-ghost" onClick={() => downloadArtifact(activeArtifact)}>Download</button></div>
        <div className="workspace-chat__artifact-content">{activeArtifact.kind === "ocr" ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null }}>{activeArtifact.content}</ReactMarkdown> : <><p>Spreadsheet rows and calculated numeric column statistics. For exact grouped calculations, verify results in a spreadsheet.</p><pre>{activeArtifact.content}</pre></>}</div>
      </aside> : null}
      {previewFile ? <ChatFilePreview file={previewFile} onClose={() => setPreviewFile(null)} /> : null}
    </section>
  );
}
