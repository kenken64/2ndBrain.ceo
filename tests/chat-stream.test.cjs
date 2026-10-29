const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function compile(file) {
  const filename = path.resolve(__dirname, '..', file), instance = new Module(filename, module);
  instance.filename = filename; instance.paths = module.paths;
  instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return instance.exports;
}
const { streamChatResponse } = compile('lib/chat-stream.ts');
const { readChatStream } = compile('lib/chat-stream-client.ts');
const fixture = fs.readFileSync(path.resolve(__dirname, '../test-data/test-15/provider-stream.sse'));
function fixtureResponse(bytes = fixture) {
  let offset = 0;
  return new Response(new ReadableStream({ pull(controller) { if (offset >= bytes.length) { controller.close(); return; } controller.enqueue(bytes.subarray(offset, offset += 7)); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
function setup(upstream, lookupCost = async () => null) {
  const charges = [], upstreamAbort = new AbortController(), request = new AbortController();
  const response = streamChatResponse({ upstream, requestSignal: request.signal, upstreamAbort, startedAt: performance.now(), model: 'fixture-model', quotaExempt: false, lookupCost, settle: async (...args) => { charges.push(args); return { llm_token_quota: 1000, llm_token_used: 20, charged_credits: 20 }; } });
  return { response, charges, upstreamAbort, request };
}
test('stream delivers fragmented UTF-8 incrementally and settles provider usage once', async () => {
  const s = setup(fixtureResponse()), updates = [];
  const result = await readChatStream(s.response, text => updates.push(text));
  assert.deepEqual(updates, ['The agent began with a simple instruction. ', 'The agent began with a simple instruction. Then it stopped listening. Café.']);
  assert.equal(result.message, updates.at(-1)); assert.equal(result.chargedCredits, 20); assert.equal(result.outputTokens, 15); assert.ok(result.generationMs >= 0);
  assert.deepEqual(s.charges, [['completed', 0.0002, 'fixture-generation', {prompt_tokens:20,completion_tokens:15,cost:0.0002}]]);
});
test('missing usage is retrieved or marked uncertain, never guessed', async () => {
  const data = Buffer.from('data: {"id":"gen","choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n');
  const recovered = setup(fixtureResponse(data), async id => { assert.equal(id, 'gen'); return 0.003; });
  assert.equal((await readChatStream(recovered.response, () => {})).usagePending, false);
  assert.equal(recovered.charges[0][0], 'completed'); assert.equal(recovered.charges[0][1], 0.003);
  const missing = setup(fixtureResponse(data));
  const missingResult = await readChatStream(missing.response, () => {});
  assert.equal(missingResult.usagePending, true); assert.equal(missingResult.outputTokens, undefined);
  assert.equal(missing.charges[0][0], 'uncertain'); assert.equal(missing.charges[0][1], null);
});
test('interrupted upstream preserves the partial response and keeps usage uncertain', async () => {
  const data = Buffer.from('data: {"id":"gen","choices":[{"delta":{"content":"Partial"}}]}\n\n');
  const s = setup(fixtureResponse(data)); let partial = '';
  await assert.rejects(readChatStream(s.response, text => { partial = text; }), /ended before completion/);
  assert.equal(partial, 'Partial'); assert.equal(s.charges.length, 1); assert.equal(s.charges[0][0], 'uncertain');
});
test('stopping aborts upstream and records uncertain usage exactly once', async () => {
  const upstream = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"id":"gen","choices":[{"delta":{"content":"Partial"}}]}\n\n')); } }), { headers: { 'Content-Type':'text/event-stream' } });
  const s = setup(upstream), reader = s.response.body.getReader();
  const first = await reader.read(); assert.match(new TextDecoder().decode(first.value), /Partial/);
  await reader.cancel(); assert.equal(s.upstreamAbort.signal.aborted, true);
  assert.equal(s.charges.length, 1); assert.deepEqual(s.charges[0].slice(0,3), ['uncertain', null, 'gen']);
});
test('a 1,000-word response fits and provider truncation is reported', async () => {
  const text = Array(1000).fill('word').join(' ');
  const data = Buffer.from(`data: ${JSON.stringify({id:'long',choices:[{delta:{content:text},finish_reason:'length'}],usage:{cost:0}})}\n\ndata: [DONE]\n\n`);
  const s = setup(fixtureResponse(data)); const result = await readChatStream(s.response, () => {});
  assert.equal(result.message, text); assert.equal(result.truncated, true); assert.equal(s.charges[0][1], 0);
});
