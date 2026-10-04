import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
// Minimal DOM for exercising the real event handlers; visual/browser QA is separate.
async function composer(){
 const nodes=new Map(),listeners=new Map();
 function element(){return {children:[],value:'',classList:{add(){},remove(){},toggle(){}},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},setAttribute(){},showModal(){}};}
 const document={createElement:element,getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},querySelector:element,querySelectorAll(){return [];},addEventListener(){},activeElement:{tagName:'BODY'}};
 const context=vm.createContext({document,window:{addEventListener(name,fn){listeners.set(name,fn);}},location:{href:'https://example.com/'},history:{replaceState(){}},URL,URLSearchParams,crypto,console,setTimeout(){},clearTimeout(){},fetch:async()=>new Response(JSON.stringify({is_connected:false}))});
 const run=code=>vm.runInContext(code,context);run(source);await new Promise(resolve=>setImmediate(resolve));
 run("status={is_connected:true,account:'owner@example.com'};globalThis.saved={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',to:'friend@example.com',subject:'Saved subject',body:'Saved body',revision:1,is_saved:true,is_demo:false};openDraft(saved);");
 function is_unload_warned(){let is_prevented=false;listeners.get('beforeunload')({preventDefault(){is_prevented=true;}});return is_prevented;}
 return {run,nodes,context,is_unload_warned};
}

test('accepting a rewrite on a reopened draft survives navigation and warns on reload',async()=>{
 const ui=await composer();
 ui.run("composeDraft.rewrite={subject:'Kinder subject',body:'Accepted kinder body'};renderDraftRewrite(composeDraft);$('draft-rewrite').children.find(node=>node.textContent==='Use this version').onclick();");
 assert.equal(ui.run('composeDraft.body'),'Accepted kinder body');assert.equal(ui.is_unload_warned(),true);
 ui.context.fetch=async()=>new Response(JSON.stringify({drafts:[ui.run('saved')]}));
 await ui.run("folder='drafts';loadMail()");ui.run('openDraft(messages[0])');
 assert.equal(ui.run('composeDraft.body'),'Accepted kinder body');assert.equal(ui.run('composeDraft.is_saved'),false);
});

test('reopening a draft while saving keeps one object and receives the new revision',async()=>{
 const ui=await composer();let finish;
 ui.context.fetch=()=>new Promise(resolve=>{finish=resolve;});
 const pending=ui.run('saveCurrentDraft(composeDraft)');ui.run('openDraft(saved)');
 assert.equal(ui.run('composeDraft.is_saving'),true);
 finish(new Response(JSON.stringify({revision:2})));assert.equal(await pending,true);
 assert.equal(ui.run('composeDraft.is_saving'),false);assert.equal(ui.run('composeDraft.revision'),2);
});

test('second reply starts fresh after send but preserves an uncertain send lock',async()=>{
 const ui=await composer();
 ui.run("composeDraft.reply_for='18aabbccddeeff00';composeDraft.is_send_locked=true;composeDraft.send_status='sent';globalThis.mail={id:'18aabbccddeeff00',sender:'friend@example.com',kind:{subject:'Question',reply_to:'friend@example.com'}};startReply(mail);");
 assert.notEqual(ui.run('composeDraft.id'),ui.run('saved.id'));assert.equal(ui.run('composeDraft.is_send_locked'),false);
 ui.run("composeDraft.is_send_locked=true;composeDraft.send_status='uncertain';globalThis.uncertainId=composeDraft.id;startReply(mail);");
 assert.equal(ui.run('composeDraft.id'),ui.run('uncertainId'));assert.equal(ui.run('composeDraft.is_send_locked'),true);
});

test('a rewrite arriving after send lock cannot change the sent draft',async()=>{
 const ui=await composer();let finish;ui.context.fetch=()=>new Promise(resolve=>{finish=resolve;});
 const pending=ui.run('rewriteDraft(composeDraft)');ui.run("composeDraft.is_send_locked=true;composeDraft.send_status='sent';");
 finish(new Response(JSON.stringify({rewrite:{subject:'Late subject',body:'Late body'}})));await pending;
 assert.equal(ui.run('composeDraft.rewrite'),undefined);assert.equal(ui.run('composeDraft.body'),'Saved body');
});

test('failed save-as-separate preserves the unsaved text and reload warning',async()=>{
 const ui=await composer();
 ui.context.fetch=async()=>new Response(JSON.stringify({error:{code:'service_unavailable'}}),{status:502});
 ui.run("composeDraft.is_conflicted=true;composeDraft.is_saved=false;renderComposer();const action=$('reader').children[1].children.find(node=>node.className==='reply-actions').children.find(node=>node.textContent==='Save as separate draft');action.onclick();");
 await new Promise(resolve=>setImmediate(resolve));
 assert.notEqual(ui.run('composeDraft.id'),ui.run('saved.id'));assert.equal(ui.run('drafts.get(composeDraft.id).body'),'Saved body');assert.equal(ui.is_unload_warned(),true);
});

for(const code of ['draft_conflict','service_unavailable'])test(`send confirmation preserves its snapshot and handles ${code}`,async()=>{
 const ui=await composer();let sent;
 ui.context.fetch=async(path,options)=>{
  if(path.startsWith('/api/drafts/'))return new Response(JSON.stringify({revision:2}));
  sent=JSON.parse(options.body);return new Response(JSON.stringify({error:{code}}),{status:code==='draft_conflict'?409:502});
 };
 await ui.run('reviewSend(composeDraft)');
 await ui.run("$('confirmation').returnValue='send';$('confirmation').onclose()");
 assert.equal(sent.to,'friend@example.com');assert.equal(sent.subject,'Saved subject');assert.equal(sent.body,'Saved body');assert.equal(sent.is_confirmed,true);
 assert.equal(ui.run('composeDraft.is_send_locked'),code!=='draft_conflict');
 assert.equal(ui.run('composeDraft.is_conflicted'),code==='draft_conflict');
 if(code==='draft_conflict'){assert.equal(ui.run('composeDraft.is_saved'),false);assert.equal(ui.is_unload_warned(),true);}
});

test('a send lock removes the save-as-separate escape from a conflicted draft',async()=>{
 const ui=await composer();ui.run('composeDraft.is_conflicted=true');
 ui.context.fetch=async()=>new Response(JSON.stringify({error:{code:'draft_send_locked'}}),{status:409});
 assert.equal(await ui.run('saveCurrentDraft(composeDraft)'),false);
 assert.equal(ui.run('composeDraft.is_send_locked'),true);assert.equal(ui.run('composeDraft.is_conflicted'),false);
 assert.equal(ui.run("$('reader').children[1].children.find(node=>node.className==='reply-actions').children.some(node=>node.textContent==='Save as separate draft')"),false);
 assert.ok(ui.nodes.get('draft-status').textContent.includes('may differ from what was sent'));
 ui.run("$('reader').children[1].children.find(node=>node.className==='reply-actions').children.find(node=>node.textContent==='Copy unsent edits to a new draft').onclick()");
 assert.notEqual(ui.run('composeDraft.id'),ui.run('saved.id'));assert.equal(ui.run('composeDraft.body'),'Saved body');
 assert.equal(ui.run('composeDraft.is_send_locked'),false);assert.equal(ui.is_unload_warned(),true);
});

test('double-clicking save-as-separate keeps the same new draft while saving',async()=>{
 const ui=await composer();let finish,count=0;
 ui.context.fetch=()=>{count++;return new Promise(resolve=>{finish=resolve;});};
 ui.run("composeDraft.is_conflicted=true;renderComposer();globalThis.separate=$('reader').children[1].children.find(node=>node.className==='reply-actions').children.find(node=>node.textContent==='Save as separate draft');separate.onclick();globalThis.newId=composeDraft.id;separate.onclick();");
 assert.equal(count,1);assert.equal(ui.run('composeDraft.id'),ui.run('newId'));
 finish(new Response(JSON.stringify({revision:1})));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(ui.run('composeDraft.revision'),1);assert.equal(ui.run('composeDraft.is_saving'),false);
});

test('rejected local edits remain reachable after the other tab confirms sending',async()=>{
 const ui=await composer();
 ui.context.fetch=async path=>new Response(JSON.stringify(path.startsWith('/api/sends/')?{status:'sent'}:{error:{code:'draft_send_locked'}}),{status:path.startsWith('/api/sends/')?200:409});
 await ui.run('saveCurrentDraft(composeDraft)');await ui.run('checkSend(composeDraft)');
 ui.context.fetch=async()=>new Response(JSON.stringify({drafts:[]}));
 await ui.run("folder='drafts';loadMail()");assert.equal(ui.run('messages.length'),1);
 ui.run('openDraft(messages[0])');assert.equal(ui.run('composeDraft.body'),'Saved body');assert.equal(ui.is_unload_warned(),true);
});

test('newest20 queue stops at 20, skips cached mail, and never invokes send',async()=>{
 const ui=await composer();ui.run("status={is_local:true,is_connected:true,is_disclosure_accepted:true,is_auto_prepare:true,account:'a@example.com',provider:'openai',model:'gpt-4.1-mini'};folder='inbox';messages=Array.from({length:25},(_,i)=>({id:String(i),kind:i===0?{subject:'Cached',body:'Cached'}:null}));globalThis.called=[];prepare=async mail=>{called.push(mail.id);};");
 await ui.run('prepareNewest(messages.slice(0,20),autoGeneration)');assert.equal(ui.run('called.length'),19);assert.equal(ui.run('called.at(-1)'),'19');
 await ui.run('prepareNewest(messages.slice(0,20),autoGeneration)');assert.equal(ui.run('called.length'),19);
});
test('pausing or changing folder stops queued work after active request',async()=>{
 const ui=await composer();ui.run("status={is_auto_prepare:true,account:'a'};folder='inbox';messages=Array.from({length:20},(_,i)=>({id:String(i)}));globalThis.called=[];prepare=async mail=>{called.push(mail.id);autoGeneration++;};");await ui.run('prepareNewest(messages,autoGeneration)');assert.equal(ui.run('called.length'),1);
});
test('truncated draft suggestion cannot replace or discard full draft',async()=>{
 const ui=await composer();ui.run("composeDraft.rewrite={subject:'Short',body:'Partial',is_truncated:true};renderDraftRewrite(composeDraft);$('draft-rewrite').children.find(node=>node.textContent==='Partial rewrite — keep full draft').onclick();");assert.equal(ui.run('composeDraft.body'),'Saved body');
});

test('automatic queue uses real prepare handlers, only kind endpoints, and stops on provider account errors',async()=>{
 const ui=await composer();ui.run("status={is_auto_prepare:true,account:'a'};folder='inbox';messages=Array.from({length:20},(_,i)=>({id:String(i)}));");const calls=[];
 ui.context.fetch=async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return new Response(JSON.stringify({error:{code:'ai_rate_limited'}}),{status:502});};
 await ui.run('prepareNewest(messages,autoGeneration)');assert.equal(calls.length,1);assert.ok(calls.every(call=>call.path.endsWith('/kind')&&call.body.is_automatic===true));
});
