import PostalMime from 'postal-mime';
import { convert } from 'html-to-text';
import { AppError,readText,base64url,fromBase64,encoder } from './security.mjs';
import { connection,refreshConnection } from './storage.mjs';
// Keep stable across website-domain changes so uncertain sends remain discoverable.
export const MESSAGE_ID_DOMAIN='legacy-kindmail.example';
export const GMAIL_SCOPE='https://www.googleapis.com/auth/gmail.modify';
export async function googleResponse(response) {
 if(!response.ok)throw new AppError(response.status===401?'gmail_reconnect_required':'gmail_unavailable',response.status===401?401:502);
 return JSON.parse(await readText(response,3000000));
}
export async function tokens(env,form) {
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({...form,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET}),signal:AbortSignal.timeout(20000)});
 if(!response.ok){const status=response.status;await response.body?.cancel();throw new AppError(status===400?'gmail_reconnect_required':'gmail_unavailable',status===400?401:502);}
 return JSON.parse(await readText(response));
}
export async function gmailSession(env,user) {
 const saved=await connection(env,user);if(!saved)throw new AppError('gmail_not_connected',401);
 if(saved.expires_at>Date.now()+60000)return saved;
 const refreshed=await tokens(env,{grant_type:'refresh_token',refresh_token:saved.refresh_token});
 if(!refreshed.access_token)throw new AppError('gmail_reconnect_required',401);
 const updated={...saved,access_token:refreshed.access_token,expires_at:Date.now()+refreshed.expires_in*1000};await refreshConnection(env,user,updated);return updated;
}
export async function gmail(session,path,options={}) {
 const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{...options,headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},signal:AbortSignal.timeout(25000)});
 return googleResponse(response);
}
export function senderAddress(header) {
 const bracket=header.match(/<([^<>]+)>/);const address=(bracket?bracket[1]:header).trim();
 return /^[^\s<>@]+@[^\s<>@]+$/.test(address)?address:'Sender address unavailable';
}
export async function metadata(session,id) {
 const message=await gmail(session,`messages/${id}?format=metadata&metadataHeaders=From`);
 return {id:message.id,thread_id:message.threadId,date:Number(message.internalDate),sender:senderAddress(message.payload?.headers?.find(h=>h.name.toLowerCase()==='from')?.value||''),is_starred:message.labelIds?.includes('STARRED')||false,is_inbox:message.labelIds?.includes('INBOX')||false,size:message.sizeEstimate};
}
export async function originalMessage(session,id) {
 const meta=await metadata(session,id);
 if(meta.size>2000000)throw new AppError('message_too_large',413);
 const raw=await gmail(session,`messages/${id}?format=raw`);
 if(typeof raw.raw!=='string'||raw.raw.length>2700000)throw new AppError('message_too_large',413);
 const message=await PostalMime.parse(fromBase64(raw.raw));
 const text=message.text?.trim()?message.text:convert(message.html||'',{wordwrap:false,selectors:[{selector:'img',format:'skip'},{selector:'a',options:{hideLinkHrefIfSameAsText:true}}]});
 return {...meta,subject:message.subject||'(No subject)',body:text,reply_to:message.replyTo?.[0]?.address||message.from?.address||'',message_id:message.messageId||'',references:message.references||'',attachment_count:message.attachments?.length||0};
}
export async function replyContext(session,sourceId,subject) {
 if(!sourceId)return {};
 const source=await gmail(session,`messages/${sourceId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`);
 const header=name=>source.payload?.headers?.find(item=>item.name.toLowerCase()===name)?.value||'';
 const messageId=header('message-id');
 if(!/^<[^<>\s]+@[^<>\s]+>$/.test(messageId))throw new AppError('reply_headers_unavailable',422);
 const references=(header('references').match(/<[^<>\s]+@[^<>\s]+>/g)||[]).slice(-10);
 const normalized=text=>text.replace(/^(\s*re:\s*)+/i,'').trim();
 return {message_id:messageId,references:[...references,messageId].join(' '),thread_id:normalized(subject)===normalized(header('subject'))?source.threadId:null};
}
export function buildMime(account,draft,operationId,reply={},messageDomain=MESSAGE_ID_DOMAIN) {
 const words=[];let chunk='';
 for(const character of draft.subject){if(encoder.encode(chunk+character).length>42){words.push(btoa(String.fromCharCode(...encoder.encode(chunk))));chunk='';}chunk+=character;}
 if(chunk||!words.length)words.push(btoa(String.fromCharCode(...encoder.encode(chunk))));
 const encodedSubject=words.map(word=>`=?UTF-8?B?${word}?=`).join('\r\n ');
 const bodyBytes=encoder.encode(draft.body);let binary='';for(const byte of bodyBytes)binary+=String.fromCharCode(byte);
 const body64=btoa(binary).match(/.{1,76}/g)?.join('\r\n')||'';
 const lines=[`From: ${account}`,`To: ${draft.to}`,`Subject: ${encodedSubject}`,`Message-ID: <${operationId}@${messageDomain}>`,...(reply.message_id?[`In-Reply-To: ${reply.message_id}`,`References: ${reply.references}`]:[]),'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',body64];
 return base64url(encoder.encode(lines.join('\r\n')));
}

export function messageIdDomain(env,account){return env.IS_LOCAL===true?account.split('@')[1]:MESSAGE_ID_DOMAIN;}
