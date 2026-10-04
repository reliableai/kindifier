import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare,createFetchMock,Log,LogLevel} from 'miniflare';
import {SITE_ORIGIN,encrypt,decrypt,digest} from '../server/security.mjs';
import {buildMime,MESSAGE_ID_DOMAIN} from '../server/google.mjs';
import PostalMime from 'postal-mime';
const OWNER_ID='local-test-user';
const key=Buffer.alloc(32,1).toString('base64');const env={TOKEN_ENCRYPTION_KEY:key};const account='owner@example.com';
let mf,db,mock;let aiScenario='failure';
const id='18aabbccddeeff00';
const rawSubject='You are useless';const rawBody='You are an idiot. Send the plan by Friday at 3 PM.';
const originalRaw=Buffer.from(`From: Angry Person <sender@example.com>\r\nTo: ${account}\r\nSubject: ${rawSubject}\r\nMessage-ID: <sample@example.com>\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${rawBody}`).toString('base64url');
function request(path,method='GET',value,headers={}){return mf.dispatchFetch(SITE_ORIGIN+path,{method,redirect:'manual',headers:{'oai-authenticated-user-id':OWNER_ID,'Origin':SITE_ORIGIN,'Content-Type':'application/json',...headers},...(value===undefined?{}:{body:JSON.stringify(value)})});}
function mockMeta(){mock.get('https://gmail.googleapis.com').intercept({path:`/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From`}).reply(200,{id,threadId:id,internalDate:'1000',sizeEstimate:500,labelIds:['INBOX'],snippet:rawBody,payload:{headers:[{name:'From',value:'Hostile sender <sender@example.com>'},{name:'Subject',value:rawSubject}]}});}
function mockRaw(){mockMeta();mock.get('https://gmail.googleapis.com').intercept({path:`/gmail/v1/users/me/messages/${id}?format=raw`}).reply(200,{id,raw:originalRaw});}
before(async()=>{mock=createFetchMock();mock.disableNetConnect();mock.get('https://api.openai.com').intercept({path:'/v1/responses',method:'POST'}).reply(options=>{
 if(aiScenario==='failure')return {statusCode:503,data:{error:{message:rawBody}}};
 if(aiScenario==='incomplete')return {statusCode:200,data:{status:'incomplete',output:[{type:'message',content:[{type:'output_text',text:rawBody}]}]}};
 // Miniflare forwards streaming request bodies; validate request serialization separately.

 return {statusCode:200,data:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({subject:'Project plan',body:'Please send the plan by Friday at 3 PM.',preview:'Plan requested by Friday at 3 PM.',is_complete:true})}]}]}};
 }).persist();mf=new Miniflare({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-08-06',d1Databases:['DB'],outboundService:async request=>{const body=await request.text();if(new URL(request.url).hostname==='api.openai.com'){const value=JSON.parse(body);assert.equal(value.store,false);assert.equal(value.text.format.strict,true);assert.equal(typeof JSON.parse(value.input).body,'string');}return fetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),...(!['GET','HEAD'].includes(request.method)?{body}:{}),dispatcher:mock});},log:new Log(LogLevel.NONE),bindings:{TOKEN_ENCRYPTION_KEY:key,GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',OPENAI_API_KEY:'test-key'}});db=await mf.getD1Database('DB');for(const file of(await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const sql of(await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();await db.prepare('INSERT INTO connections(user_id,account,ciphertext,connection_id) VALUES(?,?,?,?)').bind(OWNER_ID,account,await encrypt(env,{access_token:'test-access',refresh_token:'test-refresh',expires_at:Date.now()+3600000},`${OWNER_ID}:${account}:tokens`),crypto.randomUUID()).run();});
after(async()=>{await mf.dispose();});
test('API rejects absent identity, isolates other users, rejects direct host and cross-site mutations',async()=>{
 assert.equal((await request('/api/status','GET',undefined,{'oai-authenticated-user-id':''})).status,401);
 assert.equal((await request('/api/messages','GET',undefined,{'oai-authenticated-user-id':'someone-else'})).status,401);
 assert.equal((await mf.dispatchFetch('https://direct.workers.dev/api/status',{headers:{'oai-authenticated-user-id':OWNER_ID}})).status,403);
 assert.equal((await request('/api/rewrite','POST',{}, {Origin:'https://evil.example'})).status,403);
});
test('custom domain remains the only accepted API and mutation origin',async()=>{
 for(const origin of ['http://kindifier.com','https://kindifier.com.evil.example','https://evil.kindifier.com','https://www.kindifier.com','https://legacy-kindmail.example','null']){
  assert.equal((await request('/api/rewrite','POST',{}, {Origin:origin})).status,403,origin);
 }
 const headers={'oai-authenticated-user-id':OWNER_ID,'Content-Type':'application/json'};
 assert.equal((await mf.dispatchFetch(SITE_ORIGIN+'/api/rewrite',{method:'POST',headers,body:'{}'})).status,403);
 assert.equal((await mf.dispatchFetch('https://legacy-kindmail.example/api/status',{headers})).status,403);
 for(const type of ['text/plain','application/jsonp'])assert.equal((await request('/api/rewrite','POST',{}, {'Content-Type':type})).status,403);
 assert.equal(MESSAGE_ID_DOMAIN,'legacy-kindmail.example');
});
test('status reports readiness without exposing any token or key',async()=>{const response=await request('/api/status');const text=await response.text();assert.ok(text.includes(account));assert.ok(!text.includes('test-access'));assert.ok(!text.includes('test-key'));});
test('ciphertext cannot be decrypted for a different row or user',async()=>{const encrypted=await encrypt(env,{secret:'abc'},'user-a:account:tokens');assert.deepEqual(await decrypt(env,encrypted,'user-a:account:tokens'),{secret:'abc'});await assert.rejects(()=>decrypt(env,encrypted,'user-b:account:tokens'));});
test('inbox response excludes original subjects, snippets, and sender display names',async()=>{
 mock.get('https://gmail.googleapis.com').intercept({path:'/gmail/v1/users/me/messages?maxResults=10&q=in%3Ainbox'}).reply(200,{messages:[{id}]});mockMeta();
 const response=await request('/api/messages');assert.equal(response.status,200);const text=await response.text();assert.ok(!text.includes(rawSubject));assert.ok(!text.includes(rawBody));assert.ok(!text.includes('Hostile sender'));assert.ok(text.includes('sender@example.com'));
});
test('rewrite failure returns no original; explicit reveal is required',async()=>{
 aiScenario='failure';mockRaw();
 const response=await request(`/api/messages/${id}/kind`,'POST',{});assert.equal(response.status,502);assert.ok(!(await response.text()).includes(rawBody));
 assert.equal((await request(`/api/messages/${id}/original`,'POST',{})).status,400);
 mockRaw();const original=await(await request(`/api/messages/${id}/original`,'POST',{is_reveal_requested:true})).json();assert.equal(original.original.body.trimEnd(),rawBody);assert.equal(original.original.subject,rawSubject);
});
test('retry prepares complete kind subject/body, caches encrypted output, and never overwrites original',async()=>{
 aiScenario='success';mockRaw();
 const result=await(await request(`/api/messages/${id}/kind`,'POST',{})).json();assert.equal(result.kind.subject,'Project plan');assert.ok(result.kind.body.includes('Friday at 3 PM'));const row=await db.prepare('SELECT ciphertext FROM rewrites WHERE message_id=?').bind(id).first();assert.ok(!row.ciphertext.includes('Friday'));
 const cached=await(await request(`/api/messages/${id}/kind`,'POST',{})).json();assert.deepEqual(cached,result);
});
test('model incomplete/refused output is rejected rather than showing a partial message',async()=>{
 aiScenario='incomplete';
 const result=await request('/api/rewrite','POST',{subject:'Hello',body:'Please help.'});assert.equal(result.status,502);assert.ok(!(await result.text()).includes(rawBody));
});
test('encrypted drafts persist, including recipient-only drafts',async()=>{
 const draftId='11111111-1111-4111-8111-111111111111';const draft={to:'colleague@example.com',subject:'',body:''};assert.equal((await request('/api/drafts/'+draftId,'PUT',draft)).status,200);const result=await(await request('/api/drafts')).json();assert.equal(result.drafts[0].to,draft.to);const row=await db.prepare('SELECT ciphertext FROM drafts WHERE id=?').bind(draftId).first();assert.ok(!row.ciphertext.includes(draft.to));
});
test('OAuth state requires matching browser cookie, is single-use, and PKCE is present',async()=>{
 const start=await request('/api/gmail/connect','POST',{});assert.equal(start.status,200);const auth=new URL((await start.json()).authorization_url);assert.ok(auth.searchParams.get('code_challenge'));assert.equal(auth.searchParams.get('redirect_uri'),'https://kindifier.com/api/gmail/callback');const state=auth.searchParams.get('state');assert.equal((await request('/api/gmail/callback?state='+state+'&error=access_denied')).status,303);
 let row=await db.prepare('SELECT state_hash FROM oauth_states').first();assert.ok(row);const result=await request('/api/gmail/callback?state='+state+'&error=access_denied','GET',undefined,{cookie:'__Host-kindmail-oauth='+state});assert.equal(result.status,303);row=await db.prepare('SELECT state_hash FROM oauth_states').first();assert.equal(row,null);
});
test('header injection is rejected and Unicode outgoing MIME contains exactly the confirmed content',async()=>{
 assert.equal((await request('/api/send','POST',{to:'a@example.com\r\nBcc: hidden@example.com',subject:'Hi',body:'Hello',operation_id:'22222222-2222-4222-8222-222222222222',is_confirmed:true})).status,400);
 const draft={to:'colleague@example.com',subject:'Réunion mañana',body:'Merci. Friday at 3 PM. 😊'};const mime=buildMime(account,draft,'22222222-2222-4222-8222-222222222222');const parsed=await PostalMime.parse(Buffer.from(mime,'base64url'));assert.equal(parsed.subject,draft.subject);assert.equal(parsed.text.trim(),draft.body);assert.equal(parsed.to[0].address,draft.to);
});
test('uncertain send is locked, not retried, survives reload, and can be reconciled',async()=>{
 const operation='33333333-3333-4333-8333-333333333333',draft={to:'colleague@example.com',subject:'Confirmed subject',body:'Confirmed body.'};
 await request('/api/drafts/'+operation,'PUT',draft);
 mock.get('https://gmail.googleapis.com').intercept({path:'/gmail/v1/users/me/messages/send',method:'POST'}).reply(503,{error:'provider response lost'});
 const result=await request('/api/send','POST',{...draft,operation_id:operation,is_confirmed:true});assert.equal(result.status,502);
 const second=await(await request('/api/send','POST',{...draft,operation_id:operation,is_confirmed:true})).json();assert.equal(second.status,'uncertain');
 const reloaded=await(await request('/api/drafts')).json();assert.equal(reloaded.drafts.find(d=>d.id===operation).is_send_locked,true);
 mock.get('https://gmail.googleapis.com').intercept({path:'/gmail/v1/users/me/messages?'+new URLSearchParams({q:`in:sent rfc822msgid:${operation}@${MESSAGE_ID_DOMAIN}`,maxResults:'2'})}).reply(200,{messages:[{id:'sent-message'}]});
 const checked=await(await request('/api/sends/'+operation,'POST',{})).json();assert.equal(checked.status,'sent');const third=await(await request('/api/send','POST',{...draft,operation_id:operation,is_confirmed:true})).json();assert.equal(third.status,'sent');
});
test('sample mailbox only returns original through the reveal action',async()=>{
 const list=await(await request('/api/demo/messages')).text();assert.ok(!list.includes('ridiculous'));const response=await request('/api/demo/messages/1/original','POST',{});assert.equal(response.status,400);
 const original=await(await request('/api/demo/messages/1/original','POST',{is_reveal_requested:true})).json();assert.ok(original.original.body.includes('ridiculous'));
});
test('unknown sample ids are rejected and SAMPLE_EMAILS replaces the sample mailbox',async()=>{
 assert.equal((await request('/api/demo/messages/7/kind','POST',{})).status,404);
 const sample={id:12,email:'local@example.com',subject:'Local original subject',kind_subject:'Local kind subject',original:'Hi,\n\nLocal original.',kind:'Hi,\n\nLocal kind.',is_starred:true};
 const local=new Miniflare({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-08-06',log:new Log(LogLevel.NONE),bindings:{SAMPLE_EMAILS:JSON.stringify([sample])}});
 try{const headers={'oai-authenticated-user-id':OWNER_ID,'Origin':SITE_ORIGIN,'Content-Type':'application/json'};
  const list=await(await local.dispatchFetch(SITE_ORIGIN+'/api/demo/messages?folder=starred',{headers})).json();assert.deepEqual(list.messages.map(mail=>[mail.id,mail.sender]),[['12','local@example.com']]);
  const kind=await(await local.dispatchFetch(SITE_ORIGIN+'/api/demo/messages/12/kind',{method:'POST',headers,body:'{}'})).json();assert.equal(kind.kind.subject,sample.kind_subject);assert.equal(kind.kind.body,sample.kind);assert.equal(kind.kind.preview,'Local kind.');
  const original=await(await local.dispatchFetch(SITE_ORIGIN+'/api/demo/messages/12/original',{method:'POST',headers,body:JSON.stringify({is_reveal_requested:true})})).json();assert.equal(original.original.body,sample.original);
 }finally{await local.dispose();}
});

test('stale draft saves report a conflict and preserve the newer saved text',async()=>{
 const draftId='44444444-4444-4444-8444-444444444444';
 const first=await(await request('/api/drafts/'+draftId,'PUT',{to:'colleague@example.com',subject:'Note',body:'First',revision:0})).json();assert.equal(first.revision,1);
 const second=await(await request('/api/drafts/'+draftId,'PUT',{to:'colleague@example.com',subject:'Note',body:'Newer',revision:1})).json();assert.equal(second.revision,2);
 const stale=await request('/api/drafts/'+draftId,'PUT',{to:'colleague@example.com',subject:'Note',body:'Stale',revision:1});assert.equal(stale.status,409);
 const saved=await(await request('/api/drafts')).json();assert.equal(saved.drafts.find(draft=>draft.id===draftId).body,'Newer');
});
test('reply sends carry matching thread id and original reply references',async()=>{
 const operation='55555555-5555-4555-8555-555555555555';
 await request('/api/drafts/'+operation,'PUT',{to:'sender@example.com',subject:'Re: Project plan',body:'I will send it by Friday.',reply_for:id});
 mock.get('https://gmail.googleapis.com').intercept({path:`/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`}).reply(200,{threadId:id,payload:{headers:[{name:'Message-ID',value:'<source@example.com>'},{name:'Subject',value:'Project plan'}]}});
 mock.get('https://gmail.googleapis.com').intercept({path:'/gmail/v1/users/me/messages/send',method:'POST'}).reply(200,{id:'sent-reply'});
 const result=await(await request('/api/send','POST',{to:'sender@example.com',subject:'Re: Project plan',body:'I will send it by Friday.',reply_for:id,operation_id:operation,is_confirmed:true})).json();assert.equal(result.status,'sent');
 const raw=buildMime(account,{to:'sender@example.com',subject:'Re: Project plan',body:'I will send it by Friday.'},operation,{message_id:'<source@example.com>',references:'<source@example.com>'});const parsed=await PostalMime.parse(Buffer.from(raw,'base64url'));assert.equal(parsed.inReplyTo,'<source@example.com>');
});
