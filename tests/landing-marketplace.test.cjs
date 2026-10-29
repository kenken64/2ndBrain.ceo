const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function compile(file, mocks = {}) {
  const filename = path.resolve(__dirname, "..", file);
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = module.paths;
  const original = Module._load;
  try {
    Module._load = function (request, parent, isMain) {
      return Object.hasOwn(mocks, request) ? mocks[request] : original.apply(this, arguments);
    };
    instance._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText, filename);
  } finally { Module._load = original; }
  return instance.exports;
}

const allocation = compile("lib/workflow-tool-allocations.ts");
const catalog = compile("lib/workflow-templates.ts", { "@/lib/workflow-tool-allocations": allocation });
const messages = compile("lib/ui-messages.ts");
const { MarketplaceShowcase } = compile("components/landing/marketplace-showcase.tsx", {
  "@/lib/workflow-templates": catalog,
  "@/lib/ui-messages": messages
});

test("public marketplace shows the shared catalog, prices and repository links", () => {
  const html = renderToStaticMarkup(React.createElement(MarketplaceShowcase));
  assert.equal(catalog.MARKETPLACE_ITEMS.length, 6);
  for (const item of catalog.MARKETPLACE_ITEMS) {
    assert.ok(html.includes(item.title));
    assert.ok(html.includes(item.description));
    assert.ok(html.includes(new Intl.NumberFormat("en-US").format(item.priceTokens)));
    assert.ok(html.includes(item.repoUrl));
    for (const step of item.steps) assert.ok(html.includes(step));
  }
  assert.ok(html.includes('href="/dashboard/marketplace"'));
});

test("Chinese marketplace translates every catalog description, category and step", () => {
  const html = renderToStaticMarkup(React.createElement(MarketplaceShowcase, { locale: "zh" }));
  for (const item of catalog.MARKETPLACE_ITEMS) {
    for (const text of [item.category, item.title, item.description, ...item.steps]) {
      assert.ok(Object.hasOwn(messages.uiMessagesZh, text), `Missing translation: ${text}`);
      assert.ok(html.includes(messages.uiMessagesZh[text]));
    }
  }
  assert.ok(html.includes("工具市场"));
  assert.ok(html.includes("20,000"));
});
