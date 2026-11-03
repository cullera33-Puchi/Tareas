require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 59 (post-it notes column on the desktop project screen), port 10750. Screenshots in tests/out/pit.
//  1. Visibility: a project's Tareas at 1440 shows the column; at 1280 it does not (the segment Tareas y Notas stays); none with the
//     inspector open (back when it closes), in Sin proyecto, in Notas, in Hoy, Todas or Semana, nor on the iPhone.
//  2. Cards: pinned first, then the newest; title, date and the first lines with lists and boxes; the column header of the list still
//     lines up with its rows.
//  3. Many notes: only the cards that fit, then «Ver todas (N)», which opens Notas; a taller window shows more.
//  4. Quick card: Intro saves (first line title, the rest text), Mayúsculas e Intro make a new line, Esc empties, empty does nothing;
//     the new note is first; Deshacer takes it back.
//  5. A click opens a card as an editor that saves while typing (400 ms); a click outside or Esc closes it. A box ticks with one click on a
//     closed card. A right click opens the note menu (Fijar works from it).
//  6. The fold button hides the column, «Notas (N)» brings it back; the setting survives a reload.
//  7. Typing in the column fires no list shortcut (C, H, N); with the focus outside, the list shortcuts work.
//  8. Screenshots light and dark at 1600 with the column.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 10750, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'pit'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; }
  const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});

const NOW = new Date(2026, 10, 4, 10, 0, 0); // Wednesday 4 November 2026, 10:00
const T0 = '2026-11-03T08:00:00.000Z';
const C = n => new Date(Date.UTC(2026, 10, 3, 8, n)).toISOString();
const tk = (id, o) => Object.assign({id, title:id, spaceId:'trabajo', projectId:'p1', date:'2026-11-04', reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:T0, modified:T0, completed:null}, o);
const nt = (id, title, body, o) => Object.assign({id, projectId:'p1', title, body, pinned:false, created:T0, modified:T0}, o);
const NOTES = () => [
  nt('n1', 'Acuerdos del comité', 'Fechas cerradas con el cliente.\n- Piloto en enero\n- Go-live en marzo\n[ ] Enviar el acta\n[x] Reservar sala\nUna línea más\nY otra que no cabe', {modified:C(10)}),
  nt('n2', 'Contactos', 'Marta 600 111 222\nLuis', {pinned:true, modified:C(1)}),
  nt('n3', '', 'Idea suelta\nsegunda línea', {modified:C(20)}),
  nt('n4', 'Riesgos', '- Retraso del cliente', {modified:C(5)}) ];
const SEED = o => { o=o||{}; return { spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}],
  projects:[{id:'p1', spaceId:'trabajo', name:'FLC', color:'#FFCC00', order:0, archived:false, created:T0, modified:T0},{id:'p2', spaceId:'trabajo', name:'OCA', color:'#1F3A8A', order:1, archived:false, created:T0, modified:T0}],
  tasks:[ tk('a1', {title:'Enviar acta', estimate:15, created:C(1)}), tk('a2', {title:'Preparar SteerCo', priority:'high', created:C(2)}),
    tk('a3', {title:'Informe mensual', date:'2026-11-10', created:C(3)}), tk('a4', {title:'Reunión', reminder:new Date(2026,10,4,16,30).toISOString(), created:C(4)}),
    tk('b1', {title:'Tarea de OCA', projectId:'p2', created:C(5)}), tk('b2', {title:'Sin proyecto', projectId:null, created:C(6)}) ],
  voiceNotes:[], attachments:[], subtasks:[], projectNotes:o.notes||NOTES(), settings:Object.assign({tipsSeen:true}, o.settings||{}) }; };
async function open(browser, o){
  const vp = o.phone ? {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true} : {viewport:{width:o.w||1440,height:o.h||900}, deviceScaleFactor:1};
  const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.theme||'light'})); const page = await ctx.newPage();
  await page.clock.install({time:NOW});
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(o.tag+' console: '+m.text()); });
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed||SEED()));
  await page.goto(URL0); await until(page, ()=>typeof DB!=='undefined'&&!!document.querySelector(UI.wide?'#desk .main':'.screen.root')); return {ctx, page};
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await sleep(80); } };
const calm = page => until(page, ()=>!app.classList.contains('navigating') && !HELD.size && !document.querySelector('.row.leaving, .flip, .enter') && !document.querySelector('#desk .pane')?.getAnimations().some(a=>a.playState==='running'));
// The column as seen: shown or not, its width, the cards drawn (shown ones) and the link
const col = page => ev(page, ()=>{ const c=document.querySelector('#desk .pitcol'); if(!c||!c.offsetParent) return {shown:false, btn:!!document.querySelector('#desk .pitshow')?.offsetParent};
  const b=c.getBoundingClientRect(), cards=[...c.querySelectorAll('.pitcard')].filter(e=>e.offsetParent), all=c.querySelector('.pitall');
  return {shown:true, w:Math.round(b.width), right:Math.round(b.right), cards:cards.map(e=>e.dataset.pit), total:c.querySelectorAll('.pitcard').length, all:all&&!all.hidden&&all.offsetParent?all.textContent:null,
    listBottom:Math.round(c.querySelector('.pitlist').getBoundingClientRect().bottom), lastBottom:cards.length?Math.round(cards[cards.length-1].getBoundingClientRect().bottom):0, n:c.querySelector('.pithead .n').textContent}; });
const view = (page, v) => ev(page, v=>setDeskView(v), v);
const typeIn = async (page, sel, text) => { await page.click(sel); await page.keyboard.type(text); };

async function visibility(browser){
  let {ctx, page} = await open(browser, {tag:'V1440', w:1440}); let c, x;
  await view(page, 'project:p1'); await calm(page); c = await col(page);
  check('v_1440_shown', c.shown && c.w>=290 && c.w<=310 && c.right>=1440-1, c);
  x = await ev(page, ()=>{ const m=document.querySelector('#desk .main .mbody').getBoundingClientRect(), p=document.querySelector('#desk .pitcol').getBoundingClientRect(), r=document.querySelector('#desk .main .mbody .row[data-id=a1]').getBoundingClientRect(); return {mr:Math.round(m.right), pl:Math.round(p.left), rr:Math.round(r.right)}; });
  check('v_list_beside', x.mr<=x.pl+1 && x.rr<=x.pl, x);
  // The column header (decision 58) keeps its cells on the rows' edges
  x = await ev(page, ()=>{ const h=document.querySelector('#desk .main .colhead'), bad=[]; ['row-text','rc-date','rc-rem','rc-est'].forEach(k=>{ const a=h.querySelector('.'+k); if(!a||getComputedStyle(a).display==='none') return; const ab=a.getBoundingClientRect();
    document.querySelectorAll('#desk .main .mbody .row[data-id] .'+k).forEach(e=>{ if(getComputedStyle(e).display==='none') return; const b=e.getBoundingClientRect(); if(Math.abs(b.left-ab.left)>0.6||Math.abs(b.right-ab.right)>0.6) bad.push(k); }); }); return bad; });
  check('v_colhead_aligned', x.length===0, x);
  // Inspector open: hidden; closed again: back
  await ev(page, ()=>{ UI.dsel.cur='a1'; openDetail('a1'); }); await until(page, ()=>app.classList.contains('has-pane')); await calm(page); c = await col(page);
  check('v_pane_hides', !c.shown && !c.btn, c);
  await ev(page, ()=>pop()); await until(page, ()=>!app.classList.contains('has-pane')); await calm(page); c = await col(page);
  check('v_pane_back', c.shown, c);
  // Notas tab, Sin proyecto, other views
  await ev(page, ()=>setProjTab('p1','notes')); await calm(page); c = await col(page); check('v_notes_tab', !c.shown, c);
  await ev(page, ()=>setProjTab('p1','tasks')); await calm(page);
  for(const v of ['project:none','hoy','todas','week','settings']){ await view(page, v); await calm(page); c=await col(page); check('v_none_'+v.replace(':','_'), !c.shown&&!c.btn, c); }
  // Resize below the threshold: gone, the segment stays
  await view(page, 'project:p1'); await calm(page);
  await page.setViewportSize({width:1280, height:900}); await until(page, ()=>!document.querySelector('#desk .pitcol')?.offsetParent); c = await col(page);
  x = await ev(page, ()=>!!document.querySelector('#desk .mhead .pseg')?.offsetParent);
  check('v_1280_hidden', !c.shown && x, {c, seg:x});
  await page.setViewportSize({width:1440, height:900}); await until(page, ()=>!!document.querySelector('#desk .pitcol')?.offsetParent); c = await col(page);
  check('v_resize_back', c.shown && c.cards.length>0, c);
  await ctx.close();
  ({ctx, page} = await open(browser, {tag:'V1280', w:1280})); await view(page, 'project:p1'); await calm(page); c = await col(page);
  check('v_1280_open', !c.shown, c); await ctx.close();
  ({ctx, page} = await open(browser, {tag:'Vphone', phone:true}));
  await ev(page, ()=>{ switchTab('proyectos'); }); await calm(page); await ev(page, ()=>push('project','p1')); await calm(page);
  x = await ev(page, ()=>({pit:document.querySelectorAll('.pitcol, .pitcard, .pitshow').length, seg:!!document.querySelector('.screen.project .pseg')}));
  check('v_iphone_none', x.pit===0 && x.seg, x); await shot(page, 'iphone-project'); await ctx.close();
}

async function cards(browser){
  let {ctx, page} = await open(browser, {tag:'C', w:1440}); let c, x;
  await view(page, 'project:p1'); await calm(page); c = await col(page);
  check('c_order', JSON.stringify(c.cards)===JSON.stringify(['n2','n3','n1','n4']) && c.n==='4' && !c.all, c);
  x = await ev(page, ()=>{ const q=id=>document.querySelector('#desk .pitcard[data-pit='+id+']'); const n1=q('n1'), n2=q('n2'), n3=q('n3');
    return {pin:!!n2.querySelector('.pit-t .npin'), pin1:!!n1.querySelector('.npin'), t1:n1.querySelector('.pit-tt').textContent, t3:n3.querySelector('.pit-tt').textContent, b3:n3.querySelector('.pitv').textContent,
      li:n1.querySelectorAll('.pitv .nl.li').length, ck:n1.querySelectorAll('.pitv .ncheck').length, done:n1.querySelectorAll('.pitv .ncheck.done').length, clip:n1.classList.contains('clip'), clip2:n2.classList.contains('clip'),
      vh:Math.round(n1.querySelector('.pitv').getBoundingClientRect().height), lh:parseFloat(getComputedStyle(n1.querySelector('.pitv')).lineHeight), date:n2.querySelector('.pit-d').textContent,
      tw:getComputedStyle(n1.querySelector('.pit-t')).fontWeight, link:!!n2.querySelector('.pitv a[href^="tel:"]') }; });
  check('c_content', x.pin && !x.pin1 && x.t1==='Acuerdos del comité' && x.t3==='Idea suelta' && x.b3==='segunda línea' && x.li===2 && x.ck===2 && x.done===1 && +x.tw>=600 && !!x.date, x);
  check('c_clipped', x.clip && !x.clip2 && x.vh<=Math.ceil(x.lh*4)+1, x);
  // Contrast: the text on a card against its tinted background
  x = await ev(page, ()=>{ const lum=c=>{ const k=c.startsWith('color(')?1:255, m=c.match(/[\d.]+/g).map(Number), f=v=>{ v/=k; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4); }; return 0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]); };
    const out={}; document.querySelectorAll('#desk .pitcard').forEach(e=>{ const bg=getComputedStyle(e).backgroundColor, fg=getComputedStyle(e.querySelector('.pit-tt')).color; const a=lum(bg), b=lum(fg); out[e.dataset.pit]={bg, ratio:Math.round((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)*10)/10}; }); return out; });
  check('c_contrast_light', Object.values(x).every(o=>o.ratio>=7), x);
  // Many notes: as many as fit, then Ver todas (N)
  await ev(page, ()=>{ for(let i=0;i<30;i++){ const t=new Date(Date.UTC(2026,9,1,8,i)).toISOString(); DB.projectNotes.push({id:'m'+i, projectId:'p1', title:'Nota '+i, body:'Línea uno\nLínea dos', pinned:false, created:t, modified:t}); } save(); render(); }); await calm(page);
  c = await col(page);
  check('c_fit', c.total===34 && c.cards.length>3 && c.cards.length<34 && c.all==='Ver todas (34)' && c.lastBottom<=c.listBottom, c);
  const fewer = c.cards.length;
  await page.setViewportSize({width:1440, height:1300}); await until(page, async()=>true); await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  c = await col(page); check('c_fit_resize', c.cards.length>fewer && c.lastBottom<=c.listBottom, {now:c.cards.length, before:fewer});
  await page.setViewportSize({width:1440, height:900}); await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  c = await col(page); check('c_fit_back', c.cards.length===fewer, {now:c.cards.length, fewer});
  await page.click('#desk .pitall'); await calm(page);
  x = await ev(page, ()=>({tab:projTab('p1'), view:UI.deskView, list:!!document.querySelector('#desk .nsplit')}));
  check('c_ver_todas', x.tab==='notes' && x.view==='project:p1' && x.list, x);
  await ctx.close();
}

async function editing(browser){
  let {ctx, page} = await open(browser, {tag:'E', w:1440}); let c, x;
  await view(page, 'project:p1'); await calm(page);
  // Empty does nothing
  await page.click('#desk [data-role=pitnew]'); await page.keyboard.press('Enter');
  x = await ev(page, ()=>({n:DB.projectNotes.length, v:document.querySelector('#desk [data-role=pitnew]').value}));
  check('q_empty', x.n===4 && x.v==='', x);
  // Esc empties
  await page.keyboard.type('Borrador'); await page.keyboard.press('Escape');
  x = await ev(page, ()=>({n:DB.projectNotes.length, v:document.querySelector('#desk [data-role=pitnew]').value, d:UI.pitDraft})); check('q_esc', x.n===4 && x.v==='' && !x.d, x);
  // Intro saves; Mayúsculas e Intro make lines
  await page.click('#desk [data-role=pitnew]'); await page.keyboard.type('Llamada con Marta');
  await page.keyboard.press('Shift+Enter'); await page.keyboard.type('- Precio cerrado'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('[ ] Mandar contrato');
  x = await ev(page, ()=>({n:DB.projectNotes.length, v:document.querySelector('#desk [data-role=pitnew]').value})); check('q_shift_enter', x.n===4 && x.v==='Llamada con Marta\n- Precio cerrado\n[ ] Mandar contrato', x);
  await page.keyboard.press('Enter'); await calm(page);
  x = await ev(page, ()=>{ const n=DB.projectNotes.find(o=>o.title==='Llamada con Marta'); return {n:DB.projectNotes.length, body:n&&n.body, pid:n&&n.projectId, id:n&&n.id, v:document.querySelector('#desk [data-role=pitnew]').value, ae:document.activeElement.dataset.role, toast:document.querySelector('#toast').classList.contains('on')&&document.querySelector('#toastText').textContent, saved:JSON.parse(localStorage.getItem('tareas-v1')).projectNotes.length, view:UI.deskView, tab:projTab('p1')}; });
  c = await col(page);
  check('q_saved', x.n===5 && x.body==='- Precio cerrado\n[ ] Mandar contrato' && x.pid==='p1' && x.v==='' && x.ae==='pitnew' && x.toast==='Nota creada' && x.saved===5 && x.view==='project:p1' && x.tab==='tasks', x);
  check('q_first_after_pinned', c.cards[0]==='n2' && c.cards[1]===x.id && c.n==='5', c);
  await page.click('#toastBtn'); await calm(page); c = await col(page);
  x = await ev(page, ()=>({n:DB.projectNotes.length, saved:JSON.parse(localStorage.getItem('tareas-v1')).projectNotes.length}));
  check('q_undo', x.n===4 && x.saved===4 && c.cards.length===4, {x, c});
  // A click opens a card as an editor; typing is saved after 400 ms; a click outside closes it
  await page.click('#desk .pitcard[data-pit=n4] .pit-tt'); await calm(page);
  x = await ev(page, ()=>({open:UI.pitOpen, ae:document.activeElement.dataset.role, v:document.activeElement.value, title:document.querySelector('#desk .pitcard.open [data-role=pittitle]').value}));
  check('e_open', x.open==='n4' && x.ae==='pitbody' && x.v==='- Retraso del cliente' && x.title==='Riesgos', x);
  await page.keyboard.press('Enter'); await page.keyboard.type('Cambio de alcance');
  x = await ev(page, ()=>document.activeElement.value); check('e_list_enter', x==='- Retraso del cliente\n- Cambio de alcance', x);
  const saved = await until(page, ()=>JSON.parse(localStorage.getItem('tareas-v1')).projectNotes.find(n=>n.id==='n4').body.includes('Cambio de alcance'), null, 3000);
  check('e_autosave', saved && await ev(page, ()=>UI.pitOpen==='n4'), saved);
  await page.click('#desk [data-role=pittitle]'); await page.keyboard.press('End'); await page.keyboard.type(' del proyecto');
  // Shortcuts never fire while typing (C would complete, H move to today, N jump to the add bar)
  await page.keyboard.type(' chn');
  x = await ev(page, ()=>({t:noteRec('n4').title, ae:document.activeElement.dataset.role, a1:task('a1').status}));
  check('e_title_typing', x.t==='Riesgos del proyecto chn' && x.ae==='pittitle' && x.a1==='pending', x);
  await page.click('#desk .main .mhead h1'); await calm(page);
  x = await ev(page, ()=>({open:UI.pitOpen, saved:JSON.parse(localStorage.getItem('tareas-v1')).projectNotes.find(n=>n.id==='n4').title, card:document.querySelector('#desk .pitcard[data-pit=n4] .pit-tt').textContent}));
  check('e_click_out', !x.open && x.saved==='Riesgos del proyecto chn' && x.card==='Riesgos del proyecto chn', x);
  // Esc closes it too; the edited note is now the newest (after the pinned one)
  c = await col(page); check('e_reordered', c.cards[0]==='n2' && c.cards[1]==='n4', c);
  await page.click('#desk .pitcard[data-pit=n3]'); await calm(page); await page.keyboard.press('Escape'); await calm(page);
  x = await ev(page, ()=>({open:UI.pitOpen, ed:!!document.querySelector('#desk .pitcard.open')})); check('e_esc', !x.open && !x.ed, x);
  // A box ticks with one click on the closed card, which stays closed
  await page.click('#desk .pitcard[data-pit=n1] .pitv .ncheck:not(.done)'); await calm(page);
  x = await ev(page, ()=>({line:noteRec('n1').body.split('\n')[3], open:UI.pitOpen, saved:JSON.parse(localStorage.getItem('tareas-v1')).projectNotes.find(n=>n.id==='n1').body.split('\n')[3], done:document.querySelectorAll('#desk .pitcard[data-pit=n1] .ncheck.done').length}));
  check('e_check', x.line==='[x] Enviar el acta' && !x.open && x.saved==='[x] Enviar el acta' && x.done===2, x);
  // Right click: the note menu; Fijar from it
  const b = await page.locator('#desk .pitcard[data-pit=n3]').boundingBox(); await page.mouse.click(b.x+30, b.y+12, {button:'right'});
  await until(page, ()=>menuOpen()); x = await ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-it, #pmenu button')].map(e=>e.textContent.trim()).filter(Boolean));
  check('e_menu', x.some(t=>t.startsWith('Fijar')) && x.some(t=>t.startsWith('Compartir')) && x.some(t=>t.startsWith('Eliminar')), x);
  await page.locator('#pmenu').getByText('Fijar', {exact:true}).click(); await calm(page); c = await col(page);
  check('e_pin', await ev(page, ()=>noteRec('n3').pinned) && c.cards[0]==='n3' && c.cards[1]==='n2', c);
  // With the focus outside the column, the list shortcuts work: C completes the selected row
  await page.click('#desk .main .mbody .row[data-id=a3] .row-title'); await calm(page); await ev(page, ()=>{ if(UI.deskDetail){ pop(); } }); await calm(page);
  await ev(page, ()=>{ document.activeElement.blur(); UI.dsel.cur='a3'; paintSel(); deskRow('a3').focus(); });
  await page.keyboard.press('h'); await calm(page);
  x = await ev(page, ()=>task('a3').date); check('k_list_works', x==='2026-11-04', x);
  // A focused card is the column's: H does nothing to the list; Intro opens the card
  await ev(page, ()=>{ task('a3').date='2026-11-10'; save(); render(); UI.dsel.cur='a3'; paintSel(); }); await calm(page);
  await ev(page, ()=>document.querySelector('#desk .pitcard[data-pit=n1]').focus()); await page.keyboard.press('h');
  x = await ev(page, ()=>task('a3').date); check('k_card_no_shortcut', x==='2026-11-10', x);
  await page.keyboard.press('Enter'); await calm(page); x = await ev(page, ()=>UI.pitOpen); check('k_card_enter', x==='n1', x);
  await page.keyboard.press('Escape'); await calm(page);
  // + focuses the quick card
  await page.click('#desk .pitcol [data-act=pitAdd]'); x = await ev(page, ()=>document.activeElement.dataset.role); check('plus_focus', x==='pitnew', x);
  // Fold, kept across a reload, and unfold
  await page.click('#desk .pitcol [data-act=pitFold]'); await calm(page); c = await col(page);
  x = await ev(page, ()=>({set:DB.settings.pitFold, btn:document.querySelector('#desk .pitshow')?.textContent}));
  check('fold', !c.shown && c.btn && x.set===true && x.btn==='Notas (4)', {c, x});
  x = await ev(page, ()=>Math.round(document.querySelector('#desk .main .mbody').getBoundingClientRect().right)); check('fold_full_width', x>=1430, x);
  await page.reload(); await until(page, ()=>typeof DB!=='undefined'&&!!document.querySelector('#desk .main')); await view(page, 'project:p1'); await calm(page); c = await col(page);
  check('fold_reload', !c.shown && c.btn, c);
  await page.click('#desk .pitshow'); await calm(page); c = await col(page);
  x = await ev(page, ()=>({set:DB.settings.pitFold, saved:JSON.parse(localStorage.getItem('tareas-v1')).settings.pitFold}));
  check('unfold', c.shown && x.set===false && x.saved===false, {c, x});
  await ctx.close();
}

async function shots(browser){
  for(const theme of ['light','dark']){ const {ctx, page} = await open(browser, {tag:'S'+theme, w:1600, h:1000, theme});
    await view(page, 'project:p1'); await calm(page); await shot(page, 'project-1600-'+theme);
    await ev(page, ()=>{ document.querySelector('#desk .pitcard[data-pit=n1]').click(); }); await calm(page); await shot(page, 'project-1600-open-'+theme);
    await view(page, 'project:p2'); await calm(page); await ev(page, ()=>{ DB.projectNotes.push({id:'o1', projectId:'p2', title:'Contrato', body:'- Revisar cláusulas\n[ ] Firmar', pinned:true, created:new Date().toISOString(), modified:new Date().toISOString()}); save(); render(); }); await calm(page);
    await shot(page, 'project-oca-1600-'+theme);
    check('c_noclip_short_'+theme, await ev(page, ()=>!document.querySelector('#desk .pitcard[data-pit=o1]').classList.contains('clip')));
    if(theme==='dark'){ const x = await ev(page, ()=>{ const lum=c=>{ const k=c.startsWith('color(')?1:255, m=c.match(/[\d.]+/g).map(Number), f=v=>{ v/=k; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4); }; return 0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]); };
      const e=document.querySelector('#desk .pitcard'), a=lum(getComputedStyle(e).backgroundColor), b=lum(getComputedStyle(e.querySelector('.pit-tt')).color); return Math.round((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)*10)/10; });
      check('c_contrast_dark', x>=7, x); }
    await ctx.close(); }
}

(async()=>{
  await new Promise(res=>srv.listen(PORT, res)); const browser = await chromium.launch();
  try{ await visibility(browser); await cards(browser); await editing(browser); await shots(browser); }
  catch(e){ errors.push('exception: '+(e&&e.stack||e)); }
  await browser.close(); srv.close();
  console.log(JSON.stringify({results:r, fails, errors}, null, 1));
  process.exit(fails.length||errors.length?1:0);
})();
