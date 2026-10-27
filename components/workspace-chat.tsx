"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Bot, MessageSquarePlus } from "lucide-react";
import { CHAT_MAX_MESSAGE_CHARS, CHAT_MAX_MESSAGES, CHAT_MAX_TOTAL_BYTES, CHAT_MODELS, isChatModel, type ChatMessage, type ChatModelId } from "@/lib/chat-models";
import type { ChatConversation, ChatSummary, HistoryMessage } from "@/lib/chat-history";

type HistoryApi = typeof import("@/lib/chat-history");
type CacheState = "loading" | "ready" | "unavailable";
const HISTORY_PAGE_SIZE = 10;

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

export function WorkspaceChat({ userId, configured }: { userId: string; configured: boolean }) {
  const [chat, setChat] = useState<ChatConversation | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [cacheState, setCacheState] = useState<CacheState>("loading");
  const [hasMore, setHasMore] = useState(false);
  const [limit, setLimit] = useState(HISTORY_PAGE_SIZE);
  const [selecting, setSelecting] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const apiRef = useRef<HistoryApi | null>(null);
  const memoryRef = useRef(new Map<string, ChatConversation>());
  const busyRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const refreshHistory = useCallback(async (count: number) => {
    if (!apiRef.current) return;
    const page = await apiRef.current.listChats(userId, count);
    setChats(page.chats);
    setHasMore(page.hasMore);
  }, [userId]);

  useEffect(() => {
    let disposed = false;
    memoryRef.current.clear();
    setChat(null);
    setChats([]);
    setHasMore(false);
    setLimit(HISTORY_PAGE_SIZE);
    setPrompt("");
    setCacheState("loading");
    (async () => {
      try {
        const api = await import("@/lib/chat-history");
        await api.migrateLegacyChat(userId);
        const page = await api.listChats(userId, HISTORY_PAGE_SIZE);
        const latest = page.chats[0] ? await api.getChat(userId, page.chats[0].id) : null;
        if (disposed) return;
        apiRef.current = api;
        setChats(page.chats);
        setHasMore(page.hasMore);
        const initial = latest ?? newDraft();
        if (latest) memoryRef.current.set(latest.id, latest);
        setChat(initial);
        setCacheState("ready");
      } catch {
        if (disposed) return;
        apiRef.current = null;
        setChat(newDraft());
        setCacheState("unavailable");
      }
    })();
    return () => { disposed = true; apiRef.current = null; };
  }, [userId]);

  useEffect(() => {
    if (cacheState !== "ready" || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("ai-cuber-chat-history-v1");
    channelRef.current = channel;
    channel.onmessage = (event) => {
      if (event.data?.userId === userId) void refreshHistory(limit).catch(() => undefined);
    };
    return () => { channelRef.current = null; channel.close(); };
  }, [cacheState, limit, refreshHistory, userId]);

  useEffect(() => { scrollRef.current?.scrollIntoView({ block: "nearest" }); }, [chat?.messages, busy]);

  function rememberInMemory(next: ChatConversation) {
    memoryRef.current.set(next.id, next);
    setChats((current) => [{ id: next.id, title: next.title, model: next.model, updatedAt: next.updatedAt }, ...current.filter((item) => item.id !== next.id)]);
    setChat(next);
  }

  async function persist(next: ChatConversation): Promise<ChatConversation> {
    const api = apiRef.current;
    if (api) {
      try {
        const saved = await api.saveChat(userId, next);
        memoryRef.current.set(saved.id, saved);
        setChat(saved);
        await refreshHistory(limit).catch(() => undefined);
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
    if (busyRef.current || selecting) return;
    setSelecting(true);
    setError("");
    setNotice("");
    try {
      const selected = apiRef.current ? await apiRef.current.getChat(userId, id) : memoryRef.current.get(id);
      if (!selected) throw new Error("This chat is unavailable in this browser.");
      memoryRef.current.set(id, selected);
      setChat(selected);
      setPrompt("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to open this chat.");
    } finally { setSelecting(false); }
  }

  async function loadMore() {
    const nextLimit = limit + HISTORY_PAGE_SIZE;
    try { await refreshHistory(nextLimit); setLimit(nextLimit); }
    catch { setError("Unable to load more chats. Please try again."); }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = prompt.trim();
    if (!chat || !configured || busyRef.current || selecting || cacheState === "loading" || !value) return;
    if (value.length > CHAT_MAX_MESSAGE_CHARS) { setError(`Messages can contain up to ${CHAT_MAX_MESSAGE_CHARS.toLocaleString()} characters.`); return; }
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const model = chat.model;
    const work = async () => {
      let pending = await persist({ ...chat, messages: [...chat.messages, { role: "user", content: value }] });
      setPrompt("");
      try {
        const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, messages: historyForRequest(pending.messages) }) });
        const payload = await response.json().catch(() => null) as { message?: unknown; error?: unknown; chargedCredits?: unknown; availableCredits?: unknown; quotaExempt?: unknown } | null;
        if (!response.ok || typeof payload?.message !== "string") throw new Error(typeof payload?.error === "string" ? payload.error : "Unable to get a response. Please try again.");
        pending = await persist({ ...pending, messages: [...pending.messages, { role: "assistant", content: payload.message, model }] });
        if (payload.quotaExempt === true) setNotice("This account is exempt from AI credit charges.");
        else if (typeof payload.chargedCredits === "number" && typeof payload.availableCredits === "number") setNotice(`${payload.chargedCredits.toLocaleString()} credits used · ${payload.availableCredits.toLocaleString()} available`);
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

  function newChat() {
    if (busyRef.current || selecting) return;
    setChat(newDraft(chat?.model));
    setPrompt("");
    setError("");
    setNotice("");
  }

  return (
    <section aria-labelledby="workspace-chat-title" className="dashboard-workbench workspace-chat">
      <div className="workspace-chat__header">
        <div><p className="workspace-status-card__eyebrow">YOUR AI WORKSPACE</p><h1 id="workspace-chat-title">Chat with AI</h1><p>Choose a model and ask a question. An estimated amount of AI credits is reserved first; actual usage determines the final charge.</p></div>
        <button className="btn-ghost workspace-chat__new" disabled={busy || selecting || cacheState === "loading"} onClick={newChat} type="button"><MessageSquarePlus size={17} /> New chat</button>
      </div>
      <div className="workspace-chat__layout">
        <aside aria-label="Chat history" className="workspace-chat-history">
          <div className="workspace-chat-history__header"><h2>Chat history</h2><span>Recent</span></div>
          {cacheState === "loading" ? <p className="workspace-chat-history__empty">Loading your chats…</p> : chats.length === 0 ? <p className="workspace-chat-history__empty">Your conversations will appear here.</p> : null}
          <div className="workspace-chat-history__list">{chats.map((item) => <button aria-current={chat?.id === item.id ? "true" : undefined} className={`workspace-chat-history__item${chat?.id === item.id ? " is-active" : ""}`} disabled={busy || selecting} key={item.id} onClick={() => void selectChat(item.id)} type="button"><strong>{item.title}</strong><span>{CHAT_MODELS.find((model) => model.id === item.model)?.label ?? "AI"}</span></button>)}</div>
          {hasMore ? <button className="workspace-chat-history__more" disabled={busy || selecting} onClick={() => void loadMore()} type="button">Show more</button> : null}
        </aside>
        <div className="workspace-chat__main">
          <div className="workspace-chat__options"><label htmlFor="workspace-chat-model">AI model</label><select disabled={busy || selecting || !chat} id="workspace-chat-model" onChange={(event) => { if (chat && isChatModel(event.target.value)) setChat({ ...chat, model: event.target.value }); }} value={chat?.model ?? CHAT_MODELS[0].id}>{CHAT_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><span>Recent messages are included for context.</span></div>
          {!configured ? <p className="workspace-chat__warning" role="status">Chat is not configured yet. Contact the administrator to enable it.</p> : null}
          {cacheState === "unavailable" ? <p className="workspace-chat__warning" role="status">Chat history could not be saved in this browser. New conversations are available only until you leave this page; your existing saved data has not been removed.</p> : null}
          <div aria-label="Conversation" aria-live="polite" className="workspace-chat__thread" role="log">
            {!chat?.messages.length ? <div className="workspace-chat__empty"><span><Bot size={26} /></span><h2>What would you like to work on?</h2><p>Ask a question, explore an idea, or get help with a task.</p></div> : null}
            {chat?.messages.map((message, index) => <article className={`workspace-chat__message workspace-chat__message--${message.role}`} key={`${index}-${message.role}`}><p className="workspace-chat__sender">{message.role === "user" ? "You" : CHAT_MODELS.find((item) => item.id === message.model)?.label ?? "AI"}</p><div className="workspace-chat__content">{message.content}</div></article>)}
            {busy ? <p className="workspace-chat__thinking" role="status">Thinking…</p> : null}<div ref={scrollRef} />
          </div>
          {notice ? <p className="workspace-chat__notice" role="status">{notice}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}
          <form className="workspace-chat__form" onSubmit={send}><textarea aria-label="Your message" disabled={!configured || busy || selecting || cacheState === "loading"} maxLength={CHAT_MAX_MESSAGE_CHARS} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handleKeyDown} placeholder="Ask anything…" rows={3} value={prompt} /><div className="workspace-chat__form-footer"><span>Enter to send · Shift+Enter for a new line</span><button aria-label="Send message" className="chat-input__send" disabled={!configured || busy || selecting || cacheState === "loading" || !prompt.trim()} type="submit"><ArrowUp size={18} /></button></div></form>
          <p className="workspace-chat__privacy">Chat history is stored in this browser on this device. Clearing browser data removes it.</p>
        </div>
      </div>
    </section>
  );
}
