"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, MessageSquare, Search } from "lucide-react";
import { CHAT_MODELS } from "@/lib/chat-models";
import type { ChatSearchPage } from "@/lib/chat-history";

type HistoryApi = typeof import("@/lib/chat-history");
type LoadState = "loading" | "ready" | "unavailable";

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 250;

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

function formatUpdated(value: number) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function highlight(text: string, needle: string): ReactNode {
  if (!needle) return text;
  const parts = text.split(new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part));
}

type PagerProps = {
  onPage: (page: number) => void;
  page: number;
  pageCount: number;
};

function Pager({ onPage, page, pageCount }: PagerProps) {
  return (
    <div className="admin-users-pagination">
      <button aria-label="Previous page" className="btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} type="button">
        <ChevronLeft size={16} strokeWidth={1.8} />
      </button>
      <span>
        Page {formatNumber(page)} of {formatNumber(pageCount)}
      </span>
      <button aria-label="Next page" className="btn-ghost" disabled={page >= pageCount} onClick={() => onPage(page + 1)} type="button">
        <ChevronRight size={16} strokeWidth={1.8} />
      </button>
    </div>
  );
}

type ChatHistoryBrowserProps = {
  initialPage: number;
  initialQuery: string;
  userId: string;
};

/**
 * Lists every chat saved in this browser's DuckDB store, 50 per page, with a
 * search over titles and message text. Chats live only on this device, so
 * the search runs client-side against the same store the chat page writes.
 */
export function ChatHistoryBrowser({ initialPage, initialQuery, userId }: ChatHistoryBrowserProps) {
  const [query, setQuery] = useState(initialQuery);
  const [search, setSearch] = useState(initialQuery.trim());
  const [page, setPage] = useState(initialPage);
  const [result, setResult] = useState<ChatSearchPage | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [revision, setRevision] = useState(0);
  const apiRef = useRef<HistoryApi | null>(null);

  useEffect(() => {
    const next = query.trim();
    if (next === search) return;
    const timer = window.setTimeout(() => {
      setSearch(next);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [query, search]);

  useEffect(() => {
    let cancelled = false;
    setLoadState((current) => (current === "unavailable" ? current : "loading"));
    (async () => {
      try {
        const api = apiRef.current ?? (await import("@/lib/chat-history"));
        apiRef.current = api;
        const next = await api.searchChats(userId, search, page, PAGE_SIZE);
        if (cancelled) return;
        setResult(next);
        setLoadState("ready");
        if (next.page !== page) setPage(next.page);
        const params = new URLSearchParams();
        if (search) params.set("q", search);
        if (next.page > 1) params.set("page", String(next.page));
        const queryString = params.toString();
        window.history.replaceState(null, "", queryString ? `?${queryString}` : window.location.pathname);
      } catch {
        if (!cancelled) setLoadState("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, revision, search, userId]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    // The chat page announces saves on this channel; reload so new chats appear.
    const channel = new BroadcastChannel("ai-cuber-chat-history-v1");
    channel.onmessage = (event) => {
      if (event.data?.userId === userId) setRevision((current) => current + 1);
    };
    return () => channel.close();
  }, [userId]);

  const total = result?.total ?? 0;
  const currentPage = result?.page ?? page;
  const pageCount = result?.pageCount ?? 1;
  const first = total ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(total, currentPage * PAGE_SIZE);
  const needle = search.toLowerCase();

  return (
    <section aria-labelledby="chat-history-title" className="dashboard-workbench chat-history-page">
      <div className="settings-workbench__header">
        <p className="workspace-status-card__eyebrow">AI Chat</p>
        <h1 id="chat-history-title">Chat history</h1>
        <p>Every conversation saved in this browser, newest first. Search titles and messages, then open a chat to continue it.</p>
      </div>

      <div className="admin-users-toolbar">
        <label className="admin-users-toolbar__search">
          <Search aria-hidden="true" size={16} strokeWidth={1.8} />
          <input
            aria-label="Search chats by title or message"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles and messages..."
            type="search"
            value={query}
          />
        </label>
        <span aria-live="polite" className="admin-users-toolbar__count">
          {loadState === "loading" && !result
            ? "Loading…"
            : total
              ? `${formatNumber(first)}–${formatNumber(last)} of ${formatNumber(total)} chats`
              : "No chats"}
        </span>
        <Pager onPage={setPage} page={currentPage} pageCount={pageCount} />
      </div>

      {loadState === "unavailable" ? (
        <p className="workspace-chat__warning" role="status">
          Chat history could not be read in this browser. It needs a secure connection and browser storage access.
        </p>
      ) : null}

      {result && result.chats.length === 0 ? (
        <div className="chat-history-page__empty">
          {search ? (
            <p>No chats match “{search}”.</p>
          ) : (
            <p>
              No chats saved in this browser yet. <a href="/dashboard/chat">Start a chat</a>
            </p>
          )}
        </div>
      ) : null}

      {result && result.chats.length > 0 ? (
        <ol className="chat-history-page__list">
          {result.chats.map((item) => (
            <li key={item.id}>
              <a className="chat-history-page__item" href={`/dashboard/chat?chat=${encodeURIComponent(item.id)}`}>
                <span aria-hidden="true" className="chat-history-page__icon">
                  <MessageSquare size={16} strokeWidth={1.8} />
                </span>
                <span className="chat-history-page__body">
                  <strong>{highlight(item.title, needle)}</strong>
                  {item.snippet ? <span className="chat-history-page__snippet">{highlight(item.snippet, needle)}</span> : null}
                  <span className="chat-history-page__meta">
                    {CHAT_MODELS.find((model) => model.id === item.model)?.label ?? "AI"} · {formatNumber(item.messageCount)}{" "}
                    {item.messageCount === 1 ? "message" : "messages"} · {formatUpdated(item.updatedAt)}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      ) : null}

      {pageCount > 1 ? (
        <div className="chat-history-page__footer">
          <Pager
            onPage={(next) => {
              setPage(next);
              document.getElementById("chat-history-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            page={currentPage}
            pageCount={pageCount}
          />
        </div>
      ) : null}
    </section>
  );
}
