import "server-only";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isAdminUser, getAdminAccess } from "@/lib/admin";
import { getRequestOrigin } from "@/lib/url";
import { checkMarketplaceLaunchAccess } from "@/lib/marketplace-session-access";
import { zoomProviderClient } from "@/lib/zoom-provider-auth";
import { sealZoom, unsealZoom } from "@/lib/zoom-crypto";

type Credentials = { clientId: string; clientSecret: string; webhookSecret: string };
type Tokens = { access_token: string; refresh_token: string };
type Account = { id:string; user_id:string; generation:string; zoom_user_id:string; display_name:string; email:string; token_cipher:string|null; expires_at:string; scopes:string; provider_revision:string; refresh_owner:string|null };
const scopes = 'user:read:user meeting:read:list_meetings meeting:read:list_upcoming_meetings cloud_recording:read:list_user_recordings cloud_recording:read:list_recording_files';
const PRIVATE = { 'Cache-Control':'private, no-store', 'Referrer-Policy':'no-referrer', 'X-Content-Type-Options':'nosniff' };
const COOKIE = '__Host-2ndbrain-zoom-link';
export class ZoomIntegrationError extends Error { constructor(message:string, public status=400, public code='invalid_request', public retryAfter=0, public rateLimitType='') { super(message); } }
const response = (data:unknown,status=200) => Response.json(data,{status,headers:PRIVATE});
const hash = (value:string) => createHash('sha256').update(value).digest('base64url');
const admin = () => createAdminClient();
function checked<T>(result:{data:T;error:any}):T { if(result.error?.message?.includes('zoom_settings_conflict')) throw new ZoomIntegrationError('Zoom settings changed. Refresh and try again.',409,'settings_changed'); if(result.error) throw new ZoomIntegrationError('Zoom connection storage is unavailable. Apply the Zoom database migration and check its configuration.',503,'storage_unavailable'); return result.data; }
async function provider() { return checked(await admin().from('zoom_provider_settings').select('*').eq('id',true).maybeSingle()); }
async function account(userId:string):Promise<Account|null> { return checked(await admin().from('zoom_accounts').select('*').eq('user_id',userId).maybeSingle()); }
async function credentials(row:any):Promise<Credentials> { return unsealZoom(row.credentials_cipher,'zoom-provider'); }
async function boundedText(request:Request,max=8192) {
  const reader=request.body?.getReader(); if(!reader) throw new ZoomIntegrationError('Missing request body.');
  let size=0,text=''; const decoder=new TextDecoder();
  try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new ZoomIntegrationError('Request is too large.',413);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode(); }finally{reader.releaseLock();}
  return text;
}
async function readJson(request:Request,max=8192):Promise<any> {
  if(!request.headers.get('Content-Type')?.includes('application/json')) throw new ZoomIntegrationError('Expected JSON.',415);
  const text=await boundedText(request,max);
  try { const value=JSON.parse(text); if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value; }catch{throw new ZoomIntegrationError('Invalid JSON.');}
}
function sameOrigin(request:Request) { if(request.headers.get('Origin')!==getRequestOrigin(request)) throw new ZoomIntegrationError('Use your 2ndBrain workspace to change Zoom connections.',403,'invalid_origin'); }
async function currentUser() {
  const client=await createClient(); const {data,error}=await client.auth.getUser();
  if(error||!data.user)throw new ZoomIntegrationError('Sign in to 2ndBrain first.',401,'sign_in_required');
  const profile=checked(await admin().from('profiles').select('admin_disabled,admin_deleted_at').eq('id',data.user.id).maybeSingle());
  if(!profile||profile.admin_disabled||profile.admin_deleted_at)throw new ZoomIntegrationError('Account access is disabled.',403);
  return {client,user:data.user};
}
const redirect=(request:Request,status:string)=>new Response(null,{status:303,headers:{...PRIVATE,Location:new URL('/dashboard/settings?tab=integrations&zoom='+status,getRequestOrigin(request)).href,'Set-Cookie':`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`}});
async function timed(url:string,options:RequestInit={}) { return fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(20000),cache:'no-store'}); }
async function providerFailure(r:Response):Promise<never> {
  if(r.status===429){const raw=r.headers.get('Retry-After')||'';const n=/^\d+$/.test(raw)?Number(raw):Math.ceil((Date.parse(raw)-Date.now())/1000);const daily=r.headers.get('X-RateLimit-Type')?.toLowerCase()==='daily-limit';throw new ZoomIntegrationError(daily?'Zoom’s daily API quota is exhausted.':'Zoom rate limit reached.',429,'rate_limited',Number.isFinite(n)?Math.max(1,n):daily?0:60,daily?'daily':'qps');}
  if(r.status===401)throw new ZoomIntegrationError('Reconnect Zoom in 2ndBrain.',401,'reconnect_required');
  if(r.status===403)throw new ZoomIntegrationError('Zoom did not allow access. Check app scopes and account permissions.',403,'zoom_access_denied');
  throw new ZoomIntegrationError('Zoom could not complete the request.',502,'zoom_unavailable');
}
async function freshToken(row:Account,config:any,rejected?:string) {
  if(!row.token_cipher||row.provider_revision!==config.revision)throw new ZoomIntegrationError('Connect Zoom in 2ndBrain.',401,'reconnect_required');
  let tokens=await unsealZoom<Tokens>(row.token_cipher,'zoom-account:'+row.user_id);
  if(Date.parse(row.expires_at)>Date.now()+60000&&tokens.access_token!==rejected)return tokens.access_token;
  const lock=randomUUID(); const locked=checked(await admin().rpc('zoom_lock_refresh',{p_user_id:row.user_id,p_generation:row.generation,p_lock:lock}))?.[0] as Account|undefined;
  if(!locked)throw new ZoomIntegrationError('Zoom connection is being refreshed. Try again shortly.',409,'refresh_in_progress',2);
  try {
    tokens=await unsealZoom<Tokens>(locked.token_cipher!,'zoom-account:'+row.user_id);
    if(Date.parse(locked.expires_at)>Date.now()+60000&&tokens.access_token!==rejected)return tokens.access_token;
    const c=await credentials(config);
    const r=await timed('https://zoom.us/oauth/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(c.clientId+':'+c.clientSecret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:tokens.refresh_token})});
    if(r.status===400||r.status===401){checked(await admin().from('zoom_accounts').update({token_cipher:null}).eq('user_id',row.user_id).eq('generation',row.generation).eq('refresh_owner',lock));throw new ZoomIntegrationError('Reconnect Zoom in 2ndBrain.',401,'reconnect_required');}
    if(!r.ok)return providerFailure(r);
    const next=await r.json();if(!next.access_token||!next.refresh_token||!(next.expires_in>0))throw new ZoomIntegrationError('Zoom returned incomplete tokens.',502);
    const stored=checked(await admin().rpc('zoom_store_tokens',{p_user_id:row.user_id,p_generation:row.generation,p_provider_revision:config.revision,p_cipher:await sealZoom({access_token:next.access_token,refresh_token:next.refresh_token},'zoom-account:'+row.user_id),p_zoom_id:row.zoom_user_id,p_name:row.display_name,p_email:row.email,p_expires_at:new Date(Date.now()+next.expires_in*1000).toISOString(),p_scopes:next.scope||row.scopes,p_refresh_owner:lock}));
    if(!stored)throw new ZoomIntegrationError('Zoom connection changed. Reload and reconnect.',409,'connection_changed');
    return next.access_token as string;
  }finally{checked(await admin().from('zoom_accounts').update({refresh_owner:null,refresh_until:null}).eq('user_id',row.user_id).eq('refresh_owner',lock));}
}
function safeZoomUrl(value:unknown):string|null { try{const u=new URL(String(value));return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&['zoom.us','zoom.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h))?u.href:null;}catch{return null;} }
function meeting(m:any,recording=false){return {id:String(m.id),uuid:m.uuid||String(m.id),topic:m.topic||'Untitled Zoom meeting',startTime:m.start_time||'',duration:m.duration||0,timezone:m.timezone||'',type:m.type,kind:recording?'recording':'meeting',url:safeZoomUrl(recording?m.share_url:m.join_url),files:recording?(m.recording_files||[]).filter((f:any)=>f.recording_type==='audio_transcript'||f.file_type==='TRANSCRIPT').map((f:any)=>({id:f.id,status:f.status,type:f.recording_type||f.file_type,size:f.file_size||0})):[]};}
async function zoomApi(row:Account,config:any,path:string) {
  let token=await freshToken(row,config);let r=await timed('https://api.zoom.us/v2'+path,{headers:{Authorization:'Bearer '+token}});
  if(r.status===401){const latest=await account(row.user_id);if(!latest)throw new ZoomIntegrationError('Reconnect Zoom.',401);token=await freshToken(latest,config,token);r=await timed('https://api.zoom.us/v2'+path,{headers:{Authorization:'Bearer '+token}});}
  if(!r.ok)return providerFailure(r);return {data:await r.json(),token};
}
async function transcript(url:string,token:string) {
  let target=safeZoomUrl(url);
  for(let i=0;i<4;i++){
    if(!target)throw new ZoomIntegrationError('Unsupported recording download host. Upload the transcript manually.',422,'download_host');
    const r=await timed(target,{headers:{Authorization:'Bearer '+token}});
    if([301,302,303,307,308].includes(r.status)){target=safeZoomUrl(new URL(r.headers.get('Location')||'',target).href);continue;}
    if(!r.ok)return providerFailure(r);
    const reader=r.body?.getReader();if(!reader)throw new ZoomIntegrationError('Transcript unavailable.',422);
    let size=0,text='';const decoder=new TextDecoder();try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>5*1024*1024){await reader.cancel();throw new ZoomIntegrationError('Transcript exceeds 5 MB.',413);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
    if(!text.trim()||/<!doctype html|<html[\s>]/i.test(text.slice(0,300)))throw new ZoomIntegrationError('Transcript is not ready.',422);return text;
  }
  throw new ZoomIntegrationError('Too many transcript redirects.',502);
}

async function delegatedUser(request:Request) {
  const token=request.headers.get('Authorization')?.replace(/^Bearer\s+/i,'')||'';
  const secret=process.env.MEETING_MINUTES_SESSION_SECRET?.trim();
  if(!secret||Buffer.byteLength(secret)<32)throw new ZoomIntegrationError('Meeting Minutes delegation is not configured.',503);
  const parts=token.split('.');if(parts.length!==2)throw new ZoomIntegrationError('Invalid delegation.',401);
  const expected=createHmac('sha256',secret).update(parts[0]).digest();const actual=Buffer.from(parts[1],'base64url');
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new ZoomIntegrationError('Invalid delegation.',401);
  let c:any;try{c=JSON.parse(Buffer.from(parts[0],'base64url').toString());}catch{throw new ZoomIntegrationError('Invalid delegation.',401);}
  const now=Math.floor(Date.now()/1000);
  if(c.iss!=='2ndBrain.ceo'||c.tool_id!=='meeting-minutes'||typeof c.user_id!=='string'||typeof c.install_id!=='string'||!Number.isInteger(c.iat)||c.iat>now+30||!Number.isInteger(c.exp)||c.exp<=now||c.exp<=c.iat||c.exp-c.iat>9*3600)throw new ZoomIntegrationError('Invalid delegation.',401);
  const access=await checkMarketplaceLaunchAccess({userId:c.user_id,installId:c.install_id,toolId:c.tool_id,issuedAt:c.iat});
  if(!access.active)throw new ZoomIntegrationError('Marketplace session is no longer active.',access.status,'sign_in_required');
  return c.user_id as string;
}

export async function handleZoomIntegration(request:Request,action:string):Promise<Response> {
  try{
    if(action==='delegate'){
      if(request.method!=='POST')return response({error:'Method not allowed.'},405);
      const userId=await delegatedUser(request);const body=await readJson(request);const config=await provider();const row=await account(userId);
      if(body.operation==='status')return response({configured:!!config,connected:!!row?.token_cipher&&row.provider_revision===config?.revision,connectionId:row?row.id+':'+row.generation:null,workspaceKey:row?.token_cipher?hash(userId+':'+row.zoom_user_id):null,cacheKey:hash('cache:'+userId+(row?.token_cipher?':'+row.zoom_user_id:'')),profile:row?.token_cipher?{name:row.display_name,email:row.email}:null});
      if(!['meetings','recordings','transcript'].includes(body.operation))throw new ZoomIntegrationError('This Zoom operation is not allowed.',403);
      if(!config||!row?.token_cipher)throw new ZoomIntegrationError('Connect Zoom in 2ndBrain.',401,'reconnect_required');
      if(body.connectionId!==row.id+':'+row.generation)throw new ZoomIntegrationError('Zoom connection changed. Reload this workspace.',409,'connection_changed');
      if(body.operation==='meetings'){
        const kind=body.kind||'scheduled';if(!['scheduled','invited'].includes(kind))throw new ZoomIntegrationError('Invalid meeting list.');
        const cursor=typeof body.pageToken==='string'?body.pageToken:'';if(cursor.length>2048)throw new ZoomIntegrationError('Invalid page cursor.');
        const {data}=await zoomApi(row,config,`/users/me/${kind==='invited'?'upcoming_meetings':'meetings'}?`+new URLSearchParams({page_size:'100',next_page_token:cursor,...(kind==='scheduled'?{type:'scheduled'}:{})}));
        return response({meetings:(data.meetings||[]).map((m:any)=>meeting(m)),nextPageToken:data.next_page_token||'',total:data.total_records??null});
      }
      if(body.operation==='recordings'){
        const valid=(s:any)=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
        if(!valid(body.from)||!valid(body.to)||body.from>body.to||(Date.parse(body.to)-Date.parse(body.from))/86400000>27)throw new ZoomIntegrationError('Choose a recording window of up to 28 days.');
        const cursor=typeof body.pageToken==='string'?body.pageToken:'';if(cursor.length>2048)throw new ZoomIntegrationError('Invalid page cursor.');
        const {data}=await zoomApi(row,config,'/users/me/recordings?'+new URLSearchParams({from:body.from,to:body.to,page_size:'100',next_page_token:cursor}));
        return response({meetings:(data.meetings||[]).map((m:any)=>meeting(m,true)),nextPageToken:data.next_page_token||'',from:body.from,to:body.to,total:data.total_records??null});
      }
      if(typeof body.meetingUuid!=='string'||!body.meetingUuid||body.meetingUuid.length>256||typeof body.fileId!=='string'||body.fileId.length>256)throw new ZoomIntegrationError('Choose a transcript.');
      const once=encodeURIComponent(body.meetingUuid);const uuid=body.meetingUuid.startsWith('/')||body.meetingUuid.includes('//')?encodeURIComponent(once):once;
      const {data,token}=await zoomApi(row,config,`/meetings/${uuid}/recordings`);
      if(data.host_id!==row.zoom_user_id)throw new ZoomIntegrationError('Recording belongs to another Zoom account.',403,'recording_owner');
      const file=data.recording_files?.find((f:any)=>f.id===body.fileId&&f.status==='completed'&&(f.recording_type==='audio_transcript'||f.file_type==='TRANSCRIPT'));
      if(!file)throw new ZoomIntegrationError('Transcript unavailable.',404);
      return response({title:data.topic||'Zoom meeting',startTime:data.start_time||'',text:await transcript(file.download_url,token)});
    }
    if(action==='webhook'){
      if(request.method!=='POST')return response({error:'Method not allowed.'},405);
      const config=await provider();
      if(!config||new URL(request.url).searchParams.get('id')!==config.webhook_id)throw new ZoomIntegrationError('Webhook not found.',404);
      const c=await credentials(config);if(!c.webhookSecret)throw new ZoomIntegrationError('Webhook is not configured.',503);
      const raw=await boundedText(request,65536),timestamp=request.headers.get('x-zm-request-timestamp')||'';
      const expected='v0='+createHmac('sha256',c.webhookSecret).update(`v0:${timestamp}:${raw}`).digest('hex');
      const actual=request.headers.get('x-zm-signature')||'';
      if(!/^\d+$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>300||actual.length!==expected.length||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))throw new ZoomIntegrationError('Invalid webhook signature.',401);
      let event:any;try{event=JSON.parse(raw);}catch{throw new ZoomIntegrationError('Invalid webhook payload.');}
      if(event.event==='endpoint.url_validation'){
        const plainToken=event.payload?.plainToken;if(typeof plainToken!=='string'||plainToken.length>1024)throw new ZoomIntegrationError('Invalid validation token.');
        return response({plainToken,encryptedToken:createHmac('sha256',c.webhookSecret).update(plainToken).digest('hex')});
      }
      if(event.event==='app_deauthorized'){
        if(event.payload?.client_id!==c.clientId||typeof event.payload?.user_id!=='string')throw new ZoomIntegrationError('Invalid deauthorization event.');
        checked(await admin().from('zoom_accounts').update({token_cipher:null,generation:randomUUID(),refresh_owner:null,refresh_until:null}).eq('zoom_user_id',event.payload.user_id).eq('provider_revision',config.revision));
      }
      return response({received:true});
    }
    const {client,user}=await currentUser();
    if(action==='status'&&request.method==='GET'){
      const config=await provider(),row=await account(user.id);const canManage=await isAdminUser(user.email,user.id);
      const c=config&&canManage?await credentials(config):null;
      return response({configured:!!config,connected:!!row?.token_cipher&&row.provider_revision===config?.revision,hasLinkedZoomIdentity:!!user.identities?.some(i=>i.provider==='zoom'),profile:row?.token_cipher?{name:row.display_name,email:row.email}:null,canManageProvider:canManage,provider:canManage?{clientId:c?.clientId||'',hasClientSecret:!!c?.clientSecret,hasWebhookSecret:!!c?.webhookSecret,revision:config?.revision||'',webhookUrl:config?getRequestOrigin(request)+'/api/integrations/zoom/webhook?id='+config.webhook_id:''}:undefined});
    }
    if(action==='callback'&&request.method==='GET'){
      const url=new URL(request.url),attemptId=url.searchParams.get('attempt');
      const browser=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';
      if(!attemptId||!browser)throw new ZoomIntegrationError('Zoom connection attempt expired.',400,'invalid_state');
      const attempt=checked(await admin().rpc('zoom_consume_link',{p_id:attemptId,p_user_id:user.id,p_browser_hash:hash(browser)}))?.[0];
      if(!attempt||url.searchParams.has('error'))return redirect(request,'authorization_declined');
      const code=url.searchParams.get('code');if(!code||code.length>4096)throw new ZoomIntegrationError('Zoom did not provide a valid authorization code.');
      const verifier=await unsealZoom<string>(attempt.pkce_cipher,'zoom-link:'+attempt.id);
      const isolated=zoomProviderClient(undefined,verifier);
      const {data,error}=await isolated.client.auth.exchangeCodeForSession(code);
      // Never setSession() on the primary client and never write OAuth result cookies.
      if(error||data.user?.id!==user.id||!data.user.identities?.some(i=>i.provider==='zoom'))throw new ZoomIntegrationError('Zoom must be linked to the existing 2ndBrain user. Original login was preserved.',403,'identity_mismatch');
      const access=data.session?.provider_token,refresh=data.session?.provider_refresh_token;
      if(!access||!refresh)throw new ZoomIntegrationError('Zoom did not return API tokens. Check scopes and reconnect.',400,'provider_tokens_missing');
      const r=await timed('https://api.zoom.us/v2/users/me',{headers:{Authorization:'Bearer '+access}});if(!r.ok)await providerFailure(r);
      const profile=await r.json();
      const stored=checked(await admin().rpc('zoom_store_tokens',{p_user_id:user.id,p_generation:attempt.generation,p_provider_revision:attempt.provider_revision,p_cipher:await sealZoom({access_token:access,refresh_token:refresh},'zoom-account:'+user.id),p_zoom_id:profile.id,p_name:profile.display_name||profile.first_name||'Zoom user',p_email:profile.email||'',p_expires_at:new Date(Date.now()+50*60000).toISOString(),p_scopes:scopes}));
      if(!stored)throw new ZoomIntegrationError('Connection settings changed. Connect again.',409,'connection_changed');
      return redirect(request,'connected');
    }
    if(request.method!=='POST')return response({error:'Method not allowed.'},405);
    sameOrigin(request);
    if(action==='provider'){
      const access=await getAdminAccess();
      if(!access.ok)throw new ZoomIntegrationError(access.message,access.status,access.reason);
      if(access.userId!==user.id)throw new ZoomIntegrationError('Admin identity changed. Reload before saving.',403);
      const body=await readJson(request),config=await provider();const old=config?await credentials(config):null;
      const value=(v:any)=>typeof v==='string'&&v.length<=2048&&!/[\x00-\x1f\x7f]/.test(v)?v.trim():'';
      const next={clientId:value(body.clientId),clientSecret:value(body.clientSecret)||old?.clientSecret||'',webhookSecret:body.clearWebhookSecret?'':value(body.webhookSecret)||old?.webhookSecret||''};
      if(!next.clientId||!next.clientSecret||(next.clientId!==old?.clientId&&!value(body.clientSecret)))throw new ZoomIntegrationError('Enter the matching Zoom Client ID and Client Secret configured in Supabase.');
      if((body.revision||'')!==(config?.revision||''))throw new ZoomIntegrationError('Provider settings changed. Refresh before saving.',409);
      checked(await admin().rpc('zoom_save_provider',{p_cipher:await sealZoom(next,'zoom-provider'),p_expected_revision:config?.revision||null}));
      return response({message:'Provider settings saved immediately. Users must reconnect Zoom.'});
    }
    if(action==='connect'){
      const config=await provider();if(!config)throw new ZoomIntegrationError('An admin must configure the shared Zoom app first.',503,'setup_required');
      const {data,error}=await client.auth.getSession();if(error||!data.session||data.session.user.id!==user.id)throw new ZoomIntegrationError('Sign in to 2ndBrain again.',401);
      const isolated=zoomProviderClient(data.session);const attemptId=randomUUID();
      const options={redirectTo:getRequestOrigin(request)+'/api/integrations/zoom/callback?attempt='+attemptId,scopes,skipBrowserRedirect:true};
      const browser=randomBytes(32).toString('base64url');
      // Reserve before the provider round-trip so a concurrent disconnect can cancel it.
      checked(await admin().rpc('zoom_begin_link',{p_user_id:user.id,p_attempt_id:attemptId,p_browser_hash:hash(browser),p_pkce_cipher:await sealZoom('', 'zoom-link:'+attemptId),p_provider_revision:config.revision}));
      // Existing identities can be reauthorized; a user explicitly linking a
      // new Zoom account must use manual linking to preserve the workspace ID.
      const linked=user.identities?.some(i=>i.provider==='zoom');
      const linkNew=new URL(request.url).searchParams.get('mode')==='link-new';
      const result=linked&&!linkNew?await isolated.client.auth.signInWithOAuth({provider:'zoom',options}):await isolated.client.auth.linkIdentity({provider:'zoom',options});
      const verifier=isolated.verifier();
      if(result.error||!result.data.url||!verifier)throw new ZoomIntegrationError('Could not connect Zoom. Enable the Supabase Zoom provider, manual identity linking, and the connection callback URL.',503,'provider_setup_required');
      const pending=checked(await admin().from('zoom_link_attempts').update({pkce_cipher:await sealZoom(verifier,'zoom-link:'+attemptId)}).eq('id',attemptId).eq('user_id',user.id).select('id').maybeSingle());
      if(!pending)throw new ZoomIntegrationError('Zoom connection was cancelled or changed. Try again.',409,'connection_changed');
      return new Response(null,{status:303,headers:{...PRIVATE,Location:result.data.url,'Set-Cookie':`${COOKIE}=${browser}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`}});
    }
    if(action==='disconnect'){
      // Invalidate locally first, so in-flight callbacks/refreshes cannot restore access.
      const row=await account(user.id),config=await provider();checked(await admin().rpc('zoom_disconnect',{p_user_id:user.id}));
      let revoked=false;
      if(row?.token_cipher&&config){try{const tokens=await unsealZoom<Tokens>(row.token_cipher,'zoom-account:'+user.id),c=await credentials(config);const r=await timed('https://zoom.us/oauth/revoke',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(c.clientId+':'+c.clientSecret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:tokens.access_token})});revoked=r.ok;}catch{}}
      return response({connected:false,message:revoked?'Zoom disconnected and authorization revoked.':'Zoom disconnected here. You can also revoke access in Zoom Marketplace.'});
    }
    throw new ZoomIntegrationError('Endpoint not found.',404);
  }catch(error){
    if(action==='callback')return redirect(request,error instanceof ZoomIntegrationError?error.code:'connection_failed');
    const e=error instanceof ZoomIntegrationError?error:new ZoomIntegrationError('Zoom integration is unavailable. Check database migration and encryption-key storage.',503,'integration_unavailable');
    return response({error:e.message,code:e.code,...(e.retryAfter?{retryAfter:e.retryAfter}:{}),...(e.rateLimitType?{rateLimitType:e.rateLimitType}:{})},e.status);
  }
}
