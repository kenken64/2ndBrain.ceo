const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { NextRequest, NextResponse } = require('next/server');

function compile(file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', file), instance = new Module(filename, module);
  instance.filename = filename; instance.paths = module.paths;
  const original = Module._load;
  try {
    Module._load = function(request, ...args) { return Object.hasOwn(mocks, request) ? mocks[request] : original.call(this, request, ...args); };
    instance._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
  } finally { Module._load = original; }
  return instance.exports;
}
const policy = compile('lib/rate-limit-policy.ts');
const redis = compile('lib/redis-connection.ts', { 'server-only': {} });
function limiter(connection = { getRedisUrlFrom: () => null }) { return compile('lib/request-rate-limit.ts', { 'server-only': {}, '@/lib/rate-limit-policy': policy, '@/lib/redis-connection': connection }); }
const req = (url, method = 'POST', ip = '203.0.113.5') => new Request('https://example.test'+url, { method, headers: { 'x-real-ip': ip } });
function environment(values) {
  const prior = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) { if (value == null) delete process.env[key]; else process.env[key] = value; }
  return () => { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
}

test('auth attempts are scoped by trusted IP, expire and cannot be bypassed with another forwarded header', async () => {
  const restore = environment({ RATE_LIMIT_TRUSTED_IP_HEADER: 'x-real-ip' });
  const originalNow = Date.now; let now = originalNow(); Date.now = () => now;
  try {
    const api = limiter();
    for (let i=0;i<5;i++) assert.equal(await api.rateLimitRequest(req('/api/auth/password')), null);
    const blocked = await api.rateLimitRequest(req('/api/auth/password'));
    assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '900'); assert.match(blocked.headers.get('cache-control'), /no-store/);
    assert.equal(await api.rateLimitRequest(req('/api/auth/password', 'POST', '203.0.113.6')), null);
    const spoof = req('/api/auth/password'); spoof.headers.set('x-forwarded-for', '1.1.1.1');
    assert.equal((await api.rateLimitRequest(spoof)).status, 429);
    now += 15*60000; assert.equal(await api.rateLimitRequest(req('/api/auth/password')), null);
    const peerRestore = environment({ RATE_LIMIT_TRUSTED_IP_HEADER: null, RAILWAY_ENVIRONMENT_ID: null, RAILWAY_SERVICE_ID: null, AICUBER_CUSTOM_SERVER: null });
    try { assert.equal(api.requestClientIp(req('/api/auth/password')), 'unknown'); } finally { peerRestore(); }
  } finally { Date.now = originalNow; restore(); }
});

test('billing writes cannot exhaust polling or another account and machine callbacks are exempt', async () => {
  const api = limiter();
  for (let i=0;i<20;i++) assert.equal(await api.rateLimitRequest(req('/api/billing/lemon/checkout'), 'u1'), null);
  assert.equal((await api.rateLimitRequest(req('/api/billing/lemon/checkout'), 'u1')).status, 429);
  assert.equal(await api.rateLimitRequest(req('/api/billing/lemon/status', 'GET'), 'u1'), null);
  assert.equal(await api.rateLimitRequest(req('/api/chat/generate-video', 'PATCH'), 'u1'), null);
  assert.equal(await api.rateLimitRequest(req('/api/billing/lemon/checkout'), 'u2'), null);
  for (const url of ['/api/billing/lemon/webhook','/api/internal/reap-instances','/api/marketplace/launch-session/verify','/api/marketplace/renewals','/api/integrations/zoom/callback','/api/health','/watch']) {
    assert.equal(policy.requestRateLimit(url, 'POST', false), null);
  }
  assert.equal(policy.requestRateLimit('/api/chat', 'POST', true).limit, 500);
  assert.equal(policy.requestRateLimit('/auth/login', 'HEAD', false).limit, 5);
  assert.equal(policy.requestRateLimit('/api/%61uth/password', 'POST', false).limit, 5);
  assert.equal(policy.requestRateLimit('/api/admin/users', 'POST', true).limit, 500);
  assert.equal(policy.requestRateLimit('/api/admin/users', 'POST', true, true).limit, 10000);
  for (let i=0;i<51;i++) assert.equal(await api.rateLimitRequest(req('/api/chat'), 'chat-user'), null);
});

test('Redis failure falls back to local limits without resetting the local allowance', async () => {
  let calls=0;
  const api = limiter({ getRedisUrlFrom: () => 'redis://unused', withRedis: async () => { calls++; throw Error('offline'); } });
  const setting = { name: 'outage', limit: 2, windowMs: 60000 };
  assert.equal((await api.consumeRateLimit(setting, 'u1')).count, 1);
  assert.equal((await api.consumeRateLimit(setting, 'u1')).count, 2);
  assert.equal((await api.consumeRateLimit(setting, 'u1')).count, 3);
  assert.equal(calls, 1);
});

test('proxy throttles before auth and preserves refreshed cookies for authenticated rejections', async () => {
  let sessionCalls=0, checked=[], blocked=true, user='u1';
  const { proxy } = compile('proxy.ts', {
    '@/lib/env': { getSupabaseEnv: () => ({}) }, '@/lib/url': { appUrl: (url, request) => new URL(url, request.url) },
    '@/lib/request-rate-limit': { rateLimitRequest: async (_req, id) => { checked.push(id); return blocked ? NextResponse.json({ error: 'limited' }, { status: 429 }) : null; } },
    '@/lib/supabase/proxy': { updateSession: async (_req, options) => { sessionCalls++; const response=NextResponse.next(); response.cookies.set('refreshed','yes'); return user ? options.onAuthenticated({ userId:user, email:null, response, supabase:{} }) : response; } }
  });
  assert.equal((await proxy(new NextRequest('https://example.test/api/auth/password', { method:'POST' }))).status,429); assert.equal(sessionCalls,0);
  const result=await proxy(new NextRequest('https://example.test/api/chat', { method:'POST' }));
  assert.equal(result.status,429); assert.equal(result.cookies.get('refreshed').value,'yes'); assert.deepEqual(checked,[undefined,'u1']);
  user=null; checked=[]; await proxy(new NextRequest('https://example.test/api/chat', { method:'POST' })); assert.deepEqual(checked,[undefined]);
});

test('security headers enforce basic protections and stage CSP without blocking integrations', () => {
  const restore=environment({ NODE_ENV:'production', NEXT_PUBLIC_SUPABASE_URL:'https://custom-supabase.example.test', NEXT_PUBLIC_AVATURN_URL:'https://custom.avaturn.dev' });
  try {
    const { securityHeaders }=compile('lib/security-headers.ts');
    const headers=Object.fromEntries(securityHeaders().map(item=>[item.key,item.value]));
    assert.equal(headers['X-Content-Type-Options'],'nosniff'); assert.equal(headers['X-Frame-Options'],'SAMEORIGIN'); assert.equal(headers['X-XSS-Protection'],'0');
    assert.equal(headers['Strict-Transport-Security'],'max-age=31536000'); assert.equal(headers['Content-Security-Policy'],undefined);
    const csp=headers['Content-Security-Policy-Report-Only'];
    for (const allowed of ['https://app.lemonsqueezy.com','https://custom-supabase.example.test','wss://custom-supabase.example.test','https://custom.avaturn.dev','https://d2ol7oe51mr4n9.cloudfront.net',"worker-src 'self' blob:"]) assert.ok(csp.includes(allowed));
    assert.ok(!csp.includes("'unsafe-eval'")); assert.ok(csp.includes('report-uri /api/security/csp-report'));
  } finally { restore(); }
});

test('CSP reports are size limited and do not log URLs containing secrets or content', async () => {
  const { POST }=compile('app/api/security/csp-report/route.ts');
  const original=console.warn, logs=[]; console.warn=(...args)=>logs.push(args);
  try {
    const report={ 'csp-report': { 'effective-directive':'script-src-elem','blocked-uri':'https://widget.test/private?secret=private-key','document-uri':'https://example.test/auth/callback?code=private-code','script-sample':'private-content' } };
    assert.equal((await POST(new Request('https://example.test/api/security/csp-report',{method:'POST',body:JSON.stringify(report)}))).status,204);
    assert.ok(JSON.stringify(logs).includes('https://widget.test')); assert.doesNotMatch(JSON.stringify(logs),/private|secret/);
    assert.equal((await POST(new Request('https://example.test/api/security/csp-report',{method:'POST',body:'a'.repeat(17000)}))).status,413);
    assert.equal((await POST(new Request('https://example.test/api/security/csp-report',{method:'POST',body:'{}'}))).status,400);
  } finally { console.warn=original; }
});

test('Redis counters remain atomic across limiter instances and commands time out', async t => {
  if (spawnSync('redis-server',['--version']).error?.code === 'ENOENT') { t.skip('Install redis-server to run the Redis integration check.'); return; }
  const probe=net.createServer(); await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve)); const port=probe.address().port; await new Promise(resolve=>probe.close(resolve));
  const process=spawn('redis-server',['--bind','127.0.0.1','--port',String(port),'--save','','--appendonly','no'],{stdio:['ignore','pipe','pipe']});
  let output='';
  try {
    await new Promise((resolve,reject)=>{ const timeout=setTimeout(()=>reject(Error('Redis startup timed out')),5000); process.once('error',reject); process.once('exit',code=>{clearTimeout(timeout);reject(Error(`Redis exited ${code}`));}); process.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('Ready to accept connections')){clearTimeout(timeout);resolve();}}); });
    const restore=environment({ RATE_LIMIT_REDIS_URL:`redis://127.0.0.1:${port}/0` });
    try {
      const one=limiter(redis),two=limiter(redis),settings={name:'atomic-test',limit:5,windowMs:1000};
      const results=await Promise.all(Array.from({length:20},(_,i)=>(i%2?one:two).consumeRateLimit(settings,'one-user')));
      assert.deepEqual(results.map(x=>x.count).sort((a,b)=>a-b),Array.from({length:20},(_,i)=>i+1));
      assert.ok(results.every(x=>x.ttl>0 && x.ttl<=1000));
    } finally { restore(); }
  } finally { if (process.exitCode === null && process.signalCode === null) { process.kill('SIGTERM'); await new Promise(resolve=>process.once('exit',resolve)); } }
  const sockets=[]; const silent=net.createServer(socket=>sockets.push(socket)); await new Promise(resolve=>silent.listen(0,'127.0.0.1',resolve));
  const client=await redis.connectRedis(new URL(`redis://127.0.0.1:${silent.address().port}`),{timeoutMs:25});
  try { await assert.rejects(client.command(['PING']),/redis_command_timeout/); } finally { await client.close(); sockets.forEach(socket=>socket.destroy()); await new Promise(resolve=>silent.close(resolve)); }
});
