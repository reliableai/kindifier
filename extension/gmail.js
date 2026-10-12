// Each opened Gmail message is hidden and replaced by a kinder version prepared in the Kindifier side panel.
const seen=new WeakSet();
const errorText={panel_closed:'Open Kindifier from the Chrome toolbar. Its side panel runs the on-device model.',model_not_ready:'Gemini Nano isn’t ready yet. Finish setup in the Kindifier panel.',message_empty:'This email has no readable text. Images and attachments are not rewritten.',message_too_long:'This email is too long for the on-device model.',rewrite_incomplete:'The model couldn’t produce a complete kinder version.',rewrite_invalid:'The model returned an unreadable result.',rewrite_failed:'The rewrite failed. The Kindifier panel console has details.'};
function element(tag,text,className){const node=document.createElement(tag);node.textContent=text;node.className=className;return node;}
function action(text,onclick){const node=element('button',text,'kindifier-button');node.type='button';node.onclick=onclick;return node;}
function setOriginalVisible(body,is_visible){body.classList.toggle('kindifier-hidden',!is_visible);document.querySelector('h2.hP')?.classList.toggle('kindifier-revealed',is_visible);}
function render(panel,body,original,state){
 const is_original_visible=!body.classList.contains('kindifier-hidden');
 const bar=element('div','','kindifier-bar');
 bar.append(element('strong',state.status==='ready'?'✳ Kinder version':state.status==='loading'?'✳ Preparing a kinder version on this computer…':'Couldn’t prepare a kinder version',''));
 if(state.status==='error')bar.append(action('Try again',()=>prepare(panel,body,original)));
 bar.append(action(is_original_visible?'Hide original':'Show original',()=>{setOriginalVisible(body,!is_original_visible);render(panel,body,original,state);}));
 panel.replaceChildren(bar);
 if(state.status==='ready')panel.append(element('div',state.rewrite.subject,'kindifier-subject'),element('div',state.rewrite.body,'kindifier-body'));
 if(state.status==='error')panel.append(element('p',errorText[state.code]||state.code,'kindifier-error'));
}
async function prepare(panel,body,original){
 render(panel,body,original,{status:'loading'});
 let response;
 try{response=await chrome.runtime.sendMessage({type:'kindifier_rewrite',subject:original.subject,body:original.body});}
 catch(error){const is_panel_closed=String(error.message).includes('Receiving end does not exist');if(!is_panel_closed)console.error('Kindifier request failed',error);render(panel,body,original,{status:'error',code:is_panel_closed?'panel_closed':'rewrite_failed'});return;}
 render(panel,body,original,response.is_ok?{status:'ready',rewrite:response.rewrite}:{status:'error',code:response.error.code});
}
function attach(body){
 seen.add(body);
 // Read before hiding: innerText of a hidden element also returns invisible text.
 const original={subject:document.querySelector('h2.hP')?.textContent.trim()||'',body:body.innerText.trim()};
 body.classList.add('kindifier-seen','kindifier-hidden');
 const panel=element('div','','kindifier-panel');body.before(panel);
 void prepare(panel,body,original);
}
function scan(){for(const body of document.querySelectorAll('div.a3s'))if(!seen.has(body))attach(body);}
new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});
scan();
