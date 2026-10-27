import type { AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { CHAT_MODELS, isChatModel, type ChatMessage, type ChatModelId } from "@/lib/chat-models";

export type HistoryMessage = ChatMessage & { model?: ChatModelId };
export type ChatSummary = { id: string; title: string; model: ChatModelId; updatedAt: number };
export type ChatConversation = ChatSummary & { messages: HistoryMessage[]; revision: number; createdAt: number };
export type HistoryPage = { chats: ChatSummary[]; hasMore: boolean };

const DATABASE_PATH = "opfs://ai-cuber-chat-v1.duckdb";
const DATABASE_LOCK = "ai-cuber-chat-database-v1";

export class ChatHistoryConflict extends Error {
  constructor() { super("This chat changed in another tab. Reopen it to see the latest messages."); }
}

async function runPrepared(connection: AsyncDuckDBConnection, sql: string, values: unknown[]) {
  const statement = await connection.prepare(sql);
  try { return await statement.query(...values); } finally { await statement.close(); }
}

async function withDatabase<T>(action: (connection: AsyncDuckDBConnection) => Promise<T>, write = false): Promise<T> {
  if (!navigator.storage?.getDirectory || !navigator.locks || !window.isSecureContext) {
    throw new Error("Browser storage is not available in this browser or connection.");
  }
  return navigator.locks.request(DATABASE_LOCK, async () => {
    const duckdb = await import("@duckdb/duckdb-wasm");
    const bundle = await duckdb.selectBundle({
      mvp: { mainModule: "/duckdb/duckdb-mvp.wasm", mainWorker: "/duckdb/duckdb-browser-mvp.worker.js" },
      eh: { mainModule: "/duckdb/duckdb-eh.wasm", mainWorker: "/duckdb/duckdb-browser-eh.worker.js" }
    });
    if (!bundle.mainWorker) throw new Error("DuckDB worker is unavailable.");
    const worker = new Worker(bundle.mainWorker);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    let connection: AsyncDuckDBConnection | undefined;
    try {
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      await db.open({ path: DATABASE_PATH, accessMode: duckdb.DuckDBAccessMode.READ_WRITE });
      connection = await db.connect();
      await connection.query(`CREATE TABLE IF NOT EXISTS conversations (
        id VARCHAR PRIMARY KEY, user_id VARCHAR NOT NULL, title VARCHAR NOT NULL,
        model VARCHAR NOT NULL, messages_json VARCHAR NOT NULL, revision INTEGER NOT NULL,
        created_at DOUBLE NOT NULL, updated_at DOUBLE NOT NULL
      )`);
      const result = await action(connection);
      if (write) await connection.query("CHECKPOINT");
      return result;
    } finally {
      await connection?.close().catch(() => undefined);
      await db.terminate().catch(() => worker.terminate());
    }
  });
}

function validMessages(value: unknown): HistoryMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is HistoryMessage =>
    item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string" &&
    item.content.length <= 32_000 && (!item.model || isChatModel(item.model))
  );
}

export function conversationTitle(messages: HistoryMessage[]) {
  const first = messages.find((message) => message.role === "user")?.content.trim().replace(/\s+/g, " ") || "New chat";
  return first.length > 60 ? `${first.slice(0, 57)}…` : first;
}

function parseRecord(row: Record<string, unknown>): ChatConversation {
  let messages: HistoryMessage[] = [];
  try { messages = validMessages(JSON.parse(String(row.messages_json))); } catch { throw new Error("This chat could not be read from browser storage."); }
  return {
    id: String(row.id), title: String(row.title), model: isChatModel(row.model) ? row.model : CHAT_MODELS[0].id,
    messages, revision: Number(row.revision), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at)
  };
}

export async function listChats(userId: string, limit: number): Promise<HistoryPage> {
  return withDatabase(async (connection) => {
    const result = await runPrepared(connection, "SELECT id, title, model, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT ?", [userId, Math.max(1, limit + 1)]);
    const rows = result.toArray().map((row) => row.toJSON() as Record<string, unknown>);
    return { chats: rows.slice(0, limit).map((row) => ({ id: String(row.id), title: String(row.title), model: isChatModel(row.model) ? row.model : CHAT_MODELS[0].id, updatedAt: Number(row.updated_at) })), hasMore: rows.length > limit };
  });
}

export async function getChat(userId: string, id: string): Promise<ChatConversation | null> {
  return withDatabase(async (connection) => {
    const result = await runPrepared(connection, "SELECT * FROM conversations WHERE user_id = ? AND id = ?", [userId, id]);
    const row = result.toArray()[0];
    return row ? parseRecord(row.toJSON() as Record<string, unknown>) : null;
  });
}

export async function saveChat(userId: string, chat: ChatConversation): Promise<ChatConversation> {
  return withDatabase(async (connection) => {
    await connection.query("BEGIN TRANSACTION");
    try {
      const current = await runPrepared(connection, "SELECT revision FROM conversations WHERE user_id = ? AND id = ?", [userId, chat.id]);
      const row = current.toArray()[0];
      if ((row && Number(row.toJSON().revision) !== chat.revision) || (!row && chat.revision !== 0)) throw new ChatHistoryConflict();
      const next = { ...chat, title: conversationTitle(chat.messages), revision: chat.revision + 1, updatedAt: Date.now() };
      if (row) {
        await runPrepared(connection, "UPDATE conversations SET title = ?, model = ?, messages_json = ?, revision = ?, updated_at = ? WHERE user_id = ? AND id = ?", [next.title, next.model, JSON.stringify(next.messages), next.revision, next.updatedAt, userId, next.id]);
      } else {
        await runPrepared(connection, "INSERT INTO conversations VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [next.id, userId, next.title, next.model, JSON.stringify(next.messages), next.revision, next.createdAt, next.updatedAt]);
      }
      await connection.query("COMMIT");
      return next;
    } catch (error) {
      await connection.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }, true);
}

export async function migrateLegacyChat(userId: string): Promise<void> {
  const key = `aicuber.chat.v1.${userId}`;
  let raw: string | null;
  try { raw = localStorage.getItem(key); } catch { return; }
  if (!raw) return;
  let legacy: { model?: unknown; messages?: unknown };
  try { legacy = JSON.parse(raw); } catch { return; }
  const messages = validMessages(legacy?.messages);
  if (!messages.length) return;
  const id = `legacy:${userId}`;
  await withDatabase(async (connection) => {
    const model = isChatModel(legacy.model) ? legacy.model : CHAT_MODELS[0].id;
    const now = Date.now();
    await runPrepared(connection, "INSERT INTO conversations VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING", [id, userId, conversationTitle(messages), model, JSON.stringify(messages), 1, now, now]);
  }, true);
  try { localStorage.removeItem(key); } catch { /* An idempotent migration will retry on the next visit. */ }
}
