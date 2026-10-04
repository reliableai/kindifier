import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';

// The shared routes need only this small subset of D1, backed by local SQLite.
export async function openDatabase(filename){
 const sqlite=new DatabaseSync(filename);
 sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)');
 sqlite.exec('BEGIN IMMEDIATE');
 try {
  for(const name of (await readdir(new URL('../drizzle/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort()){
   if(sqlite.prepare('SELECT 1 FROM local_migrations WHERE name=?').get(name))continue;
   sqlite.exec((await readFile(new URL('../drizzle/'+name,import.meta.url),'utf8')).replaceAll('--> statement-breakpoint',''));
   sqlite.prepare('INSERT INTO local_migrations VALUES(?)').run(name);
  }
  sqlite.exec('COMMIT');
 } catch(error){sqlite.exec('ROLLBACK');sqlite.close();throw error;}
 const prepare=sql=>{
  const statement=sqlite.prepare(sql);
  const bound=args=>({bind:(...values)=>bound(values),first:()=>statement.get(...args)||null,all:()=>({results:statement.all(...args)}),run:()=>({meta:{changes:Number(statement.run(...args).changes)}})});
  return bound([]);
 };
 return {prepare,batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(statement=>statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}},close:()=>sqlite.close()};
}
