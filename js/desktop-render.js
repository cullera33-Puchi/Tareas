'use strict';
/* Tareas. Desktop drawing: inspector pane, renderDesktop, week popover, live search and add bar.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file. */
// R17: the inspector's width, from the settings, kept between 320 and 600 px and never squeezing the list under 360 px
function paneWidth(w){ const max=Math.max(320, Math.min(600, innerWidth-220-360)); return Math.round(Math.max(320, Math.min(max, +w||400))); }
// R15: each group of rows is a list box of options (the rows), named after the view and its group; only the selected row, or the first, takes the Tab key
function ariaList(d){ const mb=d.querySelector('.main .mbody'); if(!mb) return; const h=d.querySelector('.main .mhead h1'), name=h?h.textContent:'Tareas';
  mb.querySelectorAll('.group').forEach(g=>{ if(!g.querySelector('.row[data-id], .rph')) return; g.setAttribute('role','listbox'); g.setAttribute('aria-multiselectable','true');
    const t=g.previousElementSibling&&g.previousElementSibling.classList.contains('group-title')?g.previousElementSibling:g.parentElement&&g.parentElement.querySelector(':scope > .group-title');
    const l=t&&(t.querySelector('.gl')||t); g.setAttribute('aria-label', name+(l&&l.firstChild?', '+(l.firstChild.textContent||'').trim():'')); }); }
// The pane's markup: the selected task's inspector, the multiple selection's actions, or none (and then no task is shown)
function deskPaneHTML(){ const dx = UI.deskDetail && task(UI.deskDetail); // only a task of the active space: the spaces never mix on screen
  const pop = isCalView(UI.deskView), multi = deskMulti() && deskListView(); // R16: several tasks selected, the pane offers what can be done with them
  const pane = multi ? multiPaneHTML() : dx && dx.spaceId===space().id ? '<section class="pane'+(pop?' wpop':'')+'" data-task="'+esc(UI.deskDetail)+'">'+(pop?'':'<div class="igrip" title="Arrastra para cambiar el ancho"></div>')+'<div class="screen detail">'+viewDetail(UI.deskDetail)+'</div></section>' : '';
  if(!pane||multi) UI.deskDetail=null; app.classList.toggle('has-pane', !!pane&&!pop); return pane; }
/* R18: the pane is drawn again only when its markup changed or something changed it since (typing, a link strip, the week popover's place);
   otherwise it stays as it is, with its scroll and focus. The inspector slides in from the right when it opens (a fade with Reduce Motion);
   the week popover keeps its own fade. Returns true when the pane was drawn anew */
function putPane(d, html){ let pn=d.querySelector(':scope > .pane'); const was=!!pn&&!pn.classList.contains('wpop');
  // bindDetail holds the task object: data reloaded from another window has new objects, so the pane is bound again
  if(pn&&html&&pn._h===html&&pn._x===(UI.deskDetail?task(UI.deskDetail):null)&&!(markDirty(rowWatch.takeRecords()), pn._dirty)) return false;
  const ps=pn&&pn.querySelector('.scroll'), pst=ps?ps.scrollTop:0, pid=pn?pn.dataset.task:null; // the pane keeps its scroll while it shows the same task
  if(!html){ if(pn) pn.remove(); return false; }
  const t=document.createElement('template'); t.innerHTML=html; const nw=t.content.firstElementChild; nw._h=html; nw._x=UI.deskDetail?task(UI.deskDetail):null;
  if(pn) pn.replaceWith(nw); else d.appendChild(nw); pn=nw; watchBox(pn);
  if(UI.deskDetail){ bindDetail(pn, UI.deskDetail); if(pid===UI.deskDetail){ const p2=pn.querySelector('.scroll'); if(p2) p2.scrollTop=pst; } } // restored after bindDetail has grown the text areas
  attHydrate(pn); // decision 29: thumbnails from the device (attOwn: not a change to the drawing)
  markDirty(rowWatch.takeRecords()); pn._dirty=false; // what bindDetail set is part of the drawing
  if(!was&&!pn.classList.contains('wpop')&&pn.animate){ try{ pn.animate(RM.matches?[{opacity:0},{opacity:1}]:[{transform:'translate3d(24px,0,0)',opacity:0},{transform:'none',opacity:1}], {duration:RM.matches?200:260, easing:'cubic-bezier(.2,.8,.2,1)'}); }catch(e){} }
  return true; }
// R18: the selected row moved (arrows, J and K, Tab): only the highlight and the inspector change, the column and the sidebar stay
function deskSelPane(){ const d=$('#desk'); if(!d) return render(); paintSel(); const i=deskOrder().indexOf(UI.dsel.cur); if(i>=0) UI.dsel.idx=i; deskRedraw=true; try{ drawing(()=>putPane(d, deskPaneHTML())); } finally{ deskRedraw=false; } }
function renderDesktop(again){
  let d=$('#desk'); if(!d){ d=document.createElement('div'); d.id='desk'; d.className='desk'; app.appendChild(d); d.addEventListener('click', onClick); bindDeskEvents(d); UI.deskScroll={}; UI.deskKey=null; }
  // Each view keeps its own scroll (per space), like the iPhone tabs; a view seen for the first time opens at the top
  const body=d.querySelector('.mbody'); if(body&&UI.deskKey) UI.deskScroll[UI.deskKey]=body.scrollTop; const side=d.querySelector('.side'); const sst=side?side.scrollTop:0;
  // The add bar or the search keep focus and caret across the rebuild (a click elsewhere has already taken the focus)
  const ae=document.activeElement, fr=ae&&d.contains(ae)&&/^(addbar|search|rowedit|addnotes|ntitle|nbody)$/.test(ae.dataset.role||'') ? {role:ae.dataset.role, a:ae.selectionStart, b:ae.selectionEnd} : null;
  const rowF=ae&&d.contains(ae)&&ae.classList.contains('row'), paneWas=UI.deskDetail; // R15: a focused row gives the focus to the selected row of the new markup
  const pop = isCalView(UI.deskView); // R17: in Semana the detail is a popover next to its card, so the seven columns keep their width
  const pane = deskPaneHTML();
  d.style.setProperty('--panew', paneWidth(DB.settings.paneWidth)+'px');
  const sideHTML=deskSide(), mainHTML=deskMain();
  const key=UI.deskView+'|'+DB.settings.activeSpace; // read after deskMain, which may fall back to another view
  const keep={}; d.querySelectorAll('[data-keep]').forEach(e=>{ keep[e.dataset.keep]=e.scrollTop; }); // the calendar's own scroll boxes (columns, tray, hours)
  // R18: the sidebar, the column and the pane are put in place each on its own. A list column is merged (morphInto): its rows that did not
  // change stay, with their focus. The calendar and Ajustes columns are drawn anew, as before
  deskRedraw=true; try{
    let side=d.querySelector(':scope > .side'), main=d.querySelector(':scope > .main');
    if(!side){ d.insertAdjacentHTML('afterbegin', '<aside class="side"></aside>'); side=d.firstElementChild; }
    morphInto(side, sideHTML, {outer:true});
    const lz=lazyRows(mainHTML, UI.deskScroll[key]||0, innerHeight), stash=rowStash, list=deskListView();
    if(list){ if(!main||d._mainKind!=='list'){ const m=document.createElement('main'); m.className='main'; if(main) main.replaceWith(m); else side.after(m); main=m; }
      if(!morphInto(main, lz, {outer:true})){ const t=document.createElement('template'); t.innerHTML=lz; const m=t.content.firstElementChild; main.replaceWith(m); main=m; } }
    else { const t=document.createElement('template'); t.innerHTML=lz; const m=t.content.firstElementChild; if(main) main.replaceWith(m); else side.after(m); main=m; }
    d._mainKind=list?'list':'other'; rowStash=stash;
    putPane(d, pane);
  } finally{ deskRedraw=false; } armRows(d.querySelector('.mbody'));
  if(deskNotesOn()) bindNotesDesk(d); // decision 47: the open note's fields, grown before their column's scroll comes back
  d.querySelectorAll('[data-keep]').forEach(e=>{ const k=e.dataset.keep; if(k in keep) e.scrollTop=keep[k]; else if(k==='hours') scrollHours(e); });
  const b2=d.querySelector('.mbody'); if(b2) b2.scrollTop=UI.deskScroll[key]||0; UI.deskKey=key;
  const s2=d.querySelector('.side'); if(s2) s2.scrollTop=sst;
  ariaList(d); if(syncSel(paneWas)&&!again) return renderDesktop(true); paintSel(); // R15, R16: a selected row that left the list hands over to its neighbour
  if(fr){ const n=$('#desk [data-role='+fr.role+']'); if(n){ n.focus({preventScroll:true}); try{ n.setSelectionRange(fr.a, fr.b); }catch(e){} } }
  else if(UI.dsel.edit){ const n=$('#desk [data-role=rowedit]'); if(n){ n.focus({preventScroll:true}); if(UI.dsel.edit.fresh){ n.select(); UI.dsel.edit.fresh=false; } } }
  else if(rowF){ const r=deskRow(UI.dsel.cur); if(r) r.focus({preventScroll:true}); }
  if(pop&&UI.deskDetail){ placeWeekPop(d); const wk=d.querySelector('.week'); if(wk) wk.addEventListener('scroll', ()=>placeWeekPop(d), {passive:true, capture:true}); } // each column scrolls on its own
  const s=$('[data-role=search]',d); if(s) bindSearch(s, ()=>deskResults(d));
  bindAddBar(d);
  // Decision 31: the composer just opened unfolds under the bar (a fade with Reduce Motion); its text areas take the height of their text
  d.querySelectorAll('.axp textarea').forEach(axFit);
  if(AX.opened){ AX.opened=false; const p=d.querySelector('.axp'); if(p&&p.animate) try{ p.animate(RM.matches?[{opacity:0},{opacity:1}]:[{opacity:0, transform:'translate3d(0,-6px,0)'},{opacity:1, transform:'none'}], {duration:RM.matches?160:200, easing:'cubic-bezier(.32,.72,0,1)'}); }catch(e){} }
  renderTabbar();
}
// R17: the week popover sits beside its card (right if it fits, else left), inside the window; it follows the card as the column scrolls.
// A card no longer in view (moved to another week) leaves it where it was
function placeWeekPop(d){ const pn=d.querySelector('.pane.wpop'); if(!pn) return; const dr=d.getBoundingClientRect();
  d.querySelectorAll('.wcard.popped').forEach(c=>c.classList.remove('popped'));
  const card=d.querySelector('.wcard[data-id="'+CSS.escape(pn.dataset.task)+'"]'); let a=null;
  if(card){ const r=card.getBoundingClientRect(), mb=d.querySelector('.mbody').getBoundingClientRect(); card.classList.add('popped'); if(r.bottom>mb.top&&r.top<mb.bottom) a=UI.popRect={left:r.left, right:r.right, top:r.top, bottom:r.bottom}; else a=UI.popRect; }
  else a=UI.popRect;
  pn.style.maxHeight=(dr.height-16)+'px'; const W=pn.offsetWidth, H=Math.min(pn.offsetHeight, dr.height-16); let left, top;
  if(!a){ left=dr.width-W-16; top=8; }
  else { left = a.right+10+W<=dr.right-8 ? a.right+10-dr.left : a.left-10-W>=dr.left+8 ? a.left-10-W-dr.left : dr.width-W-8; top=a.top-dr.top-8; }
  pn.style.left=Math.max(8, left)+'px'; pn.style.top=Math.max(8, Math.min(dr.height-H-8, top))+'px'; }
// Desktop search: the column is merged around the live field (R18): the rows that still match stay, the others go, and the project filter
// and the Cancelar button follow; the field, the sidebar and the detail pane stay. The calendar columns are drawn anew under the head
function deskResults(d){ return drawing(()=>deskResultsNow(d)); }
function deskResultsNow(d){ const main=d.querySelector(':scope > .main'), ob=main&&main.querySelector('.mbody'), s=main&&main.querySelector('.mhead [data-role=search]'); if(!ob||!s) return false;
  const html=lazyRows(deskMain(), ob.scrollTop, innerHeight), stash=rowStash;
  if(d._mainKind==='list'&&deskListView()){ deskRedraw=true; let ok; try{ ok=morphInto(main, html, {outer:true, keep:s}); } finally{ deskRedraw=false; } if(!ok||!s.isConnected) return false; }
  else { const t=document.createElement('div'); t.innerHTML=html; const oi=ob.querySelector('.inner'), ni=t.querySelector('.mbody .inner'), bar=s.closest('.searchbar'), nbar=t.querySelector('.mhead .searchbar'); if(!oi||!ni||!bar||!nbar) return false;
    oi.replaceWith(ni); const sb=bar.querySelector('.search'); [...bar.children].forEach(c=>{ if(c!==sb) c.remove(); }); [...nbar.children].forEach(c=>{ if(!c.querySelector('[data-role=search]')) bar.appendChild(c); });
    const os=main.querySelector('.mhead .pfslot'), ns=t.querySelector('.mhead .pfslot'); if(os&&ns) os.replaceWith(ns); }
  rowStash=stash; armRows(ob);
  bindAddBar(d); if(deskNotesOn()) bindNotesDesk(d); if(isCalView(UI.deskView)&&UI.deskDetail) placeWeekPop(d); ariaList(d); syncSel(UI.deskDetail); paintSel(); return true; }
function bindAddBar(d){
  const ab=$('[data-role=addbar]',d); if(!ab) return; const base=()=>deskAddBase(ab.dataset.project);
  const refocus=()=>{ const n=$('#desk [data-role=addbar]'); if(n){ n.focus(); const l=n.value.length; n.setSelectionRange(l,l); } };
  // R7: the recognised parts are tinted in the field and spelled out under it
  const upd=()=>{ const said=$('#deskSaid',d), r=addxTask(ab.value, ab.dataset.project); paintQuick(ab, r.toks); const q=quickSaid(r); axPaint(r); // decision 31: the values chosen on the buttons count too
    if(said) said.innerHTML=(q.out.length?'Entendido: <b>'+esc(q.out.join(', '))+'</b>'+(q.warn.length?'. ':''):'')+(q.warn.length?'<span class="warn">'+esc(q.warn.join(' '))+'</span>':''); return r; };
  upd(); bindPasteBox(d, refocus); if(ab._ab) return; ab._ab=1; // R18: a bar kept by a merge keeps its listeners
  bindQuickScroll(ab);
  ab.addEventListener('input',()=>{ UI.addDraft=ab.value; upd(); if(ab.value.trim()&&!AX.open&&!UI.addPaste) axOpen(); }); // a render keeps the half-typed task; typing opens the composer (decision 31)
  ab.addEventListener('paste',e=>{ const ls=pasteLines(e.clipboardData&&e.clipboardData.getData('text')); if(ls.length<2) return; e.preventDefault(); UI.addPaste=(UI.addPaste||[]).concat(ls); render(); refocus(); });
  ab.addEventListener('keydown',e=>{
    if(e.key==='Tab'&&!e.shiftKey&&!e.metaKey&&!e.ctrlKey&&!e.altKey){ if(completeProjectTag(ab)) e.preventDefault(); return; }
    if(e.key!=='Shift') delete ab.dataset.tagBase;
    if(e.key!=='Enter') return; e.preventDefault();
    if(UI.addPaste){ const v=ab.value.trim(); if(v){ UI.addPaste.push(v); UI.addDraft=''; render(); refocus(); } return; } // with a pasted list waiting, Enter adds a line to it
    const r=upd(); if(!r.title) return;
    axSubmit(ab.dataset.project||null); }); // decision 31: with the notes, the buttons' values and the voice note
}
function bindPasteBox(d, refocus){ const pb=$('.pastebox',d), base=()=>{ const a=$('[data-role=addbar]',d); return deskAddBase(a&&a.dataset.project); }; if(pb&&!pb._pb){ pb._pb=1; pb.addEventListener('click',e=>{ const rm=e.target.closest('[data-paste-rm]'); if(rm){ UI.addPaste.splice(+rm.dataset.pasteRm,1); if(!UI.addPaste.length) UI.addPaste=null; render(); refocus(); return; }
    const b=e.target.closest('[data-paste]'); if(!b) return; if(b.dataset.paste==='cancel'){ UI.addPaste=null; render(); refocus(); return; }
    const ls=UI.addPaste.slice(); UI.addPaste=null; const ids=addMany(ls, base()); renderAnimated(); log('info','Tareas creadas desde una lista', {n:ids.length}); toast(ids.length===1?'1 tarea creada':ids.length+' tareas creadas', ()=>removeTasks(ids)); refocus(); }); }
}
