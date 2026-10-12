import {MODEL_OPTIONS,INSTRUCTIONS,respond} from './rewrite.js';
const $=id=>document.getElementById(id);
let base=null;
function show(text){$('status').textContent=text;}
function fail(error){console.error('Kindifier model setup failed',error);show(`Couldn’t start Gemini Nano: ${error.name}: ${error.message}`);$('setup').hidden=false;}
function record(result,seconds){const item=document.createElement('li');item.textContent=result.is_ok?`${seconds.toFixed(1)} s · ${result.rewrite.subject}`:`${seconds.toFixed(1)} s · failed: ${result.error.code}`;item.className=result.is_ok?'':'failed';$('activity').prepend(item);}
async function load(){
 $('setup').hidden=true;show('Loading Gemini Nano…');
 base=await LanguageModel.create({...MODEL_OPTIONS,initialPrompts:[{role:'system',content:INSTRUCTIONS}],monitor(monitor){monitor.addEventListener('downloadprogress',event=>show(`Downloading Gemini Nano: ${Math.round(event.loaded*100)}%`));}});
 show('Ready. Open an email in Gmail (reload Gmail once after installing).');
}
async function start(){
 if(typeof LanguageModel==='undefined'){show('This Chrome has no Prompt API. Desktop Chrome 138 or later is required.');return;}
 const availability=await LanguageModel.availability(MODEL_OPTIONS);
 if(availability==='unavailable'){show('Gemini Nano can’t run here. It needs 22 GB free disk and a GPU with more than 4 GB memory, or 16 GB RAM.');return;}
 if(availability==='available'){await load();return;}
 // Starting the download requires a click.
 show(availability==='downloading'?'Gemini Nano is downloading. Click to continue.':'Gemini Nano needs a one-time download (about 4 GB).');$('setup').hidden=false;
}
$('setup').onclick=()=>load().catch(fail);
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 if(message?.type!=='kindifier_rewrite'||sender.id!==chrome.runtime.id)return false;
 const started=performance.now();
 respond(message,base).then(result=>{record(result,(performance.now()-started)/1000);sendResponse(result);});
 return true;
});
start().catch(fail);
