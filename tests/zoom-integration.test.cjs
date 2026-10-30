const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { createHmac, randomBytes } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
function compile(file,replacements){
  const filename=path.resolve(__dirname,'..',file),instance=new Module(filename,module);instance.filename=filename;instance.paths=module.paths;
  const old=Module._load;
  Module._load=function(request){return request in replacements?replacements[request]:old.apply(this,arguments);};
  try{instance._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);return instance.exports;}finally{Module._load=old;}
}
const alice='00000000-0000-0000-0000-000000000001',bob='00000000-0000-0000-0000-000000000002',install='00000000-0000-0000-0000-000000000003';
const origin='https://brain.test';

test('central Zoom connection preserves primary identity, isolates tokens and enforces marketplace access',async()=>{
  const db=new PGlite();const originalFetch=global.fetch,previousKey=process.env.ZOOM_INTEGRATION_KEY,previousSecret=process.env.MEETING_MINUTES_SESSION_SECRET;
  process.env.ZOOM_INTEGRATION_KEY=randomBytes(32).toString('base64url');process.env.MEETING_MINUTES_SESSION_SECRET='s'.repeat(32);
  const calls=[];let authId=alice,asAdmin=true,linked=false,exchangeId=alice,primaryWrites=0,active=true,duringLink=null,profileAllowed=true,zoomProfile={id:'zoom-alice',email:'zoom@example.test',display_name:'Zoom Alice'};
  try{
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); create table profiles(id uuid primary key,email text,admin_disabled boolean default false,admin_deleted_at timestamptz,marketplace_launch_revoked_at timestamptz); create table marketplace_installs(id uuid primary key,user_id uuid,item_id text,status text);`);
    await db.exec(fs.readFileSync(path.resolve(__dirname,'../supabase/migrations/0038_zoom_connections.sql'),'utf8'));
    await db.exec(fs.readFileSync(path.resolve(__dirname,'../supabase/migrations/0039_zoom_provider_safe_updates.sql'),'utf8'));
    await db.query('insert into auth.users values ($1),($2)',[alice,bob]);
    await db.query("insert into profiles(id,email) values ($1,'primary@example.test'),($2,'bob@example.test')",[alice,bob]);
    await db.query("insert into marketplace_installs values ($1,$2,'meeting-minutes','installed')",[install,alice]);
    function from(table){
      let fields='*',filters=[],values=[],updates=null,head=false,wantsRows=false;
      const q={select(names='*',options={}){fields=names;head=!!options.head;if(updates)wantsRows=true;return q;},eq(name,value){values.push(value);filters.push(`"${name}"=$${values.length}`);return q;},update(data){updates=data;return q;},async maybeSingle(){const r=await execute();return {...r,data:r.data?.[0]||null};},then(resolve,reject){return execute().then(resolve,reject);}};
      async function execute(){try{
        const where=filters.length?' where '+filters.join(' and '):'';
        if(updates){const offset=values.length;const names=Object.keys(updates);const result=await db.query(`update ${table} set `+names.map((n,i)=>`"${n}"=$${offset+i+1}`).join(',')+where+(wantsRows?' returning '+fields:''),[...values,...Object.values(updates)]);return {data:result.rows,error:null};}
        const result=await db.query(`select ${head?'count(*) as n':fields} from ${table}${where}`,values);return {data:result.rows,error:null,count:head?Number(result.rows[0].n):undefined};
      }catch(error){return {data:null,error};}}
      return q;
    }
    const admin={from,async rpc(name,args){try{
      const keys=Object.keys(args),result=await db.query(`select * from ${name}(`+keys.map((k,i)=>`${k} => $${i+1}`).join(',')+')',Object.values(args));
      return {data:['zoom_save_provider','zoom_store_tokens','zoom_begin_link','zoom_disconnect'].includes(name)?result.rows[0]?.[name]:result.rows,error:null};
    }catch(error){return {data:null,error};}}};
    const replacements={
      'server-only':{},
      '@/lib/supabase/admin':{createAdminClient:()=>admin},
      '@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:authId?{id:authId,email:'primary@example.test',identities:linked?[{provider:'zoom'}]:[]}:null}}),getSession:async()=>({data:{session:{user:{id:authId},access_token:'primary-access',refresh_token:'primary-refresh',expires_at:9999999999}}}),setSession:()=>{primaryWrites++;throw Error('must not overwrite primary');},signInWithOAuth:()=>{primaryWrites++;throw Error('must not overwrite primary');},exchangeCodeForSession:()=>{primaryWrites++;throw Error('must not overwrite primary');}}})},
      '@/lib/admin':{isAdminUser:async()=>asAdmin,getAdminAccess:async()=>asAdmin?{ok:true,userId:authId}:{ok:false,status:403,message:'Admin access required.',reason:'admin_forbidden'}},
      '@/lib/url':{getRequestOrigin:()=>origin},
      '@/lib/workflow-launch':{workflowLaunchConfigByToolId:id=>id==='meeting-minutes'?{itemId:'meeting-minutes'}:null},
      '@/lib/zoom-provider-auth':{zoomProviderClient:(_session,verifier)=>({verifier:()=>verifier||'fixture-pkce',client:{auth:{linkIdentity:async()=>{if(duringLink)await duringLink();return {data:{url:'https://supabase.test/link'}};},signInWithOAuth:async()=>{if(duringLink)await duringLink();return {data:{url:'https://supabase.test/reauthorize'}};},exchangeCodeForSession:async()=>({data:{user:{id:exchangeId,identities:[{provider:'zoom'}]},session:{provider_token:'zoom-access',provider_refresh_token:'zoom-refresh'}}})}}})},
    };
    const crypto=compile('lib/zoom-crypto.ts',replacements);replacements['@/lib/zoom-crypto']=crypto;
    replacements['@/lib/marketplace-session-access']=compile('lib/marketplace-session-access.ts',replacements);
    const {handleZoomIntegration:handle}=compile('lib/zoom-integration.ts',replacements);
    global.fetch=async(url,options)=>{calls.push({url:String(url),options});if(String(url).includes('/oauth/token'))return Response.json({access_token:'fresh-access',refresh_token:'fresh-refresh',expires_in:3600});if(String(url).endsWith('/users/me')&&!profileAllowed)return Response.json({}, {status:403});if(String(url).endsWith('/users/me'))return Response.json(zoomProfile);if(String(url).includes('/users/me/meetings'))return Response.json({meetings:[{id:1,uuid:'one',topic:'Review',start_url:'never-expose-this'}]});throw Error('Unexpected external call: '+url);};
    const req=(action,body,headers={},method=body===undefined?'GET':'POST')=>handle(new Request(origin+'/api/integrations/zoom/'+action,{method,headers:{Origin:origin,'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),action.split('?')[0]);
    assert.equal((await req('provider',{clientId:'app-id',clientSecret:'app-secret'})).status,200);
    const stored=(await db.query('select credentials_cipher from zoom_provider_settings')).rows[0];assert.ok(!stored.credentials_cipher.includes('app-secret'));
    asAdmin=false;assert.equal((await req('provider',{clientId:'other',clientSecret:'other'})).status,403);asAdmin=true;
    assert.equal((await req('connect',{}, {Origin:'https://evil.test'})).status,403);
    async function begin(){const r=await req('connect',{});assert.equal(r.status,303);assert.equal(r.headers.get('location'),linked?'https://supabase.test/reauthorize':'https://supabase.test/link');const a=(await db.query('select id from zoom_link_attempts')).rows[0];return {id:a.id,cookie:r.headers.get('set-cookie').split(';')[0]};}
    const a=await begin();
    authId=bob;let foreign=await req(`callback?attempt=${a.id}&code=wrong-session`,undefined,{Cookie:a.cookie});assert.match(foreign.headers.get('location'),/authorization_declined/);authId=alice;
    exchangeId=bob;let r=await req(`callback?attempt=${a.id}&code=wrong`,undefined,{Cookie:a.cookie});assert.match(r.headers.get('location'),/identity_mismatch/);assert.ok(!r.headers.get('set-cookie').includes('sb-'));assert.equal((await db.query('select token_cipher from zoom_accounts')).rows[0].token_cipher,null);
    exchangeId=alice;profileAllowed=false;const denied=await begin();assert.match((await req(`callback?attempt=${denied.id}&code=denied`,undefined,{Cookie:denied.cookie})).headers.get('location'),/zoom_access_denied/);profileAllowed=true;
    exchangeId=alice;const b=await begin();r=await req(`callback?attempt=${b.id}&code=good`,undefined,{Cookie:b.cookie});assert.match(r.headers.get('location'),/zoom=connected/);assert.ok(!r.headers.get('set-cookie').includes('sb-'));
    assert.equal(primaryWrites,0);assert.equal((await db.query('select email from profiles where id=$1',[alice])).rows[0].email,'primary@example.test');
    assert.equal((await db.query('select count(*) as n from auth.users')).rows[0].n,2);
    r=await req(`callback?attempt=${b.id}&code=replay`,undefined,{Cookie:b.cookie});assert.match(r.headers.get('location'),/authorization_declined/);
    const account=(await db.query('select * from zoom_accounts')).rows[0];assert.ok(!account.token_cipher.includes('zoom-access'));
    assert.equal((await crypto.unsealZoom(account.token_cipher,'zoom-account:'+alice)).refresh_token,'zoom-refresh');await assert.rejects(crypto.unsealZoom(account.token_cipher,'zoom-account:'+bob));
    const now=Math.floor(Date.now()/1000),claims={iss:'2ndBrain.ceo',tool_id:'meeting-minutes',user_id:alice,install_id:install,iat:now-10,exp:now+300};
    const token=c=>{const data=Buffer.from(JSON.stringify(c)).toString('base64url');return data+'.'+createHmac('sha256',process.env.MEETING_MINUTES_SESSION_SECRET).update(data).digest('base64url');};
    const delegate=(body,c=claims)=>req('delegate',body,{Authorization:'Bearer '+token(c)});
    assert.equal((await req('delegate',{operation:'status'},{Authorization:'Bearer '+token(claims)+'x'})).status,401);
    const status=await (await delegate({operation:'status'})).json();assert.equal(status.connected,true);assert.ok(status.connectionId);assert.ok(status.workspaceKey);
    r=await delegate({operation:'meetings',connectionId:status.connectionId});assert.equal(r.status,200);assert.ok(!JSON.stringify(await r.json()).includes('never-expose-this'));
    r=await delegate({operation:'meetings',connectionId:'another-user'});assert.equal(r.status,409);
    assert.equal((await delegate({operation:'arbitrary-url',url:'https://evil.test'})).status,403);
    assert.equal((await delegate({operation:'status'},{...claims,tool_id:'other'})).status,401);
    assert.equal((await delegate({operation:'status'},{...claims,exp:now-1})).status,401);
    await db.query('update profiles set marketplace_launch_revoked_at=now() where id=$1',[alice]);assert.equal((await delegate({operation:'status'})).status,403);await db.query('update profiles set marketplace_launch_revoked_at=null,admin_disabled=true where id=$1',[alice]);assert.equal((await delegate({operation:'status'})).status,403);await db.query('update profiles set admin_disabled=false where id=$1',[alice]);
    await db.query("update marketplace_installs set status='uninstalled' where id=$1",[install]);assert.equal((await delegate({operation:'status'})).status,403);await db.query("update marketplace_installs set status='installed' where id=$1",[install]);
    await db.query("update zoom_accounts set expires_at=now()-interval '1 minute'");
    const concurrent=await Promise.all([delegate({operation:'meetings',connectionId:status.connectionId}),delegate({operation:'meetings',connectionId:status.connectionId})]);assert.ok(concurrent.some(r=>r.status===200));assert.ok(concurrent.every(r=>[200,409].includes(r.status)));assert.equal(calls.filter(x=>x.url.includes('/oauth/token')).length,1);
    const refreshed=(await db.query('select token_cipher from zoom_accounts')).rows[0];assert.equal((await crypto.unsealZoom(refreshed.token_cipher,'zoom-account:'+alice)).refresh_token,'fresh-refresh');
    linked=true;
    const beforeSwitch=(await db.query('select token_cipher from zoom_accounts where user_id=$1',[alice])).rows[0].token_cipher;
    const linkedStatus=await (await req('status')).json();assert.equal(linkedStatus.hasLinkedZoomIdentity,true);assert.equal(linkedStatus.connected,true);
    r=await req('connect?mode=link-new',{});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'https://supabase.test/link');
    const newAttempt=(await db.query('select id from zoom_link_attempts')).rows[0];const newCookie=r.headers.get('set-cookie').split(';')[0];
    assert.equal((await db.query('select token_cipher from zoom_accounts where user_id=$1',[alice])).rows[0].token_cipher,beforeSwitch,'existing Zoom connection remains until successful authorization');
    zoomProfile={id:'zoom-nus',email:'new@example.edu',display_name:'New Zoom Account'};
    r=await req(`callback?attempt=${newAttempt.id}&code=good`,undefined,{Cookie:newCookie});assert.match(r.headers.get('location'),/zoom=connected/);
    const switched=(await db.query('select user_id,email,zoom_user_id from zoom_accounts where user_id=$1',[alice])).rows[0];
    assert.equal(switched.user_id,alice);assert.equal(switched.email,'new@example.edu');assert.equal(switched.zoom_user_id,'zoom-nus');
    assert.equal(primaryWrites,0);assert.equal((await db.query('select email from profiles where id=$1',[alice])).rows[0].email,'primary@example.test');
    const pending=await begin();assert.equal((await req('disconnect',{})).status,200);
    r=await req(`callback?attempt=${pending.id}&code=old`,undefined,{Cookie:pending.cookie});assert.match(r.headers.get('location'),/authorization_declined/);
    assert.equal((await (await delegate({operation:'status'})).json()).connected,false);
    const changed=await admin.rpc('zoom_store_tokens',{p_user_id:alice,p_generation:account.generation,p_provider_revision:account.provider_revision,p_cipher:account.token_cipher,p_zoom_id:'old',p_name:'old',p_email:'old',p_expires_at:new Date(Date.now()+3600000).toISOString(),p_scopes:'read'});assert.equal(changed.data,false);
    // Sensitive tables and RPCs are service-only; normal app users cannot read provider tokens.
    await db.exec('set role authenticated');await assert.rejects(db.query('select * from zoom_accounts'),/permission denied/);await assert.rejects(db.query('select zoom_disconnect($1)',[alice]),/permission denied/);await db.exec('reset role');
    duringLink=async()=>{await admin.rpc('zoom_disconnect',{p_user_id:alice});};assert.equal((await req('connect',{})).status,409);duringLink=null;
    authId=null;assert.equal((await req('status')).status,401);assert.equal(primaryWrites,0);
  }finally{global.fetch=originalFetch;if(previousKey===undefined)delete process.env.ZOOM_INTEGRATION_KEY;else process.env.ZOOM_INTEGRATION_KEY=previousKey;if(previousSecret===undefined)delete process.env.MEETING_MINUTES_SESSION_SECRET;else process.env.MEETING_MINUTES_SESSION_SECRET=previousSecret;await db.close();}
});

test('Supabase Zoom client uses separate memory storage and cannot refresh/replace the primary session',()=>{
  let options;
  const {zoomProviderClient}=compile('lib/zoom-provider-auth.ts',{'server-only':{},'@/lib/env':{getSupabaseEnv:()=>({supabaseUrl:'https://project.supabase.test',supabasePublishableKey:'public-fixture'})},'@supabase/supabase-js':{createClient:(_url,_key,input)=>{options=input;return {auth:{}};}}});
  zoomProviderClient({access_token:'primary-access',refresh_token:'must-not-be-reused',expires_at:0,user:{id:alice}});
  assert.equal(options.auth.storageKey,'2ndbrain-zoom-connection');assert.equal(options.auth.autoRefreshToken,false);assert.equal(options.auth.detectSessionInUrl,false);
  const saved=JSON.parse(options.auth.storage.getItem(options.auth.storageKey));assert.equal(saved.refresh_token,'');assert.equal(saved.user.id,alice);assert.ok(!JSON.stringify(saved).includes('must-not-be-reused'));
  options.auth.storage.setItem(options.auth.storageKey+'-code-verifier','isolated-pkce');
  assert.equal(options.auth.storage.getItem('sb-project-auth-token-code-verifier'),null);
});

test('Zoom OAuth codes use the connection callback while normal login routing stays intact',async()=>{
  let primarySessionChecks=0;
  const {NextRequest}=require('next/server');
  const {proxy}=compile('proxy.ts',{'@/lib/env':{getSupabaseEnv:()=>({supabaseUrl:'https://project.supabase.test'})},'@/lib/url':{appUrl:(path,request)=>new URL(path,request.url)},'@/lib/supabase/proxy':{updateSession:async()=>{primarySessionChecks++;return new Response('original session');}}});
  for(const target of ['/api/integrations/zoom/callback?code=zoom','/auth/callback?code=primary','/api/openclaw/gws-auth/callback?code=google']) {
    const r=await proxy(new NextRequest(origin+target));assert.equal(r.headers.get('x-middleware-next'),'1');assert.equal(r.headers.get('location'),null);
  }
  const r=await proxy(new NextRequest(origin+'/dashboard?code=primary'));
  assert.equal(new URL(r.headers.get('location')).pathname,'/auth/callback');
  assert.equal(await (await proxy(new NextRequest(origin+'/dashboard'))).text(),'original session');assert.equal(primarySessionChecks,1);
});

test('generated encryption key persists, uses private permissions, and is never replaced over existing data',async()=>{
  const os=require('node:os');const directory=fs.mkdtempSync(path.join(os.tmpdir(),'brain-zoom-key-'));
  const oldKey=process.env.ZOOM_INTEGRATION_KEY,oldRoot=process.env.INTEGRATIONS_STORAGE_ROOT;
  delete process.env.ZOOM_INTEGRATION_KEY;process.env.INTEGRATIONS_STORAGE_ROOT=directory;
  let count=0;
  const replacements={'server-only':{},'@/lib/supabase/admin':{createAdminClient:()=>({from:()=>({select:async()=>({count,error:null})})})}};
  try{
    const crypto=compile('lib/zoom-crypto.ts',replacements),keyPath=path.join(directory,'zoom-token.key');
    const encrypted=await crypto.sealZoom({token:'private'},'alice');const first=fs.readFileSync(keyPath,'utf8');assert.equal(fs.statSync(keyPath).mode&0o777,0o600);
    const reopened=compile('lib/zoom-crypto.ts',replacements);assert.deepEqual(await reopened.unsealZoom(encrypted,'alice'),{token:'private'});assert.equal(fs.readFileSync(keyPath,'utf8'),first);
    count=1;fs.unlinkSync(keyPath);await assert.rejects(reopened.unsealZoom(encrypted,'alice'),/zoom_key_missing/);assert.equal(fs.existsSync(keyPath),false);
    fs.writeFileSync(keyPath,'broken');await assert.rejects(reopened.zoomKey(),/zoom_key_invalid/);assert.equal(fs.readFileSync(keyPath,'utf8'),'broken');
  }finally{if(oldKey===undefined)delete process.env.ZOOM_INTEGRATION_KEY;else process.env.ZOOM_INTEGRATION_KEY=oldKey;if(oldRoot===undefined)delete process.env.INTEGRATIONS_STORAGE_ROOT;else process.env.INTEGRATIONS_STORAGE_ROOT=oldRoot;fs.rmSync(directory,{recursive:true,force:true});}
});
