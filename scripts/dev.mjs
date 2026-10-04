import {createServer} from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {SITE_ORIGIN as origin} from '../server/security.mjs';
// Optional: KINDMAIL_SAMPLE_FILE=<json file> replaces the fictional sample mailbox in this local runtime only.
const sampleFile=process.env.KINDMAIL_SAMPLE_FILE;
const samples=sampleFile?JSON.parse(await readFile(sampleFile,'utf8')):null;
if(samples&&(!Array.isArray(samples)||!samples.length||samples.some(mail=>!Number.isInteger(mail.id)||typeof mail.email!=='string'||typeof mail.subject!=='string'||typeof mail.kind_subject!=='string'||typeof mail.original!=='string'||typeof mail.kind!=='string'||typeof mail.is_starred!=='boolean')))throw new Error(`${sampleFile}: expected a non-empty array of {id, email, subject, kind_subject, original, kind, is_starred}`);
const mf=new Miniflare({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-08-06',d1Databases:['DB'],bindings:{TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),...(samples?{SAMPLE_EMAILS:JSON.stringify(samples)}:{})}});
if(samples)console.log(`Sample mailbox: ${samples.length} emails from ${sampleFile}`);
const db=await mf.getD1Database('DB');
for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const sql of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
const server=createServer(async(req,res)=>{try{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value)headers.set(key,String(value));
 headers.set('oai-authenticated-user-id','local-test-user');if(headers.get('origin')==='http://127.0.0.1:5173')headers.set('origin',origin);
 const response=await mf.dispatchFetch(origin+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
}catch(error){console.error(error);res.writeHead(500);res.end('Local preview error');}});
server.listen(5173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:5173'));
process.on('SIGTERM',()=>{server.close();mf.dispose().then(()=>process.exit());});
