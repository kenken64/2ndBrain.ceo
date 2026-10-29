const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

function compile(file, replacements = {}) {
  const filename = path.resolve(__dirname, "..", file);
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = module.paths;
  const originalLoad = Module._load;
  try {
    Module._load = function (request, parent, isMain) {
      return Object.hasOwn(replacements, request) ? replacements[request] : originalLoad.apply(this, arguments);
    };
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    instance._compile(output, filename);
  } finally {
    Module._load = originalLoad;
  }
  return instance.exports;
}

const messages = compile("lib/ui-messages.ts");
const language = compile("components/language-provider.tsx", { "@/lib/ui-messages": messages });
const { ConfirmDialog } = compile("components/confirm-dialog.tsx", { "@/components/language-provider": language });

function render(locale, child) {
  return renderToStaticMarkup(React.createElement(language.LanguageProvider, { initialLanguage: locale }, child));
}

test("language preference selects labels and placeholders without translating unknown content", () => {
  const child = React.createElement(React.Fragment, null,
    React.createElement(language.Localized, { en: "Settings", zh: "设置" }),
    React.createElement(language.LocalizedMessage, { text: "Profile name is required." }),
    React.createElement(language.LocalizedMessage, { text: "Customer project: Hello" }),
    React.createElement(language.LocalizedInput, { placeholderEn: "Search", placeholderZh: "搜索" }),
    React.createElement(language.LocalizedContainer, { as: "nav", labelEn: "Page navigation", labelZh: "页面导航" }, "content"),
    React.createElement(language.LanguageToggle));
  const en = render("en", child);
  const zh = render("zh", child);
  assert.match(en, /Settings/);
  assert.match(en, /Profile name is required\./);
  assert.match(en, /placeholder="Search"/);
  assert.match(en, /aria-label="Page navigation"/);
  assert.match(en, />中文<\/button>/);
  assert.match(zh, /设置/);
  assert.match(zh, /请输入资料名称/);
  assert.match(zh, /placeholder="搜索"/);
  assert.match(zh, /aria-label="页面导航"/);
  assert.match(zh, />English<\/button>/);
  assert.match(zh, /Customer project: Hello/);
});

test("every signed-in dashboard header includes the language toggle", () => {
  const missing = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(filename);
      } else if (entry.name.endsWith(".tsx")) {
        const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        function walk(node) {
          if (ts.isJsxElement(node)) {
            const className = node.openingElement.attributes.properties.find(property =>
              ts.isJsxAttribute(property) && property.name.getText(source) === "className"
            );
            if (className && ts.isStringLiteral(className.initializer) && className.initializer.text.split(/\s+/).includes("dashboard-topbar")) {
              let hasToggle = false;
              function findToggle(child) {
                if ((ts.isJsxSelfClosingElement(child) || ts.isJsxOpeningElement(child)) && child.tagName.getText(source) === "LanguageToggle") hasToggle = true;
                ts.forEachChild(child, findToggle);
              }
              findToggle(node);
              if (!hasToggle) missing.push(path.relative(path.resolve(__dirname, ".."), filename));
            }
          }
          ts.forEachChild(node, walk);
        }
        walk(source);
      }
    }
  }
  visit(path.resolve(__dirname, "../app/dashboard"));
  visit(path.resolve(__dirname, "../app/admin"));
  assert.deepEqual(missing, []);
});

test("destructive confirmation keeps the required word while translating its instructions", () => {
  const child = React.createElement(ConfirmDialog, {
    open: true, closeLabel: "Close", eyebrow: "Delete account", title: "Delete this account?",
    description: "This will destroy the current Cloud AI Agent instance, clear generated Nth Brain project history for this account, reset onboarding, and log you out.",
    warning: "This action is destructive. Use it only when you want this account to return to enrolment and provision a fresh workspace.",
    confirmLabel: "Delete account", confirmWord: "DELETE", onCancel() {}, onConfirm() {}
  });
  const en = render("en", child);
  const zh = render("zh", child);
  assert.match(en, /Type DELETE to confirm/);
  assert.match(zh, /输入 DELETE 以确认/);
  assert.match(zh, /删除账户/);
  assert.match(zh, /此操作具有破坏性/);
  assert.match(zh, /placeholder="DELETE"/);
});

test("variable application messages translate while preserving their values", () => {
  assert.equal(messages.translateUiMessage("Credited 12,500 AI credits.", "zh"), "已充值 12,500 AI 积分。");
  assert.equal(messages.translateUiMessage("Transferred 20 AI credits to user@example.com.", "zh"), "已向 user@example.com 转移 20 AI 积分。");
  assert.equal(messages.translateUiMessage("Indexing 3 pages", "zh"), "正在索引 3 个页面");
  assert.equal(messages.translateUiMessage("Unknown upstream error", "zh"), "Unknown upstream error");
  assert.equal(messages.translateUiMessage("Unknown upstream\nerror", "zh"), "Unknown upstream\nerror");
  assert.equal(messages.translateUiMessage("Credited 20 AI credits.", "en"), "Credited 20 AI credits.");
});

test("static API error messages have Chinese translations", () => {
  const apiRoot = path.resolve(__dirname, "../app/api");
  const missing = new Set();
  function visitDirectory(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) visitDirectory(filename);
      else if (entry.name.endsWith(".ts")) {
        const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        function checkStrings(node) {
          if (ts.isStringLiteral(node) && node.text.length > 12 && /\s/.test(node.text) && !Object.hasOwn(messages.uiMessagesZh, node.text)) {
            missing.add(node.text);
          }
          ts.forEachChild(node, checkStrings);
        }
        function walk(node) {
          if ((ts.isPropertyAssignment(node) && node.name.getText(source).replace(/["']/g, "") === "error") ||
              (ts.isCallExpression(node) && /^(?:errorResponse|userError|jsonError)$/.test(node.expression.getText(source)))) {
            checkStrings(node);
          }
          ts.forEachChild(node, walk);
        }
        walk(source);
      }
    }
  }
  visitDirectory(apiRoot);
  assert.deepEqual([...missing], []);
});

test("graph labels translate built-in types and relations without changing custom values", () => {
  const labels = compile("lib/graph-labels.ts");
  assert.equal(labels.graphTypeLabel("decision", "zh"), "决策");
  assert.equal(labels.graphRelationLabel("depends_on", "zh"), "依赖");
  assert.equal(labels.graphTypeLabel("decision", "en"), "Decision");
  assert.equal(labels.graphRelationLabel("custom_relation", "zh"), "custom relation");
});

test("signed-in static interface copy is localized", () => {
  const roots = ["app/dashboard", "app/admin", "app/onboarding", "components"].map(item => path.resolve(__dirname, "..", item));
  const excluded = new Set(["marketing-nav.tsx", "footer.tsx", "login-dialog.tsx", "brand-logo.tsx"]);
  const neutral = new Set(["Nth Brain", "AI Agent", "HermesAgent", "OpenRouter", "Solana", "Zoom", "MB ·", "API JSON -&gt;", "/api/integrations/zoom/callback**", "-&gt;"]);
  const violations = [];
  function visitDirectory(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "landing") visitDirectory(filename);
      } else if (entry.name.endsWith(".tsx") && !excluded.has(entry.name)) {
        const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        function walk(node) {
          if (ts.isJsxText(node)) {
            const text = node.text.replace(/\s+/g, " ").trim();
            if (/[A-Za-z]{2,}/.test(text) && !neutral.has(text)) {
              let parent = node.parent;
              let localized = false;
              while (parent) {
                if ((ts.isJsxElement(parent) && parent.openingElement.tagName.getText(source) === "Localized") ||
                    (ts.isJsxSelfClosingElement(parent) && parent.tagName.getText(source) === "Localized")) {
                  localized = true;
                  break;
                }
                parent = parent.parent;
              }
              // These fragments are the English branch of an explicit language conditional.
              const explicitEnglishBranch = entry.name === "workspace-chat.tsx" &&
                (text === "Batch document mode: one" || text === "will be created per spreadsheet row.");
              if (!localized && !explicitEnglishBranch) violations.push(`${path.relative(path.resolve(__dirname, ".."), filename)}: ${text}`);
            }
          }
          ts.forEachChild(node, walk);
        }
        walk(source);
      }
    }
  }
  roots.forEach(visitDirectory);
  assert.deepEqual(violations, []);
});
