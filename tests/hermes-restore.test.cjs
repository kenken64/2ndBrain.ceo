const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../lib/hermes-restore.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText;
const instance = new Module(filename, module);
instance._compile(compiled, filename);
const { hermesRestoreArgs, hermesRestoreHostname } = instance.exports;

test("Hermes restores the requested snapshot in Singapore", () => {
  assert.deepEqual(hermesRestoreArgs(), [
    "ls-restore", "--snapshot-name", "hermes-openrouter", "--region", "ap-southeast-1"
  ]);
});

test("identifies the Lightsail hostname from restore progress or completion", () => {
  assert.equal(hermesRestoreHostname("[Step 1/6] Resolving parameters...\n  Hostname: openclaw-1234abcd\n  Region: ap-southeast-1"), "openclaw-1234abcd");
  assert.equal(hermesRestoreHostname("Instance creation started: openclaw-1234abcd"), "openclaw-1234abcd");
  assert.equal(hermesRestoreHostname("--- Restore Complete ---\n  Deploy ID: 12345678-abcd\n  Hostname: openclaw-1234abcd\n  IP Address: 127.0.0.1"), "openclaw-1234abcd");
});

test("does not mistake unrelated progress or a deploy ID for a hostname", () => {
  assert.equal(hermesRestoreHostname("Creating instance from snapshot...\nDeploy ID: 12345678-abcd"), null);
  assert.equal(hermesRestoreHostname("Hostname: openclaw-1234abcd unexpected"), null);
});
