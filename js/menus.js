'use strict';
/* Tareas. Menus: anchored menus of the iPhone (R10), and the macOS menus, popovers and task menu of the desktop (R17).
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file. */
/* ---------- R10: anchored menus (iPhone) ----------
   A long press lifts the row (a copy of it, over the blurred and dimmed screen; the row itself is hidden meanwhile) and opens a
   compact menu next to it. A button (the space title, three dots, a detail cell, the select bar) opens the same menu anchored to it.
   Options come in groups with a line icon each; a submenu replaces the menu in place, with its parent as a header that goes back.
   The finger that opened the menu can slide over the options and lift on one to choose it (menuTrack, menuRelease).
   spec: {anchor, lift, x, y, align, title, prio:{cur, fn}, groups:[[{label, sub, icon, red, on, fn, menu}]]}; menu returns a spec.
   The bottom action sheet stays for confirmations (confirmSheet), a centred dialog on the desktop, which draws every menu as a macOS menu (macMenu, R17). */
const mi = p => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>';
const MI = {
  p3:mi('<path d="M6 4.5v9.5M12 4.5v9.5M18 4.5v9.5"/><g fill="currentColor" stroke="none"><circle cx="6" cy="19" r="1.5"/><circle cx="12" cy="19" r="1.5"/><circle cx="18" cy="19" r="1.5"/></g>'),
  p2:mi('<path d="M9 4.5v9.5M15 4.5v9.5"/><g fill="currentColor" stroke="none"><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></g>'),
  p0:mi('<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>'),
  postpone:mi('<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4M8.5 15.5h6.5M12.5 13l2.5 2.5-2.5 2.5"/>'),
  calPick:mi('<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/><g fill="currentColor" stroke="none"><circle cx="8" cy="14.5" r="1.1"/><circle cx="12" cy="14.5" r="1.1"/><circle cx="16" cy="14.5" r="1.1"/><circle cx="8" cy="18" r="1.1"/><circle cx="12" cy="18" r="1.1"/></g>'),
  cal:mi('<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  sunrise:mi('<path d="M4 18h16M7 18a5 5 0 0110 0M12 6v3M5.5 10.5l1.6 1.6M18.5 10.5l-1.6 1.6M3 14.5h1.5M19.5 14.5H21"/>'),
  weekend:mi('<path d="M5 11V8a2 2 0 012-2h10a2 2 0 012 2v3M3 13a2 2 0 014 0v1h10v-1a2 2 0 014 0v5H3zM5 18v2M19 18v2"/>'),
  folder:mi('<path d="M3 7.5a2 2 0 012-2h4.2l2 2.3H19a2 2 0 012 2V18a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>'),
  space:mi('<path d="M13 4H6a2 2 0 00-2 2v12a2 2 0 002 2h7M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5"/>'),
  dup:mi('<rect x="8" y="8" width="12" height="12" rx="2.2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>'),
  select:mi('<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.3l2.6 2.6 5-5.3"/>'),
  done:mi('<path d="M5 12.5l4.5 4.5L19 7"/>'),
  undo:mi('<path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11"/>'),
  trash:mi('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  plus:mi('<path d="M12 5v14M5 12h14"/>'),
  eye:mi('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff:mi('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>'),
  summary:mi('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 9h10M7 13h6"/>'),
  play:mi('<path d="M8 5.5v13l10.5-6.5z"/>'),
  pencil:mi('<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>'),
  up:mi('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down:mi('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  archive:mi('<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 002 2h10a2 2 0 002-2V9M10 13h4"/>'),
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5L19.5 6.5"/></svg>',
};
const pmEl=$('#pmenu');
const pmHide=document.createElement('style'); document.head.appendChild(pmHide); // hides the lifted row while its copy is up, also once a render has replaced it
let PM=null, pmFinish=null; // the open menu; the end of a closing one (a new menu finishes it at once)
const menuOpen=()=>!!PM;
let pmProbe=null;
function safeInsets(){ if(!pmProbe){ pmProbe=document.createElement('div'); pmProbe.style.cssText='position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)'; document.body.appendChild(pmProbe); }
  const cs=getComputedStyle(pmProbe); return {t:parseFloat(cs.paddingTop)||0, r:parseFloat(cs.paddingRight)||0, b:parseFloat(cs.paddingBottom)||0, l:parseFloat(cs.paddingLeft)||0}; }
// The row on screen for a task: the top screen's, else the active tab's (rowMenu called without the row, as the tests and old callers do)
function visibleRow(id){ const top=UI.stack.length?UI.stack[UI.stack.length-1].el:rootScreen(UI.tab); const r=top&&top.querySelector('.scroll .row[data-id="'+CSS.escape(id)+'"]:not(.first .row)'); if(!r) return null; const b=r.getBoundingClientRect(); return b.height&&b.bottom>0&&b.top<innerHeight?r:null; }
function popMenu(spec){
  if(PM) closeMenu(true); if(pmFinish) pmFinish(); pmOpenedAt=spec.lift&&!UI.wide?0:performance.now();
  if(UI.wide) return macMenu(spec); // R17: the desktop draws the same spec as a macOS menu
  if(openRow) closeRow(openRow);
  const m=PM={spec, stack:[spec], hl:null, moved:false, x0:spec.x||0, y0:spec.y||0, subT:null, rect:null};
  const src=spec.lift&&spec.lift.isConnected?spec.lift:null;
  pmEl.className='pm open'+(src?' lift':''); pmEl.innerHTML='<div class="pm-back"></div><div class="pm-menu" role="menu"><div class="pm-list"></div></div>';
  if(src){ const r=m.rect=src.getBoundingClientRect(); const c=src.cloneNode(true);
    c.classList.remove('swiping','dir-l','dir-r','armed','held','cv','leaving','selected'); c.removeAttribute('data-id'); c.removeAttribute('data-open'); c.removeAttribute('data-open-project');
    c.querySelectorAll('.row-bg').forEach(b=>b.remove()); const cc=c.querySelector('.row-content'); if(cc){ cc.style.transform=''; cc.classList.remove('drag'); }
    const box=document.createElement('div'); box.className='pm-lift'; box.style.cssText='left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;height:'+r.height+'px';
    const g=document.createElement('div'); g.className='group'; g.appendChild(c); box.appendChild(g); pmEl.insertBefore(box, pmEl.querySelector('.pm-menu'));
    const sel=src.dataset.id?'.app .row[data-id="'+CSS.escape(src.dataset.id)+'"]':src.dataset.openProject?'.app [data-open-project="'+CSS.escape(src.dataset.openProject)+'"]':null;
    if(sel) pmHide.textContent=sel+'{visibility:hidden}'; else src.classList.add('pm-src'); m.src=src; }
  pmRender(false); pmEl.offsetWidth; pmEl.classList.add('on');
}
function pmCur(){ return PM.stack[PM.stack.length-1]; }
function pmItem(key){ const cur=pmCur(); return /^\d+$/.test(key)?cur.items[+key]:null; }
function pmRender(swap){ const m=PM, cur=pmCur(), depth=m.stack.length-1; const items=cur.items=[]; const gs=(cur.groups||[]).filter(g=>g&&g.length);
  const checks=gs.some(g=>g.some(it=>it.on!==undefined)); let h='';
  if(depth) h+='<button class="pm-head" data-mi="back">'+I.back+'<span>'+esc(cur.title||'')+'</span></button>';
  else if(cur.title) h+='<div class="pm-title">'+esc(cur.title)+'</div>';
  if(cur.prio) h+='<div class="pm-prio">'+[['high','Alta',MI.p3],['mid','Media',MI.p2],['none','Ninguna',MI.p0]].map(([k,l,ic])=>'<button class="'+k+(cur.prio.cur===k?' on':'')+'" data-mi="p:'+k+'" role="menuitemradio" aria-checked="'+(cur.prio.cur===k)+'">'+ic+'<span>'+l+'</span></button>').join('')+'</div>';
  gs.forEach(g=>{ h+='<div class="pm-grp">'+g.map(it=>{ const i=items.push(it)-1;
    return '<button class="pm-it'+(it.red?' red':'')+(checks?' chk':'')+'" data-mi="'+i+'" role="menuitem">'+(checks?'<span class="pm-ck">'+(it.on?MI.check:'')+'</span>':'')+
      '<span class="pm-l">'+esc(it.label)+(it.sub?'<small>'+esc(it.sub)+'</small>':'')+'</span>'+
      '<span class="pm-ic">'+(it.menu?I.chev.replace('<svg','<svg class="pm-sub"'):'')+(it.icon||'')+'</span></button>'; }).join('')+'</div>'; });
  const list=pmEl.querySelector('.pm-list'); list.innerHTML=h; list.classList.remove('swap'); if(swap){ list.offsetWidth; list.classList.add('swap'); }
  m.hl=null; pmEl.querySelector('.pm-menu').scrollTop=0; pmLayout(); }
// Places the menu next to its anchor or lifted row, inside the safe area: below if it fits, else above, else the lifted row moves
// out of its way (as on iOS) or the menu covers the anchor; a menu taller than the screen scrolls inside
function pmLayout(){ const m=PM, mn=pmEl.querySelector('.pm-menu'); const ins=safeInsets(); const vw=innerWidth, vv=window.visualViewport;
  const T=Math.max(ins.t, vv?vv.offsetTop:0)+8, B=Math.min(innerHeight-ins.b, vv?vv.offsetTop+vv.height:innerHeight)-8, Lx=ins.l+8, Rx=vw-ins.r-8; mn.style.maxHeight=''; mn.style.maxWidth=(Rx-Lx)+'px'; // T and B: above the keyboard, if one is up
  const w=mn.offsetWidth; let h=Math.min(mn.offsetHeight, B-T); let top, sy=0, fromTop=true; const lift=pmEl.querySelector('.pm-lift');
  const a=m.rect||(m.spec.anchor&&m.spec.anchor.isConnected?m.spec.anchor.getBoundingClientRect():null);
  if(a&&lift){ const gap=10; if(h>B-T-a.height-gap) h=Math.max(120, B-T-a.height-gap);
    const below=B-(a.bottom+gap), above=(a.top-gap)-T;
    if(h<=below) top=a.bottom+gap; else if(h<=above){ top=a.top-gap-h; fromTop=false; }
    else if(below>=above){ sy=below-h; top=a.bottom+sy+gap; } else { sy=h-above; top=a.top+sy-gap-h; fromTop=false; }
    lift.style.setProperty('--sy', sy+'px'); }
  else if(a&&a.width){ const gap=6, below=B-(a.bottom+gap), above=(a.top-gap)-T;
    if(h<=below) top=a.bottom+gap; else if(h<=above){ top=a.top-gap-h; fromTop=false; } else top=Math.max(T, Math.min(B-h, a.top)); }
  else top=(T+B-h)/2;
  let left; const ax=m.spec.x||(a?a.left+a.width/2:vw/2);
  if(!a||!a.width) left=(vw-w)/2; else if(m.spec.align==='right'||(m.spec.align!=='left'&&(lift?ax>vw/2:a.left+a.width/2>vw*0.55))) left=a.right-w; else left=a.left;
  left=Math.max(Lx, Math.min(Rx-w, left)); top=Math.max(T, Math.min(B-h, top));
  mn.style.left=left+'px'; mn.style.top=top+'px'; mn.style.maxHeight=h+'px';
  mn.style.transformOrigin=Math.round(Math.max(0, Math.min(w, (a?(lift?ax:a.left+a.width/2):vw/2)-left)))+'px '+(fromTop?'0':h+'px'); }
// pick: an option was chosen; the lifted copy fades where it is and the row shows again at once, for the action's own animation
function closeMenu(instant, pick){ const m=PM; if(!m) return; PM=null; clearTimeout(m.subT); if(m.opener) m.opener.classList.remove('open'); if(m.spec&&m.spec.onClose) setTimeout(m.spec.onClose, 0); // onClose: the focus goes back where it was (decision 31)
  const finish=()=>{ if(pmFinish!==finish) return; pmFinish=null; pmEl.className='pm'; pmEl.innerHTML=''; pmHide.textContent=''; if(m.src) m.src.classList.remove('pm-src'); };
  pmFinish=finish; if(pick||RM.matches){ pmEl.classList.add('pick'); pmHide.textContent=''; if(m.src) m.src.classList.remove('pm-src'); }
  pmEl.classList.remove('on'); if(instant) finish(); else setTimeout(finish, 300);
  if(staleView&&!pick) setTimeout(flushStale, 0); }
function pmActivate(key){ const m=PM; if(!m) return; const cur=pmCur(); clearTimeout(m.subT);
  if(key==='back'){ if(m.stack.length>1){ m.stack.pop(); pmRender(true); } return; }
  if(key.startsWith('p:')){ const pr=key.slice(2); closeMenu(false, true); cur.prio.fn(pr); return; }
  const it=pmItem(key); if(!it) return;
  if(it.menu){ const sub=it.menu(); if(!sub) return; sub.title=sub.title||it.label; m.stack.push(sub); haptic(4); pmRender(true); return; }
  closeMenu(false, true); if(it.fn) it.fn(); }
function pmHighlight(b, buzz){ const m=PM; if(!m||b===m.hl) return; if(m.hl) m.hl.classList.remove('hl'); clearTimeout(m.subT); m.hl=b||null; if(!b) return;
  b.classList.add('hl'); if(buzz) haptic(4);
  const it=pmItem(b.dataset.mi); if(buzz&&it&&it.menu) m.subT=setTimeout(()=>{ if(PM===m&&m.hl===b){ b.classList.remove('hl'); m.hl=null; pmActivate(b.dataset.mi); } }, 600); } // resting on a submenu while sliding opens it
// The finger that opened the menu (or any finger on it) slides: the option under it lights up
function menuTrack(x, y){ const m=PM; if(!m) return; if(!m.moved&&Math.hypot(x-m.x0, y-m.y0)>10) m.moved=true; if(!m.moved) return;
  const el=document.elementFromPoint(x, y); pmHighlight(el&&el.closest('#pmenu .pm-menu [data-mi]'), true); }
// It lifts: on an option, that option runs; after sliding away from where it started, outside the menu, the menu closes
function menuRelease(x, y){ const m=PM; if(!m) return; clearTimeout(m.subT); const b=m.hl; if(b){ b.classList.remove('hl'); m.hl=null; pmActivate(b.dataset.mi); return; }
  if(m.moved){ const el=document.elementFromPoint(x, y); if(!(el&&el.closest('#pmenu .pm-menu'))) closeMenu(); } m.moved=false; }
// A desktop menu touched on a touch screen acts on the click. A new touch right after the menu opened (a repeated or ghost tap, v0.14.1)
// neither chooses nor closes it; the finger that opened it (a long press) is followed by its row through menuTrack and menuRelease
pmEl.addEventListener('touchstart', e=>{ const m=PM; if(!m||m.mac) return; m.ghost=menuFresh(); if(m.ghost){ log('warn','Toque en el menú ignorado justo al abrir'); return; } const t=e.touches[0]; m.x0=t.clientX; m.y0=t.clientY; m.moved=false; m.scroll=false; m.inMenu=!!e.target.closest('.pm-menu');
  pmHighlight(e.target.closest('.pm-menu [data-mi]'), false); },{passive:true});
pmEl.addEventListener('touchmove', e=>{ const m=PM; if(!m||m.mac) return; if(m.ghost){ if(e.cancelable) e.preventDefault(); return; } const t=e.touches[0], mn=pmEl.querySelector('.pm-menu');
  if(m.inMenu&&mn.scrollHeight>mn.clientHeight+1){ if(m.scroll||Math.abs(t.clientY-m.y0)>8){ m.scroll=true; pmHighlight(null); } return; } // a menu taller than the screen scrolls instead
  e.preventDefault(); menuTrack(t.clientX, t.clientY); },{passive:false});
pmEl.addEventListener('touchend', e=>{ const m=PM; if(!m||m.mac) return; if(e.cancelable) e.preventDefault(); if(m.ghost){ m.ghost=false; return; } if(m.scroll){ m.scroll=false; return; } const t=e.changedTouches[0];
  if(m.hl){ menuRelease(t.clientX, t.clientY); return; } const el=document.elementFromPoint(t.clientX, t.clientY); if(!(el&&el.closest('.pm-menu'))) closeMenu(); });
pmEl.addEventListener('touchcancel', ()=>{ if(PM&&!PM.mac) pmHighlight(null); });
pmEl.addEventListener('click', e=>{ if(!PM) return; if(ghostClick(e)){ log('warn','Clic en el menú ignorado justo al abrir'); return; } const b=e.target.closest('.pm-menu [data-mi]'); if(b){ if(PM.mac) macActivate(b); else pmActivate(b.dataset.mi); return; } if(!inMenuPath(e)) closeMenu(); }); // a mouse, or a tap that touchend let through
// A click inside a menu or popover whose handler redrew part of it (a calendar day) has a detached target: the path taken at dispatch still knows it came from inside
function inMenuPath(e){ if(e.target.isConnected) return !!e.target.closest('.pm-menu'); return (e.composedPath?e.composedPath():[]).some(n=>n.classList&&n.classList.contains('pm-menu')); }
addEventListener('resize', ()=>{ if(PM) closeMenu(true); });
/* ---------- R17: macOS menus and popovers (desktop) ----------
   popMenu's spec drawn as a Mac menu: at the pointer (x, y: a right click) or under its control (anchor), 13 px, no lift and no dimming.
   Each level is its own panel; an item with a submenu (menu) opens it to the side on hover, a click or the right arrow.
   A check column on the left marks the current value (on); key shows a keyboard shortcut on the right. Arrows move,
   Enter or Space choose, Left and Escape go back a level. spec.html turns the panel into a popover (spec.bind wires it). */
function macMenu(spec){ const m=PM={spec, mac:true, levels:[], subT:null};
  pmEl.className='pm open mac'; pmEl.innerHTML='<div class="pm-back"></div>';
  if(spec.anchor&&spec.anchor.classList){ m.opener=spec.anchor; spec.anchor.classList.add('open'); }
  macLevel(0, spec, null); pmEl.offsetWidth; pmEl.classList.add('on');
  const f=spec.html&&pmEl.querySelector('.pm-pop [autofocus]'); if(f) f.focus(); }
function macLevel(lv, spec, parent){ const m=PM; macCloseFrom(lv);
  const el=document.createElement('div'); el.className='pm-menu'+(spec.html?' pm-pop':''); el.setAttribute('role', spec.html?'dialog':'menu'); el.dataset.lv=lv;
  const L={spec, el, items:[], hl:null, parent}; m.levels.push(L);
  el.innerHTML=spec.html||macItemsHTML(L, lv); pmEl.appendChild(el); if(spec.html&&spec.bind) spec.bind(el);
  macPlace(L); return L; }
function macItemsHTML(L, lv){ const spec=L.spec; let gs=(spec.groups||[]).filter(g=>g&&g.length);
  if(spec.prio) gs=[[['high','Alta','1'],['mid','Media','2'],['none','Ninguna','0']].map(([k,l,key])=>({label:l, key, on:spec.prio.cur===k, fn:()=>spec.prio.fn(k)}))].concat(gs);
  let h=lv===0&&spec.title?'<div class="pm-title">'+esc(spec.title)+'</div>':'';
  gs.forEach(g=>{ h+='<div class="pm-grp" role="group">'+g.map(it=>{ const i=L.items.push(it)-1, dot=it.icon&&it.icon.indexOf('pm-dot')>=0?it.icon:'', key=it.key||(it.sub&&!it.menu?it.sub:'');
    return '<button class="pm-it'+(it.red?' red':'')+'" data-mi="'+lv+':'+i+'" role="'+(it.on!==undefined?'menuitemcheckbox" aria-checked="'+!!it.on:'menuitem')+'"'+(it.menu?' aria-haspopup="menu"':'')+'><span class="pm-ck">'+(it.on?MI.check:'')+'</span>'+dot+
      '<span class="pm-l">'+esc(it.label)+'</span>'+(key?'<span class="pm-key">'+esc(key)+'</span>':'')+(it.menu?I.chev.replace('<svg','<svg class="pm-sub"'):'')+'</button>'; }).join('')+'</div>'; });
  return h; }
// Under its control (right-aligned with align:'right'), or with its top left corner at the pointer, flipping at the window edges
// as macOS does; a submenu beside its item, on the left when the right has no room
function macPlace(L){ const el=L.el, vw=innerWidth, vh=innerHeight, M=6; el.style.maxHeight=(vh-2*M)+'px';
  const w=el.offsetWidth, h=Math.min(el.offsetHeight, vh-2*M); let x, y; const sp=L.spec;
  if(L.parent){ const pr=L.parent.getBoundingClientRect(), mr=L.parent.closest('.pm-menu').getBoundingClientRect(); x=mr.right-3+w<=vw-M?mr.right-3:mr.left+3-w; y=pr.top-5; }
  else { const a=sp.anchor&&sp.anchor.isConnected?sp.anchor.getBoundingClientRect():null;
    if(a){ x=sp.align==='right'?a.right-w:a.left; y=a.bottom+4; if(y+h>vh-M&&a.top-4-h>=M) y=a.top-4-h; }
    else if(sp.x!=null&&sp.y!=null){ x=sp.x; y=sp.y; if(x+w>vw-M) x-=w; if(y+h>vh-M) y=Math.max(M, y-h); }
    else { x=(vw-w)/2; y=(vh-h)/2; } }
  el.style.left=Math.round(Math.max(M, Math.min(vw-M-w, x)))+'px'; el.style.top=Math.round(Math.max(M, Math.min(vh-M-h, y)))+'px'; }
function macCloseFrom(lv){ const m=PM; if(!m) return; m.levels.slice(lv).forEach(L=>L.el.remove()); m.levels.length=Math.min(m.levels.length, lv); }
function macHl(L, b){ if(L.hl===b) return; if(L.hl) L.hl.classList.remove('hl'); L.hl=b||null; if(b) b.classList.add('hl'); }
const macAt = b => { const [lv,i]=b.dataset.mi.split(':').map(Number); const L=PM&&PM.levels[lv]; return {lv, L, it:L&&L.items[i]}; };
function macOpenSub(b, kb){ const m=PM, {lv, L, it}=macAt(b); if(!it||!it.menu) return; clearTimeout(m.subT); macHl(L, b);
  if(m.levels[lv+1]&&m.levels[lv+1].parent===b){ if(kb) macHl(m.levels[lv+1], m.levels[lv+1].el.querySelector('[data-mi]')); return; }
  const sub=it.menu(); if(!sub) return; const S=macLevel(lv+1, sub, b); if(kb) macHl(S, S.el.querySelector('[data-mi]')); }
function macActivate(b){ const m=PM, {L, it}=macAt(b); if(!it) return; clearTimeout(m.subT);
  if(it.menu){ macOpenSub(b, false); return; }
  macHl(L, b); closeMenu(false, true); if(it.fn) it.fn(); }
// Hover: the item lights up; resting on one with a submenu opens it, on another item closes the open one (a short wait lets the
// pointer cross other items on its way into a submenu)
pmEl.addEventListener('mouseover', e=>{ const m=PM; if(!m||!m.mac) return; const b=e.target.closest('.pm-menu [data-mi]'); if(!b) return; const {lv, L, it}=macAt(b); if(!L) return;
  macHl(L, b); clearTimeout(m.subT); const open=m.levels[lv+1]; if(open&&open.parent===b) return;
  if(it&&it.menu) m.subT=setTimeout(()=>{ if(PM===m&&L.hl===b) macOpenSub(b, false); }, 160);
  else if(open) m.subT=setTimeout(()=>{ if(PM===m&&L.hl===b) macCloseFrom(lv+1); }, 220); });
pmEl.addEventListener('mouseout', e=>{ const m=PM; if(!m||!m.mac) return; const from=e.target.closest('.pm-menu'); if(!from||(e.relatedTarget&&from.contains(e.relatedTarget))) return;
  const lv=+from.dataset.lv, L=m.levels[lv]; if(L&&!(m.levels[lv+1]&&m.levels[lv+1].parent===L.hl)) macHl(L, null); });
// A right click outside an open menu closes it and opens the menu of what is under the pointer, as on a Mac
pmEl.addEventListener('contextmenu', e=>{ const m=PM; if(!m||!m.mac) return; e.preventDefault(); if(e.target.closest('.pm-menu')) return; const x=e.clientX, y=e.clientY; closeMenu(true);
  const el=document.elementFromPoint(x, y); if(el&&el.closest('#desk')) el.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:x, clientY:y, button:2})); });
// Keys while a desktop menu is open; a popover leaves every key but Escape to its fields
window.addEventListener('keydown', e=>{ const m=PM; if(!m||!m.mac) return; const k=e.key, L=m.levels[m.levels.length-1]; if(!L) return;
  const stop=()=>{ e.preventDefault(); e.stopPropagation(); };
  if(k==='Escape'){ stop(); if(m.levels.length>1) macCloseFrom(m.levels.length-1); else closeMenu(); return; }
  if(L.spec.html) return;
  if(k==='ArrowDown'||k==='ArrowUp'){ stop(); clearTimeout(m.subT); const bs=[...L.el.querySelectorAll('[data-mi]')]; if(!bs.length) return; let i=bs.indexOf(L.hl);
    i=k==='ArrowDown'?(i+1)%bs.length:(i<=0?bs.length-1:i-1); macHl(L, bs[i]); bs[i].scrollIntoView({block:'nearest'}); return; }
  if(k==='ArrowRight'){ stop(); if(L.hl) macOpenSub(L.hl, true); return; }
  if(k==='ArrowLeft'){ stop(); if(m.levels.length>1) macCloseFrom(m.levels.length-1); return; }
  if(k==='Enter'||k===' '){ stop(); if(L.hl){ const {it}=macAt(L.hl); if(it&&it.menu) macOpenSub(L.hl, true); else macActivate(L.hl); } return; }
  if(!e.metaKey&&!e.ctrlKey) stop(); // nothing behind an open menu reacts to a key
}, true);
// The control a desktop picker for a task hangs from when none was given (a menu item, an old caller): the inspector's control,
// else the date column of the task's row, else its week card
function taskAnchor(id, act){ if(!UI.wide) return null; const q=CSS.escape(id);
  const pc=document.querySelector('#desk .pane[data-task="'+q+'"] [data-act='+(act||'pickDate')+']'); if(pc) return {anchor:pc, align:'left'};
  const r=document.querySelector('#desk .main .row[data-id="'+q+'"]:not(.first .row) .rc-date')||document.querySelector('#desk .wcard[data-id="'+q+'"]');
  return r?{anchor:r, align:'right'}:{}; }
// R17: on the desktop a date or a reminder is chosen in a popover under its control; on the iPhone in a bottom sheet.
// bind(panel, done) wires the content; done closes whichever it is
function pickerPanel(title, html, id, src, act, bind){
  if(UI.wide){ const at=src&&src.isConnected?{anchor:src, align:src.closest('.pane')?'left':'right'}:taskAnchor(id, act); popMenu(Object.assign(at, {html, bind:el=>bind(el, ()=>closeMenu(false, true))})); return; }
  openSheet('<h2>'+title+'</h2>'+html, s=>bind(s, closeSheet)); }
// The priority options (R10 on the iPhone, a submenu of the desktop menus with their keys, R17)
const prioItems = (x, id) => [['high','Alta',MI.p3,'1'],['mid','Media',MI.p2,'2'],['none','Ninguna',MI.p0,'0']].map(([k,l,ic,key])=>({label:l, icon:ic, key, on:x.priority===k, fn:()=>setPriority(id,k)}));
function priorityMenu(id, src){ const x=task(id); if(!x) return; const at=src?{anchor:src, align:'right'}:taskAnchor(id, 'pickPriority')||{};
  popMenu(Object.assign(at, {groups:[prioItems(x, id)]})); }
function setPriority(id, pr){ const x=task(id); if(!x||x.priority===pr) return; const old=x.priority; updTask(id,{priority:pr}); haptic(8); renderAnimated(); toast({high:'Prioridad alta',mid:'Prioridad media',none:'Sin prioridad'}[pr], ()=>updTask(id,{priority:old})); }
function moveToProject(id, projectId){ const x=task(id); if(!x||x.projectId===projectId) return; const old=x.projectId; updTask(id,{projectId}); const p=projectId?proj(projectId):null; renderAnimated(); toast(p?'Movida a '+p.name:'Sin proyecto', ()=>updTask(id,{projectId:old})); }
function moveToSpace(id, sp){ const x=task(id); if(!x) return; const old={spaceId:x.spaceId, projectId:x.projectId}; leaveRows(id); setTimeout(()=>{ updTask(id,{spaceId:sp.id, projectId:null}); if(detailTaskId()===id) pop(); else renderAnimated(); toast('Movida a '+sp.name, ()=>updTask(id,old)); },200); }
const otherSpaces = x => DB.spaces.filter(sp=>sp.id!==x.spaceId).sort((a,b)=>a.order-b.order);
function moveToSpaceSheet(id, src){ const x=task(id); if(!x||!otherSpaces(x).length) return; const m=spaceMoveMenu(id); m.title=''; popMenu(Object.assign(src?{anchor:src}:taskAnchor(id)||{}, m)); }
// R10 submenus of a task (row menu and detail menu, iPhone)
function spaceMoveMenu(id){ const x=task(id); if(!x) return null; return {title:'Mover a otro espacio', groups:[otherSpaces(x).map(sp=>({label:sp.name, icon:MI.space, fn:()=>moveToSpace(id, sp)}))]}; }
function projectPickMenu(id){ const x=task(id); if(!x) return null; const dot=c=>'<span class="pm-dot" style="background:'+c+'"></span>';
  return {title:'Mover a proyecto', groups:[[{label:'Ninguno', icon:dot('var(--ink3)'), on:!x.projectId, fn:()=>moveToProject(id,null)}].concat(activeProjects().map(p=>({label:p.name, icon:dot(p.color), on:x.projectId===p.id, fn:()=>moveToProject(id,p.id)})))]}; }
const DATE_ICON={'Mañana':MI.sunrise, 'Fin de semana':MI.weekend, 'Próxima semana':MI.postpone, 'En una semana':MI.cal, 'Sin fecha':MI.p0};
const dateItem = (l, d, fn) => ({label:l, sub:l==='Mañana'||!d?'':fmtDate(d), icon:DATE_ICON[l]||MI.cal, fn});
function postponeMenu(id){ const t=todayStr(); const opts=uniqueBy([['Mañana',addDays(t,1)],['Fin de semana',weekendDay()],['Próxima semana',nextWeekday(1,true)]], o=>o[1]);
  return {title:'Aplazar', groups:[opts.map(([l,d])=>dateItem(l, d, ()=>{ leaveRows(id); setTimeout(()=>{ rescheduleTask(id,d,l.toLowerCase()); renderAnimated(); },200); })), [{label:'Elegir fecha', icon:MI.calPick, key:'F', fn:()=>dateSheet(id)}]]}; }
// R17: a date chosen from a desktop menu, with Deshacer; choosing the date it already has confirms a carried task for today
function setTaskDate(id, d){ const x=task(id); if(!x||(x.date===d&&!x.carried)) return; releaseHold(id); const old=daySnap(x); updTask(id, dayPatch(x, d)); haptic(8); renderAnimated();
  toast(d?'Movida a '+fmtDate(d).toLowerCase():'Sin fecha', ()=>undoDay(old)); }
// R17: the Fecha submenu of the desktop: the quick dates with their keys (H, M, V, S), Sin fecha and the calendar popover (F)
function dateMenu(id){ const x=task(id); if(!x) return null; const t=todayStr();
  const ds=uniqueBy([['Hoy',t,'H'],['Mañana',addDays(t,1),'M'],['Viernes',nextWeekday(5,true),'V'],['Próxima semana',nextWeekday(1,true),'S']], o=>o[1]);
  return {title:'Fecha', groups:[ds.map(([l,d,k])=>({label:l, key:k, on:x.date===d, fn:()=>setTaskDate(id,d)})), [{label:'Sin fecha', on:!x.date, fn:()=>setTaskDate(id,null)}], [{label:'Elegir fecha…', key:'F', fn:()=>dateSheet(id)}]]}; }
/* R17: the desktop menu of a task (right click, its three dots): Completar, then Fecha, Prioridad and Proyecto as submenus with a check
   on the current value, Mover a otro espacio, Duplicar and Eliminar, each with the key that acts on the selected row (R15) */
function deskTaskMenu(id){ const x=task(id); if(!x) return null; const done=x.status==='done';
  return {groups:[
    [{label:done?'Marcar pendiente':'Completar', key:'C', fn:()=>{ releaseHold(id); leaveRows(id); setTimeout(()=>{ completeTask(id); renderAnimated(); },200); }}],
    [{label:'Fecha', menu:()=>dateMenu(id)}, {label:'Prioridad', menu:()=>({title:'Prioridad', groups:[prioItems(x, id)]})}, {label:'Proyecto', key:'P', menu:()=>projectPickMenu(id)}].concat(DB.spaces.length>1?[{label:'Mover a otro espacio', menu:()=>spaceMoveMenu(id)}]:[]),
    [{label:'Duplicar', fn:()=>duplicateTask(id)}],
    [{label:'Eliminar', key:'Supr', red:true, fn:()=>confirmDelete(id)}] ]}; }
function duplicateTask(id){ const x=task(id); if(!x) return; const n=addTask({title:x.title, projectId:x.projectId, priority:x.priority, notes:x.notes, spaceId:x.spaceId}); haptic(8); renderAnimated(); toast('Tarea duplicada'); openDetail(n.id); }
function leaveRows(id){ document.querySelectorAll('.row[data-id="'+id+'"]').forEach(r=>r.classList.add('leaving')); }
function confirmDelete(id, after){ const x=task(id); if(!x) return; releaseHold(id); confirmSheet('Eliminar tarea', '"'+x.title+'" se eliminará. Podrás deshacerlo durante unos segundos.', ()=>{ leaveRows(id); setTimeout(()=>{ deleteTask(id); after?after():renderAnimated(); },200); }); }
function detailMenu(id, src){ const x=task(id); if(!x) return;
  popMenu({anchor:src, align:'right', groups:[
    [{label:x.status==='done'?'Marcar pendiente':'Marcar completada', icon:x.status==='done'?MI.undo:MI.done, key:'C', fn:()=>{ completeTask(id,true); render(); }}],
    (DB.spaces.length>1?[{label:'Mover a otro espacio', icon:MI.space, menu:()=>spaceMoveMenu(id)}]:[]).concat([{label:'Duplicar', icon:MI.dup, fn:()=>duplicateTask(id)}]),
    [{label:'Eliminar tarea', icon:MI.trash, red:true, key:'Supr', fn:()=>confirmDelete(id, closeDetailOf(id))}] ]}); }
// After a delete from the detail, close that task's detail only if it is still the one showing: Atrás may have been tapped meanwhile
const closeDetailOf = id => ()=>{ if(detailTaskId()===id) pop(); else renderAnimated(); };
function postponeSheet(id, src){ releaseHold(id); const m=postponeMenu(id); if(m) popMenu(Object.assign(m, src?{anchor:src, align:'right'}:taskAnchor(id)||{})); }
