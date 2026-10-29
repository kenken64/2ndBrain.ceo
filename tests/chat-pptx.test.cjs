const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const PizZip = require('pizzip');

function compile(file, mocks = {}) {
  const filename=path.resolve(__dirname,'..',file), instance=new Module(filename,module);
  instance.filename=filename; instance.paths=module.paths;
  const original=Module._load;
  try {
    Module._load=function(request,...args){ return Object.hasOwn(mocks,request)?mocks[request]:original.call(this,request,...args); };
    instance._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
  } finally { Module._load=original; }
  return instance.exports;
}
const attachments=compile('lib/chat-attachments.ts',{'@/lib/chat-files-shared':{CHAT_FILE_MAX_BYTES:20*1024*1024}});
const pdf=compile('lib/chat-pdf-batch.ts');
const docx=compile('lib/chat-docx-batch.ts',{'@/lib/chat-attachments':attachments,'@/lib/chat-pdf-batch':pdf});
const generated=compile('lib/chat-pptx-generation.ts');

test('PowerPoint template and Excel create five correctly populated editable presentations',async()=>{
  const folder=path.resolve(__dirname,'../test-data/test-8');
  const ppt=attachments.validateChatFile('training-template.pptx',fs.readFileSync(path.join(folder,'training-template.pptx')));
  const sheet=attachments.validateChatFile('participants.xlsx',fs.readFileSync(path.join(folder,'participants.xlsx')));
  const context=await attachments.spreadsheetContext(sheet);
  const data=await docx.prepareDocxBatch(ppt,context);
  assert.equal(data.rows.length,5);
  assert.deepEqual(new Set(data.fields.map(f=>f.name)),new Set(['Full Name','Company','Email','Course','Session Date']));
  const mapping=pdf.validateBatchMapping({mappings:data.fields.map(f=>({field:f.name,column:f.name}))},data);
  const output=docx.renderDocxRow(ppt.data,data,mapping,data.rows[0]);
  const text=await attachments.presentationText({...ppt,data:output});
  assert.match(text,/Alice Tan/); assert.match(text,/alice\.tan@example\.com/); assert.doesNotMatch(text,/\{\{/);
  assert.ok(new PizZip(output).file('ppt/presentation.xml'));
});

test('prompt presentation renderer creates editable slides and rejects unsafe or oversized content',async()=>{
  const output=await generated.renderChatPresentation({title:'Support plan',slides:[{title:'Goals',bullets:['Respond within eight hours','Review staffing']} ]});
  const zip=new PizZip(output); assert.ok(zip.file('ppt/presentation.xml'));
  const text=await attachments.presentationText({name:'presentation.pptx',type:'presentation',mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation',data:output});
  assert.match(text,/Support plan/); assert.match(text,/Respond within eight hours/);
  const realistic = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../test-data/test-13/sample-slide-content.json'), 'utf8'));
  const expanded = await generated.renderChatPresentation(realistic);
  const expandedText = await attachments.presentationText({name:'presentation.pptx',type:'presentation',mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation',data:expanded});
  assert.match(expandedText, /Pilot goal \(continued\)/); assert.match(expandedText, /communicate delays clearly/); assert.match(expandedText, /agreed escalation process/);
  const moreSlides = await generated.renderChatPresentation({title:'x',slides:Array.from({length:11},()=>({title:'x',bullets:['y']}))}); assert.ok(new PizZip(moreSlides).file('ppt/presentation.xml'));
  await assert.rejects(generated.renderChatPresentation({title:'x',slides:[{title:'x',bullets:['x'.repeat(4001)]}]}),/limits/);
  await assert.rejects(attachments.checkOfficeArchive(Buffer.from('not a zip'),'PPTX'),/Invalid PPTX/);
});

test('PowerPoint batch uses owned uploads, tracks mapping cost and saves one file per row',async()=>{
  const folder=path.resolve(__dirname,'../test-data/test-8');
  const template=attachments.validateChatFile('training-template.pptx',fs.readFileSync(path.join(folder,'training-template.pptx')));
  const sheet=attachments.validateChatFile('participants.xlsx',fs.readFileSync(path.join(folder,'participants.xlsx')));
  const model=compile('lib/chat-models.ts'); const rpc=[], saved=[];
  const admin={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{email:'user@example.test',openclaw_instance:null},error:null})})})}),rpc:(name,args)=>({single:async()=>{rpc.push({name,args}); return {data:{request_id:'request',llm_token_quota:10000,llm_token_used:100,charged_credits:args.p_actual_credits||0},error:null};}})};
  const mocks={
    '@/lib/chat-attachments':attachments,'@/lib/chat-pdf-batch':pdf,'@/lib/chat-docx-batch':docx,'@/lib/chat-models':model,
    '@/lib/chat-files':{loadChatFile:async(_admin,user,id)=> user==='alice' ? id==='template'?{file:template,metadata:{id:'template',origin:'upload'}}:id==='sheet'?{file:sheet,metadata:{id:'sheet',origin:'upload'}}:null:null,
      saveChatGeneratedPptx:async(_admin,user,source,name,bytes)=>{assert.equal(user,'alice'); assert.equal(source,'template'); saved.push({name,bytes}); return {id:String(saved.length),name};}},
    '@/lib/admin':{isAdminUser:async()=>false},'@/lib/env':{hasSupabaseEnv:()=>true},'@/lib/onboarding':{getUserIdFromClaims:c=>c?.sub},
    '@/lib/supabase/admin':{createAdminClient:()=>admin,hasSupabaseServiceRoleEnv:()=>true},
    '@/lib/supabase/server':{createClient:async()=>({auth:{getClaims:async()=>({data:{claims:{sub:'alice'}}})}})},
    '@/lib/token-quota-redis':{publishTokenQuotaUpdate:async()=>true}
  };
  const route=compile('app/api/chat/batch-pdf/route.ts',mocks);
  const oldFetch=global.fetch, oldKey=process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY='test-key';
  global.fetch=async url=>String(url).endsWith('/models')?Response.json({data:[{id:model.FILE_CHAT_MODEL,pricing:{prompt:'0.000001',completion:'0.000002'}}]}):Response.json({id:'generation',usage:{cost:0.001,prompt_tokens:10,completion_tokens:20},choices:[{message:{content:JSON.stringify({mappings:['Full Name','Company','Email','Course','Session Date'].map(name=>({field:name,column:name}))})}}]});
  try {
    const req=new Request('http://localhost/api/chat/batch-pdf',{method:'POST',headers:{'content-type':'application/json',host:'localhost',origin:'http://localhost'},body:JSON.stringify({fileIds:['template','sheet'],messages:[{role:'user',content:'Fill the presentation'}]})});
    const response=await route.POST(req); const body=await response.json();
    assert.equal(response.status,200); assert.equal(body.savedOutputs.length,5); assert.equal(rpc[0].args.p_kind,'pptx_generation'); assert.equal(rpc[1].args.p_cost_usd,0.001);
    assert.match(await attachments.presentationText({...template,data:saved[0].bytes}),/Alice Tan/);
  } finally {global.fetch=oldFetch; if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldKey;}
});
