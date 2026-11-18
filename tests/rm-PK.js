require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 87: names deleted from the person picker (Responsable and Esperando a), asked by the owner on 18 November. Port 8836.
//  1. The list: contacts, then the names open tasks use (any space); a name only completed tasks use is not listed, nor the Esperando a left
//     on a pending task.
//  2. iPhone: a swipe to the left shows Eliminar; the first tap asks on the row, the second deletes the contact, with Deshacer (back in the
//     open list); a tap on another row only closes; a name an open task uses says «Lo usa 1 tarea abierta» and stays; the tasks keep names.
//  3. Desktop: the × on hover, the same question and deletion; the Esperando a picker too.
const H = require('./lib/pdharness.js'); const { ev, calm, settle } = H;
const fs = require('fs'); const path = require('path');
const PORT = 8836, OUT = path.join(__dirname, 'out', 'PK'); fs.mkdirSync(OUT, {recursive:true});
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});
const NOW = new Date(2026, 10, 18, 10, 0, 0), T0 = '2026-10-01T08:00:00.000Z';
const tk = (id, o) => Object.assign({id, title:id, spaceId:'trabajo', projectId:null, date:null, reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:T0, modified:T0, completed:null}, o);
const SEED = () => ({ spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}], projects:[],
  tasks:[ tk('t1', {title:'Revisar SOW', date:'2026-11-18'}), tk('t2', {title:'Firma', status:'waiting', waitingFor:'Ana López'}),
    tk('t3', {title:'Vieja', status:'done', completed:T0, responsible:'Pedro Antiguo'}), tk('t4', {title:'Otra', responsible:'Luis', spaceId:'personal'}),
    tk('t5', {title:'Pendiente con resto', waitingFor:'Resto'}) ],
  voiceNotes:[], attachments:[], subtasks:[], projectNotes:[],
  contacts:[{id:'c1',name:'Ana López',email:null,phone:'600',created:T0,modified:T0},{id:'c2',name:'Marta',email:'m@x.es',phone:null,created:T0,modified:T0},{id:'c3',name:'Typo Nombre',email:null,phone:null,created:T0,modified:T0}],
  settings:{tipsSeen:true} });
const names = page => ev(page, ()=>[...document.querySelectorAll('.pplist .pprow')].map(b=>b.querySelector('.ppl').textContent).join('|'));
const rowOf = (page, re) => ev(page, s=>[...document.querySelectorAll('.pplist .pprow')].findIndex(b=>new RegExp(s).test(b.textContent)), re);
async function swipe(page, i){ await ev(page, i=>{ const el=document.querySelectorAll('.pplist .pprow')[i], bx=el.getBoundingClientRect();
  const T=(t,x)=>{ const tc=new Touch({identifier:1, target:el, clientX:x, clientY:bx.top+10}); el.dispatchEvent(new TouchEvent(t, {bubbles:true, touches:t==='touchend'?[]:[tc], changedTouches:[tc]})); };
  T('touchstart', 300); T('touchmove', 250); T('touchmove', 200); T('touchend', 200); }, i); await settle(page); }

async function iphone(browser){
  const {ctx, page} = await H.open(browser, {tag:'M', port:PORT, now:NOW, seed:SEED()}, errors); let x;
  await ev(page, ()=>openDetail('t1')); await calm(page); await page.tap('.pushed-screen.detail [data-act=pickResp]'); await settle(page);
  check('i_list', await names(page)==='Sin responsableLa tarea es tuya|Ana López|Marta|Typo Nombre|Luis', await names(page)); // no Pedro Antiguo, no Resto
  let i = await rowOf(page, 'Typo'); await swipe(page, i);
  x = await ev(page, i=>{ const b=document.querySelectorAll('.pplist .pprow')[i]; return {open:b.classList.contains('ppopen'), op:getComputedStyle(b.querySelector('.ppdel')).opacity}; }, i);
  check('i_swipe', x.open && x.op==='1', x);
  await shot(page, 'i1-swipe');
  await ev(page, ()=>document.querySelectorAll('.pplist .pprow')[1].click()); await settle(page); // a tap elsewhere only closes
  x = await ev(page, ()=>({open:!!document.querySelector('.pplist .ppopen'), sheet:document.querySelector('#sheet').classList.contains('on'), resp:task('t1').responsible||null}));
  check('i_close_only', !x.open && x.sheet && x.resp===null, x);
  await swipe(page, i); await ev(page, ()=>document.querySelector('.pplist .ppopen .ppdel').click()); await settle(page);
  x = await ev(page, ()=>{ const b=document.querySelector('.pplist .ppconf'); return b&&b.querySelector('.ppl').textContent; });
  check('i_ask', x==='¿Eliminar «Typo Nombre» de la lista?', x);
  await shot(page, 'i2-ask');
  await ev(page, ()=>document.querySelector('.pplist .ppconf .ppdel').click()); await settle(page);
  x = await ev(page, ()=>({c:DB.contacts.map(c=>c.name).join(), toast:document.querySelector('#toastText').textContent}));
  check('i_deleted', x.c==='Ana López,Marta' && x.toast==='«Typo Nombre» eliminado de la lista' && !/Typo/.test(await names(page)), x);
  await ev(page, ()=>undoFn()); await settle(page);
  check('i_undo', await ev(page, ()=>!!contactByName('Typo Nombre')) && /Typo Nombre/.test(await names(page)), await names(page));
  i = await rowOf(page, 'Ana'); await swipe(page, i); await ev(page, ()=>document.querySelector('.pplist .ppopen .ppdel').click()); await settle(page);
  x = await ev(page, ()=>{ const b=document.querySelector('.pplist .ppmsg'); return {msg:b&&b.querySelector('small').textContent, c:!!contactByName('Ana López'), t2:task('t2').waitingFor}; });
  check('i_in_use', x.msg==='Lo usa 1 tarea abierta' && x.c && x.t2==='Ana López', x);
  await shot(page, 'i3-en-uso');
  await page.clock.runFor(3000); await settle(page);
  check('i_msg_gone', await ev(page, ()=>!document.querySelector('.pplist .ppmsg')));
  await ctx.close(); }

async function desktop(browser){
  const {ctx, page} = await H.open(browser, {tag:'D', port:PORT, now:NOW, seed:SEED(), desk:true}, errors); let x;
  await ev(page, ()=>openDetail('t1')); await calm(page); await page.click('#desk .pane [data-act=pickResp]'); await settle(page);
  let i = await rowOf(page, 'Marta'); await page.hover('.pplist .pprow:nth-child('+(i+1)+')'); await H.sleep(450); // the fade of the ×
  x = await ev(page, i=>getComputedStyle(document.querySelectorAll('.pplist .pprow')[i].querySelector('.ppdel')).opacity, i);
  check('d_hover', x==='1', x);
  await shot(page, 'd1-hover');
  await page.click('.pplist .pprow:nth-child('+(i+1)+') .ppdel'); await settle(page);
  check('d_ask', await ev(page, ()=>!!document.querySelector('.pplist .ppconf')));
  await page.click('.pplist .ppconf .ppdel'); await settle(page);
  check('d_deleted', await ev(page, ()=>!contactByName('Marta')&&!!document.querySelector('.pplist')));
  await ev(page, ()=>closeMenu(true)); await calm(page);
  // The Esperando a picker of Por confirmar
  await ev(page, ()=>waitingSheet('t1')); await settle(page);
  i = await rowOf(page, 'Typo'); check('d_wait_list', i>0 && !/Pedro|Resto/.test(await names(page)), await names(page));
  await page.hover('.pplist .pprow:nth-child('+(i+1)+')'); await page.click('.pplist .pprow:nth-child('+(i+1)+') .ppdel'); await settle(page); await page.click('.pplist .ppconf .ppdel'); await settle(page);
  check('d_wait_deleted', await ev(page, ()=>!contactByName('Typo Nombre')&&!!document.querySelector('.pplist')));
  await shot(page, 'd2-esperando');
  await ctx.close(); }

(async()=>{
  const srv = await H.server(PORT); const browser = await H.chromium.launch();
  try{ await iphone(browser); }catch(e){ fails.push('iphone_exception'); errors.push('iphone: '+String(e&&e.stack||e)); }
  try{ await desktop(browser); }catch(e){ fails.push('desktop_exception'); errors.push('desktop: '+String(e&&e.stack||e)); }
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  await browser.close(); srv.close(); process.exit(fails.length||errors.length?1:0);
})();
