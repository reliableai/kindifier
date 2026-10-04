import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/worker.mjs';
import {SITE_ORIGIN} from '../server/security.mjs';
import {sampleEmails} from '../server/demo.mjs';

function request(id,action,env={},body={}){
 return worker.fetch(new Request(`${SITE_ORIGIN}/api/demo/messages/${id}/${action}`,{method:'POST',headers:{'oai-authenticated-user-id':'sample-test',origin:SITE_ORIGIN,'content-type':'application/json'},body:JSON.stringify(body)}),env);
}
test('all built-in samples have explicitly prepared subjects and bodies',async()=>{
 for(const sample of sampleEmails){
  const response=await request(sample.id,'kind');assert.equal(response.status,200);
  const {kind}=await response.json();assert.equal(kind.subject,sample.kind_subject);assert.equal(kind.body,sample.kind);assert.ok(kind.preview);
 }
});
for(const missing of [{kind:''},{kind:null},{kind_subject:''},{kind_subject:undefined}])test('missing prepared sample content never falls back to originals '+JSON.stringify(missing),async()=>{
 const sample={id:12,email:'sender@example.com',subject:'Hostile original subject',original:'Hostile original body',kind_subject:'Prepared subject',kind:'Prepared body',is_starred:false,...missing};
 const env={SAMPLE_EMAILS:JSON.stringify([sample])};
 const response=await request(12,'kind',env);assert.equal(response.status,502);
 const text=await response.text();assert.ok(!text.includes(sample.subject));assert.ok(!text.includes(sample.original));
 assert.equal((await request(12,'original',env)).status,400);
 const revealed=await(await request(12,'original',env,{is_reveal_requested:true})).json();assert.equal(revealed.original.body,sample.original);
});
test('custom samples display prepared subject and a single-paragraph preview',async()=>{
 const sample={id:12,email:'sender@example.com',subject:'Hidden subject',original:'Hidden body',kind_subject:'Prepared subject',kind:'Prepared body',is_starred:false};
 const {kind}=await(await request(12,'kind',{SAMPLE_EMAILS:JSON.stringify([sample])})).json();
 assert.equal(kind.subject,sample.kind_subject);assert.equal(kind.preview,sample.kind);assert.ok(!JSON.stringify(kind).includes('Hidden'));
});
