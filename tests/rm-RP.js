require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// v0.27.1, port 10620. A device that pulled rows with an older version kept only the columns that version knew (focus, repeat, deadline...)
// and its cursor moved past them. With a version that syncs more columns, the next run pulls those tables whole once, so the task gets its
// focus from the server; nothing is sent back, and a second run does not pull everything again.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 10620, URL0 = 'http://localhost:'+PORT+'/';
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; }
  const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
const T0='2026-11-03T01:15:00.000Z';
const SEED = JSON.stringify({spaces:[{id:'s1',name:'Trabajo',order:0,created:T0,modified:T0}], projects:[], voiceNotes:[], attachments:[], subtasks:[], projectNotes:[],
  tasks:[{id:'t1',title:'Revisar sesiones',spaceId:'s1',projectId:null,date:'2026-11-03',priority:'none',status:'pending',notes:'',created:T0,modified:T0},
         {id:'t2',title:'Otra',spaceId:'s1',projectId:null,date:'2026-11-03',priority:'none',status:'pending',notes:'',created:T0,modified:T0}],
  settings:{tipsSeen:true, activeSpace:'s1'}});
(async()=>{
  await new Promise(res=>srv.listen(PORT,res)); const browser = await chromium.launch();
  try{
    const ctx = await browser.newContext(); const page = await ctx.newPage(); await page.clock.install({time:new Date('2026-11-03T08:05:00Z')});
    page.on('pageerror', e=>errors.push('pageerror: '+e.message));
    await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, SEED);
    await page.goto(URL0); for(let i=0;i<100&&!(await page.evaluate(()=>typeof syncRun==='function'&&typeof DB!=='undefined'));i++) await sleep(50);
    const x = await page.evaluate(async T0=>{
      // What an older version left: both tasks known with their signature then, the tasks cursor past the rows, no list of fields
      const sig=id=>syncSig(syncToRow('tasks', task(id)));
      localStorage.setItem('tareas-sync', JSON.stringify({owner:'u1', firstFor:'u1', user:{id:'u1'}, known:{tasks:{t1:sig('t1'), t2:sig('t2')}, spaces:{s1:syncSig(syncToRow('spaces', DB.spaces[0]))}}, cursor:{tasks:'2026-11-03T08:02:16.000Z', spaces:'2026-11-03T08:02:16.000Z'}, del:{}}));
      const row=(id,extra)=>Object.assign(syncToRow('tasks', task(id)), {id, owner_id:'u1', server_ts:'2026-11-03T01:15:01.000Z'}, extra||{});
      const server={tasks:[row('t1',{focus:'2026-11-03T01:15:00.000Z'}), row('t2')], spaces:[Object.assign(syncToRow('spaces', DB.spaces[0]), {id:'s1', owner_id:'u1', server_ts:'2026-11-03T01:00:00.000Z'})]};
      const calls={pull:[], upsert:[]};
      const remote={ missing:new Set(), async init(){ return {id:'u1'}; },
        async pull(table, after, n){ calls.pull.push(table+':'+(after?'cursor':'all')); return (server[table]||[]).filter(r=>!after||r.server_ts>after); },
        async upsert(table, rows){ calls.upsert.push(...rows.map(r=>table+':'+r.id)); return rows.map(r=>Object.assign({}, r, {server_ts:new Date().toISOString()})); },
        async markDeleted(){ return []; }, async byIds(){ return []; } };
      SY={remote, user:{id:'u1'}, status:'idle', error:'', ready:true, running:false, again:false, runP:null, timer:0, retry:0, pending:0, unsub:null, rt:[], rtT:0, quiet:false, lastSync:null, initP:null, authBound:true};
      await syncRun('prueba'); const one={focus:task('t1').focus||null, t2:task('t2').focus||null, pulls:calls.pull.slice(), up:calls.upsert.slice(), fields:!!JSON.parse(localStorage.getItem('tareas-sync')).fields, log:LOG.filter(e=>/campos nuevos/.test(e.m)).length};
      calls.pull.length=0; await syncRun('prueba'); const two={pulls:calls.pull.slice(), up:calls.upsert.slice()};
      return {one, two};
    }, T0);
    check('refetch_gets_focus', x.one.focus==='2026-11-03T01:15:00.000Z' && x.one.t2===null && x.one.pulls.includes('tasks:all') && x.one.up.length===0 && x.one.fields && x.one.log===1, x.one);
    check('second_run_uses_cursor', x.two.pulls.includes('tasks:cursor') && !x.two.pulls.includes('tasks:all') && x.two.up.length===0, x.two);
    await ctx.close();
  }catch(e){ fails.push('exception'); errors.push(String(e&&e.stack||e)); }
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  await browser.close(); srv.close(); process.exit(fails.length||errors.length?1:0);
})();
