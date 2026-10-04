import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdir,writeFile,rm,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import worker from '../server/worker.mjs';
import {AppError,logFailure} from '../server/security.mjs';
import {openDatabase} from './database.mjs';
import {applySettings,validateSettings} from './settings.mjs';
const matches=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const sessionName='kindifier-session';
export async function startLocal({directory,store,port=0,now=Date.now}){
 await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
 const lock=join(directory,'running.lock');
 try{await writeFile(lock,String(process.pid),{flag:'wx',mode:0o600});}catch(error){throw new Error('Kindifier is already running, or a previous run left running.lock. Close the other instance; after a crash, verify it has stopped before removing '+lock,{cause:error});}
 let db,server;
 try {
  db=await openDatabase(join(directory,'mail.sqlite'));await chmod(join(directory,'mail.sqlite'),0o600);
  let settings=store.read();
  if(!settings&&db.prepare('SELECT 1 FROM connections LIMIT 1').first())throw new Error('Credential store is missing but saved mail exists. Restore your original credential store before opening this data directory.');
  const env={DB:db,IS_LOCAL:true};applySettings(env,settings);
  const launchToken=randomBytes(32).toString('base64url'),sessionToken=randomBytes(32).toString('base64url');
  let is_launch_used=false;const launchExpiry=now()+120000;
  const pending=new Map();let activeRequests=0;let is_exclusive=false;
  server=createServer(async(req,res)=>{
   activeRequests++;let is_exclusive_request=false;
   try{
    if(req.headers.host!==new URL(env.SITE_ORIGIN).host)throw new AppError('invalid_host',403);
    const url=new URL(req.url,env.SITE_ORIGIN);
    if(url.origin!==env.SITE_ORIGIN||!req.url.startsWith('/'))throw new AppError('invalid_host',403);
    const is_mutation=!['GET','HEAD'].includes(req.method);
    if(is_mutation&&(req.headers.origin!==env.SITE_ORIGIN||req.headers['content-type']?.split(';')[0].trim()!=='application/json'))throw new AppError('invalid_request_origin',403);
    const chunks=[];let length=0;
    for await(const chunk of req){length+=chunk.length;if(length>200000)throw new AppError('request_too_large',413);chunks.push(chunk);}
    const body=Buffer.concat(chunks);
    if(url.pathname==='/api/local/unlock'&&req.method==='POST'){
     const value=JSON.parse(body);
     if(is_launch_used||now()>launchExpiry||!matches(value.token,launchToken))throw new AppError('launch_expired',401);
     is_launch_used=true;
     res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','Set-Cookie':`${sessionName}=${sessionToken}; Path=/api; HttpOnly; SameSite=Lax`});res.end('{}');return;
    }
    const browserSession=req.headers.cookie?.split(';').map(item=>item.trim()).find(item=>item.startsWith(sessionName+'='))?.slice(sessionName.length+1);
    if(url.pathname.startsWith('/api/')&&!matches(browserSession,sessionToken))throw new AppError('local_sign_in_required',401);
    if(url.pathname.startsWith('/api/')&&is_exclusive)throw new AppError('requests_in_progress',409);
    if(url.pathname==='/api/local/settings'&&req.method==='POST'){
     if(activeRequests>1||pending.size)throw new AppError('requests_in_progress',409);
     if(db.prepare('SELECT 1 FROM connections LIMIT 1').first())throw new AppError('disconnect_before_settings',409);
     const updated=validateSettings(JSON.parse(body),settings);
     store.write(updated);settings=updated;applySettings(env,settings);db.prepare('DELETE FROM oauth_states').run();
     res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({is_saved:true}));return;
    }
    if(url.pathname==='/api/local/automatic'&&req.method==='POST'){
     const value=JSON.parse(body);
     if(!settings||!env.IS_DISCLOSURE_ACCEPTED)throw new AppError('disclosure_required',403);
     if(typeof value.is_enabled!=='boolean')throw new AppError('invalid_settings',400);
     const updated={...settings,is_auto_prepare:value.is_enabled};store.write(updated);settings=updated;applySettings(env,settings);
     res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({is_auto_prepare:env.IS_AUTO_PREPARE}));return;
    }
    if(['/api/gmail/connect','/api/gmail/callback','/api/gmail/disconnect'].includes(url.pathname)){if(activeRequests>1||pending.size)throw new AppError('requests_in_progress',409);is_exclusive=true;is_exclusive_request=true;}
    const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value)headers.set(key,String(value));
    headers.set('oai-authenticated-user-id','local-user');
    const request=new Request(url,{method:req.method,headers,...(is_mutation?{body}:{} )});
    const is_rewrite=req.method==='POST'&&/^\/api\/messages\/[a-f0-9]+\/kind$/.test(url.pathname);
    // One process/config at a time; Gmail message IDs are immutable. Only share identical message work.
    let response;
    if(is_rewrite){let operation=pending.get(url.pathname);if(!operation){operation=worker.fetch(request,env);pending.set(url.pathname,operation);}try{response=(await operation).clone();}finally{if(pending.get(url.pathname)===operation)pending.delete(url.pathname);}}
    else response=await worker.fetch(request,env);
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
   }catch(error){logFailure(error,'local-request',crypto.randomUUID());if(!res.headersSent)res.writeHead(error instanceof AppError?error.status:500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:{code:error instanceof AppError?error.code:'local_service_failed'}}));}
   finally{if(is_exclusive_request)is_exclusive=false;activeRequests--;}
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  env.SITE_ORIGIN='http://127.0.0.1:'+server.address().port;
  return {origin:env.SITE_ORIGIN,launchUrl:env.SITE_ORIGIN+'/#launch='+launchToken,env,async close(){const closed=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));server.closeAllConnections();await closed;db.close();await rm(lock);}};
 }catch(error){if(server?.listening)await new Promise(resolve=>server.close(resolve));db?.close();await rm(lock);throw error;}
}
