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

test('saved uploads are generated through OpenRouter in the correct project with guarded writes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-openrouter-test-'));
  const binary = path.join(dir, 'clawmacdo');
  fs.writeFileSync(binary, `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_RECORD"
case "$1" in
wiki-tree) printf '%s' "$TEST_TREE";;
wiki-read) printf '%s' "$TEST_PAGE";;
wiki-write) printf '{"sha256":"new-sha"}';;
*) exit 1;;
esac
`, { mode: 0o755 });
  const env = { AWS_REGION: 'test', AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test', OPENCLAW_PROJECT_ROOT: '/workspace', CLAWMACDO_BIN_PATH: binary, TEST_RECORD: path.join(dir, 'commands'), TEST_TREE: JSON.stringify({ tree: [
    { name: 'index.md', path: 'wiki-test/index.md', type: 'file' },
    { name: 'first.md', path: 'wiki-test/raw/uploads/one/sources/first.md', type: 'file' },
    { name: 'second.md', path: 'wiki-test/raw/uploads/two/sources/second.md', type: 'file' }
  ] }), TEST_PAGE: JSON.stringify({ content: '---\nsource_file: "first.pdf"\nsource_type: "pdf"\n---\nEvidence', sha256: 'a'.repeat(64) }) };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  let received;
  let fail = false;
  try {
    const claw = compile('lib/openclaw.ts', {
      '@/lib/wiki': { normalizeWikiPath: value => value, titleFromWikiPath: value => value },
      '@/lib/wiki-attachments': { buildAttachmentPromptContext: () => '' },
      '@/lib/hermes-restore': {},
      '@/lib/wiki-openrouter': { generateWikiWithOpenRouter: async input => { received = input; if (fail) throw new Error('provider failed'); return [{ path: 'index.md', content: '# Updated index' }, { path: 'wiki/entities/maya.md', content: '# Maya' }]; } }
    });
    const input = { attachments: [{ fileName: 'source.pdf', markdown: 'Evidence', path: 'raw/uploads/one/sources/source.md', sourceType: 'pdf', size: 8 }], avatarName: 'Avatar', instance: '127.0.0.1', ownerName: 'Owner', projectId: 'p1', projectSlug: 'wiki-test', prompt: 'Create pages', userId: 'u1', writeAttachments: false };
    fail = true;
    await assert.rejects(claw.ingestOpenClawWikiAttachments(input), /provider failed/);
    fail = false;
    assert.equal((await claw.ingestOpenClawWikiAttachments(input)).mapping, 'wiki-ingest-openrouter');
    assert.equal(received.attachments[0].markdown, 'Evidence');
    assert.equal(received.existingPages[0].path, 'index.md');
    let commands = fs.readFileSync(env.TEST_RECORD, 'utf8');
    assert.match(commands, /wiki-write .*--path wiki-test\/index.md .*--base-sha a{64}/);
    assert.match(commands, /wiki-write .*--path wiki-test\/wiki\/entities\/maya.md .*--base-sha NEW/);
    assert.doesNotMatch(commands, /wiki-ingest|openclaw-llm-wiki/);
    fs.writeFileSync(env.TEST_RECORD, '');
    const retry = { ...input, sourceNamespace: 'raw/uploads/one' };
    assert.equal((await claw.backfillOpenClawWikiIngest(retry)).mapping, 'wiki-ingest-backfill-openrouter');
    commands = fs.readFileSync(env.TEST_RECORD, 'utf8');
    assert.match(commands, /raw\/uploads\/one\/sources\/first\.md/);
    assert.doesNotMatch(commands, /raw\/uploads\/two\/sources\/second\.md/);
    await assert.rejects(claw.backfillOpenClawWikiIngest({ ...retry, sourceNamespace: 'raw/uploads/missing' }), /No uploaded source markdown/);
  } finally {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fixture(job, mapping) {
  const state = { job: job ? { ...job } : null, project: { id: 'p1', status: 'ready', title: 'Test', prompt: 'project context', openclaw_project_slug: 'wiki-test', openclaw_generation_mapping: mapping, openclaw_generation_prompt: 'original instruction' } };
  const context = { project: state.project, projectSlug: 'wiki-test', instance: 'instance', userId: 'u1', profile: { owner_name: 'Owner', avatar_name: 'Avatar' } };
  context.supabase = { from(table) {
    let patch; let inserted; const filters = {};
    const query = {
      select() { return this; }, update(data) { patch = data; return this; }, insert(data) { inserted = data; return this; }, eq(key, value) { filters[key] = value; return this; }, order() { return this; }, limit() { return this; },
      async maybeSingle() {
        if (table === 'projects') return { data: state.project, error: null };
        if (inserted) state.job = { ...inserted, id: 'new-job' };
        if (patch) {
          if (filters.status && state.job.status !== filters.status) return { data: null, error: null };
          Object.assign(state.job, patch);
        }
        return { data: state.job, error: null };
      },
      single() { return this.maybeSingle(); },
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

test('initial fallback with a saved source can be retried without a previous ingest job', async () => {
  const { context, state } = fixture(null, 'openclaw-llm-wiki-fallback-scaffold');
  const getRoute = compile('app/api/wiki/ingest/route.ts', {
    'next/server': nextServer, '@/lib/openclaw': {}, '@/lib/wiki-server': { getWikiContext: async () => context }, '@/lib/wiki-attachments': {}
  });
  const status = await getRoute.GET({ url: 'https://example.test/?projectId=p1' });
  assert.equal(status.body.canRetry, true);
  assert.equal(status.body.needsRetry, true);
  let retryInput;
  const backfill = compile('app/api/wiki/ingest/backfill/route.ts', {
    'next/server': nextServer, '@/lib/wiki-server': { getWikiContext: async () => context },
    '@/lib/openclaw': { backfillOpenClawWikiIngest: async input => { retryInput = input; return { mapping: 'wiki-ingest-backfill', task: input.prompt, output: 'done' }; }, readOpenClawWikiTree: async () => [] }
  });
  const result = await backfill.POST({ json: async () => ({ projectId: 'p1' }) });
  assert.equal(result.status, 200);
  assert.equal(retryInput.sourceNamespace, 'raw/sources');
  assert.equal(retryInput.prompt, 'project context');
  assert.equal(state.job.status, 'ready');
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

test('patched wiki commands do not let Claude consume the SSH script', () => {
  const { spawnSync } = require('node:child_process');
  const patch = fs.readFileSync(path.resolve(__dirname, '../scripts/clawmacdo-wiki-stdin.patch'), 'utf8');
  const commands = patch.split('\n').filter(line => line.startsWith('+  ') && line.includes('claude -p ')).map(line => line.slice(1).trim());
  assert.equal(commands.length, 4);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-stdin-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'claude'), '#!/bin/sh\ncat >/dev/null\n', { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'timeout'), '#!/bin/sh\nshift\nexec "$@"\n', { mode: 0o755 });
    for (const command of commands) {
      const run = line => spawnSync('/bin/bash', ['-se'], {
        input: `PROMPT_FILE=/dev/null\nLOG_FILE=/dev/null\n${line.replace('__TIMEOUT__', '2')}\nprintf "command-finished\\n"\n`,
        encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, timeout: 5000
      });
      const fixed = run(command);
      assert.equal(fixed.status, 0, fixed.stderr);
      assert.equal(fixed.stdout, 'command-finished\n');
      const broken = run(command.replace(' </dev/null', ''));
      assert.equal(broken.stdout, '', 'the test must reproduce the unpatched stdin failure');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
