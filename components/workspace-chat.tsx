"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Bot, MessageSquarePlus } from "lucide-react";
import { CHAT_MAX_MESSAGE_CHARS, CHAT_MAX_MESSAGES, CHAT_MAX_TOTAL_BYTES, CHAT_MODELS, isChatModel, type ChatMessage, type ChatModelId } from "@/lib/chat-models";

type DisplayMessage = ChatMessage & { model?: ChatModelId };

function historyForRequest(history: DisplayMessage[]): ChatMessage[] {
  const selected: ChatMessage[] = [];
  let bytes = 0;
  for (const item of history.slice(-CHAT_MAX_MESSAGES).reverse()) {
    const length = new TextEncoder().encode(item.content).length;
    if (bytes + length > CHAT_MAX_TOTAL_BYTES) break;
    selected.unshift({ role: item.role, content: item.content });
    bytes += length;
  }
  return selected;
}

export function WorkspaceChat({ userId, configured }: { userId: string; configured: boolean }) {
  const [model, setModel] = useState<ChatModelId>(CHAT_MODELS[0].id);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const busyRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const storageKey = `aicuber.chat.v1.${userId}`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as { model?: unknown; messages?: unknown };
        if (isChatModel(saved.model)) setModel(saved.model);
        if (Array.isArray(saved.messages)) {
          setMessages(saved.messages.filter((item): item is DisplayMessage =>
            item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string" && item.content.length <= 32_000 && (!item.model || isChatModel(item.model))
          ).slice(-200));
        }
      }
    } catch { setStorageAvailable(false); }
    setLoaded(true);
  }, [storageKey]);

  useEffect(() => {
    if (!loaded) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify({ model, messages: messages.slice(-200) })); setStorageAvailable(true); } catch { setStorageAvailable(false); }
  }, [loaded, messages, model, storageKey]);

  useEffect(() => { scrollRef.current?.scrollIntoView({ block: "nearest" }); }, [messages, busy]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = prompt.trim();
    if (!configured || busyRef.current || !value) return;
    if (value.length > CHAT_MAX_MESSAGE_CHARS) { setError(`Messages can contain up to ${CHAT_MAX_MESSAGE_CHARS.toLocaleString()} characters.`); return; }
    const updated: DisplayMessage[] = [...messages, { role: "user", content: value }];
    setMessages(updated);
    setPrompt("");
    setError("");
    setNotice("");
    busyRef.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, messages: historyForRequest(updated) }) });
      const payload = await response.json().catch(() => null) as { message?: unknown; error?: unknown; chargedCredits?: unknown; availableCredits?: unknown; quotaExempt?: unknown } | null;
      if (!response.ok || typeof payload?.message !== "string") throw new Error(typeof payload?.error === "string" ? payload.error : "Unable to get a response. Please try again.");
      setMessages((current) => [...current, { role: "assistant", content: payload.message as string, model }]);
      if (payload.quotaExempt === true) setNotice("This account is exempt from AI credit charges.");
      else if (typeof payload.chargedCredits === "number" && typeof payload.availableCredits === "number") setNotice(`${payload.chargedCredits.toLocaleString()} credits used · ${payload.availableCredits.toLocaleString()} available`);
    } catch (reason) {
      setMessages((current) => current.slice(0, -1));
      setPrompt(value);
      setError(reason instanceof Error ? reason.message : "Unable to get a response. Please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function newChat() {
    if (busyRef.current) return;
    setMessages([]);
    setPrompt("");
    setError("");
    setNotice("");
  }

  return (
    <section aria-labelledby="workspace-chat-title" className="dashboard-workbench workspace-chat">
      <div className="workspace-chat__header">
        <div><p className="workspace-status-card__eyebrow">YOUR AI WORKSPACE</p><h1 id="workspace-chat-title">Chat with AI</h1><p>Choose a model and ask a question. An estimated amount of AI credits is reserved first; actual usage determines the final charge.</p></div>
        <button className="btn-ghost workspace-chat__new" disabled={busy} onClick={newChat} type="button"><MessageSquarePlus size={17} /> New chat</button>
      </div>
      <div className="workspace-chat__options">
        <label htmlFor="workspace-chat-model">AI model</label>
        <select disabled={busy} id="workspace-chat-model" onChange={(event) => { if (isChatModel(event.target.value)) setModel(event.target.value); }} value={model}>
          {CHAT_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <span>Recent messages are included for context.</span>
      </div>
      {!configured ? <p className="workspace-chat__warning" role="status">Chat is not configured yet. Contact the administrator to enable it.</p> : null}
      <div aria-label="Conversation" aria-live="polite" className="workspace-chat__thread" role="log">
        {messages.length === 0 ? <div className="workspace-chat__empty"><span><Bot size={26} /></span><h2>What would you like to work on?</h2><p>Ask a question, explore an idea, or get help with a task.</p></div> : null}
        {messages.map((message, index) => <article className={`workspace-chat__message workspace-chat__message--${message.role}`} key={`${index}-${message.role}`}><p className="workspace-chat__sender">{message.role === "user" ? "You" : CHAT_MODELS.find((item) => item.id === message.model)?.label ?? "AI"}</p><div className="workspace-chat__content">{message.content}</div></article>)}
        {busy ? <p className="workspace-chat__thinking" role="status">Thinking…</p> : null}
        <div ref={scrollRef} />
      </div>
      {notice ? <p className="workspace-chat__notice" role="status">{notice}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <form className="workspace-chat__form" onSubmit={send}>
        <textarea aria-label="Your message" disabled={!configured || busy} maxLength={CHAT_MAX_MESSAGE_CHARS} onChange={(event) => setPrompt(event.target.value)} onKeyDown={handleKeyDown} placeholder="Ask anything…" rows={3} value={prompt} />
        <div className="workspace-chat__form-footer"><span>Enter to send · Shift+Enter for a new line</span><button aria-label="Send message" className="chat-input__send" disabled={!configured || busy || !prompt.trim()} type="submit"><ArrowUp size={18} /></button></div>
      </form>
      <p className="workspace-chat__privacy">{storageAvailable ? "This conversation is saved in this browser on this device. Starting a new chat clears it here." : "Browser storage is unavailable. This conversation will be lost when you leave or refresh."}</p>
    </section>
  );
}
