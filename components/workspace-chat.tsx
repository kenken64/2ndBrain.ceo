"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowRight, Bot, Download, Eye, FileText, Image as ImageIcon, MessageSquare, Paperclip, Presentation, Square, Video, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { CHAT_MAX_MESSAGE_CHARS, CHAT_MAX_MESSAGES, CHAT_MAX_TOTAL_BYTES, CHAT_MODELS, FILE_CHAT_MODEL, isChatModel, type ChatMessage, type ChatModelId } from "@/lib/chat-models";
import { Localized, useLanguage, LocalizedMessage } from "@/components/language-provider";
import { ChatSavedFiles } from "@/components/chat-saved-files";
import { ChatFilePreviewContent } from "@/components/chat-file-preview";
import { ChatBatchMapping, type BatchReview } from "@/components/chat-batch-mapping";
import { ChatResponseTools } from "@/components/chat-response-tools";
import { readBatchProgress, type BatchProgress } from "@/lib/chat-batch-client";
import { readChatStream } from "@/lib/chat-stream-client";
import { isChatResponseMetrics } from "@/lib/chat-response-metrics";
import { CHAT_FILE_MAX_BYTES, type SavedChatFile } from "@/lib/chat-files-shared";
import type { ChatConversation, ChatSummary, HistoryMessage, FileArtifact } from "@/lib/chat-history";

type HistoryApi = typeof import("@/lib/chat-history");
type CacheState = "loading" | "ready" | "unavailable";
type PresentationRecovery = { id: string; chatId: string; data: Blob };
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
  const { language } = useLanguage();
  const tr = (en: string, zh: string) => language === "zh" ? zh : en;
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
  const [dismissedVideoJobs, setDismissedVideoJobs] = useState<Set<string>>(() => new Set());
  const [videoRefresh, setVideoRefresh] = useState(0);
  const [files, setFiles] = useState<SavedChatFile[]>([]);
  const [confirmedPowerPointRoles, setConfirmedPowerPointRoles] = useState("");
  const [followUpFile, setFollowUpFile] = useState<{ id: string; name: string } | null>(null);
  const [batchReview, setBatchReview] = useState<{ fileKey: string; data: BatchReview } | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [presentationRecoveries, setPresentationRecoveries] = useState<PresentationRecovery[]>([]);
  const [savingRecovery, setSavingRecovery] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelFiles, setPanelFiles] = useState<Array<{ id: string; name: string }>>([]);
  const [panelSelection, setPanelSelection] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamingResponse, setStreamingResponse] = useState<{ chatId: string; text: string; model: ChatModelId } | null>(null);
  const [unsavedResponses, setUnsavedResponses] = useState<Array<{ chatId: string; text: string; model: ChatModelId }>>([]);
  const [canStop, setCanStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<HTMLElement | null>(null);
  const apiRef = useRef<HistoryApi | null>(null);
  const memoryRef = useRef(new Map<string, ChatConversation>());
  const busyRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const newChatRef = useRef<() => void>(() => undefined);
  const threadRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(`aicuber:dismissed-video-jobs:${userId}`) ?? "[]");
      setDismissedVideoJobs(new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string").slice(-100) : []));
    } catch {
      setDismissedVideoJobs(new Set());
    }
  }, [userId]);

  function dismissVideoNotice(jobId: string) {
    const next = new Set([...dismissedVideoJobs, jobId].slice(-100));
    setDismissedVideoJobs(next);
    try {
      localStorage.setItem(`aicuber:dismissed-video-jobs:${userId}`, JSON.stringify([...next]));
    } catch {
      // The notification stays dismissed for this visit if browser storage is unavailable.
    }
  }

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
    setStreamingResponse(null);
    setUnsavedResponses([]);
    setCanStop(false);
    setStopping(false);
    setChats([]);
    setPrompt("");
    setFiles([]);
    setConfirmedPowerPointRoles("");
    setFollowUpFile(null);
    setBatchReview(null);
    setBatchProgress(null);
    setPresentationRecoveries([]);
    setPanelFiles([]);
    setPanelSelection("");
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
    return () => { disposed = true; apiRef.current = null; streamAbortRef.current?.abort(); streamAbortRef.current = null; };
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
  }, [chat?.messages, busy, streamingResponse?.text]);

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
      setConfirmedPowerPointRoles("");
      setFollowUpFile(null);
      setBatchReview(null);
      setBatchProgress(null);
      setPanelFiles([]);
      setPanelSelection("");
      setPanelOpen(true);
      setPrompt("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to open this chat.");
    } finally { setSelecting(false); }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isPowerPointTransfer = files.length === 2 && files.every(item => /\.pptx$/i.test(item.name));
    const batch = files.length === 2 && !isPowerPointTransfer;
    const fileKey = files.map(item => item.id).join(":");
    const review = batchReview?.fileKey === fileKey ? batchReview.data : null;
    const value = isPowerPointTransfer ? "Apply the second PowerPoint's design to the first presentation." : batch ? "Fill the document template for each spreadsheet record." : prompt.trim() || (files.length === 2 ? "Fill the document template for each spreadsheet record." : (files[0] || followUpFile) ? `Extract and review ${(files[0] || followUpFile)!.name}` : "");
    if (!chat || !configured || busyRef.current || selecting || cacheState === "loading" || uploading || !value) return;
    if (isPowerPointTransfer && confirmedPowerPointRoles !== fileKey) { setError("Confirm which presentation contains the content and which is the design template."); return; }
    if (value.length > CHAT_MAX_MESSAGE_CHARS) { setError(`Messages can contain up to ${CHAT_MAX_MESSAGE_CHARS.toLocaleString()} characters.`); return; }
    if (batch && !review) {
      busyRef.current = true; setBusy(true); setError(""); setNotice(""); setBatchProgress(null);
      try {
        const response = await fetch("/api/chat/batch-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review", fileIds: files.map(item => item.id) }) });
        const payload = await response.json() as BatchReview & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not inspect the template.");
        setBatchReview({ fileKey, data: payload });
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not inspect the template."); }
      finally { busyRef.current = false; setBusy(false); }
      return;
    }
    if (batch && review?.mappings.some(item => !item.column)) { setError("Choose a spreadsheet column for every template field."); return; }
    busyRef.current = true;
    isAtBottomRef.current = true;
    setShowJumpToLatest(false);
    setBusy(true);
    setError("");
    setNotice("");
    const file = files[0] ?? followUpFile;
    const model = file || generationMode === "pptx" ? FILE_CHAT_MODEL : chat.model;
    const streamChat = generationMode === "chat" && !file && !batch && !isPowerPointTransfer;
    const streamController = streamChat ? new AbortController() : null;
    let streamText = "", requestStarted = false, responseSaved = false, requestStartedAt = 0;
    if (streamController) {
      streamAbortRef.current = streamController;
      setStreamingResponse({ chatId: chat.id, text: "", model });
      setCanStop(true); setStopping(false);
    }
    const work = async () => {
      const priorArtifact = [...chat.messages].reverse().find(message => message.artifact)?.artifact;
      let pending = await persist({ ...chat, messages: [...chat.messages, { role: "user", content: value, ...(files.length ? { fileRefs: files.map(({ id, name }) => ({ id, name })) } : followUpFile ? { fileRef: followUpFile } : {}) }] });
      setPrompt("");
      try {
        if (streamController?.signal.aborted) throw new DOMException("Stopped", "AbortError");
        const fileContext = !file && priorArtifact ? `${priorArtifact.content.length > 6000 ? "PARTIAL EXCERPT: remaining file data is not included. Do not infer statistics for the complete file.\n" : ""}${priorArtifact.content.slice(0, 6000)}` : undefined;
        requestStarted = true;
        requestStartedAt = performance.now();
        const response = await fetch(generationMode === "image" ? "/api/chat/generate-image" : generationMode === "video" ? "/api/chat/generate-video" : isPowerPointTransfer ? "/api/chat/retheme-pptx" : batch ? "/api/chat/batch-review" : "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, signal: streamController?.signal, body: JSON.stringify(generationMode === "image" || generationMode === "video" ? { prompt: value } : isPowerPointTransfer ? { sourceId: files[0].id, templateId: files[1].id } : batch ? { action: "run", mappings: review!.mappings, fileIds: files.map(item => item.id) } : { model, messages: historyForRequest(pending.messages), ...(generationMode === "pptx" ? { outputFormat: "pptx" } : { fileId: file?.id, fileContext, ...(streamChat ? { stream: true } : {}) }) }) });
        let payload: { message?: unknown; error?: unknown; model?: unknown; generationMs?: unknown; outputTokens?: unknown; recoveryPptx?: unknown; ocr?: { name?: unknown; markdown?: unknown; truncated?: unknown } | null; spreadsheet?: unknown; savedOutput?: { id?: unknown; name?: unknown }; savedOutputs?: Array<{ id?: unknown; name?: unknown }>; batchSaveIncomplete?: boolean; outputSaveFailed?: boolean; usagePending?: boolean; truncated?: boolean; chargedCredits?: unknown; availableCredits?: unknown; quotaExempt?: unknown } | null;
        if (batch) {
          const result = await readBatchProgress(response, setBatchProgress);
          const mapping = review!.mappings.map(item => `- ${item.field.slice(0, 100)} ← ${item.column?.slice(0, 100)}`).join("\n");
          const failures = result.progress.failed.map(item => `- Row ${item.row}: ${item.error.slice(0, 100)}`).join("\n");
          payload = { message: `Generated ${result.progress.succeeded} of ${result.progress.total} documents; ${result.progress.failed.length} need attention. No AI credits were used.\n\n**Approved field mapping:**\n${mapping}${failures ? `\n\n**Rows needing attention:**\n${failures}` : ""}`, savedOutputs: result.files, batchSaveIncomplete: result.progress.failed.length > 0 };
        } else if (streamChat) {
          payload = await readChatStream(response, text => { streamText = text; setStreamingResponse({ chatId: chat.id, text, model }); });
          setCanStop(false); streamAbortRef.current = null;
        } else payload = await response.json().catch(() => null);
        if (!response.ok || typeof payload?.message !== "string") throw new Error(typeof payload?.error === "string" ? payload.error : "Unable to get a response. Please try again.");
        const metricsCandidate = { elapsedMs: Math.max(0, performance.now() - requestStartedAt), generationMs: payload.generationMs, outputTokens: payload.outputTokens };
        const metrics = isChatResponseMetrics(metricsCandidate) ? metricsCandidate : { elapsedMs: metricsCandidate.elapsedMs };
        const responseModel = isChatModel(payload.model) ? payload.model : model;
        if (typeof payload.recoveryPptx === "string" && payload.recoveryPptx.length <= Math.ceil(5 * 1024 * 1024 / 3) * 4 + 4) {
          try {
            const binary = atob(payload.recoveryPptx), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
            setPresentationRecoveries(current => [...current, { id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`, chatId: chat.id, data: new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }) }]);
          } catch { setError("The recovery download could not be prepared. Check AI Credits Usage before trying again."); }
        }
        let artifact: FileArtifact | undefined;
        if (file && payload.ocr && typeof payload.ocr.markdown === "string") artifact = { name: file.name, kind: "ocr", content: payload.ocr.markdown, truncated: payload.ocr.truncated === true };
        else if (file && typeof payload.spreadsheet === "string") artifact = { name: file.name, kind: "spreadsheet", content: payload.spreadsheet };
        if (artifact) setPanelSelection("artifact");
        const outputFile = payload.savedOutput && typeof payload.savedOutput.id === "string" && typeof payload.savedOutput.name === "string" ? { id: payload.savedOutput.id, name: payload.savedOutput.name } : undefined;
        const outputFiles = Array.isArray(payload.savedOutputs) ? payload.savedOutputs.filter((item): item is { id: string; name: string } => typeof item.id === "string" && typeof item.name === "string").slice(0, 100) : [];
        pending = await persist({ ...pending, messages: [...pending.messages, { role: "assistant", content: payload.message, metrics, ...(generationMode === "chat" && !isPowerPointTransfer && !batch ? { model: responseModel } : {}), ...(artifact ? { artifact } : {}), ...(outputFile ? { fileRef: outputFile } : {}), ...(outputFiles.length ? { fileRefs: outputFiles } : {}) }] });
        responseSaved = true;
        if (streamChat) setStreamingResponse(null);
        const generated = [...(outputFile ? [outputFile] : []), ...outputFiles];
        if (generated.length) {
          setPanelFiles(current => [...current.filter(item => !generated.some(output => output.id === item.id)), ...generated]);
          if (!artifact) setPanelSelection(generated[0].id);
        }
        if (generationMode === "video") setVideoRefresh(current => current + 1);
        const missingOcr = !batch && file && !artifact && /\.(pdf|png|jpe?g|webp)$/i.test(file.name);
        setFiles([]);
        setConfirmedPowerPointRoles("");
        setFollowUpFile(null);
        setBatchReview(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setPanelOpen(true);
        const notices: string[] = [];
        if (payload.outputSaveFailed) notices.push("The response is shown, but its generated file could not be saved. You can still download the extracted data from the side panel.");
        else if (missingOcr) notices.push("The file was processed, but no extracted text was available for the side panel.");
        if (payload.usagePending) notices.push("Usage is unconfirmed. Reserved credits remain held for review; see AI Credits Usage or contact support.");
        else if (payload.quotaExempt === true) notices.push("This account is exempt from AI credit charges.");
        else if (typeof payload.chargedCredits === "number" && typeof payload.availableCredits === "number") notices.push(`${payload.chargedCredits.toLocaleString()} credits used · ${payload.availableCredits.toLocaleString()} available`);
        if (payload.truncated) notices.push("The response reached its length limit. Ask the model to continue.");
        if (notices.length) setNotice(notices.join("\n"));
      } catch (reason) {
        if (apiRef.current && reason instanceof apiRef.current.ChatHistoryConflict) throw reason;
        if (streamChat && (streamText.trim() || streamController?.signal.aborted)) {
          const stopped = streamController?.signal.aborted === true;
          setCanStop(false); streamAbortRef.current = null;
          if (streamText.trim()) await persist({ ...pending, messages: [...pending.messages, { role: "assistant", content: `${streamText}\n\n*Response ${stopped ? "stopped" : "interrupted"}.*`, model, metrics: { elapsedMs: Math.max(0, performance.now() - requestStartedAt) } }] });
          else if (!requestStarted) setPrompt(value);
          setStreamingResponse(null);
          setNotice(stopped && !requestStarted ? "Stopped before the request was sent." : stopped ? `Response stopped.${streamText.trim() ? " Partial text is kept." : ""} The provider may still charge for work performed; check AI Credits Usage for the status.` : "The response was interrupted. Partial text is kept; check AI Credits Usage before retrying.");
          if (!stopped && reason instanceof Error) setError(reason.message);
          return;
        }
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
      if (streamChat && streamText.trim() && !responseSaved) {
        setUnsavedResponses(current => [...current, { chatId: chat.id, text: streamText, model }]);
        setNotice("The response is shown below but could not be saved to chat history. Copy it before leaving this page.");
      }
      setError(reason instanceof Error ? reason.message : "Unable to get a response. Please try again.");
    } finally { busyRef.current = false; setBusy(false); setCanStop(false); setStopping(false); streamAbortRef.current = null; setStreamingResponse(null); }
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
    setConfirmedPowerPointRoles("");
    setFollowUpFile(null);
    setBatchReview(null);
    setBatchProgress(null);
    setPanelFiles([]);
    setPanelSelection("");
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
  function showAttachedFile(file: { id: string; name: string }, replace: boolean) {
    setPanelFiles(current => replace ? [file] : [...current.filter(item => item.id !== file.id), file]);
    setPanelSelection(current => replace || !current || current === "artifact" ? file.id : current);
    setPanelOpen(true);
  }
  function showFileInPanel(file: { id: string; name: string }) {
    setPanelFiles(current => current.some(item => item.id === file.id) ? current : [...current, file]);
    setPanelSelection(file.id);
    setPanelOpen(true);
  }
  function downloadPresentationRecovery(recovery: PresentationRecovery) {
    const url = URL.createObjectURL(recovery.data), link = document.createElement("a");
    link.href = url; link.download = "presentation.pptx"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function savePresentationRecovery(recovery: PresentationRecovery) {
    if (!chat || chat.id !== recovery.chatId || busyRef.current || selecting || uploading) return;
    busyRef.current = true; setBusy(true); setSavingRecovery(recovery.id); setError("");
    let saved = false;
    try {
      const work = async () => {
        const response = await fetch("/api/chat/recover-pptx", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: recovery.data });
        const payload = await response.json().catch(() => null) as { file?: { id?: unknown; name?: unknown }; error?: string } | null;
        if (!response.ok || typeof payload?.file?.id !== "string" || typeof payload.file.name !== "string") throw new Error(payload?.error || "Could not confirm the save. Check My files before retrying.");
        const file = { id: payload.file.id, name: payload.file.name };
        saved = true;
        setPresentationRecoveries(current => current.filter(item => item.id !== recovery.id));
        setNotice("Presentation saved to My files. No additional AI credits were used.");
        showFileInPanel(file);
        await persist({ ...chat, messages: [...chat.messages, { role: "assistant", content: "Your recovered PowerPoint presentation is saved in My files.", fileRef: file }] });
      };
      if (navigator.locks) await navigator.locks.request(`ai-cuber-chat-send:${userId}:${chat.id}`, { ifAvailable: true }, async lock => { if (!lock) throw new Error("This chat is already being used in another tab."); await work(); });
      else await work();
    } catch (reason) {
      setError(saved ? "The file was saved in My files, but the chat could not be updated." : reason instanceof Error ? reason.message : "The presentation could not be saved. Check My files before retrying.");
    } finally { busyRef.current = false; setBusy(false); setSavingRecovery(null); }
  }
  function askAboutFile(file: { id: string; name: string }) {
    if (busy || uploading || selecting || files.length) { setError("Finish or remove the current attachments before choosing a file for a follow-up."); return; }
    setFollowUpFile(file); setGenerationMode("chat"); setError("");
    showFileInPanel(file);
  }
  async function downloadBatch(fileIds: string[]) {
    if (downloading) return;
    setDownloading(true); setError("");
    try {
      const response = await fetch("/api/chat/batch-download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileIds }) });
      if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(data?.error || "Could not download the files."); }
      const url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
      link.href = url; link.download = "generated-documents.zip"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not download the files."); }
    finally { setDownloading(false); }
  }
  function addSavedFile(selected: SavedChatFile) {
    if (followUpFile) { setError("Remove the selected follow-up file before attaching another file."); return; }
    if (files.some(item => item.id === selected.id)) { setError("That file is already attached."); return; }
    if (files.length >= 2 || !isBatchPair([...files.map(item => item.name), selected.name])) { setError("Choose two PowerPoint files, or one document template and one spreadsheet."); return; }
    if (selected.origin === "output" && files.some(item => /\.(xlsx|csv)$/i.test(item.name))) { setError("Use an uploaded template with a spreadsheet. Generated PowerPoints can be used with another PowerPoint."); return; }
    if (/\.(xlsx|csv)$/i.test(selected.name) && files.some(item => item.origin === "output")) { setError("Use an uploaded template with a spreadsheet. Generated PowerPoints can be used with another PowerPoint."); return; }
    setBatchProgress(null); setConfirmedPowerPointRoles("");
    showAttachedFile(selected, files.length === 0);
    setFiles(current => [...current, selected]); setError("");
  }
  async function uploadFiles(selected: File[]) {
    if (!selected.length) return;
    if (followUpFile) { setError("Remove the selected follow-up file before attaching another file."); return; }
    if (files.length + selected.length > 2 || !isBatchPair([...files.map(item => item.name), ...selected.map(item => item.name)])) { setError("Choose two PowerPoint files, or one document template and one spreadsheet."); if (fileInputRef.current) fileInputRef.current.value = ""; return; }
    if (files.some(item => item.origin === "output") && selected.some(item => /\.(xlsx|csv)$/i.test(item.name))) { setError("Use an uploaded template with a spreadsheet. Generated PowerPoints can be used with another PowerPoint."); if (fileInputRef.current) fileInputRef.current.value = ""; return; }
    if (selected.some(item => item.size === 0 || item.size > CHAT_FILE_MAX_BYTES)) { setError("Choose files between 1 byte and 20 MB each."); if (fileInputRef.current) fileInputRef.current.value = ""; return; }
    setUploading(true); setError(""); setBatchProgress(null); setConfirmedPowerPointRoles("");
    try {
      for (const [index, item] of selected.entries()) {
        const response = await fetch(`/api/chat/files?${new URLSearchParams({ name: item.name })}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: item });
        const result = await response.json().catch(() => null) as { file?: SavedChatFile; error?: string } | null;
        if (!response.ok || !result?.file) throw new Error(result?.error || "Could not save file.");
        const saved = result.file; showAttachedFile(saved, files.length === 0 && index === 0); setFiles(current => [...current, saved]);
      }
      setNotice("Files saved to your private library.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save file."); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  }

  const activeArtifact = [...(chat?.messages ?? [])].reverse().find(message => message.artifact)?.artifact;
  const selectedPanelFile = panelFiles.find(item => item.id === panelSelection) ?? (!activeArtifact || panelSelection !== "artifact" ? panelFiles[0] : undefined);
  const showArtifact = !!activeArtifact && (panelSelection === "artifact" || !selectedPanelFile);
  const hasPanelContent = panelFiles.length > 0 || !!activeArtifact;
  const isBatchFiles = files.length === 2 && !files.every(item => /\.pptx$/i.test(item.name));
  const isPowerPointTransfer = files.length === 2 && files.every(item => /\.pptx$/i.test(item.name));
  const powerPointFileKey = files.map(item => item.id).join(":");
  const visibleReview = batchReview?.fileKey === files.map(item => item.id).join(":") ? batchReview.data : null;
  function removeAttachment(id: string) {
    setConfirmedPowerPointRoles("");
    setFiles(current => current.filter(item => item.id !== id));
    setPanelFiles(current => current.filter(item => item.id !== id));
    if (panelSelection === id) setPanelSelection(panelFiles.find(item => item.id !== id)?.id ?? (activeArtifact ? "artifact" : ""));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  function downloadArtifact(artifact: FileArtifact) {
    const url = URL.createObjectURL(new Blob([artifact.content], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${artifact.name.replace(/\.[^.]+$/, "")}-extracted.${artifact.kind === "ocr" ? "md" : "json"}`; link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-labelledby="workspace-chat-title" className={`dashboard-workbench workspace-chat${hasPanelContent && panelOpen ? " workspace-chat--with-artifact" : ""}`}>
      <div className="workspace-chat__header">
        <div><p className="workspace-status-card__eyebrow"><Localized en="YOUR AI WORKSPACE" zh="您的 AI 工作空间" /></p><h1 id="workspace-chat-title"><Localized en="Chat with AI" zh="与 AI 对话" /></h1><p><Localized en="Choose a model and ask a question. An estimated amount of AI credits is reserved first; actual usage determines the final charge." zh="选择模型并提出问题。系统会先预留估算的 AI 积分，最终费用取决于实际用量。" /></p></div>
      </div>
      <div className="workspace-chat__layout">
        <div className="workspace-chat__main">
          <div className="workspace-chat__alerts">
            {!configured ? <p className="workspace-chat__warning" role="status"><Localized en="Chat is not configured yet. Contact the administrator to enable it." zh="AI 对话尚未配置。请联系管理员启用。" /></p> : null}
            {cacheState === "unavailable" ? <p className="workspace-chat__warning" role="status"><Localized en="Chat history could not be saved in this browser. New conversations are available only until you leave this page; your existing saved data has not been removed." zh="无法在此浏览器中保存对话记录。新对话仅在离开页面前可用；现有保存的数据未被删除。" /></p> : null}
            {notice ? <p className="workspace-chat__notice" role="status"><LocalizedMessage text={notice} /></p> : null}{error ? <p className="form-error" role="alert"><LocalizedMessage text={error} /></p> : null}
            {videoJobs.some(job => job.status === "pending" || job.status === "submitting") ? <p className="workspace-chat__notice" role="status"><Localized en="Video generation or usage confirmation is in progress. Jobs resume checking when you return to chat." zh="正在生成视频或确认用量。返回对话页面时将继续检查任务。" /></p> : null}
            {videoJobs.filter(job => job.output_file_id && !dismissedVideoJobs.has(job.id)).slice(0, 3).map(job => (
              <p className="workspace-chat__notice workspace-chat__video-notice" key={job.id}>
                <span>{tr("Video ready · ", "视频已就绪 · ")}<button type="button" className="text-link" onClick={() => showFileInPanel({ id: job.output_file_id!, name: "Generated video.mp4" })}><Localized en="Preview video" zh="预览视频" /></button>{tr(" · saved in My Files", " · 已保存到我的文件")}</span>
                <button type="button" className="workspace-chat__dismiss-notice" aria-label={tr("Dismiss video notification", "关闭视频通知")} title={tr("Dismiss", "关闭")} onClick={() => dismissVideoNotice(job.id)}><X size={16} aria-hidden="true" /></button>
              </p>
            ))}
            {videoJobs.some(job => job.status === "uncertain") ? <p className="workspace-chat__warning"><Localized en="A video request could not be confirmed. Check AI Credits Usage or contact support before retrying." zh="无法确认视频请求。请在重试前查看 AI 积分用量或联系支持人员。" /></p> : null}
            {videoJobs.some(job => job.status === "failed") ? <p className="workspace-chat__warning"><Localized en="A video job did not complete. Check AI Credits Usage for its recorded cost." zh="视频任务未完成。请查看 AI 积分用量中的费用记录。" /></p> : null}
          </div>
          <div className="workspace-chat__conversation">
            <div aria-label={tr("Conversation", "对话")} aria-live="polite" className="workspace-chat__thread" onScroll={handleThreadScroll} ref={threadRef} role="log">
              {!chat?.messages.length ? <div className="workspace-chat__empty"><span><Bot size={26} /></span><h2><Localized en="What would you like to work on?" zh="您想做什么？" /></h2><p><Localized en="Ask a question, explore an idea, or get help with a task." zh="提出问题、探索想法或寻求任务帮助。" /></p></div> : null}
              {chat?.messages.map((message, index) => <article className={`workspace-chat__message workspace-chat__message--${message.role}`} key={`${index}-${message.role}`}><p className="workspace-chat__sender">{message.role === "user" ? tr("You", "您") : CHAT_MODELS.find((item) => item.id === message.model)?.label ?? "AI"}</p><div className="workspace-chat__content"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ table: ({ children, ...props }) => <div className="workspace-chat__table-wrap"><table {...props}>{children}</table></div> }}>{message.content}</ReactMarkdown>{[...(message.fileRef ? [message.fileRef] : []), ...(message.fileRefs ?? [])].map(reference => <div key={reference.id}>{message.role === "assistant" && /^generated-image-[0-9a-f]+\.(png|jpg|webp)$/i.test(reference.name) ? <img className="workspace-chat__generated-image" src={`/api/chat/files/${encodeURIComponent(reference.id)}/preview?inline=1`} alt={language === "zh" ? "AI 生成的图片" : "AI-generated image"} /> : null}<div className="workspace-chat__file-card"><FileText size={17} aria-hidden="true" /><button type="button" className="workspace-chat__file-name" onClick={() => showFileInPanel(reference)}>{reference.name}</button><button type="button" className="chat-file-icon" aria-label={language === "zh" ? `预览 ${reference.name}` : `Preview ${reference.name}`} title={tr("Preview", "预览")} onClick={() => showFileInPanel(reference)}><Eye size={17} /></button><a className="chat-file-icon" aria-label={language === "zh" ? `下载 ${reference.name}` : `Download ${reference.name}`} title={tr("Download", "下载")} href={`/api/chat/files/${encodeURIComponent(reference.id)}`}><Download size={17} /></a>{/\.(pdf|docx|pptx|png|jpe?g|webp|xlsx|csv)$/i.test(reference.name) ? <button type="button" className="workspace-chat__ask-file" disabled={busy || uploading || selecting} onClick={() => askAboutFile(reference)} aria-label={language === "zh" ? `询问 ${reference.name}` : `Ask about ${reference.name}`}><Localized en="Ask about" zh="询问文件" /></button> : null}</div></div>)}{message.role === "assistant" && message.fileRefs && message.fileRefs.length > 1 ? <button type="button" className="btn-ghost btn-ghost--compact workspace-chat__download-all" disabled={downloading} onClick={() => void downloadBatch(message.fileRefs!.map(item => item.id))}>{downloading ? tr("Preparing ZIP…", "正在准备 ZIP…") : tr("Download all as ZIP", "全部下载为 ZIP")}</button> : null}</div>{message.role === "assistant" ? <ChatResponseTools content={message.content} metrics={message.metrics} /> : null}</article>)}
              {streamingResponse && streamingResponse.chatId === chat?.id && streamingResponse.text ? <article className="workspace-chat__message workspace-chat__message--assistant"><p className="workspace-chat__sender">{CHAT_MODELS.find(item => item.id === streamingResponse.model)?.label ?? "AI"}</p><div className="workspace-chat__content"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{ table: ({ children, ...props }) => <div className="workspace-chat__table-wrap"><table {...props}>{children}</table></div> }}>{streamingResponse.text}</ReactMarkdown></div></article> : null}
              {unsavedResponses.filter(item => item.chatId === chat?.id).map((item, index) => <article className="workspace-chat__message workspace-chat__message--assistant" key={`unsaved-${index}`}><p className="workspace-chat__sender">{CHAT_MODELS.find(model => model.id === item.model)?.label ?? "AI"} · {tr("Not saved", "未保存")}</p><div className="workspace-chat__content"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{item.text}</ReactMarkdown></div><ChatResponseTools content={item.text} /></article>)}
              {presentationRecoveries.filter(item => item.chatId === chat?.id).map(item => <article className="workspace-chat__message workspace-chat__message--assistant workspace-chat__recovery" key={item.id}><strong><Localized en="Presentation ready for recovery" zh="演示文稿可恢复" /></strong><p><Localized en="Download it now or retry saving to My files. This copy is available only until you leave or refresh the page." zh="立即下载或重试保存到“我的文件”。此副本仅在离开或刷新页面前可用。" /></p><div className="workspace-chat__recovery-actions"><button className="btn-ghost btn-ghost--compact" type="button" onClick={() => downloadPresentationRecovery(item)}><Download size={15} /> <Localized en="Download PowerPoint" zh="下载 PowerPoint" /></button><button className="btn-ghost btn-ghost--compact" type="button" disabled={busy || selecting || uploading} onClick={() => void savePresentationRecovery(item)}>{savingRecovery === item.id ? tr("Saving…", "正在保存…") : tr("Retry saving", "重试保存")}</button></div></article>)}
              {busy ? <p className="workspace-chat__thinking" role="status">{stopping ? tr("Stopping…", "正在停止…") : streamingResponse ? (streamingResponse.text ? tr("Generating response…", "正在生成回复…") : tr("Waiting for the AI response…", "正在等待 AI 回复…")) : tr("Working…", "正在处理…")}</p> : null}
            </div>
            {showJumpToLatest && chat?.messages.length ? <button aria-label={tr("Jump to latest message", "跳至最新消息")} className="workspace-chat__jump-latest" onClick={() => threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" })} title={tr("Jump to latest message", "跳至最新消息")} type="button"><ArrowDown size={18} /></button> : null}
          </div>
          <form className={`workspace-chat__form${dragActive ? " is-dragging" : ""}`} onSubmit={send} onDragOver={event => { if (Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); if (!busy && !uploading && !selecting && generationMode === "chat" && !followUpFile) setDragActive(true); } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }} onDrop={event => { event.preventDefault(); setDragActive(false); if (!busy && !uploading && !selecting && generationMode === "chat" && !followUpFile) void uploadFiles(Array.from(event.dataTransfer.files)); }}>
            <div className="workspace-chat__mode-bar" role="group" aria-label={tr("Choose chat mode", "选择对话模式")}>
              <span className="workspace-chat__mode-label"><Localized en="MODE" zh="模式" /></span>
              {([
                { id: "chat", label: tr("Chat", "对话"), icon: MessageSquare },
                { id: "image", label: tr("Image", "图片"), icon: ImageIcon },
                { id: "video", label: tr("Video · 15s", "视频 · 15秒"), icon: Video },
                { id: "pptx", label: "PowerPoint", icon: Presentation },
              ] as const).map(({ id, label, icon: Icon }) => <button key={id} type="button" className="workspace-chat__mode" aria-pressed={generationMode === id} disabled={busy || selecting || uploading || files.length > 0 || !!followUpFile} onClick={() => setGenerationMode(id)}><Icon size={15} aria-hidden="true" /><span>{label}</span></button>)}
            </div>
            {dragActive ? <p className="workspace-chat__drop-hint"><Localized en="Drop files to attach" zh="拖放文件以添加附件" /></p> : null}
            {files.map(item => <div className="workspace-chat__file" key={item.id}><span>{item.name}{tr(" · saved", " · 已保存")}{files.length === 2 ? "" : " · Gemini 2.5 Flash"}{files.length === 1 && item.name.toLowerCase().endsWith(".pdf") ? " · Mistral OCR" : files.length === 1 && /\.(png|jpe?g|webp)$/i.test(item.name) ? tr(" · image OCR", " · 图片 OCR") : ""}</span><button type="button" aria-label={language === "zh" ? `移除 ${item.name}` : `Remove ${item.name}`} disabled={busy} onClick={() => removeAttachment(item.id)}><X size={16} /></button></div>)}
            {followUpFile ? <div className="workspace-chat__file"><span>{language === "zh" ? `后续提问：${followUpFile.name} · 使用 Gemini 再次处理（需支付 AI 费用）${/\.pptx$/i.test(followUpFile.name) ? " · 仅幻灯片文本" : ""}` : `Follow-up: ${followUpFile.name} · processed again with Gemini (AI charges apply)${/\.pptx$/i.test(followUpFile.name) ? " · slide text only" : ""}`}</span><button type="button" aria-label={language === "zh" ? `移除后续提问文件 ${followUpFile.name}` : `Remove follow-up ${followUpFile.name}`} disabled={busy} onClick={() => setFollowUpFile(null)}><X size={16} /></button></div> : null}
            {visibleReview && isBatchFiles ? <ChatBatchMapping review={visibleReview} disabled={busy} onChange={mappings => setBatchReview(current => current ? { ...current, data: { ...current.data, mappings } } : null)} onCancel={() => setBatchReview(null)} /> : null}
            {batchProgress ? <div className="chat-batch-progress" role="status"><strong>{language === "zh" ? `批次：已处理 ${batchProgress.processed} / ${batchProgress.total}` : `Batch: ${batchProgress.processed} of ${batchProgress.total} processed`}</strong><progress value={batchProgress.processed} max={batchProgress.total || 1} /><span>{language === "zh" ? `成功 ${batchProgress.succeeded} 项 · ${batchProgress.failed.length} 项需要处理` : `${batchProgress.succeeded} succeeded · ${batchProgress.failed.length} need attention`}</span></div> : null}
            {isPowerPointTransfer ? <div className="workspace-chat__transfer"><strong><Localized en="Choose what each PowerPoint does" zh="选择每个 PowerPoint 的用途" /></strong><div className="workspace-chat__transfer-roles"><p><span><Localized en="CONTENT TO COPY" zh="要复制的内容" /></span>{files[0].name}</p><p><span><Localized en="NEW DESIGN TEMPLATE" zh="新设计模板" /></span>{files[1].name}</p></div><button type="button" className="btn-ghost btn-ghost--compact" disabled={busy} onClick={() => { setFiles(current => [...current].reverse()); setConfirmedPowerPointRoles(""); }}><Localized en="Swap content and template" zh="交换内容和模板" /></button>{/template/i.test(files[0].name) && /content/i.test(files[1].name) ? <p className="workspace-chat__transfer-warning"><Localized en="The filenames suggest the content and template may be reversed. Check the roles above." zh="文件名表明内容和模板可能颠倒了。请检查上面的用途。" /></p> : null}<label className="workspace-chat__transfer-confirm"><input type="checkbox" disabled={busy} checked={confirmedPowerPointRoles === powerPointFileKey} onChange={event => setConfirmedPowerPointRoles(event.target.checked ? powerPointFileKey : "")} /> <Localized en="I confirmed the content and template roles." zh="我已确认内容和模板的用途。" /></label><p><Localized en="The transfer checks object positions and uses no AI credits. Complex or already-overlapping slides may require editing first." zh="转移会检查对象位置，不消耗 AI 积分。复杂或已有重叠的幻灯片可能需要先进行编辑。" /></p></div> : files.length === 2 ? <p className="workspace-chat__notice">{language === "zh" ? "批量文档模式：每个电子表格行将创建一个文件。" : <>Batch document mode: one {files.some(item => /\.pptx$/i.test(item.name)) ? "PPTX" : files.some(item => /\.docx$/i.test(item.name)) ? "DOCX" : "PDF"} will be created per spreadsheet row. </>}{files.some(item => /\.(docx|pptx)$/i.test(item.name)) ? tr("Use placeholders such as {{Name}} in the template. ", "请在模板中使用 {{Name}} 等占位符。") : ""}{tr("Review the field mapping and generated files.", "请检查字段映射和生成的文件。") }</p> : null}
            {generationMode === "image" ? <p className="workspace-chat__notice">{tr("Generate one image with Seedream 4.5. ", "使用 Seedream 4.5 生成一张图片。")}{imageEstimate ? (language === "zh" ? `当前预留：${imageEstimate.credits.toLocaleString()} 积分（预计服务商费用 $${imageEstimate.estimatedUsd.toFixed(4)}）。` : `Current reservation: ${imageEstimate.credits.toLocaleString()} credits (estimated provider cost $${imageEstimate.estimatedUsd.toFixed(4)}). `) : imageEstimateError ? tr("Pricing is temporarily unavailable. ", "暂时无法获取价格。") : tr("Checking current pricing… ", "正在查询当前价格…")}{tr("The final provider cost is recorded in AI Credits Usage.", "最终服务商费用记录在 AI 积分用量中。")}</p> : null}
            {generationMode === "video" ? <p className="workspace-chat__notice">{tr("Generate a 15-second, 480p video with Grok Imagine Video 1.5 Lite. ", "使用 Grok Imagine Video 1.5 Lite 生成 15 秒、480p 视频。")}{videoEstimate ? (language === "zh" ? `当前预留：${videoEstimate.credits.toLocaleString()} 积分（预计服务商费用 $${videoEstimate.estimatedUsd.toFixed(4)}）。` : `Current reservation: ${videoEstimate.credits.toLocaleString()} credits (estimated provider cost $${videoEstimate.estimatedUsd.toFixed(4)}). `) : tr("Pricing is unavailable or still loading. ", "价格不可用或仍在加载。")}{tr("Final usage is recorded in AI Credits Usage.", "最终用量记录在 AI 积分用量中。") }</p> : null}
            {generationMode === "pptx" ? <p className="workspace-chat__notice"><Localized en="Create an editable PowerPoint from your prompt with Gemini 2.5 Flash. AI usage is recorded in AI Credits Usage; review the slides and their facts before sharing." zh="使用 Gemini 2.5 Flash 根据您的提示创建可编辑的 PowerPoint。AI 用量记录在 AI 积分用量中；分享前请检查幻灯片及其事实。" /></p> : null}
            <textarea aria-label={tr("Your message", "您的消息")} disabled={!configured || busy || selecting || uploading || cacheState === "loading" || files.length === 2} maxLength={CHAT_MAX_MESSAGE_CHARS} value={files.length === 2 ? "" : prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handleKeyDown} placeholder={generationMode === "image" ? tr("Describe the image you want to create…", "描述您想创建的图片…") : generationMode === "video" ? tr("Describe the video you want to create…", "描述您想创建的视频…") : generationMode === "pptx" ? tr("Describe the PowerPoint you want to create…", "描述您想创建的 PowerPoint…") : files.length === 2 && files.every(item => /\.pptx$/i.test(item.name)) ? tr("Use the controls above to confirm the file order.", "使用上方控件确认文件顺序。") : files.length === 2 ? tr("Review and select the spreadsheet columns for each template field.", "查看并为每个模板字段选择电子表格列。") : tr("Ask anything…", "有什么问题？")} rows={3} />
            <div className="workspace-chat__form-footer">
              <input ref={fileInputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.csv,.docx,.pptx" hidden onChange={(event) => { const selected = Array.from(event.target.files ?? []); if (selected.length) void uploadFiles(selected); }} />
              <div className="workspace-chat__attachment-actions">
                <button type="button" className="btn-ghost" disabled={generationMode !== "chat" || busy || selecting || uploading || files.length >= 2 || !!followUpFile} onClick={() => fileInputRef.current?.click()}><Paperclip size={16} /> {uploading ? tr("Saving…", "正在保存…") : tr("Attach file", "添加文件")}</button>
                <ChatSavedFiles disabled={generationMode !== "chat" || busy || selecting || uploading || files.length >= 2 || !!followUpFile} onSelect={addSavedFile} />
              </div>
              <div className="workspace-chat__submit-actions">
                {generationMode === "chat" && files.length !== 2 ? <label className="workspace-chat__model-control"><span><Localized en="Model" zh="模型" /></span><select aria-label={tr("AI model", "AI 模型")} className="workspace-chat__model-select" disabled={busy || selecting || uploading || files.length > 0 || !!followUpFile || !chat} id="workspace-chat-model" onChange={(event) => { if (chat && isChatModel(event.target.value)) setChat({ ...chat, model: event.target.value }); }} value={files.length || followUpFile || uploading ? FILE_CHAT_MODEL : chat?.model ?? CHAT_MODELS[0].id}>{CHAT_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label> : null}
                {canStop ? <button aria-label={tr("Stop response", "停止回复")} className="workspace-chat__send workspace-chat__send--action workspace-chat__stop" disabled={stopping} type="button" onClick={() => { setStopping(true); streamAbortRef.current?.abort(); }}>{stopping ? tr("Stopping…", "正在停止…") : <>{tr("Stop", "停止")} <Square size={12} fill="currentColor" aria-hidden="true" /></>}</button> : <button aria-label={isPowerPointTransfer ? tr("Apply PowerPoint template", "应用 PowerPoint 模板") : isBatchFiles ? (visibleReview ? tr("Generate documents", "生成文档") : tr("Review fields", "查看字段")) : tr("Send message", "发送消息")} className="workspace-chat__send workspace-chat__send--action" disabled={!configured || busy || selecting || uploading || cacheState === "loading" || (!prompt.trim() && !files.length && !followUpFile) || (isPowerPointTransfer && confirmedPowerPointRoles !== powerPointFileKey) || (!!visibleReview && visibleReview.mappings.some(item => !item.column))} type="submit">{isPowerPointTransfer ? tr("Apply template", "应用模板") : isBatchFiles ? (visibleReview ? tr("Generate documents", "生成文档") : tr("Review fields", "查看字段")) : generationMode === "image" ? tr("Create image", "创建图片") : generationMode === "video" ? tr("Create video", "创建视频") : generationMode === "pptx" ? tr("Create slides", "创建幻灯片") : <>{tr("Send", "发送")} <ArrowRight size={15} strokeWidth={2.4} aria-hidden="true" /></>}</button>}
              </div>
            </div>
          </form>
          <p className="workspace-chat__privacy"><Localized en="Uploaded files are saved privately to your account. Chat history and extracted data remain on this device. Files are sent for processing; follow-ups include the first 6,000 characters of extracted data." zh="上传的文件会私密保存到您的账户。对话记录和提取的数据保留在此设备上。文件会被发送处理；后续问题包含提取数据的前 6,000 个字符。" /></p>
        </div>
        {hasPanelContent && !panelOpen ? <button className="btn-ghost workspace-chat__show-artifact" type="button" onClick={() => setPanelOpen(true)}><Localized en="Show file panel" zh="显示文件面板" /></button> : null}
        {historyTarget ? createPortal(<aside aria-label={language === "zh" ? "对话记录" : "Chat history"} className="workspace-chat-history">
          <div className="workspace-chat-history__header"><h2><Localized en="Chat history" zh="对话记录" /></h2><a className="workspace-chat-history__view-all" href="/dashboard/chat/history"><Localized en="View all" zh="查看全部" /></a></div>
          {cacheState === "loading" ? <p className="workspace-chat-history__empty"><Localized en="Loading your chats…" zh="正在加载对话…" /></p> : chats.length === 0 ? <p className="workspace-chat-history__empty"><Localized en="Your conversations will appear here." zh="您的对话将显示在这里。" /></p> : null}
          <div className="workspace-chat-history__list">{chats.map((item) => <button aria-current={chat?.id === item.id ? "true" : undefined} className={`workspace-chat-history__item${chat?.id === item.id ? " is-active" : ""}`} disabled={busy || selecting} key={item.id} onClick={() => void selectChat(item.id)} type="button"><strong>{item.title}</strong><span>{CHAT_MODELS.find((model) => model.id === item.model)?.label ?? "AI"}</span></button>)}</div>
        </aside>, historyTarget) : null}
      </div>
      {hasPanelContent && panelOpen ? <aside className="workspace-chat__artifact" aria-label={tr("File panel", "文件面板")}>
        <div className="workspace-chat__artifact-header"><div><strong>{showArtifact && activeArtifact ? (activeArtifact.kind === "ocr" ? tr("Extracted text", "提取的文本") : tr("Spreadsheet data", "电子表格数据")) : tr("File preview", "文件预览")}</strong><p>{showArtifact ? activeArtifact?.name : selectedPanelFile?.name}</p></div><div className="workspace-chat__artifact-header-actions">{!showArtifact && selectedPanelFile ? <a className="chat-file-icon" href={`/api/chat/files/${encodeURIComponent(selectedPanelFile.id)}`} aria-label={language === "zh" ? `下载 ${selectedPanelFile.name}` : `Download ${selectedPanelFile.name}`} title={tr("Download", "下载")}><Download size={18} /></a> : null}<button type="button" className="btn-icon" aria-label={tr("Close file panel", "关闭文件面板")} onClick={() => setPanelOpen(false)}><X size={18} /></button></div></div>
        {panelFiles.length + (activeArtifact ? 1 : 0) > 1 ? <div className="workspace-chat__panel-tabs" aria-label={tr("Choose file preview", "选择文件预览")}>{panelFiles.map(item => <button type="button" key={item.id} title={item.name} aria-pressed={!showArtifact && selectedPanelFile?.id === item.id} onClick={() => setPanelSelection(item.id)}>{item.name}</button>)}{activeArtifact ? <button type="button" aria-pressed={showArtifact} onClick={() => setPanelSelection("artifact")}>{activeArtifact.kind === "ocr" ? tr("Extracted text", "提取的文本") : tr("Spreadsheet data", "电子表格数据")}</button> : null}</div> : null}
        {showArtifact && activeArtifact ? <>{activeArtifact.truncated ? <p className="workspace-chat__warning"><Localized en="The extraction was truncated. Try a shorter document or image." zh="提取结果已截断。请尝试较短的文档或图片。" /></p> : null}{activeArtifact.content.length > 6000 ? <p><Localized en="Follow-up questions include only the first 6,000 characters of this data." zh="后续问题仅包含此数据的前 6,000 个字符。" /></p> : null}<div className="workspace-chat__artifact-actions"><button type="button" className="btn-ghost" onClick={() => void navigator.clipboard.writeText(activeArtifact.content).catch(() => setError("Could not copy text."))}><Localized en="Copy" zh="复制" /></button><button type="button" className="btn-ghost" onClick={() => downloadArtifact(activeArtifact)}><Localized en="Download" zh="下载" /></button></div><div className="workspace-chat__artifact-content">{activeArtifact.kind === "ocr" ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null }}>{activeArtifact.content}</ReactMarkdown> : <><p><Localized en="Spreadsheet rows and calculated numeric column statistics. For exact grouped calculations, verify results in a spreadsheet." zh="电子表格行和数值列的统计结果。如需精确的分组计算，请在电子表格中验证结果。" /></p><pre>{activeArtifact.content}</pre></>}</div></> : selectedPanelFile ? <ChatFilePreviewContent key={selectedPanelFile.id} file={selectedPanelFile} /> : null}
      </aside> : null}
    </section>
  );
}
