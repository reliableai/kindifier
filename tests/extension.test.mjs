import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {SCHEMA,rewriteEmail,respond} from '../extension/rewrite.js';

const kind=JSON.stringify({subject:'Project plan',body:'Please send the plan by Friday.',is_complete:true});
function fakeModel(reply){
 const calls={clones:0,destroyed:0,prompts:[]};
 const base={async clone(){calls.clones++;return {async prompt(input,options){calls.prompts.push({input,options});return reply;},destroy(){calls.destroyed++;}};}};
 return {base,calls};
}
test('on-device rewrite sends only the email JSON to a fresh session, constrains output, and frees the session',async()=>{
 const {base,calls}=fakeModel(kind);
 assert.deepEqual(await rewriteEmail(base,'You are useless','Send the plan by Friday, idiot.'),{subject:'Project plan',body:'Please send the plan by Friday.'});
 assert.deepEqual(JSON.parse(calls.prompts[0].input),{subject:'You are useless',body:'Send the plan by Friday, idiot.'});
 assert.equal(calls.prompts[0].options.responseConstraint,SCHEMA);assert.equal(calls.clones,1);assert.equal(calls.destroyed,1);
});
for(const [reply,code] of [['not json','rewrite_invalid'],[JSON.stringify({subject:'S',body:'B',is_complete:false}),'rewrite_incomplete'],[JSON.stringify({subject:'S',body:'  ',is_complete:true}),'rewrite_incomplete']])test('model output is rejected rather than shown partially: '+code,async()=>{
 const {base,calls}=fakeModel(reply);
 await assert.rejects(rewriteEmail(base,'Hi','Hello'),{code});assert.equal(calls.destroyed,1);
});
test('empty mail is refused before any model call',async()=>{
 const {base,calls}=fakeModel(kind);
 await assert.rejects(rewriteEmail(base,'Hi','  \n'),{code:'message_empty'});assert.equal(calls.clones,0);
});
test('panel replies report missing setup, overlong mail and success to Gmail',async t=>{
 t.mock.method(console,'error',()=>{});
 assert.deepEqual(await respond({subject:'Hi',body:'Hello'},null),{is_ok:false,error:{code:'model_not_ready'}});
 const tooLong={async clone(){return {async prompt(){throw new DOMException('too long','QuotaExceededError');},destroy(){}};}};
 assert.deepEqual(await respond({subject:'Hi',body:'Hello'},tooLong),{is_ok:false,error:{code:'message_too_long'}});
 assert.deepEqual(await respond({subject:'Hi',body:'Hello'},fakeModel(kind).base),{is_ok:true,rewrite:{subject:'Project plan',body:'Please send the plan by Friday.'}});
});

const gmailSource=await readFile(new URL('../extension/gmail.js',import.meta.url),'utf8');
// Minimal DOM for the content script's real handlers; Gmail itself is checked by hand.
function fakeNode(){
 const classes=new Set();
 return {children:[],textContent:'',innerText:'',get className(){return [...classes].join(' ');},set className(value){classes.clear();for(const name of value.split(' ').filter(Boolean))classes.add(name);},
  classList:{add:(...names)=>names.forEach(name=>classes.add(name)),contains:name=>classes.has(name),toggle(name,is_on){if(is_on)classes.add(name);else classes.delete(name);}},
  append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},before(item){this.previous=item;}};
}
const texts=node=>[node.textContent,...node.children.flatMap(texts)].filter(Boolean);
function find(node,text){if(node.textContent===text)return node;for(const child of node.children){const found=find(child,text);if(found)return found;}return null;}
async function gmail(reply){
 const subject=fakeNode(),body=fakeNode();subject.textContent=' You are useless ';body.innerText='Send the plan by Friday, idiot.\n';body.className='a3s';
 const sent=[];
 const context=vm.createContext({console,
  document:{createElement:fakeNode,body:fakeNode(),querySelector:selector=>selector==='h2.hP'?subject:null,querySelectorAll:selector=>selector==='div.a3s'?[body]:[]},
  MutationObserver:class{constructor(callback){context.mutate=callback;}observe(){}},
  chrome:{runtime:{sendMessage:async message=>{sent.push(message);return reply(message);}}}});
 vm.runInContext(gmailSource,context);await new Promise(resolve=>setImmediate(resolve));
 return {context,subject,body,sent,panel:body.previous};
}
test('an opened Gmail message is hidden, sent once, and replaced by its kinder version',async()=>{
 const ui=await gmail(async()=>({is_ok:true,rewrite:{subject:'Project plan',body:'Please send the plan by Friday.'}}));
 assert.equal(JSON.stringify(ui.sent),JSON.stringify([{type:'kindifier_rewrite',subject:'You are useless',body:'Send the plan by Friday, idiot.'}]));
 assert.ok(ui.body.classList.contains('kindifier-hidden'));assert.ok(texts(ui.panel).includes('Please send the plan by Friday.'));assert.ok(!texts(ui.panel).some(text=>text.includes('idiot')));
 ui.context.mutate();assert.equal(ui.sent.length,1);
 find(ui.panel,'Show original').onclick();assert.ok(!ui.body.classList.contains('kindifier-hidden'));assert.ok(ui.subject.classList.contains('kindifier-revealed'));
 find(ui.panel,'Hide original').onclick();assert.ok(ui.body.classList.contains('kindifier-hidden'));assert.ok(!ui.subject.classList.contains('kindifier-revealed'));
});
test('a closed side panel keeps the original hidden and Try again prepares it once the panel is open',async()=>{
 let is_panel_open=false;
 const ui=await gmail(async()=>{if(!is_panel_open)throw new Error('Could not establish connection. Receiving end does not exist.');return {is_ok:true,rewrite:{subject:'Project plan',body:'Kind body'}};});
 assert.ok(texts(ui.panel).some(text=>text.startsWith('Open Kindifier')));assert.ok(ui.body.classList.contains('kindifier-hidden'));
 is_panel_open=true;await find(ui.panel,'Try again').onclick();assert.ok(texts(ui.panel).includes('Kind body'));
});
test('model errors reported by the panel are shown in Gmail',async()=>{
 const ui=await gmail(async()=>({is_ok:false,error:{code:'message_too_long'}}));
 assert.ok(texts(ui.panel).includes('This email is too long for the on-device model.'));assert.ok(ui.body.classList.contains('kindifier-hidden'));
});
