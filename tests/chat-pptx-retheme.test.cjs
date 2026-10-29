const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const PizZip = require('pizzip');
const PptxGenJS = require('pptxgenjs');
const { DOMParser } = require('@xmldom/xmldom');
function compile(file, mocks = {}) {
  const filename=path.resolve(__dirname,'..',file), instance=new Module(filename,module);
  instance.filename=filename; instance.paths=module.paths;
  const original=Module._load;
  try { Module._load=function(request,...args){return Object.hasOwn(mocks,request)?mocks[request]:original.call(this,request,...args)}; instance._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename); } finally { Module._load=original; }
  return instance.exports;
}
const attachments=compile('lib/chat-attachments.ts',{'@/lib/chat-files-shared':{CHAT_FILE_MAX_BYTES:20*1024*1024}});
const layout=compile('lib/chat-pptx-layout.ts');
const retheme=compile('lib/chat-pptx-retheme.ts',{'@/lib/chat-attachments':attachments,'@/lib/chat-pptx-layout':layout});
const template=fs.readFileSync(path.join(__dirname,'../aicuber-docs/AI_CUBER_PPT_Template_New_Logo.pptx'));
async function sourceDeck(layout='LAYOUT_WIDE') {
  const pptx=new PptxGenJS(); if(layout==='different') { pptx.defineLayout({name:'different',width:10,height:7.5}); pptx.layout='different'; } else pptx.layout=layout;
  const slide=pptx.addSlide(); slide.addText('Quarterly sales',{x:.8,y:.5,w:5,h:.5});
  slide.addImage({path:path.join(__dirname,'../test-data/test-5/receipt.png'),x:.8,y:1.4,w:2,h:2.5});
  slide.addChart(pptx.ChartType.bar,[{name:'Revenue',labels:['A','B'],values:[20,35]}],{x:4,y:1.2,w:6,h:4});
  return Buffer.from(await pptx.write({outputType:'nodebuffer'}));
}

test('transfers editable text, an image and a native chart into a branded design',async()=>{
  const input=await sourceDeck(), result=await retheme.restyleChatPresentation(input,template);
  assert.equal(result.slideCount,1);
  const zip=new PizZip(result.data);
  assert.equal(Object.keys(zip.files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).length,1);
  assert.equal(Object.keys(zip.files).filter(name=>/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)).length,0);
  assert.ok(Object.keys(zip.files).some(name=>/^ppt\/charts\/chart\d+\.xml$/.test(name)));
  assert.ok(Object.keys(zip.files).some(name=>/^ppt\/embeddings\/.*\.xlsx$/.test(name)));
  assert.match(await attachments.presentationText({name:'result.pptx',type:'presentation',mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation',data:result.data}),/Quarterly sales/);
  const hashes=Object.values(zip.files).filter(f=>/^ppt\/media\//.test(f.name)).map(f=>f.asNodeBuffer());
  const receipt=fs.readFileSync(path.join(__dirname,'../test-data/test-5/receipt.png'));
  assert.ok(hashes.some(bytes=>bytes.equals(receipt)));
  const slidePath=Object.keys(zip.files).find(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name));
  const doc=new DOMParser().parseFromString(zip.file(slidePath).asText(),'text/xml');
  const p='http://schemas.openxmlformats.org/presentationml/2006/main', a='http://schemas.openxmlformats.org/drawingml/2006/main';
  const shapeRect=shape=>{const transform=shape.getElementsByTagNameNS(a,'xfrm').item(0)??shape.getElementsByTagNameNS(p,'xfrm').item(0),off=transform.getElementsByTagNameNS(a,'off').item(0),ext=transform.getElementsByTagNameNS(a,'ext').item(0);return {x:Number(off.getAttribute('x')),y:Number(off.getAttribute('y')),w:Number(ext.getAttribute('cx')),h:Number(ext.getAttribute('cy'))}};
  const names=Array.from(doc.getElementsByTagNameNS(p,'cNvPr'));
  const content=names.filter(node=>node.getAttribute('name')?.startsWith('2ndbrain-content-')).map(node=>shapeRect(node.parentNode.parentNode));
  const logo=names.find(node=>node.getAttribute('name')==='图片 14');
  assert.equal(content.length,3); assert.ok(logo,'AICUBER template logo retained');
  for(let i=0;i<content.length;i++){assert.equal(layout.rectanglesOverlap(content[i],shapeRect(logo.parentNode.parentNode)),false);for(let j=i+1;j<content.length;j++)assert.equal(layout.rectanglesOverlap(content[i],content[j]),false);}
});

test('rejects overlapping source objects and reversed sample roles instead of producing a crowded file',async()=>{
  const bad=fs.readFileSync(path.join(__dirname,'../test-data/test-14/overlapping-source.pptx'));
  await assert.rejects(retheme.restyleChatPresentation(bad,template),/overlap|too close/i);
  const content=fs.readFileSync(path.join(__dirname,'../test-data/test-10/source-content.pptx'));
  await assert.rejects(retheme.restyleChatPresentation(template,content),/template slide|overlap/i);
});

test('chooses an unobstructed region and refuses unsafe layouts',()=>{
  const source=[{x:10,y:10,w:30,h:10},{x:10,y:30,w:30,h:30}], obstacles=[{x:0,y:70,w:20,h:20}];
  const plan=layout.planSlideLayout(100,100,source,[{slideNumber:1,obstacles:[{x:0,y:0,w:100,h:100}]},{slideNumber:2,obstacles}]);
  assert.equal(plan.slideNumber,2); assert.ok(plan.positions.every(rect=>obstacles.every(item=>!layout.rectanglesOverlap(rect,item))));
  assert.throws(()=>layout.planSlideLayout(100,100,[source[0],{x:12,y:12,w:20,h:10}],[{slideNumber:1,obstacles:[]}]),/overlap/i);
  assert.throws(()=>layout.planSlideLayout(100,100,source,[{slideNumber:1,obstacles:[{x:0,y:0,w:100,h:100}]}]),/clear space/i);
});

test('keeps transferred objects clear of decorations inherited from the slide master',async()=>{
  const pptx=new PptxGenJS(); pptx.layout='LAYOUT_WIDE';
  pptx.defineSlideMaster({title:'Brand',background:{color:'FFFFFF'},objects:[{rect:{x:.4,y:.4,w:1.8,h:.8,fill:{color:'2255CC'},line:{color:'2255CC'}}}]});
  pptx.addSlide('Brand').addText('Template example',{x:3,y:1,w:4,h:.4});
  const brand=Buffer.from(await pptx.write({outputType:'nodebuffer'}));
  const result=await retheme.restyleChatPresentation(await sourceDeck(),brand), zip=new PizZip(result.data);
  const slidePath=Object.keys(zip.files).find(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name));
  const doc=new DOMParser().parseFromString(zip.file(slidePath).asText(),'text/xml');
  const p='http://schemas.openxmlformats.org/presentationml/2006/main',a='http://schemas.openxmlformats.org/drawingml/2006/main';
  const master={x:.4*914400,y:.4*914400,w:1.8*914400,h:.8*914400};
  const shapes=Array.from(doc.getElementsByTagNameNS(p,'cNvPr')).filter(node=>node.getAttribute('name')?.startsWith('2ndbrain-content-'));
  assert.equal(shapes.length,3);
  for(const node of shapes){const shape=node.parentNode.parentNode,transform=shape.getElementsByTagNameNS(a,'xfrm').item(0)??shape.getElementsByTagNameNS(p,'xfrm').item(0),off=transform.getElementsByTagNameNS(a,'off').item(0),ext=transform.getElementsByTagNameNS(a,'ext').item(0);assert.equal(layout.rectanglesOverlap(master,{x:Number(off.getAttribute('x')),y:Number(off.getAttribute('y')),w:Number(ext.getAttribute('cx')),h:Number(ext.getAttribute('cy'))}),false);}
});

test('handles unnamed objects and absolute OOXML relationships, and rejects unsupported content',async()=>{
  const input=fs.readFileSync(path.join(__dirname,'../test-data/test-8/training-template.pptx'));
  const result=await retheme.restyleChatPresentation(input,template);
  assert.equal(result.slideCount,2);
  const outputText=await attachments.presentationText({name:'result.pptx',type:'presentation',mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation',data:result.data});
  assert.match(outputText,/\{\{Full Name\}\}/);
  assert.doesNotMatch(outputText,/PRESENTATION TITLE/);
  await assert.rejects(retheme.restyleChatPresentation(await sourceDeck('different'),template),/different slide sizes/);
  const zip=new PizZip(await sourceDeck());
  const rels=zip.file('ppt/slides/_rels/slide1.xml.rels');
  zip.file('ppt/slides/_rels/slide1.xml.rels',rels.asText().replace('</Relationships>','<Relationship Id="external" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.test" TargetMode="External"/></Relationships>'));
  await assert.rejects(retheme.restyleChatPresentation(zip.generate({type:'nodebuffer'}),template),/external links/);
});

test('transfer endpoint uses owned files, preserves file order and saves the result',async()=>{
  let user='alice',saved=null,layoutFailure=false;
  const fake=(name)=>({file:{name,type:'presentation',mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation',data:Buffer.from('PK\x03\x04fixture')},metadata:{id:name,origin:'upload'}});
  const route=compile('app/api/chat/retheme-pptx/route.ts',{
    '@/lib/chat-attachments':{validateChatFile:(name,data)=>({name,data,type:name.endsWith('.pptx')?'presentation':'image'})},
    '@/lib/chat-files':{loadChatFile:async(_admin,owner,id)=>owner==='alice'?fake(id):null,saveChatGeneratedPptx:async(_admin,owner,source,name,bytes)=>{saved={owner,source,name,bytes};return {id:'out',name}}},
    '@/lib/chat-pptx-retheme':{restyleChatPresentation:async(s,t)=>{assert.ok(s.length&&t.length);if(layoutFailure)throw new Error('Source slide 1: Source slide objects overlap. Simplify the slide.');return {data:Buffer.from('pptx'),slideCount:2,containsNotesOrAnimations:true}}},
    '@/lib/env':{hasSupabaseEnv:()=>true},'@/lib/onboarding':{getUserIdFromClaims:c=>c?.sub},
    '@/lib/supabase/admin':{createAdminClient:()=>({}),hasSupabaseServiceRoleEnv:()=>true},
    '@/lib/supabase/server':{createClient:async()=>({auth:{getClaims:async()=>({data:{claims:{sub:user}}})}})}
  });
  const req=body=>new Request('http://localhost/api/chat/retheme-pptx',{method:'POST',headers:{'content-type':'application/json',host:'localhost',origin:'http://localhost'},body:JSON.stringify(body)});
  let response=await route.POST(req({sourceId:'content.pptx',templateId:'theme.pptx'})); const body=await response.json();
  assert.equal(response.status,200); assert.equal(saved.owner,'alice'); assert.equal(saved.source,'content.pptx'); assert.equal(body.savedOutput.id,'out'); assert.match(body.message,/not transferred/); assert.match(body.message,/did not use AI credits/);
  saved=null; layoutFailure=true; response=await route.POST(req({sourceId:'content.pptx',templateId:'theme.pptx'})); assert.equal(response.status,422); assert.match((await response.json()).error,/objects overlap/); assert.equal(saved,null); layoutFailure=false;
  user='bob'; response=await route.POST(req({sourceId:'content.pptx',templateId:'theme.pptx'})); assert.equal(response.status,404);
  user='alice'; response=await route.POST(req({sourceId:'same.pptx',templateId:'same.pptx'})); assert.equal(response.status,400);
});
