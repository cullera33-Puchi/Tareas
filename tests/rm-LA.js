require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// v0.37.2, batch A of the usability and performance review. Port 8833. Against the team's fake (tests/lib/team-fake.js).
//  1. The tables of a pass are asked for at once: more than one pull is in flight together.
//  2. A save with nothing to send (a view setting) runs no pass once the last one went well; a real change still goes up.
//  3. Realtime: «transport failure», the cut iOS gives on coming back from the background, is logged as info.
//  4. iPhone, keyboard up: a bottom sheet is held to the height that shows (--vvh) and the person list of Por confirmar is 134 px.
//  5. Detail: empty notes open at two lines, take the usual height on focus and do not shrink on leaving.
//  6. Desktop calendar: done tasks go after the open ones of the day, also in Mes's choice of what shows.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const TF = require('./lib/team-fake.js'); const { until, synced, signIn, tk, seed } = TF;
const PORT = 8833, OUT = path.join(__dirname, 'out', 'LA'); fs.mkdirSync(OUT, {recursive:true});
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };

async function syncTests(browser){
  const fake = new TF.Fake();
  const UE = fake.user('9b2f6d3e-0000-4000-8000-0000000000f1', 'enric@example.com', 'Enric Vidal');
  fake.bootstrap();
  const E = await TF.device(browser, fake, {tag:'E', user:UE, seed:seed([tk('a1', {title:'Primera'}), tk('a2', {title:'Segunda', notes:''})])}, PORT, errors); const p=E.page;
  await signIn(p, false); check('signed_in', await synced(p));

  /* 1. Pulls in flight together */
  const inflight = await p.evaluate(async()=>{ const R=SY.remote, orig=R.pull; let now=0, max=0;
    R.pull=async(...a)=>{ now++; max=Math.max(max, now); try{ await new Promise(r=>setTimeout(r, 30)); return await orig.apply(R, a); } finally{ now--; } };
    try{ await syncRun('prueba'); } finally{ R.pull=orig; } return max; });
  check('pulls_parallel', inflight>1, {inflight});
  await synced(p);

  /* 2. No pass for a save with nothing to send */
  const passes = () => p.evaluate(()=>LOG.filter(e=>/^Sincronización \(/.test(e.m)).length);
  const n0 = await passes();
  await p.evaluate(()=>{ DB.settings.filter='todas'; save(); render(); }); await p.waitForTimeout(2600);
  const n1 = await passes();
  check('no_empty_pass', n1===n0, {before:n0, after:n1});
  await p.evaluate(()=>{ updTask('a1', {title:'Primera, cambiada'}); }); await p.waitForTimeout(2600); await synced(p);
  check('change_still_goes_up', (await passes())>n1 && fake.t.tasks.get('a1').title==='Primera, cambiada', {passes:await passes(), srv:fake.t.tasks.get('a1').title});

  /* 3. transport failure as info */
  const lv = await p.evaluate(()=>{ SY.rtFails=0; SY.rtInfoAt=0; SY.rtWarnAt=0; const n=LOG.length; syncRtTrouble('CHANNEL_ERROR', new Error('channel error: transport failure')); return LOG.slice(n).map(e=>e.l+' '+e.m); });
  check('transport_failure_info', lv.length===1 && /^info /.test(lv[0]), lv);

  /* 4. Sheet held to what shows with the keyboard up */
  const sh = await p.evaluate(async()=>{ document.documentElement.classList.add('kbup'); document.documentElement.style.setProperty('--vvh', '416px');
    waitingSheet('a2'); await new Promise(r=>setTimeout(r, 700)); const s=document.getElementById('sheet'), l=s.querySelector('.pplist');
    const out={max:getComputedStyle(s).maxHeight, h:Math.round(s.getBoundingClientRect().height), list:l?getComputedStyle(l).maxHeight:null};
    closeSheet(); document.documentElement.classList.remove('kbup'); await new Promise(r=>setTimeout(r, 600)); return out; });
  const top = await p.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('padding-top'))||0);
  check('sheet_held_to_visible', parseFloat(sh.max)<=416-12-top+0.5 && sh.h<=416 && sh.list==='134px', sh);

  /* 5. Empty notes at two lines until tapped */
  await p.evaluate(()=>openDetail('a2')); await p.waitForTimeout(700);
  const h = async () => p.evaluate(()=>Math.round(document.querySelector('.pushed-screen [data-role=notes]').getBoundingClientRect().height));
  const hClosed = await h();
  await p.evaluate(()=>document.querySelector('.pushed-screen [data-role=notes]').focus()); await p.waitForTimeout(150); const hOpen = await h();
  await p.evaluate(()=>document.querySelector('.pushed-screen [data-role=notes]').blur()); await p.waitForTimeout(150); const hLeft = await h();
  check('empty_notes_two_lines', hClosed<=80 && hClosed<hOpen && hOpen>=100 && hLeft>=100, {hClosed, hOpen, hLeft});
  await p.evaluate(()=>pop()); await p.waitForTimeout(600);
  await p.screenshot({path:path.join(OUT, 'iphone.png')});
  await E.ctx.close();
}

async function calendarTests(browser){
  const fake = new TF.Fake();
  const d = new Date(); const t = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const D = await TF.device(browser, fake, {tag:'D', desk:true, user:null, seed:seed([])}, PORT, errors); const p=D.page;
  const res = await p.evaluate(t=>{ const now=new Date().toISOString();
    const P=[{id:'pa', spaceId:DB.settings.activeSpace, name:'Alfa', color:'#007AFF', order:0, archived:false, created:now, modified:now}, {id:'pb', spaceId:DB.settings.activeSpace, name:'Beta', color:'#34C759', order:1, archived:false, created:now, modified:now}];
    const mk=(id, pid, done)=>({id, title:id, spaceId:DB.settings.activeSpace, projectId:pid, date:t, reminder:null, priority:'none', status:done?'done':'pending', notes:'', carried:false, created:now, modified:now, completed:done?now:null});
    const xs=[mk('d1','pa',true), mk('o1','pa',false), mk('d2','pb',true), mk('o2','pb',false), mk('o3','pb',false)];
    DB.projects.push(...P);
    return {sort:calSort(xs).map(x=>x.id), pick:calPick(xs, 3).map(x=>x.id)}; }, t);
  check('cal_done_last', res.sort.join()==='o1,o2,o3,d1,d2', res.sort);
  check('cal_pick_open_first', res.pick.join()==='o1,o2,o3', res.pick);
  await D.ctx.close();
}

(async()=>{
  const srv = await TF.serve(PORT); const browser = await chromium.launch();
  try { await syncTests(browser); } catch(e){ errors.push('sync: '+(e.stack||e.message)); }
  try { await calendarTests(browser); } catch(e){ errors.push('calendar: '+(e.stack||e.message)); }
  await browser.close(); srv.close();
  console.log(JSON.stringify({r, fails, errors}, null, 1)); process.exit(fails.length||errors.length?1:0);
})();
