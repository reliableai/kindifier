import {readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {build} from 'esbuild';
const assets={};
for(const [file,type] of [['index.html','text/html; charset=utf-8'],['styles.css','text/css; charset=utf-8'],['app.js','text/javascript; charset=utf-8']])assets['/'+file]={type,content:await readFile('public/'+file,'utf8')};
await writeFile('server/assets.generated.mjs','export const assets='+JSON.stringify(assets)+';\n');
await rm('dist',{recursive:true,force:true});await mkdir('dist/server',{recursive:true});
await build({entryPoints:['server/worker.mjs'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/server/index.js',sourcemap:true});
