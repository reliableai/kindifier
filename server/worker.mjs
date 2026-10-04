import {SITE_ORIGIN,AppError,requireUser,requireMutation,jsonBody,json,digest,random,encrypt,decrypt,isMessageId,isDraftId,checkDraft,logFailure} from './security.mjs';
import {connection,saveConnection,getRewrite,saveRewrite,listDrafts,saveDraft,reserveSend} from './storage.mjs';
import {GMAIL_SCOPE,messageIdDomain,tokens,gmailSession,gmail,metadata,originalMessage,buildMime,replyContext} from './google.mjs';
import {rewriteEmail} from './rewrite.mjs';
import {sampleEmails} from './demo.mjs';
import {assets} from './assets.generated.mjs';
const redirect=(path,cookie,origin=SITE_ORIGIN)=>new Response(null,{status:303,headers:{Location:origin+path,'Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})}});
const cookie=(value,seconds,is_local=false)=>`${is_local?'kindifier-oauth':'__Host-kindmail-oauth'}=${value}; Path=/; ${is_local?'':'Secure; '}HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
const COOKIE_CLEAR=cookie('',0);
// SAMPLE_EMAILS is set only by the local dev server (KINDMAIL_SAMPLE_FILE); deployments use the fictional samples.
const sampleMailbox=env=>env.SAMPLE_EMAILS?JSON.parse(env.SAMPLE_EMAILS):sampleEmails;
function setup(env){return {is_google_configured:!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET),is_ai_configured:!!(env.AI_API_KEY||env.OPENAI_API_KEY),is_storage_configured:!!(env.DB&&env.TOKEN_ENCRYPTION_KEY),is_local:env.IS_LOCAL===true,provider:env.AI_PROVIDER||'openai',model:env.AI_MODEL||env.OPENAI_MODEL||'gpt-4.1-mini',is_disclosure_accepted:env.IS_DISCLOSURE_ACCEPTED===true,is_auto_prepare:env.IS_AUTO_PREPARE===true,callback_url:(env.SITE_ORIGIN||SITE_ORIGIN)+'/api/gmail/callback'};}
async function authenticatedSession(env,user){if(!env.DB||!env.TOKEN_ENCRYPTION_KEY)throw new AppError('setup_required',503);return gmailSession(env,user);}
async function handle(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(!path.startsWith('/api/')){
  const asset=assets[path==='/'?'/index.html':path];if(!asset)return new Response('Not found',{status:404});
  return new Response(asset.content,{headers:{'Content-Type':asset.type,'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'; form-action 'self' https://accounts.google.com",'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
 }
 const origin=env.SITE_ORIGIN||SITE_ORIGIN;
 const user=requireUser(request,origin);
 if(request.method!=='GET')requireMutation(request,origin);
 if(env.IS_LOCAL===true&&['/api/rewrite','/api/gmail/connect'].includes(path)&&!env.IS_DISCLOSURE_ACCEPTED)throw new AppError('disclosure_required',403);
 if(path==='/api/status'&&request.method==='GET'){
  const config=setup(env);const saved=config.is_storage_configured?await connection(env,user):null;
  return json({...config,is_connected:!!saved,account:saved?.account||null});
 }
 if(path==='/api/gmail/connect'&&request.method==='POST'){
  const config=setup(env);if(!config.is_google_configured||!config.is_storage_configured||!config.is_ai_configured)throw new AppError('setup_required',503);
  const state=random(),verifier=random();
  await env.DB.prepare('DELETE FROM oauth_states WHERE user_id=? OR expires_at<?').bind(user,Date.now()).run();
  await env.DB.prepare('INSERT INTO oauth_states(state_hash,user_id,verifier,expires_at) VALUES(?,?,?,?)').bind(await digest(state),user,await encrypt(env,verifier,user+':oauth'),Date.now()+600000).run();
  const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:config.callback_url,response_type:'code',scope:GMAIL_SCOPE,access_type:'offline',prompt:'consent',state,code_challenge:await digest(verifier),code_challenge_method:'S256'}).toString();
  const result=json({authorization_url:auth.href});result.headers.set('Set-Cookie',cookie(state,600,env.IS_LOCAL===true));return result;
 }
 if(path==='/api/gmail/callback'&&request.method==='GET'){
  const state=url.searchParams.get('state');
  const browserState=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(env.IS_LOCAL===true?'kindifier-oauth=':'__Host-kindmail-oauth='))?.split('=')[1];
  if(!state||state!==browserState)throw new AppError('oauth_state_invalid',403);
  const row=await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=? AND user_id=? AND expires_at>? RETURNING verifier').bind(await digest(state),user,Date.now()).first();
  if(!row)throw new AppError('oauth_state_invalid',403);
  if(url.searchParams.has('error'))return redirect('/?connection=declined',cookie('',0,env.IS_LOCAL===true),origin);
  const code=url.searchParams.get('code');if(!code)throw new AppError('oauth_code_missing');
  const token=await tokens(env,{grant_type:'authorization_code',code,redirect_uri:setup(env).callback_url,code_verifier:await decrypt(env,row.verifier,user+':oauth')});
  if(!token.refresh_token||!token.access_token||!token.scope?.split(' ').includes(GMAIL_SCOPE))throw new AppError('gmail_permission_missing',403);
  const profile=await gmail(token,'profile');
  if(!/^[^\s<>@]+@[^\s<>@]+$/.test(profile.emailAddress))throw new AppError('gmail_account_invalid',502);
  const previous=await connection(env,user);
  if(previous&&previous.account!==profile.emailAddress)throw new AppError('disconnect_before_switching',409);
  await saveConnection(env,user,{account:profile.emailAddress,...token,expires_at:Date.now()+token.expires_in*1000});
  return redirect('/?connection=connected',cookie('',0,env.IS_LOCAL===true),origin);
 }
 if(path==='/api/rewrite'&&request.method==='POST'){
  if(!(env.AI_API_KEY||env.OPENAI_API_KEY))throw new AppError('ai_not_configured',503);
  const {subject,body}=await jsonBody(request);const draft=checkDraft({to:'draft@example.com',subject,body});
  const hash=await digest(JSON.stringify({subject:draft.subject,body:draft.body}));
  return json({rewrite:await rewriteEmail(env,draft.subject,draft.body),snapshot:hash});
 }
 if(path==='/api/demo/messages'&&request.method==='GET'){
  const folder=url.searchParams.get('folder')||'inbox';
  const list=folder==='archive'?[]:sampleMailbox(env).filter(mail=>folder!=='starred'||mail.is_starred);
  return json({messages:list.map(mail=>({id:String(mail.id),sender:mail.email,date:0,is_starred:mail.is_starred,is_inbox:true,kind:null})),next_page:null,is_demo:true});
 }
 const sampleRoute=path.match(/^\/api\/demo\/messages\/(\d{1,3})\/(kind|original)$/);
 if(sampleRoute&&request.method==='POST'){
  const sample=sampleMailbox(env).find(mail=>mail.id===Number(sampleRoute[1]));if(!sample)throw new AppError('not_found',404);
  if(sampleRoute[2]==='original'){
   const body=await jsonBody(request);if(body.is_reveal_requested!==true)throw new AppError('explicit_reveal_required');
   return json({original:{subject:sample.subject,body:sample.original,reply_to:sample.email,attachment_count:0},is_demo:true});
  }
  if(typeof sample.kind_subject!=='string'||!sample.kind_subject.trim()||typeof sample.kind!=='string'||!sample.kind.trim())throw new AppError('rewrite_unavailable',502);
  return json({kind:{subject:sample.kind_subject,body:sample.kind,preview:(sample.kind.split('\n\n')[1]||sample.kind).slice(0,300),reply_to:sample.email,attachment_count:0},is_demo:true});
 }
 if(path==='/api/gmail/disconnect'&&request.method==='POST'){
  const saved=await connection(env,user);
  if(saved){
   const result=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:saved.refresh_token}),signal:AbortSignal.timeout(20000)});
   if(!result.ok)throw new AppError('disconnect_failed',502);
  }
  await env.DB.batch(['connections','rewrites','drafts','sends','oauth_states'].map(table=>env.DB.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(user)));
  return json({is_disconnected:true});
 }
 const session=await authenticatedSession(env,user);
 if(path==='/api/messages'&&request.method==='GET'){
  const folder=url.searchParams.get('folder')||'inbox';
  const query=folder==='inbox'?'in:inbox':folder==='starred'?'is:starred':folder==='archive'?'-in:inbox -in:trash -in:spam -in:sent -is:draft':null;
  if(!query)throw new AppError('invalid_folder');
  const params=new URLSearchParams({maxResults:env.IS_LOCAL===true?'20':'10',q:query});const page=url.searchParams.get('page');if(page){if(page.length>1000)throw new AppError('invalid_page');params.set('pageToken',page);}
  const list=await gmail(session,'messages?'+params);
  const messages=[];
  for(const entry of list.messages||[]){const meta=await metadata(session,entry.id);const kind=await getRewrite(env,user,session.account,entry.id);messages.push({...meta,kind});}
  return json({messages,next_page:list.nextPageToken||null});
 }
 const messageRoute=path.match(/^\/api\/messages\/([a-f0-9]+)\/(kind|original|labels)$/);
 if(messageRoute&&request.method==='POST'){
  const [,id,action]=messageRoute;if(!isMessageId(id))throw new AppError('invalid_message_id');
  if(action==='labels'){
   const body=await jsonBody(request);if(!['star','archive'].includes(body.action)||typeof body.is_enabled!=='boolean')throw new AppError('invalid_label_action');
   const label=body.action==='star'?'STARRED':'INBOX';const is_add=body.action==='star'?body.is_enabled:!body.is_enabled;
   await gmail(session,`messages/${id}/modify`,{method:'POST',body:JSON.stringify({addLabelIds:is_add?[label]:[],removeLabelIds:is_add?[]:[label]})});
   return json({is_updated:true});
  }
  if(action==='kind'){
   const requestBody=await jsonBody(request);if(env.IS_LOCAL===true&&requestBody.is_automatic===true&&!env.IS_AUTO_PREPARE)throw new AppError('automatic_paused',409);
   if(env.IS_LOCAL===true&&!env.IS_DISCLOSURE_ACCEPTED)throw new AppError('disclosure_required',403);
   const cached=await getRewrite(env,user,session.account,id);if(cached)return json({kind:cached});
   const original=await originalMessage(session,id);
   const kind={...await rewriteEmail(env,original.subject,original.body),reply_to:original.reply_to,attachment_count:original.attachment_count};
   await saveRewrite(env,user,session,id,kind);return json({kind});
  }
  const body=await jsonBody(request);if(body.is_reveal_requested!==true)throw new AppError('explicit_reveal_required');
  const original=await originalMessage(session,id);
  return json({original:{subject:original.subject,body:original.body,reply_to:original.reply_to,attachment_count:original.attachment_count}});
 }
 if(path==='/api/drafts'&&request.method==='GET')return json({drafts:await listDrafts(env,user,session.account)});
 const draftRoute=path.match(/^\/api\/drafts\/([a-f0-9-]+)$/);
 if(draftRoute&&request.method==='PUT'){
  const id=draftRoute[1];if(!isDraftId(id))throw new AppError('invalid_draft_id');
  const value=await jsonBody(request);
  if(['to','subject','body'].some(key=>typeof value[key]!=='string')||value.to.length>254||value.subject.length>500||value.body.length>30000)throw new AppError('invalid_draft');
  if(value.reply_for!=null&&!isMessageId(value.reply_for))throw new AppError('invalid_reply');
  const baseRevision=value.revision??0;if(!Number.isInteger(baseRevision)||baseRevision<0)throw new AppError('invalid_revision');
  const saved={to:value.to,subject:value.subject,body:value.body,reply_for:value.reply_for||null};const revision=await saveDraft(env,user,session,id,saved,baseRevision);return json({id,revision});
 }
 if(path==='/api/send'&&request.method==='POST'){
  const body=await jsonBody(request);const draft=checkDraft(body);const id=body.operation_id;
  if(!isDraftId(id)||body.is_confirmed!==true)throw new AppError('send_confirmation_required');
  const hash=await digest(JSON.stringify(draft));
  const existing=await env.DB.prepare('SELECT digest,status,gmail_id FROM sends WHERE user_id=? AND account=? AND id=?').bind(user,session.account,id).first();
  if(existing){if(existing.digest!==hash)throw new AppError('send_content_changed',409);return json({status:existing.status,gmail_id:existing.gmail_id});}
  const reply=await replyContext(session,draft.reply_for,draft.subject);
  const saved=await env.DB.prepare('SELECT ciphertext,revision FROM drafts WHERE user_id=? AND account=? AND id=?').bind(user,session.account,id).first();
  if(!saved||await digest(JSON.stringify(checkDraft(await decrypt(env,saved.ciphertext,`${user}:${session.account}:draft:${id}`))))!==hash)throw new AppError('draft_conflict',409);
  // Reserve before any external effect. A duplicate operation never sends again.
  await reserveSend(env,user,session,id,hash,saved.revision);
  const message=await gmail(session,'messages/send',{method:'POST',body:JSON.stringify({raw:buildMime(session.account,draft,id,reply,messageIdDomain(env,session.account)),...(reply.thread_id?{threadId:reply.thread_id}:{})})});
  if(!message.id)throw new AppError('send_outcome_unknown',502);
  await env.DB.prepare("UPDATE sends SET status='sent',gmail_id=? WHERE user_id=? AND account=? AND id=?").bind(message.id,user,session.account,id).run();
  return json({status:'sent',gmail_id:message.id});
 }
 const sendCheck=path.match(/^\/api\/sends\/([a-f0-9-]+)$/);
 if(sendCheck&&request.method==='POST'){
  const id=sendCheck[1];if(!isDraftId(id))throw new AppError('invalid_send_id');
  const existing=await env.DB.prepare('SELECT status,gmail_id FROM sends WHERE user_id=? AND account=? AND id=?').bind(user,session.account,id).first();if(!existing)throw new AppError('send_not_found',404);
  if(existing.status==='sent')return json(existing);
  const found=await gmail(session,'messages?'+new URLSearchParams({q:`in:sent rfc822msgid:${id}@${messageIdDomain(env,session.account)}`,maxResults:'2'}));
  if(found.messages?.length===1){await env.DB.prepare("UPDATE sends SET status='sent',gmail_id=? WHERE user_id=? AND account=? AND id=?").bind(found.messages[0].id,user,session.account,id).run();return json({status:'sent',gmail_id:found.messages[0].id});}
  return json({status:'uncertain',gmail_id:null});
 }
 throw new AppError('not_found',404);
}
export default {async fetch(request,env){
 const requestId=crypto.randomUUID();
 try{return await handle(request,env);}
 catch(error){logFailure(error,new URL(request.url).pathname,requestId);const code=error instanceof AppError?error.code:'service_unavailable';
  if(new URL(request.url).pathname==='/api/gmail/callback')return redirect('/?connection=failed',cookie('',0,env.IS_LOCAL===true),env.SITE_ORIGIN||SITE_ORIGIN);
  return json({error:{code,request_id:requestId}},error instanceof AppError?error.status:502);
 }
}};
