"use client";

import {Localized, useLanguage } from "@/components/language-provider";


import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, GripVertical, LoaderCircle, MessageSquare, Search, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CHAT_MODELS } from "@/lib/chat-models";
import type { ChatSearchPage, ChatSearchResult } from "@/lib/chat-history";

type HistoryApi = typeof import("@/lib/chat-history");
type LoadState = "loading" | "ready" | "unavailable";
type DeleteTarget = { kind: "all" } | { kind: "chat"; id: string; title: string };
type DropTarget = { id: string; placement: "before" | "after" };

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 250;

function formatNumber(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

function formatUpdated(value: number, zh = false) {
  return new Intl.DateTimeFormat(zh ? "zh-CN" : "en", {
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
  disabled?: boolean;
  onPage: (page: number) => void;
  page: number;
  pageCount: number;
};

function Pager({ disabled = false, onPage, page, pageCount }: PagerProps) {
  const _uiLanguage = useLanguage().language;
  return (
    <div className="admin-users-pagination">
      <button aria-label={_uiLanguage === "zh" ? "上一页" : "Previous page"} className="btn-ghost" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)} type="button">
        <ChevronLeft size={16} strokeWidth={1.8} />
      </button>
      <span>
        {_uiLanguage === "zh" ? `第 ${formatNumber(page)} 页，共 ${formatNumber(pageCount)} 页` : `Page ${formatNumber(page)} of ${formatNumber(pageCount)}`}
      </span>
      <button aria-label={_uiLanguage === "zh" ? "下一页" : "Next page"} className="btn-ghost" disabled={disabled || page >= pageCount} onClick={() => onPage(page + 1)} type="button">
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
  const _uiLanguage = useLanguage().language;
  const [query, setQuery] = useState(initialQuery);
  const [search, setSearch] = useState(initialQuery.trim());
  const [page, setPage] = useState(initialPage);
  const [result, setResult] = useState<ChatSearchPage | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [revision, setRevision] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [mutation, setMutation] = useState<"delete" | "reorder" | null>(null);
  const [mutationError, setMutationError] = useState("");
  const [notice, setNotice] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const apiRef = useRef<HistoryApi | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const mutationRef = useRef(false);
  const draggedIdRef = useRef<string | null>(null);
  const zh = _uiLanguage === "zh";

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
    // Keep saves, deletes and ordering changes in sync with other tabs.
    const channel = new BroadcastChannel("ai-cuber-chat-history-v1");
    channelRef.current = channel;
    channel.onmessage = (event) => {
      if (event.data?.userId === userId) setRevision((current) => current + 1);
    };
    return () => { channelRef.current = null; channel.close(); };
  }, [userId]);

  const total = result?.total ?? 0;
  const totalChats = result?.totalChats ?? 0;
  const currentPage = result?.page ?? page;
  const pageCount = result?.pageCount ?? 1;
  const first = total ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(total, currentPage * PAGE_SIZE);
  const needle = search.toLowerCase();
  const controlsDisabled = loadState !== "ready" || mutation !== null || deleteTarget !== null || query.trim() !== search;

  function resetDrag() {
    draggedIdRef.current = null;
    setDraggedId(null);
    setDropTarget(null);
  }

  function requestDelete(target: DeleteTarget) {
    resetDrag();
    setMutationError("");
    setNotice("");
    setDeleteTarget(target);
  }

  async function confirmDelete() {
    const api = apiRef.current;
    if (!api || !deleteTarget || mutationRef.current) return;
    mutationRef.current = true;
    setMutation("delete");
    setMutationError("");
    try {
      if (deleteTarget.kind === "all") {
        await api.clearChats(userId);
        setQuery("");
        setSearch("");
        setPage(1);
        setNotice(zh ? "已清空所有对话记录。" : "All chat history cleared.");
      } else {
        await api.deleteChat(userId, deleteTarget.id);
        setNotice(zh ? "对话已删除。" : "Chat deleted.");
      }
      channelRef.current?.postMessage({ userId });
      setDeleteTarget(null);
      setLoadState("loading");
      setRevision((current) => current + 1);
    } catch {
      setMutationError(zh ? "无法删除对话记录。请重试。" : "Chat history could not be deleted. Please try again.");
    } finally {
      mutationRef.current = false;
      setMutation(null);
    }
  }

  async function reorderChat(id: string, targetId: string, placement: "before" | "after") {
    const api = apiRef.current;
    if (!api || !result || controlsDisabled || mutationRef.current || id === targetId) return;
    const previous = result;
    const moving = result.chats.find((item) => item.id === id);
    const reordered = result.chats.filter((item) => item.id !== id);
    const targetIndex = reordered.findIndex((item) => item.id === targetId);
    if (!moving || targetIndex < 0) return;
    reordered.splice(targetIndex + (placement === "after" ? 1 : 0), 0, moving);
    if (reordered.every((item, index) => item.id === result.chats[index].id)) return;
    mutationRef.current = true;
    setMutation("reorder");
    setMutationError("");
    setNotice("");
    setResult({ ...result, chats: reordered });
    try {
      await api.moveChat(userId, id, targetId, placement);
      channelRef.current?.postMessage({ userId });
      setNotice(zh ? "对话顺序已保存。" : "Chat order saved.");
      setLoadState("loading");
      setRevision((current) => current + 1);
    } catch {
      setResult(previous);
      setMutationError(zh ? "无法保存对话顺序。请重试。" : "Chat order could not be saved. Please try again.");
    } finally {
      mutationRef.current = false;
      setMutation(null);
    }
  }

  function moveAdjacent(item: ChatSearchResult, index: number, direction: -1 | 1) {
    const target = result?.chats[index + direction];
    if (target) void reorderChat(item.id, target.id, direction === -1 ? "before" : "after");
  }

  return (
    <section aria-labelledby="chat-history-title" className="dashboard-workbench chat-history-page">
      <div className="settings-workbench__header">
        <p className="workspace-status-card__eyebrow"><Localized en="AI Chat" zh="AI 对话" /></p>
        <h1 id="chat-history-title"><Localized en={"Chat history"} zh={"对话记录"} /></h1>
        <p><Localized en="Every conversation saved in this browser. Search titles and messages, open a chat to continue it, or arrange your history in the order you prefer." zh="此浏览器中保存的所有对话。搜索标题和消息，打开对话继续，或按您喜欢的顺序排列记录。" /></p>
      </div>

      <div className="admin-users-toolbar">
        <label className="admin-users-toolbar__search">
          <Search aria-hidden="true" size={16} strokeWidth={1.8} />
          <input
            aria-label={_uiLanguage === "zh" ? "按标题或消息搜索对话" : "Search chats by title or message"}
            disabled={mutation !== null || deleteTarget !== null}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={_uiLanguage === "zh" ? "搜索标题和消息..." : "Search titles and messages..."}
            type="search"
            value={query}
          />
        </label>
        <span aria-live="polite" className="admin-users-toolbar__count">
          {loadState === "loading" && !result
            ? <Localized en={"Loading…"} zh={"正在加载…"} />
            : total
              ? (_uiLanguage === "zh" ? `显示 ${formatNumber(first)}–${formatNumber(last)}，共 ${formatNumber(total)} 个对话` : `${formatNumber(first)}–${formatNumber(last)} of ${formatNumber(total)} chats`)
              : <Localized en={"No chats"} zh={"暂无对话"} />}
        </span>
        <button className="btn-danger btn-danger--compact" disabled={controlsDisabled || totalChats === 0} onClick={() => requestDelete({ kind: "all" })} type="button">
          <Trash2 aria-hidden="true" size={15} />
          <Localized en="Clear all history" zh="清空所有记录" />
        </button>
        <Pager disabled={controlsDisabled} onPage={setPage} page={currentPage} pageCount={pageCount} />
      </div>

      <div aria-live="polite" className="chat-history-page__status" role="status">
        {mutation === "reorder" ? <><LoaderCircle aria-hidden="true" className="spin-icon" size={15} /><Localized en="Saving order…" zh="正在保存顺序…" /></> : notice}
      </div>
      {mutationError && !deleteTarget ? <p className="form-error" role="alert">{mutationError}</p> : null}

      {loadState === "unavailable" ? (
        <p className="workspace-chat__warning" role="status">
          <Localized en={"Chat history could not be read in this browser. It needs a secure connection and browser storage access."} zh={"无法读取此浏览器中的对话记录。需要安全连接和浏览器存储权限。"} /></p>
      ) : null}

      {result && result.chats.length === 0 ? (
        <div className="chat-history-page__empty">
          {search ? (
            <p>{_uiLanguage === "zh" ? `没有匹配“${search}”的对话。` : `No chats match “${search}”.`}</p>
          ) : (
            <p>
              <Localized en={"No chats saved in this browser yet."} zh={"此浏览器中尚未保存对话。"} />{" "}<a href="/dashboard/chat"><Localized en={"Start a chat"} zh={"开始对话"} /></a>
            </p>
          )}
        </div>
      ) : null}

      {result && result.chats.length > 0 ? (
        <>
        <p className="chat-history-page__sort-hint" id="chat-history-sort-hint"><Localized en="Drag the handle to reorder chats, or use the up and down buttons. Your order is saved in this browser. New chats appear first." zh="拖动手柄或使用上下按钮调整对话顺序。顺序保存在此浏览器中，新对话显示在最前面。" /></p>
        <ol aria-busy={mutation !== null || loadState === "loading"} className="chat-history-page__list">
          {result.chats.map((item, index) => (
            <li
              className={`chat-history-page__row${draggedId === item.id ? " is-dragging" : ""}${dropTarget?.id === item.id ? ` is-drop-${dropTarget.placement}` : ""}`}
              key={item.id}
              onDragOver={(event) => {
                if (controlsDisabled || !draggedIdRef.current || draggedIdRef.current === item.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const bounds = event.currentTarget.getBoundingClientRect();
                setDropTarget({ id: item.id, placement: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after" });
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget((current) => current?.id === item.id ? null : current);
              }}
              onDrop={(event) => {
                const id = draggedIdRef.current;
                if (!id || controlsDisabled) return;
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                resetDrag();
                void reorderChat(id, item.id, event.clientY < bounds.top + bounds.height / 2 ? "before" : "after");
              }}
            >
              <button
                aria-describedby="chat-history-sort-hint"
                aria-label={zh ? `拖动以调整“${item.title}”的顺序；也可使用上下方向键` : `Drag to reorder “${item.title}”, or use the up and down arrow keys`}
                className="chat-history-page__drag-handle"
                disabled={controlsDisabled}
                draggable={!controlsDisabled}
                onDragEnd={resetDrag}
                onDragStart={(event) => {
                  if (controlsDisabled) { event.preventDefault(); return; }
                  draggedIdRef.current = item.id;
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", item.id);
                  const row = event.currentTarget.closest("li");
                  if (row) event.dataTransfer.setDragImage(row, 20, 20);
                  setDraggedId(item.id);
                  setNotice("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault();
                    moveAdjacent(item, index, event.key === "ArrowUp" ? -1 : 1);
                  }
                }}
                title={zh ? "拖动以调整顺序" : "Drag to reorder"}
                type="button"
              ><GripVertical aria-hidden="true" size={18} /></button>
              <a className="chat-history-page__item" draggable={false} href={`/dashboard/chat?chat=${encodeURIComponent(item.id)}`}>
                <span aria-hidden="true" className="chat-history-page__icon">
                  <MessageSquare size={16} strokeWidth={1.8} />
                </span>
                <span className="chat-history-page__body">
                  <strong>{highlight(item.title, needle)}</strong>
                  {item.snippet ? <span className="chat-history-page__snippet">{highlight(item.snippet, needle)}</span> : null}
                  <span className="chat-history-page__meta">
                    {CHAT_MODELS.find((model) => model.id === item.model)?.label ?? "AI"} · {formatNumber(item.messageCount)}{" "}
                    {item.messageCount === 1 ? <Localized en={"message"} zh={"条消息"} /> : <Localized en={"messages"} zh={"条消息"} />} · {formatUpdated(item.updatedAt, _uiLanguage === "zh")}
                  </span>
                </span>
              </a>
              <div className="chat-history-page__actions">
                <button aria-label={zh ? `上移“${item.title}”` : `Move “${item.title}” up`} className="chat-history-page__action" disabled={controlsDisabled || index === 0} onClick={() => moveAdjacent(item, index, -1)} title={zh ? "上移" : "Move up"} type="button"><ArrowUp aria-hidden="true" size={16} /></button>
                <button aria-label={zh ? `下移“${item.title}”` : `Move “${item.title}” down`} className="chat-history-page__action" disabled={controlsDisabled || index === result.chats.length - 1} onClick={() => moveAdjacent(item, index, 1)} title={zh ? "下移" : "Move down"} type="button"><ArrowDown aria-hidden="true" size={16} /></button>
                <button aria-label={zh ? `删除“${item.title}”` : `Delete “${item.title}”`} className="chat-history-page__action chat-history-page__action--delete" disabled={controlsDisabled} onClick={() => requestDelete({ kind: "chat", id: item.id, title: item.title })} title={zh ? "删除对话" : "Delete chat"} type="button"><Trash2 aria-hidden="true" size={16} /></button>
              </div>
            </li>
          ))}
        </ol>
        </>
      ) : null}

      {pageCount > 1 ? (
        <div className="chat-history-page__footer">
          <Pager
            disabled={controlsDisabled}
            onPage={(next) => {
              setPage(next);
              document.getElementById("chat-history-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            page={currentPage}
            pageCount={pageCount}
          />
        </div>
      ) : null}
      <ConfirmDialog
        busy={mutation === "delete"}
        busyLabel={zh ? "正在删除…" : "Deleting…"}
        closeLabel={zh ? "关闭删除对话框" : "Close delete dialog"}
        confirmLabel={deleteTarget?.kind === "all" ? (zh ? "清空所有记录" : "Clear all history") : (zh ? "删除对话" : "Delete chat")}
        description={deleteTarget?.kind === "all"
          ? (zh ? `这将删除您在此浏览器中保存的全部 ${formatNumber(totalChats)} 个对话及其消息，包括当前搜索和页面之外的对话。` : `This deletes all ${formatNumber(totalChats)} of your saved chats and their messages in this browser, including chats outside the current search and page.`)
          : <p>{zh ? <>这将从此浏览器中删除 <strong>{deleteTarget?.kind === "chat" ? deleteTarget.title : ""}</strong> 及其消息。</> : <>This deletes <strong>{deleteTarget?.kind === "chat" ? deleteTarget.title : ""}</strong> and its messages from this browser.</>}</p>}
        error={mutationError}
        eyebrow={zh ? "对话记录" : "Chat history"}
        onCancel={() => { if (!mutationRef.current) { setDeleteTarget(null); setMutationError(""); } }}
        onConfirm={() => void confirmDelete()}
        open={deleteTarget !== null}
        title={deleteTarget?.kind === "all" ? (zh ? "清空所有对话记录？" : "Clear all chat history?") : (zh ? "删除此对话？" : "Delete this chat?")}
        warning={zh ? "此操作无法撤销。已保存的文件将保留在“我的文件”中。" : "This cannot be undone. Saved files remain available in My files."}
      />
    </section>
  );
}
