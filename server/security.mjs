export const SITE_ORIGIN = 'https://kindifier.com';
export class AppError extends Error {
  constructor(code, status=400, options) { super(code, options); this.name='AppError'; this.code=code; this.status=status; }
}
export const encoder=new TextEncoder();
export function base64url(bytes) { let s=''; for(const byte of bytes)s+=String.fromCharCode(byte); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
export function fromBase64(value) { return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)); }
export const random=()=>base64url(crypto.getRandomValues(new Uint8Array(32)));
export async function digest(value) { return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))); }
export async function encrypt(env, value, context) {
 const key=await crypto.subtle.importKey('raw',fromBase64(env.TOKEN_ENCRYPTION_KEY),'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(context)},key,encoder.encode(JSON.stringify(value)));
 return base64url(iv)+'.'+base64url(new Uint8Array(ciphertext));
}
export async function decrypt(env, value, context) {
 const [iv,ciphertext]=value.split('.');
 const key=await crypto.subtle.importKey('raw',fromBase64(env.TOKEN_ENCRYPTION_KEY),'AES-GCM',false,['decrypt']);
 const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(iv),additionalData:encoder.encode(context)},key,fromBase64(ciphertext));
 return JSON.parse(new TextDecoder().decode(bytes));
}
export function requireUser(request,origin=SITE_ORIGIN) {
 if(new URL(request.url).origin!==origin)throw new AppError('invalid_origin',403);
 const id=request.headers.get('oai-authenticated-user-id');
 if(!id||id.length>256)throw new AppError('sign_in_required',401);
 return id;
}
export function requireMutation(request,origin=SITE_ORIGIN) {
 if(request.headers.get('origin')!==origin||request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='application/json')throw new AppError('invalid_request_origin',403);
}
export async function readText(response,limit=200000) {
 if(Number(response.headers.get('content-length'))>limit)throw new AppError('message_too_large',413);
 const reader=response.body?.getReader();if(!reader)return '';
 let length=0;const chunks=[];
 try { while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit)throw new AppError('message_too_large',413);chunks.push(value);} }
 finally {await reader.cancel();}
 const joined=new Uint8Array(length);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
 return new TextDecoder().decode(joined);
}
export async function jsonBody(request) {
 let value;try{value=JSON.parse(await readText(request,150000));}catch(error){if(error instanceof AppError)throw error;throw new AppError('invalid_json',400,{cause:error});}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError('invalid_request',400);return value;
}
export function json(value,status=200) { return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}); }
export function logFailure(error,route,requestId) {
 const errors=[];for(let current=error;current;current=current.cause)errors.push({name:current.name,code:current.code,status:current.status,frames:String(current.stack||'').split('\n').filter(line=>/^\s+at /.test(line)).join('\n')});
 console.error(JSON.stringify({event:'kindmail_request_failed',route,requestId,errors}));
}
export const isMessageId=value=>typeof value==='string'&&/^[a-f0-9]{8,40}$/.test(value);
export const isDraftId=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
export function checkDraft(value) {
 if(typeof value.to!=='string'||!/^\S+@[^\s@]+\.[^\s@]+$/.test(value.to)||/[\r\n,;<>]/.test(value.to)||value.to.length>254)throw new AppError('invalid_recipient');
 if(typeof value.subject!=='string'||/[\r\n]/.test(value.subject)||value.subject.length>500)throw new AppError('invalid_subject');
 if(typeof value.body!=='string'||!value.body.trim()||value.body.length>30000)throw new AppError('invalid_body');
 if(value.reply_for!=null&&!isMessageId(value.reply_for))throw new AppError('invalid_reply');
 return {to:value.to.trim(),subject:value.subject,body:value.body,reply_for:value.reply_for||null};
}
