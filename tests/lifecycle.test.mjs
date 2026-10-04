import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare,createFetchMock,Log,LogLevel} from 'miniflare';
import PostalMime from 'postal-mime';
import {SITE_ORIGIN,encrypt,decrypt} from '../server/security.mjs';
import {connection,saveConnection,saveDraft,reserveSend} from '../server/storage.mjs';

const user='lifecycle-user',account='owner@example.com',id='18aabbccddeeff00';
const draftId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const draft={to:'friend@example.com',subject:'Confirmed subject',body:'Confirmed content',reply_for:null};

test('connection migration preserves existing encrypted tokens and assigns distinct identities',async t=>{
 const mf=new Miniflare({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-08-06',d1Databases:['DB'],log:new Log(LogLevel.NONE)});t.after(()=>mf.dispose());
 const env={DB:await mf.getD1Database('DB'),TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64')};
 await env.DB.prepare('CREATE TABLE connections (user_id text PRIMARY KEY NOT NULL, account text NOT NULL, ciphertext text NOT NULL)').run();
 const tokens={access_token:'legacy-access',refresh_token:'legacy-refresh',expires_at:123};
 for(const owner of [user,'second-user'])await env.DB.prepare('INSERT INTO connections VALUES(?,?,?)').bind(owner,account,await encrypt(env,tokens,`${owner}:${account}:tokens`)).run();
 for(const sql of(await readFile('drizzle/0002_connection_identity.sql','utf8')).split('--> statement-breakpoint'))await env.DB.prepare(sql.trim()).run();
 const first=await connection(env,user),second=await connection(env,'second-user');
 assert.equal(first.access_token,tokens.access_token);assert.equal(second.refresh_token,tokens.refresh_token);
 assert.ok(first.connection_id);assert.notEqual(first.connection_id,second.connection_id);
});

function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
async function runtime(t){
 const mock=createFetchMock();mock.disableNetConnect();
 const mf=new Miniflare({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-08-06',d1Databases:['DB'],log:new Log(LogLevel.NONE),bindings:{TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64'),GOOGLE_CLIENT_ID:'fictional-client',GOOGLE_CLIENT_SECRET:'fictional-secret',OPENAI_API_KEY:'fictional-key'},outboundService:async request=>{
  if(state.waitFor&&new URL(request.url).hostname===state.waitFor){state.started.resolve();await state.release.promise;}
  const body=await request.text();
  if(new URL(request.url).pathname.endsWith('/messages/send'))state.sent.push(JSON.parse(body));
  return fetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),...(!['GET','HEAD'].includes(request.method)?{body}:{}),dispatcher:mock});
 }});
 const state={mock,mf,sent:[],started:deferred(),release:deferred()};
 t.after(async()=>{state.release.resolve();await mf.dispose();await mock.close();});
 const DB=await mf.getD1Database('DB');state.env={DB,TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64')};
 for(const file of(await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const sql of(await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await DB.prepare(sql).run();
 state.connect=()=>saveConnection(state.env,user,{account,access_token:'fictional-access',refresh_token:'fictional-refresh',expires_at:Date.now()+3600000});
 await state.connect();
 state.request=(path,method='GET',value)=>mf.dispatchFetch(SITE_ORIGIN+path,{method,headers:{'oai-authenticated-user-id':user,origin:SITE_ORIGIN,'content-type':'application/json'},...(value===undefined?{}:{body:JSON.stringify(value)})});
 state.disconnect=async()=>{mock.get('https://oauth2.googleapis.com').intercept({path:'/revoke',method:'POST'}).reply(200,{});assert.equal((await state.request('/api/gmail/disconnect','POST',{})).status,200);};
 return state;
}

for(const is_reconnect of [false,true]){
 test(`in-flight rewrite cannot persist after disconnect (reconnect=${is_reconnect})`,async t=>{
  const r=await runtime(t);r.waitFor='api.openai.com';
  const raw=Buffer.from('From: sender@example.com\r\nSubject: Original subject\r\nContent-Type: text/plain\r\n\r\nOriginal text.').toString('base64url');
  r.mock.get('https://gmail.googleapis.com').intercept({path:`/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From`}).reply(200,{id,sizeEstimate:100});
  r.mock.get('https://gmail.googleapis.com').intercept({path:`/gmail/v1/users/me/messages/${id}?format=raw`}).reply(200,{id,raw});
  r.mock.get('https://api.openai.com').intercept({path:'/v1/responses',method:'POST'}).reply(200,{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({subject:'Kind subject',body:'Kind body',preview:'Kind preview',is_complete:true})}]}]});
  const pending=r.request(`/api/messages/${id}/kind`,'POST',{});await r.started.promise;
  await r.disconnect();if(is_reconnect)await r.connect();r.release.resolve();
  const response=await pending;assert.equal(response.status,401);assert.equal((await response.json()).error.code,'gmail_not_connected');
  assert.equal((await r.env.DB.prepare('SELECT count(*) AS n FROM rewrites').first()).n,0);
 });
 test(`in-flight refresh cannot resurrect or overwrite a connection (reconnect=${is_reconnect})`,async t=>{
  const r=await runtime(t);
  await saveConnection(r.env,user,{account,access_token:'expired',refresh_token:'old-refresh',expires_at:0});
  r.waitFor='oauth2.googleapis.com';
  r.mock.get('https://oauth2.googleapis.com').intercept({path:'/token',method:'POST'}).reply(200,{access_token:'stale-refreshed-token',expires_in:3600});
  const pending=r.request('/api/drafts');await r.started.promise;
  // Let revocation run while the token response is held.
  r.waitFor=null;await r.disconnect();if(is_reconnect)await r.connect();r.release.resolve();
  assert.equal((await pending).status,401);
  const current=await connection(r.env,user);
  assert.equal(current?.access_token||null,is_reconnect?'fictional-access':null);
 });
}

test('disconnect without a connection deletes residual personal records',async t=>{
 const r=await runtime(t);await r.request('/api/drafts/'+draftId,'PUT',draft);
 await r.env.DB.prepare('DELETE FROM connections WHERE user_id=?').bind(user).run();
 assert.equal((await r.request('/api/gmail/disconnect','POST',{})).status,200);
 assert.equal((await r.env.DB.prepare('SELECT count(*) AS n FROM drafts').first()).n,0);
});

test('stale sessions and deleted draft revisions cannot recreate drafts',async t=>{
 const r=await runtime(t),oldSession=await connection(r.env,user);
 await r.disconnect();await r.connect();
 await assert.rejects(saveDraft(r.env,user,oldSession,draftId,draft,0),{code:'gmail_not_connected'});
 const response=await r.request('/api/drafts/'+draftId,'PUT',{...draft,revision:2});assert.equal(response.status,409);
 assert.equal((await r.env.DB.prepare('SELECT count(*) AS n FROM drafts').first()).n,0);
});

for(const status of [200,503])test(`sent and uncertain drafts reject later saves (provider=${status})`,async t=>{
 const r=await runtime(t);
 const saved=await(await r.request('/api/drafts/'+draftId,'PUT',draft)).json();
 r.mock.get('https://gmail.googleapis.com').intercept({path:'/gmail/v1/users/me/messages/send',method:'POST'}).reply(status,{id:'sent-id'});
 const response=await r.request('/api/send','POST',{...draft,operation_id:draftId,is_confirmed:true});assert.equal(response.status,status===200?200:502);
 const late=await r.request('/api/drafts/'+draftId,'PUT',{...draft,body:'Unsent edits from another tab',revision:saved.revision});
 assert.equal(late.status,409);assert.equal((await late.json()).error.code,'draft_send_locked');
 const row=await r.env.DB.prepare('SELECT ciphertext FROM drafts WHERE id=?').bind(draftId).first();
 assert.equal((await decrypt(r.env,row.ciphertext,`${user}:${account}:draft:${draftId}`)).body,draft.body);
 assert.equal(r.sent.length,1);const mime=await PostalMime.parse(Buffer.from(r.sent[0].raw,'base64url'));
 assert.equal(mime.subject,draft.subject);assert.equal(mime.text.trimEnd(),draft.body);assert.equal(mime.to[0].address,draft.to);
});

test('a draft changed after review cannot send the older snapshot',async t=>{
 const r=await runtime(t);await r.request('/api/drafts/'+draftId,'PUT',draft);
 await r.request('/api/drafts/'+draftId,'PUT',{...draft,body:'Newer text',revision:1});
 const response=await r.request('/api/send','POST',{...draft,operation_id:draftId,is_confirmed:true});
 assert.equal(response.status,409);assert.equal((await response.json()).error.code,'draft_conflict');assert.equal(r.sent.length,0);
 assert.equal((await r.env.DB.prepare('SELECT count(*) AS n FROM sends').first()).n,0);
});

test('a revision changed between snapshot validation and reservation blocks sending',async t=>{
 const r=await runtime(t),session=await connection(r.env,user);
 const revision=await saveDraft(r.env,user,session,draftId,draft,0);
 await saveDraft(r.env,user,session,draftId,{...draft,body:'Newer text'},revision);
 await assert.rejects(reserveSend(r.env,user,session,draftId,'reviewed-content-hash',revision),{code:'draft_conflict'});
 assert.equal((await r.env.DB.prepare('SELECT count(*) AS n FROM sends').first()).n,0);
});

test('disconnect while reply headers load blocks an old send reservation',async t=>{
 const r=await runtime(t),reply={...draft,reply_for:id};await r.request('/api/drafts/'+draftId,'PUT',reply);
 r.waitFor='gmail.googleapis.com';
 r.mock.get('https://gmail.googleapis.com').intercept({path:`/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`}).reply(200,{threadId:id,payload:{headers:[{name:'Message-ID',value:'<original@example.com>'},{name:'Subject',value:draft.subject}]}});
 const pending=r.request('/api/send','POST',{...reply,operation_id:draftId,is_confirmed:true});await r.started.promise;
 await r.disconnect();await r.connect();await r.request('/api/drafts/'+draftId,'PUT',reply);r.release.resolve();
 assert.equal((await pending).status,409);assert.equal(r.sent.length,0);
 assert.equal((await r.env.DB.prepare('SELECT count(*) AS n FROM sends').first()).n,0);
});
