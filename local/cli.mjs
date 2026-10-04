#!/usr/bin/env node
import {homedir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {startLocal} from './server.mjs';
import {credentialStore} from './settings.mjs';
import {logFailure} from '../server/security.mjs';
import {disclosure} from './disclosure.mjs';
process.umask(0o077);
console.log(disclosure);
const directory=process.platform==='darwin'?join(homedir(),'Library','Application Support','Kindifier'):process.platform==='win32'?join(process.env.LOCALAPPDATA||homedir(),'Kindifier'):join(process.env.XDG_DATA_HOME||join(homedir(),'.local','share'),'kindifier');
const app=await startLocal({directory,store:credentialStore()});
console.log('Kindifier is running only on this computer. Close with Ctrl+C.');
console.log('Local data: '+directory);
const command=process.platform==='darwin'?'open':process.platform==='win32'?'rundll32':'xdg-open';
const args=process.platform==='win32'?['url.dll,FileProtocolHandler',app.launchUrl]:[app.launchUrl];
const browser=spawn(command,args,{stdio:'ignore'});
browser.on('error',error=>{console.error('Could not open the browser:',error);console.log('Open this one-use local link within two minutes: '+app.launchUrl);});
browser.on('exit',code=>{if(code!==null&&code!==0){console.error('Browser launcher exited with code '+code);console.log('Open this one-use local link within two minutes: '+app.launchUrl);}});
let is_closing=false;async function close(){if(is_closing)return;is_closing=true;try{await app.close();process.exit(0);}catch(error){logFailure(error,'local-shutdown',crypto.randomUUID());process.exit(1);}}
process.on('SIGINT',close);process.on('SIGTERM',close);

process.on('SIGHUP',close);
