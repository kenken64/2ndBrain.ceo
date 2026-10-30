const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function compile(file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', file);
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = module.paths;
  const original = Module._load;
  try {
    Module._load = function (request) { return Object.hasOwn(mocks, request) ? mocks[request] : original.apply(this, arguments); };
    instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText, filename);
  } finally { Module._load = original; }
  return instance.exports;
}

const nextServer = { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } };

test('saved sources are only marked successful when the agent confirms wiki changes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-ingest-test-'));
  const binary = path.join(dir, 'clawmacdo');
  fs.writeFileSync(binary, '#!/bin/sh\ncase "$1" in\nwiki-tree) printf "%s" "$TEST_TREE"; exit 0;;\nwiki-read) printf "%s\\n" "$@" >> "$TEST_RECORD"; printf "%s" "$TEST_PAGE"; exit 0;;\nesac\nif [ "$TEST_INGEST_RESULT" = error ]; then echo "failed to parse wiki ingest JSON: EOF while parsing a value" >&2; exit 1; fi\nprintf "%s" "$TEST_INGEST_RESULT"\n', { mode: 0o755 });
  const env = { AWS_REGION: 'test', AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', OPENCLAW_PROJECT_ROOT: '/workspace', CLAWMACDO_BIN_PATH: binary };
  const previous = Object.fromEntries([...Object.keys(env), 'TEST_INGEST_RESULT', 'TEST_TREE', 'TEST_PAGE', 'TEST_RECORD'].map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    const claw = compile('lib/openclaw.ts', {
      '@/lib/wiki': { normalizeWikiPath: value => value, titleFromWikiPath: value => value },
      '@/lib/wiki-attachments': { buildAttachmentPromptContext: () => '' },
      '@/lib/hermes-restore': {}
    });
    const input = { attachments: [{ fileName: 'source.pdf', markdown: 'Evidence', path: 'raw/uploads/one/sources/source.md', sourceType: 'pdf', size: 8 }], avatarName: 'Avatar', instance: '127.0.0.1', ownerName: 'Owner', projectId: 'p1', projectSlug: 'wiki-test', prompt: 'Create pages', userId: 'u1', writeAttachments: false };
    process.env.TEST_INGEST_RESULT = 'error';
    await assert.rejects(claw.ingestOpenClawWikiAttachments(input), /wiki generation could not be confirmed/);
    process.env.TEST_INGEST_RESULT = '{"changed_files":["raw/sources/upload.md"]}';
    await assert.rejects(claw.ingestOpenClawWikiAttachments(input), /No wiki pages were updated/);
    process.env.TEST_INGEST_RESULT = '{"changed_files":["wiki/entities/maya.md"]}';
    assert.equal((await claw.ingestOpenClawWikiAttachments(input)).mapping, 'wiki-ingest');
    process.env.TEST_TREE = JSON.stringify({ tree: [
      { name: 'first.md', path: 'wiki-test/raw/uploads/one/sources/first.md', type: 'file' },
      { name: 'second.md', path: 'wiki-test/raw/uploads/two/sources/second.md', type: 'file' }
    ] });
    process.env.TEST_PAGE = JSON.stringify({ content: '---\nsource_file: "first.pdf"\nsource_type: "pdf"\n---\nEvidence' });
    process.env.TEST_RECORD = path.join(dir, 'read-args');
    const retry = { ...input, sourceNamespace: 'raw/uploads/one' };
    assert.equal((await claw.backfillOpenClawWikiIngest(retry)).mapping, 'wiki-ingest-backfill');
    assert.match(fs.readFileSync(process.env.TEST_RECORD, 'utf8'), /raw\/uploads\/one\/sources\/first\.md/);
    assert.doesNotMatch(fs.readFileSync(process.env.TEST_RECORD, 'utf8'), /raw\/uploads\/two/);
    await assert.rejects(claw.backfillOpenClawWikiIngest({ ...retry, sourceNamespace: 'raw/uploads/missing' }), /No uploaded source markdown/);
  } finally {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fixture(job, mapping) {
  const state = { job: { ...job }, project: { id: 'p1', status: 'ready', title: 'Test', prompt: 'project context', openclaw_project_slug: 'wiki-test', openclaw_generation_mapping: mapping, openclaw_generation_prompt: 'original instruction' } };
  const context = { project: state.project, projectSlug: 'wiki-test', instance: 'instance', userId: 'u1', profile: { owner_name: 'Owner', avatar_name: 'Avatar' } };
  context.supabase = { from(table) {
    let patch; const filters = {};
    const query = {
      select() { return this; }, update(data) { patch = data; return this; }, eq(key, value) { filters[key] = value; return this; }, order() { return this; }, limit() { return this; },
      async maybeSingle() {
        if (table === 'projects') return { data: state.project, error: null };
        if (patch) {
          if (filters.status && state.job.status !== filters.status) return { data: null, error: null };
          Object.assign(state.job, patch);
        }
        return { data: state.job, error: null };
      },
      then(resolve, reject) { return this.maybeSingle().then(resolve, reject); }
    };
    return query;
  }};
  return { context, state };
}

test('legacy source-only jobs are presented as needing retry', async () => {
  const { context } = fixture({ id: 'j1', status: 'ready' }, 'wiki-ingest-attachment-only');
  const route = compile('app/api/wiki/ingest/route.ts', {
    'next/server': nextServer, '@/lib/openclaw': {}, '@/lib/wiki-server': { getWikiContext: async () => context }, '@/lib/wiki-attachments': {}
  });
  const result = await route.GET({ url: 'https://example.test/api/wiki/ingest?projectId=p1' });
  assert.equal(result.body.needsRetry, true);
  assert.equal(result.body.canRetry, true);
  context.project.openclaw_generation_mapping = 'wiki-ingest';
  const normal = await route.GET({ url: 'https://example.test/?projectId=p1' });
  assert.equal(normal.body.needsRetry, false);
  assert.equal(normal.body.canRetry, true);
});

test('retry uses the original saved upload and finishes the latest job', async () => {
  const { context, state } = fixture({ id: 'j1', status: 'ready', file_path: 'raw/uploads/one' }, 'wiki-ingest-attachment-only');
  let retryInput;
  const route = compile('app/api/wiki/ingest/backfill/route.ts', {
    'next/server': nextServer,
    '@/lib/wiki-server': { getWikiContext: async () => context },
    '@/lib/openclaw': { backfillOpenClawWikiIngest: async input => { retryInput = input; return { mapping: 'wiki-ingest-backfill', task: input.prompt, output: 'done' }; }, readOpenClawWikiTree: async () => [] }
  });
  const result = await route.POST({ json: async () => ({ projectId: 'p1' }) });
  assert.equal(result.status, 200);
  assert.equal(retryInput.sourceNamespace, 'raw/uploads/one');
  assert.equal(retryInput.prompt, 'original instruction');
  assert.equal(state.job.status, 'ready');
});

test('Test 18 PDF is converted to readable source markdown', async () => {
  const { convertWikiAttachments } = compile('lib/wiki-attachments.ts');
  const pdf = fs.readFileSync(path.resolve(__dirname, '../test-data/test-18/nth-brain-support-pilot.pdf'));
  const file = new File([pdf], 'nth-brain-support-pilot.pdf', { type: 'application/pdf' });
  const [attachment] = await convertWikiAttachments([file], { sourceRoot: 'raw/uploads/test/sources' });
  assert.equal(attachment.sourceType, 'pdf');
  assert.match(attachment.markdown, /Northstar Labs/);
  assert.match(attachment.markdown, /Maya Chen/);
  assert.match(attachment.markdown, /Ticket\s+Routing/);
  assert.match(attachment.markdown, /source_type: "pdf"/);
  assert.match(attachment.path, /^raw\/uploads\/test\/sources\//);
});
