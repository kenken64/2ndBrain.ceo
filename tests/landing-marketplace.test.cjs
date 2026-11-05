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
const carousel = compile("components/landing/marketplace-carousel.tsx");
const { MarketplaceShowcase } = compile("components/landing/marketplace-showcase.tsx", {
  "@/components/landing/marketplace-carousel": carousel,
  "@/lib/workflow-templates": catalog,
  "@/lib/ui-messages": messages
});

test("public marketplace shows the shared catalog, prices and repository links", () => {
  const html = renderToStaticMarkup(React.createElement(MarketplaceShowcase));
  assert.equal(catalog.MARKETPLACE_ITEMS.length, 8);
  for (const item of catalog.MARKETPLACE_ITEMS) {
    assert.ok(html.includes(item.title.replaceAll("&", "&amp;")));
    assert.ok(html.includes(item.description));
    assert.ok(html.includes(item.priceTokens === 0 ? "Free" : new Intl.NumberFormat("en-US").format(item.priceTokens)));
    if (item.repoUrl) assert.ok(html.includes(item.repoUrl));
    for (const step of item.steps) assert.ok(html.includes(step));
  }
  assert.ok(html.includes('href="/dashboard/marketplace"'));
  assert.ok(html.includes('aria-roledescription="carousel"'));
  assert.ok(html.includes('aria-label="Previous tools"'));
  assert.ok(html.includes('aria-label="Next tools"'));
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
  assert.ok(html.includes('aria-label="下一组工具"'));
});

test("carousel scrolls by a page, supports keyboard navigation and updates its bounds", () => {
  const original = { window: global.window, getComputedStyle: global.getComputedStyle, ResizeObserver: global.ResizeObserver };
  const scrolls = [], positions = [], cleanups = [];
  const track = { clientWidth: 936, scrollWidth: 2526, scrollLeft: 0, firstElementChild: { getBoundingClientRect: () => ({ width: 300 }) }, scrollBy: value => scrolls.push(value), scrollTo: value => scrolls.push(value) };
  let observer, reduced = false, id = 0, disconnected = false;
  global.window = { matchMedia: () => ({ matches: reduced }) };
  global.getComputedStyle = () => ({ columnGap: '18px' });
  global.ResizeObserver = class { constructor(callback) { observer = callback; } observe() {} disconnect() { disconnected = true; } };
  try {
    const { MarketplaceCarousel } = compile('components/landing/marketplace-carousel.tsx', { react: { ...React, useRef: () => ({ current: track }), useId: () => `id-${id++}`, useState: value => [value, next => positions.push(next)], useCallback: fn => fn, useEffect: fn => cleanups.push(fn()) } });
    const tree = MarketplaceCarousel({ children: 'cards', count: 8, locale: 'en' });
    function find(node, predicate) {
      if (!node || typeof node !== 'object') return null;
      if (predicate(node)) return node;
      for (const child of React.Children.toArray(node.props?.children)) { const found = find(child, predicate); if (found) return found; }
      return null;
    }
    const next = find(tree, node => node.props?.['aria-label'] === 'Next tools');
    const viewport = find(tree, node => node.props?.className === 'lp-marketplace__track');
    assert.deepEqual(positions.at(-1), { first: 1, last: 3, back: false, next: true });
    next.props.onClick(); assert.deepEqual(scrolls.at(-1), { left: 954, behavior: 'smooth' });
    reduced = true; next.props.onClick(); assert.equal(scrolls.at(-1).behavior, 'instant');
    let prevented = false;
    const key = value => viewport.props.onKeyDown({ key: value, target: track, currentTarget: track, preventDefault() { prevented = true; } });
    key('ArrowLeft'); assert.equal(prevented, true); assert.equal(scrolls.at(-1).left, -954);
    key('Home'); assert.equal(scrolls.at(-1).left, 0);
    key('End'); assert.equal(scrolls.at(-1).left, 2526);
    track.scrollLeft = 1590; viewport.props.onScroll();
    assert.deepEqual(positions.at(-1), { first: 6, last: 8, back: true, next: false });
    track.scrollLeft = 0; track.clientWidth = 618; observer();
    assert.deepEqual(positions.at(-1), { first: 1, last: 2, back: false, next: true });
    for (const cleanup of cleanups) cleanup?.(); assert.equal(disconnected, true);
  } finally { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete global[key]; else global[key] = value; } }
});
