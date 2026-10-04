import {rewritePolicy} from './rewrite.mjs';
import { AppError,encrypt,decrypt } from './security.mjs';
export async function connection(env,user) {
 const row=await env.DB.prepare('SELECT account, ciphertext, connection_id FROM connections WHERE user_id=?').bind(user).first();
 if(!row)return null;
 return {account:row.account,connection_id:row.connection_id,...await decrypt(env,row.ciphertext,`${user}:${row.account}:tokens`)};
}
export async function saveConnection(env,user,value) {
 const ciphertext=await encrypt(env,{access_token:value.access_token,refresh_token:value.refresh_token,expires_at:value.expires_at},`${user}:${value.account}:tokens`);
 const result=await env.DB.prepare('INSERT INTO connections(user_id,account,ciphertext,connection_id) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET ciphertext=excluded.ciphertext,connection_id=excluded.connection_id WHERE connections.account=excluded.account').bind(user,value.account,ciphertext,crypto.randomUUID()).run();
 if(!result.meta.changes)throw new AppError('disconnect_before_switching',409);
}
export async function refreshConnection(env,user,value) {
 const ciphertext=await encrypt(env,{access_token:value.access_token,refresh_token:value.refresh_token,expires_at:value.expires_at},`${user}:${value.account}:tokens`);
 const result=await env.DB.prepare('UPDATE connections SET ciphertext=? WHERE user_id=? AND account=? AND connection_id=?').bind(ciphertext,user,value.account,value.connection_id).run();
 if(!result.meta.changes)throw new AppError('gmail_not_connected',401);
}
export async function getRewrite(env,user,account,id) {
 const row=await env.DB.prepare('SELECT ciphertext FROM rewrites WHERE user_id=? AND account=? AND message_id=? AND created_at>?').bind(user,account,id,Date.now()-7*86400000).first();
 if(!row)return null;
 const value=await decrypt(env,row.ciphertext,`${user}:${account}:rewrite:${id}`);
 return value.rewrite_policy===rewritePolicy(env)?value:null;
}
export async function saveRewrite(env,user,session,id,value) {
 const {account,connection_id}=session;
 const ciphertext=await encrypt(env,value,`${user}:${account}:rewrite:${id}`);
 const result=await env.DB.prepare('INSERT INTO rewrites(user_id,account,message_id,ciphertext,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM connections WHERE user_id=? AND account=? AND connection_id=?) ON CONFLICT(user_id,account,message_id) DO UPDATE SET ciphertext=excluded.ciphertext,created_at=excluded.created_at').bind(user,account,id,ciphertext,Date.now(),user,account,connection_id).run();
 if(!result.meta.changes)throw new AppError('gmail_not_connected',401);
}
export async function listDrafts(env,user,account) {
 const {results}=await env.DB.prepare("SELECT d.id,d.ciphertext,d.updated_at,d.revision,s.status AS send_status FROM drafts d LEFT JOIN sends s ON s.user_id=d.user_id AND s.account=d.account AND s.id=d.id WHERE d.user_id=? AND d.account=? AND (s.status IS NULL OR s.status!='sent') ORDER BY d.updated_at DESC LIMIT 50").bind(user,account).all();
 return Promise.all(results.map(async row=>({id:row.id,updated_at:row.updated_at,revision:row.revision,send_status:row.send_status,is_send_locked:!!row.send_status,...await decrypt(env,row.ciphertext,`${user}:${account}:draft:${row.id}`)})));
}
export async function saveDraft(env,user,session,id,value,baseRevision) {
 const {account,connection_id}=session;
 const ciphertext=await encrypt(env,value,`${user}:${account}:draft:${id}`);
 const row=await env.DB.prepare(`INSERT INTO drafts(user_id,account,id,ciphertext,updated_at,revision)
 SELECT ?,?,?,?,?,1 WHERE EXISTS (SELECT 1 FROM connections WHERE user_id=? AND account=? AND connection_id=?)
 AND NOT EXISTS (SELECT 1 FROM sends WHERE user_id=? AND account=? AND id=?)
 AND (?=0 OR EXISTS (SELECT 1 FROM drafts WHERE user_id=? AND account=? AND id=?))
 ON CONFLICT(user_id,account,id) DO UPDATE SET ciphertext=excluded.ciphertext,updated_at=excluded.updated_at,revision=drafts.revision+1 WHERE drafts.revision=? RETURNING revision`).bind(user,account,id,ciphertext,Date.now(),user,account,connection_id,user,account,id,baseRevision,user,account,id,baseRevision).first();
 if(!row){
  const active=await env.DB.prepare('SELECT 1 FROM connections WHERE user_id=? AND account=? AND connection_id=?').bind(user,account,connection_id).first();
  if(!active)throw new AppError('gmail_not_connected',401);
  const send=await env.DB.prepare('SELECT 1 FROM sends WHERE user_id=? AND account=? AND id=?').bind(user,account,id).first();
  throw new AppError(send?'draft_send_locked':'draft_conflict',409);
 }
 return row.revision;
}

export async function reserveSend(env,user,session,id,hash,revision) {
 const {account,connection_id}=session;
  const reserved=await env.DB.prepare(`INSERT OR IGNORE INTO sends(user_id,account,id,digest,status,created_at)
   SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM connections WHERE user_id=? AND account=? AND connection_id=?)
   AND EXISTS (SELECT 1 FROM drafts WHERE user_id=? AND account=? AND id=? AND revision=?)`).bind(user,account,id,hash,'uncertain',Date.now(),user,account,connection_id,user,account,id,revision).run();
  if(!reserved.meta.changes){
   const started=await env.DB.prepare('SELECT 1 FROM sends WHERE user_id=? AND account=? AND id=?').bind(user,account,id).first();
   if(started)throw new AppError('send_already_started',409);
   throw new AppError('draft_conflict',409);
  }
}
