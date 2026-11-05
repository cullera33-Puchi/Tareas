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
     with its email, the share sheet otherwise (or a copy). A multiple selection of one person's tasks sends one message with every title. */

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
// The names the fields suggest: the contacts, then the names the tasks use (Responsable, Esperando a) that no contact has; those that hold
// what is typed, the ones that start with it first. At most six; the value already in the field is left out
function personNames(q, cur){ const k=personKey(q), seen=new Set(), out=[];
  const add=n=>{ const s=String(n||'').replace(/\s+/g,' ').trim(), key=personKey(s); if(!s||seen.has(key)) return; seen.add(key); out.push(s); };
  contactsSorted().forEach(c=>add(c.name)); DB.tasks.map(x=>x.responsible).concat(DB.tasks.map(x=>x.waitingFor)).filter(Boolean).sort(nameCmp).forEach(add);
  let l=out.filter(n=>personKey(n)!==personKey(cur)); if(k) l=l.filter(n=>personKey(n).includes(k)).sort((a,b)=>(personKey(b).startsWith(k)?1:0)-(personKey(a).startsWith(k)?1:0));
  return l.slice(0,6); }
const personSugHTML = (q, cur) => personNames(q, cur).map(n=>'<button type="button" class="chip" data-sug="'+esc(n)+'">'+esc(n)+'</button>').join('');
/* The suggestions under a name field (Responsable, Esperando a): they follow what is typed; a tap puts the name in the field (pick, when
   given, takes it at once). A press on a chip keeps the focus in the field, so the iPhone keyboard stays up */
function bindPersonField(root, inp, pick){ const box=root.querySelector('.psug'); if(!box||!inp) return;
  const fill=()=>{ box.innerHTML=personSugHTML(inp.value, ''); box.classList.toggle('empty', !box.children.length); };
  fill(); inp.addEventListener('input', fill);
  box.addEventListener('mousedown', e=>{ if(e.target.closest('[data-sug]')) e.preventDefault(); });
  box.addEventListener('click', e=>{ const b=e.target.closest('[data-sug]'); if(!b) return; e.stopPropagation(); inp.value=b.dataset.sug; haptic(4); if(pick) pick(b.dataset.sug); else { fill(); inp.focus(); } }); }

/* ---------- Responsable ---------- */
function setResponsible(id, who){ const x=task(id); if(!x) return; const v=personName(who); if((x.responsible||null)===v) return; const old=x.responsible||null; releaseHold(id);
  let nc=null; batch(()=>{ nc=v?ensureContact(v):null; updTask(id, {responsible:v}); }); haptic(8); renderAnimated(); log('info', v?'Responsable':'Responsable quitado');
  toast(v?'Responsable: '+v:'Sin responsable', ()=>batch(()=>{ updTask(id, {responsible:old}); dropContact(nc); save(); })); }
// The sheet (iPhone, actions in its head, decision 18; the field focused inside the tap) or the popover (desktop) of Responsable
function responsibleSheet(id, src){ const x=task(id); if(!x) return;
  const field='<input type="text" class="wfor" data-role="resp" placeholder="Nombre" value="'+esc(x.responsible||'')+'" autocomplete="off" autocapitalize="words" enterkeyhint="done"'+(UI.wide?' autofocus':'')+'>';
  const body='<div class="wsheet rsheet"><label class="wlbl">Quién la hace</label>'+field+'<div class="chips psug"></div><div class="hint">Vacío, la tarea es tuya.</div>'+(x.responsible?'<button class="wback" data-x="clear">Quitar responsable</button>':'');
  const bind=(s, close)=>{ const inp=$('[data-role=resp]', s); const go=v=>{ close(); setResponsible(id, v); };
    bindPersonField(s, inp, go);
    inp.addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.isComposing){ e.preventDefault(); go(inp.value); } });
    s.onclick=e=>{ const b=e.target.closest('[data-x]'); if(!b) return; if(b.dataset.x==='ok') go(inp.value); else if(b.dataset.x==='clear') go(''); else close(); };
    if(!UI.wide){ inp.focus(); try{ inp.setSelectionRange(inp.value.length, inp.value.length); }catch(e){} } };
  if(UI.wide){ pickerPanel('Responsable', '<div class="pm-title wtitle">Responsable</div>'+body+'<div class="sheet-actions"><button class="btn" data-x="cancel">Cancelar</button><button class="btn primary" data-x="ok">Guardar</button></div></div>', id, src&&src.isConnected?src:null, 'pickResp', bind); return; }
  openSheet(sheadHTML('Responsable', 'Cancelar', 'Guardar')+body+'</div>', s=>bind(s, closeSheet)); }

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
const remindItem = x => (x.title||'Sin título')+(remindWhen(x)?' ('+remindWhen(x)+')':'');
function remindText(xs, name){ const first=String(name||'').trim().split(' ')[0];
  if(xs.length===1) return 'Hola '+first+', te recuerdo: '+remindItem(xs[0])+'. Gracias.';
  return 'Hola '+first+', te recuerdo:\n'+xs.map(x=>'- '+remindItem(x)).join('\n')+'\nGracias.'; }
// How it goes: WhatsApp with a phone, mail with an email, the share sheet otherwise. A Spanish number without its country code gets +34
function waDigits(phone){ let d=String(phone||'').replace(/[^\d+]/g,''); if(d.startsWith('+')) d=d.slice(1); else if(d.startsWith('00')) d=d.slice(2); else if(/^[6-9]\d{8}$/.test(d)) d='34'+d; d=d.replace(/\D/g,''); return d.length>=8?d:''; }
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||'').trim());
function remindVia(name){ const c=contactByName(name); if(c&&waDigits(c.phone)) return {kind:'wa', to:c.phone, label:'Por WhatsApp a '+c.phone};
  if(c&&validEmail(c.email)) return {kind:'mail', to:c.email.trim(), label:'Por correo a '+c.email.trim()};
  return {kind:'share', label:navigator.share?'Con la hoja de compartir':'Se copia para pegarlo donde quieras'}; }
function sendRemind(name, text, xs){ const via=remindVia(name); log('info','Recordatorio enviado', {via:via.kind, n:xs.length});
  if(via.kind==='wa'){ window.open('https://wa.me/'+waDigits(via.to)+'?text='+encodeURIComponent(text), '_blank', 'noopener'); return; }
  if(via.kind==='mail'){ const a=document.createElement('a'); a.href='mailto:'+encodeURIComponent(via.to).replace(/%40/g,'@')+'?subject='+encodeURIComponent('Recordatorio: '+(xs.length===1?xs[0].title:xs.length+' tareas'))+'&body='+encodeURIComponent(text); a.style.display='none'; document.body.appendChild(a); a.click(); a.remove(); return; }
  if(navigator.share){ navigator.share({text}).catch(e=>{ if(!e||e.name!=='AbortError') copyText(text, 'Recordatorio copiado. Pégalo donde quieras.'); }); return; }
  copyText(text, 'Recordatorio copiado. Pégalo donde quieras.'); }
/* The sheet: whom (when the task has two people), the message to edit and how it will go. Enviar opens WhatsApp, mail or the share sheet
   inside the tap, as browsers ask. after: run once it is sent (the end of a multiple selection) */
function remindSheet(ids, after){ const xs=ids.map(task).filter(canRemind); if(!xs.length) return; flushEdits();
  const names=xs.length===1?taskPeople(xs[0]):[sharedPerson(xs)].filter(Boolean); if(!names.length) return; let who=names[0], edited=false;
  const whoHTML=()=>names.length>1?'<label class="wlbl">Para</label><div class="chips wchips rwho">'+names.map(n=>'<button class="chip'+(n===who?' on':'')+'" data-who="'+esc(n)+'">'+esc(n)+'</button>').join('')+'</div>':'<div class="rto">Para '+esc(who)+'</div>';
  const body='<div class="wsheet remsheet">'+'<div class="rwhowrap">'+whoHTML()+'</div><textarea class="wfor rmsg" data-role="rmsg" rows="4">'+esc(remindText(xs, who))+'</textarea><div class="hint rvia">'+esc(remindVia(who).label)+'</div>'+
    (remindVia(who).kind==='share'?'<div class="hint">Añade su teléfono o su correo en Ajustes, Contactos, para enviarlo directamente.</div>':'')+'</div>';
  openSheet(sheadHTML('Enviar recordatorio', 'Cancelar', 'Enviar')+body, s=>{ const ta=$('[data-role=rmsg]', s);
    ta.addEventListener('input', ()=>{ edited=true; });
    s.onclick=e=>{ const w=e.target.closest('[data-who]'); if(w){ who=w.dataset.who; $('.rwhowrap', s).innerHTML=whoHTML(); if(!edited) ta.value=remindText(xs, who); $('.rvia', s).textContent=remindVia(who).label; haptic(4); return; }
      const b=e.target.closest('[data-x]'); if(!b) return; if(b.dataset.x!=='ok'){ closeSheet(); return; }
      const text=ta.value.trim(); if(!text){ ta.focus(); return; } closeSheet(); sendRemind(who, text, xs); if(after) after(); }; }); }
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
  const rf=renamed&&personKey(UI.respFilter)===k; if(rf) UI.respFilter=v.name; render(); log('info', renamed?'Contacto renombrado':'Contacto cambiado', renamed?{tasks:moved.length}:undefined);
  toast(renamed&&moved.length?'Contacto renombrado en '+bulkN(moved.length):'Contacto guardado', ()=>batch(()=>{ const cur=contactRec(c.id); if(cur) Object.assign(cur, prev, {modified:new Date().toISOString()});
    moved.forEach(o=>{ if(task(o.id)) updTask(o.id, Object.fromEntries(o.keys.map(kk=>[kk, o[kk]]))); }); if(rf) UI.respFilter=prev.name; save(); })); }
function confirmDeleteContact(id){ const c=contactRec(id); if(!c) return; const n=contactUses(c);
  confirmSheet('Eliminar contacto', '"'+c.name+'" se eliminará de tus contactos.'+(n?' '+(n===1?'La tarea que lo usa conserva':'Las '+n+' tareas que lo usan conservan')+' el nombre.':'')+' Podrás deshacerlo durante unos segundos.', ()=>{
    const i=DB.contacts.indexOf(c); if(i<0) return; DB.contacts.splice(i,1); save(); render(); haptic(14); log('info','Contacto eliminado');
    toast('Contacto eliminado', ()=>{ if(!contactRec(c.id)){ c.modified=new Date().toISOString(); DB.contacts.push(c); } save(); }); }); }
