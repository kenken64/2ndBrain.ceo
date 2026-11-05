const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

test("token-free OpenClaw restore requires a sanitized snapshot and refuses unsafe reuse", async () => {
  const filename = path.resolve(__dirname, "../lib/openclaw.ts");
  const instance = new Module(filename, module); instance.paths = module.paths;
  const mocks = { "@/lib/wiki": {}, "@/lib/wiki-attachments": {}, "@/lib/hermes-restore": {}, "@/lib/wiki-openrouter": {} };
  const load = Module._load;
  try {
    Module._load = function (request, parent, main) { return Object.hasOwn(mocks, request) ? mocks[request] : load.apply(this, arguments); };
    instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
  } finally { Module._load = load; }
  const previousRegion = process.env.AWS_REGION, previousSnapshot = process.env.OPENCLAW_TELEGRAM_FREE_SNAPSHOT_NAME;
  const input = { telegramBotToken: "", avatarName: "Assistant", avatarGender: "female", ownerName: "Owner" };
  try {
    process.env.AWS_REGION = "ap-southeast-1";
    delete process.env.OPENCLAW_TELEGRAM_FREE_SNAPSHOT_NAME;
    await assert.rejects(instance.exports.provisionOpenClaw(input), /missing_openclaw_telegram_free_snapshot_name/);
    process.env.OPENCLAW_TELEGRAM_FREE_SNAPSHOT_NAME = "clean-snapshot";
    await assert.rejects(instance.exports.provisionOpenClaw({ ...input, existingInstance: "old-instance", existingSnapshotName: "unknown" }), /openclaw_existing_instance_not_telegram_free/);
  } finally {
    if (previousRegion === undefined) delete process.env.AWS_REGION; else process.env.AWS_REGION = previousRegion;
    if (previousSnapshot === undefined) delete process.env.OPENCLAW_TELEGRAM_FREE_SNAPSHOT_NAME; else process.env.OPENCLAW_TELEGRAM_FREE_SNAPSHOT_NAME = previousSnapshot;
  }
});
