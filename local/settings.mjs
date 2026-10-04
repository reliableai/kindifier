import {Entry} from '@napi-rs/keyring';
import {randomBytes} from 'node:crypto';
import {MODELS} from '../server/rewrite.mjs';
import {AppError} from '../server/security.mjs';
export const DISCLOSURE_VERSION=1;
export function credentialStore(){
 const entry=new Entry('com.kindifier.local','settings',{linux:{store:'secret-service'}});
 return {read(){const secret=entry.getPassword();return secret?JSON.parse(secret):null;},write(settings){entry.setPassword(JSON.stringify(settings));}};
}
export function validateSettings(value,previous){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError('invalid_settings',400);
 if(value.is_disclosure_accepted!==true||value.disclosure_version!==DISCLOSURE_VERSION)throw new AppError('disclosure_required',400);
 if(!['openai','openrouter'].includes(value.provider)||!MODELS.includes(value.model))throw new AppError('unsupported_model',400);
 if(typeof value.api_key!=='string'||value.api_key.length<10||value.api_key.length>512||/\s/.test(value.api_key))throw new AppError('invalid_api_key',400);
 const client=value.google_client?.installed;
 if(!client||typeof client.client_id!=='string'||!client.client_id.endsWith('.apps.googleusercontent.com')||client.client_id.length>256||typeof client.client_secret!=='string'||!client.client_secret||client.client_secret.length>256)throw new AppError('desktop_client_required',400);
 if(typeof value.is_auto_prepare!=='boolean')throw new AppError('invalid_settings',400);
 return {provider:value.provider,model:value.model,api_key:value.api_key,client_id:client.client_id,client_secret:client.client_secret,is_disclosure_accepted:true,disclosure_version:DISCLOSURE_VERSION,is_auto_prepare:value.is_auto_prepare,encryption_key:previous?.encryption_key||randomBytes(32).toString('base64')};
}
export function applySettings(env,settings){
 Object.assign(env,{AI_PROVIDER:settings?.provider||'openai',AI_MODEL:settings?.model||'gpt-4.1-mini',AI_API_KEY:settings?.api_key,GOOGLE_CLIENT_ID:settings?.client_id,GOOGLE_CLIENT_SECRET:settings?.client_secret,TOKEN_ENCRYPTION_KEY:settings?.encryption_key,IS_DISCLOSURE_ACCEPTED:settings?.is_disclosure_accepted===true&&settings.disclosure_version===DISCLOSURE_VERSION,IS_AUTO_PREPARE:settings?.is_auto_prepare===true});
}
