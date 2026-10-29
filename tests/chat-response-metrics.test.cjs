const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../lib/chat-response-metrics.ts');
const instance = new Module(filename, module); instance.filename = filename;
instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, filename);
const {wordCount, tokensPerSecond, isChatResponseMetrics} = instance.exports;
const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../test-data/test-16/benchmark-response.json'), 'utf8'));
test('counts visible words and computes provider output speed using the measured AI request time', () => {
  assert.equal(wordCount(fixture.content), fixture.expectedWords);
  assert.equal(tokensPerSecond(fixture), fixture.expectedTokensPerSecond);
  assert.equal(wordCount(''), 0); assert.equal(wordCount('Hello, **world**!'), 2); assert.ok(wordCount('你好世界') > 0);
});
test('does not invent tokens or divide by zero and rejects invalid stored metrics', () => {
  assert.equal(tokensPerSecond({elapsedMs:1000}), null); assert.equal(tokensPerSecond({elapsedMs:1000,generationMs:0,outputTokens:12}), null);
  assert.equal(tokensPerSecond({elapsedMs:1000,generationMs:1000,outputTokens:0}), 0);
  assert.equal(isChatResponseMetrics({elapsedMs:1000}), true);
  assert.equal(isChatResponseMetrics({elapsedMs:1000,generationMs:NaN,outputTokens:12}), false);
  assert.equal(isChatResponseMetrics({elapsedMs:-1,outputTokens:12}), false);
  assert.equal(isChatResponseMetrics({elapsedMs:10,outputTokens:1.5}), false);
});
