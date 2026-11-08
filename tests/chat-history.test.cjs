const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const duckdb = require("@duckdb/duckdb-wasm/blocking");

function compile(file, mocks = {}) {
  const filename = path.resolve(__dirname, "..", file);
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = instance.require.bind(instance);
  instance.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : originalRequire(name);
  instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText, filename);
  return instance.exports;
}

const models = compile("lib/chat-models.ts");

// Exercise the real DuckDB SQL with an in-memory database. Only the browser
// worker/storage lifecycle is adapted to Node; every call opens a new connection.
let db, api, failSql;
const storage = new Map();
const originalGlobals = new Map(["navigator", "window", "Worker", "localStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));

function query(sql, values = []) {
  const connection = db.connect();
  try {
    const statement = connection.prepare(sql);
    try { return statement.query(...values).toArray().map((row) => row.toJSON()); }
    finally { statement.close(); }
  } finally { connection.close(); }
}

before(async () => {
  db = await duckdb.createDuckDB({ mvp: { mainModule: require.resolve("@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm") } }, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  let pending = Promise.resolve();
  const browserGlobals = {
    navigator: { storage: { getDirectory() {} }, locks: { request(_name, action) {
      const result = pending.then(action);
      pending = result.catch(() => undefined);
      return result;
    } } },
    window: { isSecureContext: true },
    Worker: class { terminate() {} },
    localStorage: { getItem: (key) => storage.get(key) ?? null, removeItem: (key) => storage.delete(key) }
  };
  for (const [key, value] of Object.entries(browserGlobals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const browserDuckdb = {
    selectBundle: async () => ({ mainModule: "test.wasm", mainWorker: "test.worker.js" }),
    VoidLogger: duckdb.VoidLogger,
    DuckDBAccessMode: duckdb.DuckDBAccessMode,
    AsyncDuckDB: class {
      async instantiate() {}
      async open() {}
      async connect() {
        const connection = db.connect();
        return {
          query: async (sql) => connection.query(sql),
          prepare: async (sql) => {
            const statement = connection.prepare(sql);
            return {
              query: async (...values) => {
                if (failSql?.test(sql)) { failSql = null; throw new Error("Simulated storage failure"); }
                return statement.query(...values);
              },
              close: async () => statement.close()
            };
          },
          close: async () => connection.close()
        };
      }
      async terminate() {}
    }
  };
  api = compile("lib/chat-history.ts", {
    "@duckdb/duckdb-wasm": browserDuckdb,
    "@/lib/chat-models": models,
    "@/lib/chat-response-metrics": compile("lib/chat-response-metrics.ts")
  });
  await api.listChats("alice", 10);
});

beforeEach(() => {
  failSql = null;
  storage.clear();
  query("DELETE FROM conversation_order");
  query("DELETE FROM conversations");
});

after(() => {
  db?.reset();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

async function seed(userId, id, title, time) {
  const chat = await api.saveChat(userId, {
    id, title, model: models.CHAT_MODELS[0].id, revision: 0, createdAt: time, updatedAt: time,
    messages: [{ role: "user", content: title }, { role: "assistant", content: `Reply to ${title}` }]
  });
  query("UPDATE conversations SET updated_at = ? WHERE user_id = ? AND id = ?", [time, userId, id]);
  return { ...chat, updatedAt: time };
}

const ids = (page) => page.chats.map((chat) => chat.id);

test("custom order persists across connections, search, pagination and the sidebar without changing messages", async () => {
  await seed("alice", "a", "Work alpha", 5);
  await seed("alice", "b", "Personal beta", 4);
  const beforeMove = await seed("alice", "c", "Work gamma", 3);
  await seed("alice", "d", "Personal delta", 2);
  await seed("alice", "e", "Work epsilon", 1);
  await seed("bob", "bob", "Work private", 6);
  assert.deepEqual(ids(await api.listChats("alice", 10)), ["a", "b", "c", "d", "e"]);

  await api.moveChat("alice", "e", "c", "before");
  assert.deepEqual(ids(await api.listChats("alice", 10)), ["a", "b", "e", "c", "d"]);
  assert.deepEqual(await api.getChat("alice", "c"), beforeMove);
  const filtered = await api.searchChats("alice", "WORK", 2, 1);
  assert.deepEqual(ids(filtered), ["e"]);
  assert.equal(filtered.total, 3);
  assert.equal(filtered.totalChats, 5);
  assert.deepEqual(ids(await api.searchChats("alice", "", 2, 2)), ["e", "c"]);

  await api.moveChat("alice", "a", "c", "after");
  assert.deepEqual(ids(await api.listChats("alice", 3)), ["b", "e", "c"]);
  assert.equal((await api.listChats("alice", 3)).hasMore, true);
  assert.deepEqual(ids(await api.searchChats("alice", "work", 1, 50)), ["e", "c", "a"]);
  assert.deepEqual(ids(await api.listChats("bob", 10)), ["bob"]);
});

test("editing a sorted chat preserves its position and newly created chats appear first", async () => {
  const a = await seed("alice", "a", "Alpha", 3);
  await seed("alice", "b", "Beta", 2);
  await seed("alice", "c", "Gamma", 1);
  await api.moveChat("alice", "a", "c", "after");
  await api.saveChat("alice", { ...a, messages: [...a.messages, { role: "user", content: "Another message" }] });
  assert.deepEqual(ids(await api.listChats("alice", 10)), ["b", "c", "a"]);
  await seed("alice", "new", "New chat", 10);
  assert.deepEqual(ids(await api.listChats("alice", 10)), ["new", "b", "c", "a"]);
});

test("reordering refuses missing chats and another user's chats without changing either history", async () => {
  await seed("alice", "a", "Alpha", 2);
  await seed("alice", "b", "Beta", 1);
  await seed("bob", "bob", "Private", 3);
  for (const [id, target] of [["a", "bob"], ["bob", "b"], ["a", "missing"]]) {
    await assert.rejects(api.moveChat("alice", id, target, "before"), api.ChatHistoryConflict);
  }
  assert.deepEqual(ids(await api.listChats("alice", 10)), ["a", "b"]);
  assert.deepEqual(ids(await api.listChats("bob", 10)), ["bob"]);
});

test("individual deletion removes its messages and ordering while stale tabs cannot restore the chat", async () => {
  const a = await seed("alice", "a", "Alpha", 2);
  await seed("alice", "b", "Beta", 1);
  await seed("bob", "bob", "Private", 3);
  await api.moveChat("alice", "b", "a", "before");
  await api.deleteChat("alice", "bob");
  assert.ok(await api.getChat("bob", "bob"));
  await api.deleteChat("alice", "a");
  assert.equal(await api.getChat("alice", "a"), null);
  assert.deepEqual(ids(await api.listChats("alice", 10)), ["b"]);
  assert.equal(query("SELECT * FROM conversation_order WHERE chat_id = ?", ["a"]).length, 0);
  await assert.rejects(api.saveChat("alice", a), api.ChatHistoryConflict);
  assert.equal(await api.getChat("alice", "a"), null);
  await api.deleteChat("alice", "a"); // Retrying deletion is harmless.
});

test("clear deletes every page and search result for only the chosen user and removes legacy history", async () => {
  const stale = await seed("alice", "a", "Needle", 3);
  await seed("alice", "b", "Hidden", 2);
  await seed("alice", "legacy:alice", "Legacy", 1);
  await seed("bob", "bob-1", "Private one", 5);
  await seed("bob", "bob-2", "Private two", 4);
  await api.moveChat("alice", "b", "a", "before");
  await api.moveChat("bob", "bob-2", "bob-1", "before");
  storage.set("aicuber.chat.v1.alice", JSON.stringify({ messages: stale.messages }));
  storage.set("aicuber.chat.v1.bob", "keep");
  assert.equal((await api.searchChats("alice", "Needle", 1, 1)).total, 1);
  const noMatches = await api.searchChats("alice", "unmatched", 1, 50);
  assert.equal(noMatches.total, 0);
  assert.equal(noMatches.totalChats, 3);

  await api.clearChats("alice");
  const empty = await api.searchChats("alice", "", 9, 1);
  assert.deepEqual(ids(empty), []);
  assert.equal(empty.totalChats, 0);
  assert.equal(empty.page, 1);
  assert.equal(empty.pageCount, 1);
  assert.deepEqual(ids(await api.listChats("bob", 10)), ["bob-2", "bob-1"]);
  assert.equal(query("SELECT * FROM conversation_order WHERE user_id = ?", ["alice"]).length, 0);
  assert.equal(storage.has("aicuber.chat.v1.alice"), false);
  assert.equal(storage.get("aicuber.chat.v1.bob"), "keep");
  await api.migrateLegacyChat("alice");
  assert.equal((await api.listChats("alice", 10)).chats.length, 0);
  await assert.rejects(api.saveChat("alice", stale), api.ChatHistoryConflict);
});

test("deleting the last chat on a page clamps pagination to the remaining page", async () => {
  await seed("alice", "a", "Alpha", 3);
  await seed("alice", "b", "Beta", 2);
  await seed("alice", "c", "Gamma", 1);
  assert.deepEqual(ids(await api.searchChats("alice", "", 2, 2)), ["c"]);
  await api.deleteChat("alice", "c");
  const page = await api.searchChats("alice", "", 2, 2);
  assert.equal(page.page, 1);
  assert.equal(page.pageCount, 1);
  assert.deepEqual(ids(page), ["a", "b"]);
});

test("storage failures roll back deletion and reordering completely", async () => {
  await seed("alice", "a", "Alpha", 3);
  await seed("alice", "b", "Beta", 2);
  await seed("alice", "c", "Gamma", 1);
  await api.moveChat("alice", "c", "a", "before");
  failSql = /INSERT INTO conversation_order/;
  await assert.rejects(api.moveChat("alice", "a", "c", "before"), /Simulated storage failure/);
  assert.deepEqual(ids(await api.listChats("alice", 10)), ["c", "a", "b"]);
  failSql = /DELETE FROM conversations/;
  await assert.rejects(api.clearChats("alice"), /Simulated storage failure/);
  assert.deepEqual(ids(await api.listChats("alice", 10)), ["c", "a", "b"]);
  assert.equal(query("SELECT * FROM conversation_order WHERE user_id = ?", ["alice"]).length, 3);
});
