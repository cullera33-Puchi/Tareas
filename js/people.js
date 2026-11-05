'use strict';
/* Tareas. People (decision 48c and the roadmap's list of contacts, approved by the owner on 4 November): Responsable, Contactos and
   Enviar recordatorio.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file.
   - Task.responsible: who does the task when it is not the owner (free text, Supabase tasks.responsible), null when nobody. Set in the
     detail, the inspector and the task menus (responsibleSheet), shown in grey on the rows, a list filter (UI.respFilter, with the
     project filter) and found by the search. Duplicate and the next one of a series copy it.
   - DB.contacts: {id, name, email, phone, created, modified}, synced as the table contacts (0011_contacts.sql). A new name set as
     Responsable or Esperando a makes a contact with just the name (ensureContact); both fields suggest the contacts first, then the names
     the tasks use. Ajustes, Contactos: edit, add, delete (the tasks keep their names) and rename (the tasks follow, one Deshacer).
   - Enviar recordatorio (remindSheet): a message to the task's person, editable before it goes: WhatsApp with the contact's phone, mail
     with its email, the share sheet otherwise (or a copy). A multiple selection of one person's tasks sends one message with every title.
   - Por persona (decision 65a): the people with open tasks, in the desktop sidebar and the iPhone's Proyectos tab, each with a view of what
     they do and what is waited from them, and Recordar todo (one message with the whole list). */

/* ---------- Contacts ---------- */
const contactRec = id => DB.contacts.find(c=>c&&c.id===id);
const personKey = s => norm(String(s||'').replace(/\s+/g,' ').trim());
const contactByName = name => { const k=personKey(name); return k ? DB.contacts.find(c=>c&&personKey(c.name)===k)||null : null; };
const nameCmp = (a,b) => String(a).localeCompare(String(b), 'es', {sensitivity:'base'});
function contactsSorted(){ return DB.contacts.filter(c=>c&&c.name).slice().sort((a,b)=>nameCmp(a.name, b.name)); }
// A typed name, tidied: single spaces, at most 80 characters; the spelling of a contact with that name when there is one
function personName(v){ v=String(v||'').replace(/\s+/g,' ').trim().slice(0,80); if(!v) return null; const c=contactByName(v); return c?c.name:v; }
/* A name newly set as Responsable or Esperando a becomes a contact with just the name, when none has it. Esperando a also takes a reason
   («respuesta del banco»): only what reads as a name (up to 40 characters and four words) is kept as a contact. Returns the new contact, for
   Deshacer (dropContact), or null. The caller saves */
function ensureContact(name){ const n=String(name||'').replace(/\s+/g,' ').trim(); if(!n||n.length>40||n.split(' ').length>4||contactByName(n)) return null;
  const t=new Date().toISOString(), c={id:uid(), name:n, email:null, phone:null, created:t, modified:t}; DB.contacts.push(c); log('info','Contacto creado al escribir un nombre nuevo'); return c; }
// Deshacer of the action that made c: it goes again while nobody has changed it
function dropContact(c){ if(!c) return; const cur=contactRec(c.id); if(cur&&cur.modified===c.modified&&!cur.email&&!cur.phone) DB.contacts=DB.contacts.filter(o=>o!==cur); }
/* ---------- v0.33.1: the person picker, a list with a search field on top (Responsable and Esperando a) ----------
   The names are the contacts, alphabetically, then those the tasks use (Responsable, Esperando a) that no contact has, with the contact's
   phone or mail as a grey icon. What is typed filters them (no accents or case); with nothing typed the list starts with the «none» row
   (Sin responsable, La tarea es tuya); a typed text that no name matches exactly gives «Añadir «Texto»» at the top. The current value has
   the check mark. Keys: up and down move, Enter chooses; the mouse and the finger choose with one click. A press on a row keeps the focus in
   the field, so the iPhone keyboard stays up. o: {cur, none:[label, sub], onPick(value or null, 'click'|'enter'), rows (desktop rows shown)} */
function pickNames(cur){ const seen=new Set(), out=[]; const add=(n, c)=>{ const v=String(n||'').replace(/\s+/g,' ').trim(), k=personKey(v); if(!v||seen.has(k)) return; seen.add(k); out.push({name:v, c}); };
  contactsSorted().forEach(c=>add(c.name, c)); const n=out.length;
  DB.tasks.map(x=>x.responsible).concat(DB.tasks.map(x=>x.waitingFor)).concat([cur]).forEach(v=>add(v, null));
  return out.slice(0, n).concat(out.slice(n).sort((a,b)=>nameCmp(a.name, b.name))); } // the contacts first, then the other names
const personPickHTML = () => '<div class="ppick"><div class="ppsearch">'+I.search+'<input type="text" data-role="ppq" placeholder="Buscar o escribir un nombre" autocomplete="off" autocapitalize="words" enterkeyhint="done" spellcheck="false" aria-label="Buscar o escribir un nombre"'+(UI.wide?' autofocus':'')+'></div><div class="pplist" role="listbox"></div></div>';
function bindPersonPick(root, o){ const inp=$('[data-role=ppq]', root), box=$('.pplist', root); if(!inp||!box) return null; let rows=[], act=-1;
  const hl=()=>{ box.querySelectorAll('.pprow').forEach((b,i)=>b.classList.toggle('hl', i===act)); const b=box.children[act]; if(b&&b.scrollIntoView) b.scrollIntoView({block:'nearest'}); };
  const paint=()=>{ const q=inp.value.replace(/\s+/g,' ').trim(), k=personKey(q), ck=personKey(o.cur), names=pickNames(o.cur);
    rows=[]; if(!k) rows.push({none:true}); else if(!names.some(n=>personKey(n.name)===k)) rows.push({add:q});
    names.forEach(n=>{ if(!k||personKey(n.name).includes(k)) rows.push(n); });
    box.innerHTML=rows.map((r,i)=>{ const on=r.none?!ck:r.add==null&&personKey(r.name)===ck;
      const ic=r.add!=null?I.plus:r.c&&r.c.phone?MI.phone:r.c&&r.c.email?MI.mail:'';
      const lbl=r.none?esc(o.none[0])+'<small>'+esc(o.none[1])+'</small>':r.add!=null?'Añadir «'+esc(r.add)+'»':esc(r.name);
      return '<button type="button" class="pprow'+(r.add!=null?' ppadd':'')+(r.none?' ppnone':'')+'" data-pp="'+i+'" role="option" aria-selected="'+on+'"'+(r.c&&(r.c.phone||r.c.email)?' title="'+esc(r.c.phone||r.c.email)+'"':'')+'><span class="ppck">'+(on?MI.check:'')+'</span><span class="ppl">'+lbl+'</span><span class="ppic">'+ic+'</span></button>'; }).join('');
    act=k?0:Math.max(0, rows.findIndex(r=>r.none?!ck:personKey(r.name)===ck)); if(UI.wide) hl(); };
  const pick=(i, how)=>{ const r=rows[i]; if(!r) return; haptic(4); o.onPick(r.none?null:r.add!=null?r.add:r.name, how); };
  paint(); inp.addEventListener('input', paint);
  inp.addEventListener('keydown', e=>{ if(e.isComposing) return;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){ e.preventDefault(); if(!rows.length) return; act=e.key==='ArrowDown'?(act+1)%rows.length:(act<=0?rows.length-1:act-1); hl(); return; }
    if(e.key==='Enter'){ e.preventDefault(); pick(act<0?0:act, 'enter'); } });
  box.addEventListener('mousedown', e=>{ if(e.target.closest('.pprow')) e.preventDefault(); });
  box.addEventListener('mousemove', e=>{ if(!UI.wide) return; const b=e.target.closest('.pprow'); if(b&&+b.dataset.pp!==act){ act=+b.dataset.pp; box.querySelectorAll('.pprow').forEach((x,i)=>x.classList.toggle('hl', i===act)); } });
  box.addEventListener('click', e=>{ const b=e.target.closest('.pprow'); if(!b) return; e.stopPropagation(); pick(+b.dataset.pp, 'click'); });
  // The picker inside a sheet that saves later (Esperando a): set the chosen value, clear the search, move the check mark
  return { set(v){ o.cur=v||''; inp.value=''; paint(); }, typed:()=>inp.value.replace(/\s+/g,' ').trim(), input:inp }; }

/* ---------- Responsable ---------- */
function setResponsible(id, who){ const x=task(id); if(!x) return; const v=personName(who); if((x.responsible||null)===v) return; const old=x.responsible||null; releaseHold(id);
  let nc=null; batch(()=>{ nc=v?ensureContact(v):null; updTask(id, {responsible:v}); }); haptic(8); renderAnimated(); log('info', v?'Responsable':'Responsable quitado');
  toast(v?'Responsable: '+v:'Sin responsable', ()=>batch(()=>{ updTask(id, {responsible:old}); dropContact(nc); save(); })); }
/* The Responsable picker (v0.33.1, a list): on the iPhone a sheet with Cancelar in its head (decision 18) and the field focused inside the
   tap; on the desktop a popover of about 280 px under the control that opened it (the inspector's cell; a menu's or a key's opens it at
   the row or centred). One choice closes it and applies, with Deshacer */
function responsibleSheet(id, src){ const x=task(id); if(!x) return;
  const bind=(s, close)=>{ bindPersonPick(s, {cur:x.responsible||'', none:['Sin responsable','La tarea es tuya'], onPick:v=>{ close(); setResponsible(id, v||''); }});
    s.addEventListener('click', e=>{ if(e.target.closest('[data-x=cancel]')) close(); });
    if(!UI.wide){ const inp=$('[data-role=ppq]', s); if(inp) inp.focus(); } };
  if(UI.wide){ const at=src&&src.isConnected?{anchor:src, align:src.closest('.pane')?'left':'right'}:taskAnchor(id, 'pickResp');
    popMenu(Object.assign(at||{}, {html:'<div class="ppwrap">'+personPickHTML()+'</div>', bind:el=>{ el.classList.add('pp-pop'); bind(el, ()=>closeMenu(false, true)); }})); return; }
  openSheet('<div class="shead"><button class="hbtn" data-x="cancel">Cancelar</button><h2>Responsable</h2><span></span></div>'+personPickHTML(), s=>{ s.classList.add('ppsheet'); bind(s, closeSheet); }); }

/* ---------- List filter by responsible ----------
   UI.respFilter holds a name; with the project filter (UI.projFilter) both apply. One person at a time; a search ignores both, as it
   ignores the project filter; they clear together (Quitar filtro, a space change, the return to Hoy) */
const filterOn = () => UI.projFilter!==null || !!UI.respFilter;
const passProj = x => UI.projFilter===null || (UI.projFilter==='none' ? !x.projectId : x.projectId===UI.projFilter);
const passFilter = x => passProj(x) && (!UI.respFilter || personKey(x.responsible)===personKey(UI.respFilter));
// The responsibles of the open tasks of the space, and the one filtered by even when no task has it any more (so it can be cleared)
function respNames(){ const seen=new Set(), out=[]; spaceTasks().filter(isOpen).map(x=>x.responsible).concat(UI.respFilter?[UI.respFilter]:[]).forEach(n=>{ const k=personKey(n); if(k&&!seen.has(k)){ seen.add(k); out.push(String(n).trim()); } });
  return out.sort(nameCmp); }
function setRespFilter(v){ UI.respFilter=v||null; haptic(4); render(); }
function respFilterMenu(src){ const cur=personKey(UI.respFilter);
  popMenu({anchor:src, align:UI.wide?'right':undefined, title:UI.wide?'':'Responsable', groups:[[{label:'Todos', on:!cur, fn:()=>setRespFilter(null)}], respNames().map(n=>({label:n, icon:UI.wide?'':MI.person, on:personKey(n)===cur, fn:()=>setRespFilter(n)}))]}); }
// The iPhone's chip, first in the row of project chips, and the desktop's pop-up button beside Proyecto: Todos. Only with a name to choose
function respChipHTML(){ if(!respNames().length) return ''; const on=!!UI.respFilter;
  return '<button class="chip rchip'+(on?' on':'')+'" data-act="respFilterMenu" aria-haspopup="menu">'+I.person+esc(on?UI.respFilter:'Responsable')+'</button>'; }
function rfDropHTML(){ if(UI.query||!respNames().length) return ''; const on=!!UI.respFilter;
  return '<button class="pfdrop rfdrop'+(on?' on':'')+'" data-act="respFilterMenu" aria-haspopup="menu" title="Filtrar por responsable"><span class="l"><i>Responsable:</i> '+esc(on?UI.respFilter:'Todos')+'</span>'+I.chevD+'</button>'; }
// The empty list under the filters: «Nada de FLC para Marta»
function filterEmptyTitle(){ const pf=UI.projFilter===null?'':UI.projFilter==='none'?' sin proyecto':' de '+esc((proj(UI.projFilter)||{}).name||''); return 'Nada'+pf+(UI.respFilter?' para '+esc(UI.respFilter):''); }

/* ---------- Rows ----------
   The responsible in grey next to Esperando a: on the iPhone in the line under the title, on the desktop a tag in the title cell. The same
   name in both says it once, as Esperando a */
// Decision 65a: in a person's view the rows do not repeat that person (opts.person, its key), as R3 asks
const isViewPerson = (name, opts) => !!(opts&&opts.person) && personKey(name)===opts.person;
const respShown = x => !!x.responsible && !(x.status==='waiting'&&x.waitingFor&&personKey(x.waitingFor)===personKey(x.responsible));
const respMetaHTML = x => respShown(x) ? '<span class="resp" title="Responsable: '+esc(x.responsible)+'">'+I.person+esc(x.responsible)+'</span>' : '';
const respTagHTML = x => respShown(x) ? '<span class="rtag" title="Responsable: '+esc(x.responsible)+'">'+I.person+esc(x.responsible)+'</span>' : '';

/* ---------- Enviar recordatorio ---------- */
// The people a task can be reminded to: its responsible, then whom it waits for
const taskPeople = x => { const out=[]; [x&&x.responsible, x&&x.status==='waiting'&&x.waitingFor].forEach(n=>{ const s=String(n||'').trim(); if(s&&!out.some(o=>personKey(o)===personKey(s))) out.push(s); }); return out; };
const canRemind = x => !!x && isOpen(x) && taskPeople(x).length>0;
// The person every task of a selection shares (Responsable or Esperando a), or null
function sharedPerson(xs){ if(!xs.length||!xs.every(canRemind)) return null; return taskPeople(xs[0]).find(n=>xs.every(x=>taskPeople(x).some(o=>personKey(o)===personKey(n))))||null; }
// «(entrega el jueves 5)», «(para mañana)»: the deadline, or the date of a pending task (a waiting task's date is its review day)
function remindWhen(x){ if(x.deadline) return 'entrega '+dayWords(x.deadline); if(x.date&&x.status==='pending') return 'para '+dayWords(x.date); return ''; }
// Decision 74: the project goes with each task, then its date or deadline
const remindItem = x => { const p=x.projectId&&proj(x.projectId), d=[p&&p.name, remindWhen(x)].filter(Boolean); return (x.title||'Sin título')+(d.length?' ('+d.join(', ')+')':''); };
function remindText(xs, name){ const first=String(name||'').trim().split(' ')[0];
  // Decision 73: an opening line, one bullet per task and the thanks, each on its own line
  return 'Hola '+first+',\n\nTe recuerdo '+(xs.length===1?'esta tarea':'estas tareas')+':\n\n'+xs.map(x=>'• '+remindItem(x)).join('\n')+'\n\nGracias.'; }
// How it goes: WhatsApp with a phone, mail with an email, the share sheet otherwise. A Spanish number without its country code gets +34
function waDigits(phone){ let d=String(phone||'').replace(/[^\d+]/g,''); if(d.startsWith('+')) d=d.slice(1); else if(d.startsWith('00')) d=d.slice(2); else if(/^[6-9]\d{8}$/.test(d)) d='34'+d; d=d.replace(/\D/g,''); return d.length>=8?d:''; }
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||'').trim());
// Decision 74: every way the person can be reached; the first one is the default (WhatsApp, then mail)
function remindVias(name){ const c=contactByName(name), out=[];
  if(c&&waDigits(c.phone)) out.push({kind:'wa', to:c.phone, name:'WhatsApp', label:'Por WhatsApp a '+c.phone});
  if(c&&validEmail(c.email)) out.push({kind:'mail', to:c.email.trim(), name:'Correo', label:'Por correo a '+c.email.trim()}, {kind:'teams', to:c.email.trim(), name:'Teams', label:'Por Teams a '+c.email.trim()});
  out.push({kind:'share', name:'Otras apps', label:navigator.share?'Con la hoja de compartir':'Se copia para pegarlo donde quieras'}); return out; }
function remindVia(name, kind){ const v=remindVias(name); return v.find(x=>x.kind===kind)||v[0]; }
function sendRemind(name, text, xs, kind){ const via=remindVia(name, kind); log('info','Recordatorio enviado', {via:via.kind, n:xs.length});
  if(via.kind==='teams'){ window.open('https://teams.microsoft.com/l/chat/0/0?users='+encodeURIComponent(via.to)+'&message='+encodeURIComponent(text), '_blank', 'noopener'); return; }
  if(via.kind==='wa'){ window.open('https://wa.me/'+waDigits(via.to)+'?text='+encodeURIComponent(text), '_blank', 'noopener'); return; }
  if(via.kind==='mail'){ const a=document.createElement('a'); a.href='mailto:'+encodeURIComponent(via.to).replace(/%40/g,'@')+'?subject='+encodeURIComponent('Recordatorio: '+(xs.length===1?xs[0].title:xs.length+' tareas'))+'&body='+encodeURIComponent(text); a.style.display='none'; document.body.appendChild(a); a.click(); a.remove(); return; }
  if(navigator.share){ navigator.share({text}).catch(e=>{ if(!e||e.name!=='AbortError') copyText(text, 'Recordatorio copiado. Pégalo donde quieras.'); }); return; }
  copyText(text, 'Recordatorio copiado. Pégalo donde quieras.'); }
/* The sheet: whom (when the task has two people), the message to edit and how it will go. Enviar opens WhatsApp, mail or the share sheet
   inside the tap, as browsers ask. after: run once it is sent (the end of a multiple selection). to: whom, when the caller knows (the
   person's view: its tasks may share another person too) */
function remindSheet(ids, after, to, pick){ const all=ids.map(task).filter(canRemind); if(!all.length) return; flushEdits();
  // Decision 73: from a person's view, which tasks go in (all ticked at first); the message follows the ticks until it is edited
  pick=!!pick&&all.length>1; const on=new Set(all.map(x=>x.id)); let xs=all;
  const names=to?[to]:xs.length===1?taskPeople(xs[0]):[sharedPerson(xs)].filter(Boolean); if(!names.length) return; let who=names[0], edited=false; // to: the person of Recordar todo (decision 65a)
  const whoHTML=()=>names.length>1?'<label class="wlbl">Para</label><div class="chips wchips rwho">'+names.map(n=>'<button class="chip'+(n===who?' on':'')+'" data-who="'+esc(n)+'">'+esc(n)+'</button>').join('')+'</div>':'<div class="rto">Para '+esc(who)+'</div>';
  let via=remindVia(who).kind; // decision 74: the channel can be changed in the sheet
  const viaHTML=()=>{ const v=remindVias(who); if(!v.some(x=>x.kind===via)) via=v[0].kind; return (v.length>1?'<div class="chips rvias">'+v.map(x=>'<button class="chip'+(x.kind===via?' on':'')+'" data-via="'+x.kind+'">'+esc(x.name)+'</button>').join('')+'</div>':'')+'<div class="hint rvia">'+esc(remindVia(who, via).label)+'</div>'; };
  const pickHTML=()=>!pick?'':'<div class="rpick"><div class="rpickh"><span>'+on.size+' de '+all.length+' tareas</span><button class="rall" data-rall>'+(on.size===all.length?'Quitar todas':'Seleccionar todo')+'</button></div>'+
    all.map(x=>'<button class="rpi'+(on.has(x.id)?' on':'')+'" data-rpick="'+esc(x.id)+'"><span class="rbox">'+I.check+'</span><span class="rpt">'+esc(remindItem(x))+'</span></button>').join('')+'</div>';
  const body='<div class="wsheet remsheet">'+'<div class="rwhowrap">'+whoHTML()+'</div>'+pickHTML()+'<textarea class="wfor rmsg" data-role="rmsg" rows="4">'+esc(remindText(xs, who))+'</textarea><div class="rviawrap">'+viaHTML()+'</div>'+
    (remindVias(who).length===1?'<div class="hint">Añade su teléfono o su correo en Ajustes, Contactos, para enviarlo directamente.</div>':'')+'</div>';
  openSheet(sheadHTML('Enviar recordatorio', 'Cancelar', 'Enviar')+body, s=>{ const ta=$('[data-role=rmsg]', s);
    ta.addEventListener('input', ()=>{ edited=true; });
    s.onclick=e=>{ const w=e.target.closest('[data-who]'); if(w){ who=w.dataset.who; $('.rwhowrap', s).innerHTML=whoHTML(); if(!edited) ta.value=remindText(xs, who); via=remindVia(who).kind; $('.rviawrap', s).innerHTML=viaHTML(); haptic(4); return; }
      const vb=e.target.closest('[data-via]'); if(vb){ via=vb.dataset.via; $('.rviawrap', s).innerHTML=viaHTML(); haptic(4); return; }
      const rp=e.target.closest('[data-rpick],[data-rall]'); if(rp){ if(rp.hasAttribute('data-rall')){ if(on.size===all.length) on.clear(); else all.forEach(x=>on.add(x.id)); } else { const id=rp.dataset.rpick; if(on.has(id)) on.delete(id); else on.add(id); }
        xs=all.filter(x=>on.has(x.id)); $('.rpick', s).outerHTML=pickHTML(); if(!edited&&xs.length) ta.value=remindText(xs, who); haptic(4); return; }
      const b=e.target.closest('[data-x]'); if(!b) return; if(b.dataset.x!=='ok'){ closeSheet(); return; }
      if(!xs.length){ toast('Elige al menos una tarea'); return; }
      const text=ta.value.trim(); if(!text){ ta.focus(); return; } closeSheet(); sendRemind(who, text, xs, via); if(after) after(); }; }); }
// A multiple selection whose tasks share one person (iPhone selection bar, desktop pane)
function bulkRemind(){ const xs=selectedTasks(); if(!sharedPerson(xs)) return; remindSheet(xs.map(x=>x.id), ()=>endSelect()); }
const bulkRemindOn = () => !!sharedPerson(selectedTasks());

/* ---------- Ajustes, Contactos ---------- */
const contactUses = c => { const k=personKey(c.name); return DB.tasks.filter(x=>personKey(x.responsible)===k||personKey(x.waitingFor)===k).length; };
function contactsSectionHTML(){ const cs=contactsSorted(), chev=I.chev.replace('<svg','<svg class="chev"');
  return '<div class="group-title">Contactos</div><div class="group contacts">'+cs.map(c=>'<button class="cell" data-contact="'+esc(c.id)+'"><span class="lbl">'+esc(c.name)+'</span><span class="val">'+esc(c.phone||c.email||'')+'</span>'+chev+'</button>').join('')+
    '<button class="cell link" data-act="newContact">'+I.plus.replace('<svg','<svg style="width:18px;height:18px"')+'<span class="lbl">Nuevo contacto</span></button></div>'+
    '<div class="footnote">Se crean solos al escribir un nombre nuevo en Responsable o en Esperando a. Con su teléfono, Enviar recordatorio abre WhatsApp; con su correo, el correo.</div>'; }
function contactSheet(id){ const c=id?contactRec(id):null; if(id&&!c) return; const n=c?contactUses(c):0;
  const f=(role, type, ph, v, extra)=>'<input class="wfor" data-role="'+role+'" type="'+type+'" placeholder="'+ph+'" value="'+esc(v||'')+'" autocomplete="off"'+(extra||'')+'>';
  openSheet(sheadHTML(c?'Editar contacto':'Nuevo contacto', 'Cancelar', c?'Guardar':'Crear')+'<div class="wsheet csheet">'+f('cname','text','Nombre',c&&c.name,' autocapitalize="words"')+f('cemail','email','Correo',c&&c.email,' inputmode="email" autocapitalize="off" spellcheck="false"')+f('cphone','tel','Teléfono',c&&c.phone,' inputmode="tel"')+
    (c?'<div class="hint">'+(n?(n===1?'Lo usa 1 tarea.':'Lo usan '+n+' tareas.')+' Si cambias el nombre, cambia también en ellas.':'Ninguna tarea lo usa.')+'</div><button class="wback red" data-x="del">Eliminar contacto</button>':'')+'</div>', s=>{
    const nm=$('[data-role=cname]', s);
    const ok=()=>{ const v={name:String(nm.value||'').replace(/\s+/g,' ').trim().slice(0,80), email:String($('[data-role=cemail]', s).value||'').trim()||null, phone:String($('[data-role=cphone]', s).value||'').trim()||null};
      if(!v.name){ nm.focus(); toast('Escribe un nombre'); return; } const other=contactByName(v.name); if(other&&other!==c){ nm.focus(); toast('Ya hay un contacto con ese nombre'); return; }
      closeSheet(); saveContact(c, v); };
    s.querySelectorAll('input').forEach(i=>i.addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.isComposing){ e.preventDefault(); ok(); } }));
    s.onclick=e=>{ const b=e.target.closest('[data-x]'); if(!b) return; if(b.dataset.x==='ok') ok(); else if(b.dataset.x==='del'){ closeSheet(); confirmDeleteContact(c.id); } else closeSheet(); };
    if(!c) nm.focus(); }); }
/* A new contact, or a contact changed. A new name renames it in the tasks too (Responsable and Esperando a, the same name without minding
   accents or case), in one save and one Deshacer; the filter by that person follows */
function saveContact(c, v){ const t=new Date().toISOString();
  if(!c){ const n=Object.assign({id:uid(), created:t, modified:t}, v); DB.contacts.push(n); save(); render(); log('info','Contacto creado'); toast('Contacto creado', ()=>{ DB.contacts=DB.contacts.filter(o=>o!==n); save(); }); return; }
  if(c.name===v.name&&(c.email||null)===v.email&&(c.phone||null)===v.phone) return;
  const prev={name:c.name, email:c.email||null, phone:c.phone||null, modified:c.modified}, k=personKey(c.name), renamed=c.name!==v.name, moved=[];
  batch(()=>{ Object.assign(c, v, {modified:t});
    if(renamed) DB.tasks.forEach(x=>{ const p={}; if(personKey(x.responsible)===k&&x.responsible!==v.name) p.responsible=v.name; if(personKey(x.waitingFor)===k&&x.waitingFor!==v.name) p.waitingFor=v.name;
      if(Object.keys(p).length){ moved.push({id:x.id, responsible:x.responsible||null, waitingFor:x.waitingFor||null, keys:Object.keys(p)}); updTask(x.id, p); } });
    save(); });
  const rf=renamed&&personKey(UI.respFilter)===k; if(rf) UI.respFilter=v.name; if(renamed) personRenamed(prev.name, v.name); /* decision 65a: the person's view follows */ render(); log('info', renamed?'Contacto renombrado':'Contacto cambiado', renamed?{tasks:moved.length}:undefined);
  toast(renamed&&moved.length?'Contacto renombrado en '+bulkN(moved.length):'Contacto guardado', ()=>batch(()=>{ const cur=contactRec(c.id); if(cur) Object.assign(cur, prev, {modified:new Date().toISOString()});
    moved.forEach(o=>{ if(task(o.id)) updTask(o.id, Object.fromEntries(o.keys.map(kk=>[kk, o[kk]]))); }); if(rf) UI.respFilter=prev.name; if(renamed) personRenamed(v.name, prev.name); save(); })); }
function confirmDeleteContact(id){ const c=contactRec(id); if(!c) return; const n=contactUses(c);
  confirmSheet('Eliminar contacto', '"'+c.name+'" se eliminará de tus contactos.'+(n?' '+(n===1?'La tarea que lo usa conserva':'Las '+n+' tareas que lo usan conservan')+' el nombre.':'')+' Podrás deshacerlo durante unos segundos.', ()=>{
    const i=DB.contacts.indexOf(c); if(i<0) return; DB.contacts.splice(i,1); save(); render(); haptic(14); log('info','Contacto eliminado');
    toast('Contacto eliminado', ()=>{ if(!contactRec(c.id)){ c.modified=new Date().toISOString(); DB.contacts.push(c); } save(); }); }); }

/* ---------- Por persona (decision 65a, design approved by the owner on 5 November) ----------
   What is open with each person in the active space (the spaces never mix): Le toca a <Nombre>, the open tasks (pending or waiting) whose
   Responsable is that person, and Esperando a <Nombre>, the waiting tasks whose Esperando a is that person. A task in both goes only in
   Esperando a. Each group by date (no date last), then priority. Names match without accents or case (personKey); a person is any name
   those two fields use, contact or not, written as the contact writes it when there is one. Only people with something open are listed,
   the busiest first. Desktop: the sidebar's Personas and a view 'person:<name>' in the column. iPhone: Personas in the Proyectos tab and
   a pushed screen of kind 'person'. Recordar todo sends one message with the whole list (remindSheet). No data of its own */
const personOrder = xs => xs.slice().sort((a,b)=>{ const da=a.date||'~', db=b.date||'~'; if(da!==db) return da<db?-1:1;
  const pa=PRI[a.priority]??2, pb=PRI[b.priority]??2; if(pa!==pb) return pa-pb; return a.created<b.created?-1:a.created>b.created?1:0; });
// The open names of a task: its responsible and, while it waits, whom it waits for (one entry per person)
function openPeople(x){ const out=[]; if(!isOpen(x)) return out; [x.responsible, x.status==='waiting'?x.waitingFor:null].forEach(n=>{ const s=String(n||'').replace(/\s+/g,' ').trim(), k=personKey(s); if(k&&!out.some(o=>o.k===k)) out.push({k, s}); }); return out; }
// [{key, name, n}] of the active space, the most open tasks first, then by name. A name with no contact keeps the spelling of its oldest task
function peopleList(){ const by=new Map();
  spaceTasks().slice().sort((a,b)=>a.created<b.created?-1:a.created>b.created?1:0).forEach(x=>openPeople(x).forEach(({k, s})=>{ let e=by.get(k); if(!e){ const c=contactByName(s); e={key:k, name:c?c.name:s, n:0}; by.set(k, e); } e.n++; }));
  return [...by.values()].sort((a,b)=>b.n-a.n||nameCmp(a.name, b.name)); }
// The two groups of a person's view (UI.query, when the desktop search has one, filters them)
function personGroups(name){ const k=personKey(name); if(!k) return {mine:[], wait:[]}; let xs=spaceTasks().filter(isOpen); if(UI.query) xs=xs.filter(queryMatcher(UI.query));
  const wait=xs.filter(x=>x.status==='waiting'&&personKey(x.waitingFor)===k), mine=xs.filter(x=>personKey(x.responsible)===k&&!wait.includes(x));
  return {mine:personOrder(mine), wait:personOrder(wait)}; }
// The name a view shows: the contact's spelling, else the list's, else as it came
function personLabel(name){ const c=contactByName(name); if(c) return c.name; const k=personKey(name), e=peopleList().find(p=>p.key===k); return e?e.name:String(name||'').trim(); }
const personFirst = name => String(name||'').trim().split(' ')[0];
// The tasks Recordar todo sends: the whole list, Le toca a first
function personRemindable(name){ const g=personGroups(name); return g.mine.concat(g.wait).filter(canRemind); }
function remindAll(name){ const q=UI.query; UI.query=''; let xs; try{ xs=personRemindable(name); } finally{ UI.query=q; } if(!xs.length) return; // a search never shortens the message
  log('info','Recordar todo', {n:xs.length}); remindSheet(xs.map(x=>x.id), null, personLabel(name), true); }
// The contact's phone and mail, for the view's head
function personContactLine(name){ const c=contactByName(name); return c?[c.phone, c.email].map(v=>String(v||'').trim()).filter(Boolean):[]; }
// The two groups (or the empty state), shared by the iPhone screen and the desktop column
function personListHTML(name){ const g=personGroups(name), nm=personLabel(name), pk=personKey(name), R=x=>rowHTML(x, {person:pk});
  if(!g.mine.length&&!g.wait.length){ if(UI.query) return '<div class="empty">'+I.search.replace('<svg','<svg style="width:44px;height:44px"')+'<b>Sin resultados</b>Prueba con otra palabra</div>';
    return '<div class="empty pempty">'+I.person.replace('<svg','<svg style="width:44px;height:44px"')+'<b>Nada pendiente con '+esc(nm)+'</b>Aquí verás lo que le toca y lo que esperas de '+esc(personFirst(nm))+'.</div>'; }
  return (g.mine.length?gsec(gtitle('Le toca a '+esc(nm), g.mine.length, '', ' data-pgroup="mine"'), g.mine.map(R).join('')):'')+
    (g.wait.length?gsec(gtitle('Esperando a '+esc(nm), g.wait.length, '', ' data-pgroup="wait"'), g.wait.map(R).join('')):''); }
// iPhone: the Proyectos tab's section, under the projects
function peopleSectionHTML(){ const ps=peopleList(); if(!ps.length) return ''; const chev=I.chev.replace('<svg','<svg class="chev"');
  return '<div class="group-title">Personas</div><div class="group people">'+ps.map(p=>'<button class="cell" data-open-person="'+esc(p.name)+'"><span class="picon pperson">'+I.person+'</span><span class="lbl">'+esc(p.name)+'</span><span class="count">'+p.n+'</span>'+chev+'</button>').join('')+'</div>'+
    '<div class="footnote">Lo que le toca a cada persona y lo que esperas de ella.</div>'; }
// iPhone: the person's pushed screen
function viewPerson(name){ const nm=personLabel(name);
  if(UI.select&&UI.select.scope==='project') return selectNav()+'<div class="scroll">'+personListHTML(name)+'</div>'; // the selection of the screen on top
  const xs=personRemindable(name), via=xs.length?remindVia(nm):null;
  return '<header class="nav"><div class="nav-row"><button class="back" data-act="back">'+I.back+'Atrás</button><div class="nav-title">'+esc(nm)+'</div><span class="action"></span></div></header>'+
    '<div class="scroll">'+(xs.length?'<div class="group premind"><button class="cell link" data-act="remindAll" data-person="'+esc(nm)+'">'+MI.send+'<span class="lbl">Recordar todo</span><span class="val">'+bulkN(xs.length)+'</span></button></div><div class="footnote">'+esc(via.label)+'</div>':'')+
    personListHTML(name)+'</div>'; }
// Desktop: the sidebar's section, under Proyectos
function peopleSideHTML(){ const ps=peopleList(); if(!ps.length) return ''; const k=UI.deskView.startsWith('person:')?personKey(UI.deskView.slice(7)):null;
  return '<div class="sec">Personas</div>'+ps.map(p=>'<button class="it iperson'+(p.key===k?' on':'')+'" data-view="person:'+esc(p.name)+'">'+I.person+'<span>'+esc(p.name)+'</span><span class="n">'+p.n+'</span></button>').join(''); }
// Desktop: the head of the person's column (name, phone or mail, Recordar todo) and its body
function personHeadHTML(name){ const nm=personLabel(name), cl=personContactLine(nm), xs=personRemindable(name);
  return {title:'<div class="ptitle"><h1>'+esc(nm)+'</h1>'+(cl.length?'<div class="psub">'+cl.map(v=>'<span>'+esc(v)+'</span>').join('')+'</div>':'')+'</div>',
    btn:xs.length?'<button class="btn premindb" data-act="remindAll" data-person="'+esc(nm)+'" title="'+esc(remindVia(nm).label)+'">'+MI.send+'Recordar todo</button>':''}; }
// The person views follow a contact renamed in Ajustes (saveContact)
function personRenamed(oldName, newName){ const k=personKey(oldName);
  if(UI.wide&&UI.deskView.startsWith('person:')&&personKey(UI.deskView.slice(7))===k) UI.deskView='person:'+newName;
  UI.stack.forEach(s=>{ if(s.kind==='person'&&personKey(s.id)===k) s.id=newName; }); }
