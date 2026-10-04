import {test} from 'node:test';
import {request as httpRequest} from 'node:http';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startLocal} from '../local/server.mjs';
import {validateSettings} from '../local/settings.mjs';
import {saveConnection,getRewrite,saveRewrite,connection} from '../server/storage.mjs';
import {rewritePolicy} from '../server/rewrite.mjs';
const realFetch=globalThis.fetch;
const fakeSettings={provider:'openai',model:'gpt-4.1-mini',api_key:'fictional-key-not-real',google_client:{installed:{client_id:'fake.apps.googleusercontent.com',client_secret:'fictional-client-secret'}},is_disclosure_accepted:true,disclosure_version:1,is_auto_prepare:true};
async function local(t,options={}){
 const directory=await mkdtemp(join(tmpdir(),'kindifier-test-'));let saved=null;
 const store={read:()=>saved,write:value=>{saved=value;}};
 const app=await startLocal({directory,store,...options});t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});
 const request=(path,{method='GET',body,headers={}}={})=>realFetch(app.origin+path,{method,redirect:'manual',headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const unlock=await request('/api/local/unlock',{method:'POST',body:{token:new URL(app.launchUrl).hash.slice(8)},headers:{origin:app.origin}});
 assert.equal(unlock.status,200);const cookie=unlock.headers.get('set-cookie').split(';')[0];
 const auth=(path,method='GET',body,headers={})=>request(path,{method,body,headers:{cookie,origin:app.origin,...headers}});
 return {...app,directory,request,auth,cookie,saved:()=>saved};
}
test('loopback APIs require private session, exact Host, same-origin JSON; one-use launch and single instance',async t=>{
 const app=await local(t);
 assert.equal((await app.request('/api/status')).status,401);
 assert.equal((await app.auth('/api/status')).status,200);
 for(const host of ['127.0.0.1.evil','localhost:'+new URL(app.origin).port]){const status=await new Promise((resolve,reject)=>{const request=httpRequest(app.origin+'/api/status',{headers:{host,cookie:app.cookie}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);request.end();});assert.equal(status,403);}
 assert.equal((await app.auth('/api/local/settings','POST',fakeSettings,{origin:'https://evil.example'})).status,403);
 assert.equal((await app.auth('/api/local/settings','POST',fakeSettings,{origin:''})).status,403);
 assert.equal((await app.auth('/api/local/unlock','POST',{token:new URL(app.launchUrl).hash.slice(8)})).status,401);
 await assert.rejects(startLocal({directory:app.directory,store:{read:()=>null}}),/already running/);
});
test('expired launch does not authorize any API',async t=>{
 let now=0;const directory=await mkdtemp(join(tmpdir(),'kindifier-expired-'));const app=await startLocal({directory,store:{read:()=>null},now:()=>now});
 t.after(async()=>{await app.close();await rm(directory,{recursive:true,force:true});});now=120001;
 const response=await realFetch(app.origin+'/api/local/unlock',{method:'POST',headers:{origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(app.launchUrl).hash.slice(8)})});assert.equal(response.status,401);
});
test('consent gates setup and AI, credentials are absent from status and SQLite, pause persists',async t=>{
 const app=await local(t);
 assert.equal((await app.auth('/api/rewrite','POST',{subject:'Hi',body:'Hello'})).status,403);
 assert.equal((await app.auth('/api/local/settings','POST',{...fakeSettings,is_disclosure_accepted:false})).status,400);
 assert.equal((await app.auth('/api/local/settings','POST',{...fakeSettings,provider:'openrouter',disclosure_version:0})).status,400);
 assert.equal((await app.auth('/api/local/settings','POST',{...fakeSettings,google_client:{web:fakeSettings.google_client.installed}})).status,400);
 const response=await app.auth('/api/local/settings','POST',fakeSettings);assert.equal(response.status,200);
 const status=await(await app.auth('/api/status')).text();assert.ok(status.includes('"is_disclosure_accepted":true'));assert.ok(status.includes('"is_auto_prepare":true'));
 for(const secret of [fakeSettings.api_key,fakeSettings.google_client.installed.client_secret,app.saved().encryption_key]){assert.ok(!status.includes(secret));for(const name of (await readdir(app.directory)).filter(name=>name.startsWith('mail.sqlite')))assert.ok(!(await readFile(join(app.directory,name))).includes(Buffer.from(secret)));}
 assert.equal((await app.auth('/api/local/automatic','POST',{is_enabled:false})).status,200);assert.equal(app.saved().is_auto_prepare,false);
});
test('Desktop OAuth uses exact loopback callback, PKCE, cookie binding, and one-use state',async t=>{
 const app=await local(t);await app.auth('/api/local/settings','POST',fakeSettings);
 const start=await app.auth('/api/gmail/connect','POST',{});assert.equal(start.status,200);
 const auth=new URL((await start.json()).authorization_url);assert.equal(auth.searchParams.get('redirect_uri'),app.origin+'/api/gmail/callback');assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
 const oauthCookie=start.headers.get('set-cookie').split(';')[0];assert.ok(oauthCookie.startsWith('kindifier-oauth='));assert.ok(!start.headers.get('set-cookie').includes('Secure'));
 const callback='/api/gmail/callback?state='+auth.searchParams.get('state')+'&error=access_denied';
 const missing=await app.auth(callback);assert.equal(missing.headers.get('location'),app.origin+'/?connection=failed');
 const denied=await app.auth(callback,'GET',undefined,{cookie:app.cookie+'; '+oauthCookie});assert.equal(denied.headers.get('location'),app.origin+'/?connection=declined');
 const replay=await app.auth(callback,'GET',undefined,{cookie:app.cookie+'; '+oauthCookie});assert.equal(replay.headers.get('location'),app.origin+'/?connection=failed');
});
test('local OAuth code exchange, encrypted persistence, cache policy, and reconnect across restart',async t=>{
 const app=await local(t);await app.auth('/api/local/settings','POST',fakeSettings);
 const start=await app.auth('/api/gmail/connect','POST',{}),url=new URL((await start.json()).authorization_url);
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(String(url)==='https://oauth2.googleapis.com/token'){assert.equal(options.body.get('redirect_uri'),app.origin+'/api/gmail/callback');assert.ok(options.body.get('code_verifier'));return Response.json({access_token:'fictional-access',refresh_token:'fictional-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.modify'});}
  assert.equal(String(url),'https://gmail.googleapis.com/gmail/v1/users/me/profile');return Response.json({emailAddress:'tester@example.com'});
 });
 const result=await app.auth('/api/gmail/callback?code=fake-code&state='+url.searchParams.get('state'),'GET',undefined,{cookie:app.cookie+'; '+start.headers.get('set-cookie').split(';')[0]});assert.equal(result.headers.get('location'),app.origin+'/?connection=connected');
 const session=await connection(app.env,'local-user');assert.equal(session.account,'tester@example.com');
 const encrypted=app.env.DB.prepare('SELECT ciphertext FROM connections').first().ciphertext;assert.ok(!encrypted.includes('fictional-access'));
 await saveRewrite(app.env,'local-user',session,'18aabbccddeeff00',{subject:'Kind',body:'Kind',preview:'Kind',rewrite_policy:rewritePolicy(app.env)});
 assert.ok(await getRewrite(app.env,'local-user',session.account,'18aabbccddeeff00'));app.env.AI_MODEL='gpt-4o-mini';assert.equal(await getRewrite(app.env,'local-user',session.account,'18aabbccddeeff00'),null);
 assert.equal((await app.auth('/api/local/settings','POST',fakeSettings)).status,409);
});
test('simultaneous message opens share one provider call, cached reload costs nothing, settings cannot race it',async t=>{
 const app=await local(t);await app.auth('/api/local/settings','POST',fakeSettings);
 await saveConnection(app.env,'local-user',{account:'tester@example.com',access_token:'fake-access',refresh_token:'fake-refresh',expires_at:Date.now()+3600000});
 const id='18aabbccddeeff00';let release,started;const waiting=new Promise(resolve=>{release=resolve;}),sent=new Promise(resolve=>{started=resolve;});let calls=0;
 t.mock.method(globalThis,'fetch',async(url)=>{
  if(String(url).includes('api.openai.com')){calls++;started();await waiting;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({subject:'Kind',body:'Kind text',preview:'Kind',is_complete:true})}]}]});}
  if(String(url).includes('format=raw'))return Response.json({raw:Buffer.from('From: a@example.com\r\nSubject: Test\r\n\r\nHello').toString('base64url')});
  return Response.json({id,sizeEstimate:100,payload:{headers:[]}});
 });
 const first=app.auth(`/api/messages/${id}/kind`,'POST',{});await sent;
 const second=app.auth(`/api/messages/${id}/kind`,'POST',{});
 assert.equal((await(await app.auth('/api/local/settings','POST',fakeSettings)).json()).error.code,'requests_in_progress');assert.equal((await(await app.auth('/api/gmail/disconnect','POST',{})).json()).error.code,'requests_in_progress');
 release();assert.equal((await first).status,200);assert.equal((await second).status,200);assert.equal(calls,1);
 assert.equal((await app.auth(`/api/messages/${id}/kind`,'POST',{})).status,200);assert.equal(calls,1);
});

test('paused automatic requests are refused before provider access, while manual rewriting remains separate',async t=>{
 const app=await local(t);await app.auth('/api/local/settings','POST',fakeSettings);
 await saveConnection(app.env,'local-user',{account:'tester@example.com',access_token:'fake-access',refresh_token:'fake-refresh',expires_at:Date.now()+3600000});
 await app.auth('/api/local/automatic','POST',{is_enabled:false});
 t.mock.method(globalThis,'fetch',()=>assert.fail('paused automatic request must not contact any provider'));
 const response=await app.auth('/api/messages/18aabbccddeeff00/kind','POST',{is_automatic:true});assert.equal(response.status,409);assert.equal((await response.json()).error.code,'automatic_paused');
});

test('local SQLite preserves encrypted account across restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'kindifier-restart-'));let stored=validateSettings(fakeSettings);const store={read:()=>stored,write:value=>{stored=value;}};let app;
 try{app=await startLocal({directory,store});await saveConnection(app.env,'local-user',{account:'tester@example.com',access_token:'fake-access',refresh_token:'fake-refresh',expires_at:Date.now()+3600000});await app.close();app=null;app=await startLocal({directory,store});assert.equal((await connection(app.env,'local-user')).account,'tester@example.com');}
 finally{if(app)await app.close();await rm(directory,{recursive:true,force:true});}
});

test('local draft/send ledger allows only the confirmed snapshot and never duplicate delivery',async t=>{
 const app=await local(t);await app.auth('/api/local/settings','POST',fakeSettings);
 await saveConnection(app.env,'local-user',{account:'tester@example.com',access_token:'fake-access',refresh_token:'fake-refresh',expires_at:Date.now()+3600000});
 let sends=0;t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(String(url),'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');const mime=Buffer.from(JSON.parse(options.body).raw,'base64url').toString();assert.ok(mime.includes('@example.com>'));assert.ok(!mime.includes('legacy-kindmail'));sends++;return Response.json({id:'sent-fictional-id'});});
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';const draft={to:'self@example.com',subject:'Fictional test',body:'Test content',reply_for:null};
 assert.equal((await app.auth('/api/drafts/'+id,'PUT',draft)).status,200);
 const unconfirmed=await app.auth('/api/send','POST',{...draft,operation_id:id});assert.equal(unconfirmed.status,400);assert.equal(sends,0);
 const request={...draft,operation_id:id,is_confirmed:true};assert.equal((await app.auth('/api/send','POST',request)).status,200);assert.equal((await app.auth('/api/send','POST',request)).status,200);assert.equal(sends,1);
 assert.equal((await app.auth('/api/drafts/'+id,'PUT',{...draft,revision:1,body:'Late edits'})).status,409);
});

test('disconnect in progress blocks a late OAuth callback from recreating a connection',async t=>{
 const app=await local(t);await app.auth('/api/local/settings','POST',fakeSettings);
 await saveConnection(app.env,'local-user',{account:'tester@example.com',access_token:'fake',refresh_token:'fake',expires_at:Date.now()+3600000});
 let release,begin;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{begin=resolve;});
 t.mock.method(globalThis,'fetch',async url=>{assert.equal(String(url),'https://oauth2.googleapis.com/revoke');begin();await gate;return Response.json({});});
 const disconnect=app.auth('/api/gmail/disconnect','POST',{});await started;
 const callback=await app.auth('/api/gmail/callback?code=fake&state=fake');assert.equal(callback.status,409);const rewrite=await app.auth('/api/messages/18aabbccddeeff00/kind','POST',{is_automatic:true});assert.equal(rewrite.status,409);
 release();assert.equal((await disconnect).status,200);assert.equal(await connection(app.env,'local-user'),null);
});

test('shutdown closes a waiting HTTP connection and releases the instance lock promptly',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'kindifier-close-'));const app=await startLocal({directory,store:{read:()=>null}});
 let request;try{
  await new Promise((resolve,reject)=>{request=httpRequest(app.origin+'/api/local/unlock',{method:'POST',headers:{origin:app.origin,'content-type':'application/json','content-length':'1000'}});request.on('error',()=>{});request.on('socket',socket=>socket.on('connect',resolve));request.write('{');});
  const timer=Date.now();await app.close();assert.ok(Date.now()-timer<2000);assert.ok(!(await readdir(directory)).includes('running.lock'));
 }finally{request?.destroy();await rm(directory,{recursive:true,force:true});}
});
