'use strict';
/* Tareas. Decision 47: project notes. Notes inside each project, next to its tasks: several per project, with a title and a date, the
   newest first and pinned ones on top. Plain text where '- ' lines read as a list, '[ ]' and '[x]' lines as boxes that tick, and links
   and phone numbers can be tapped; list lines can become tasks of the project (Crear tareas). First phase: no photos or audio.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file.
   - Data: DB.projectNotes, one record per note {id, projectId, title, body, pinned, created, modified}, synced as the table project_notes
     (0006_project_notes.sql). A note belongs to a real project (Sin proyecto has none). Archiving a project keeps its notes; a project
     that goes (with its space) takes them, with Deshacer; a project moved to another space keeps them (they only name the project).
   - Typing is saved a moment after the last key (saveNoteEdit, as saveEdit and the steps). A note left with nothing written goes quietly
     when it is left (noteLeft), as in Notas of iOS.
   - iPhone: the project screen has the segment Tareas and Notas (UI.projTab); a note opens as a pushed screen (kind 'note').
     Desktop: the same segment in the column head; Notas shows the list and the open note side by side (UI.noteOpen).
   - The body is a text area while it has the focus (UI.noteEdit) and a drawn view otherwise (noteBodyHTML), whose boxes tick without
     entering the text; a tap on the view edits it at that line */
const PIN_I='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3.5h6M10 3.5l-.6 5.6L6.5 13h11l-2.9-3.9-.6-5.6M12 13v7.5"/></svg>';
const PIN_F='<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3.5h6M10 3.5l-.6 5.6L6.5 13h11l-2.9-3.9-.6-5.6z"/><path d="M12 13v7.5" fill="none"/></svg>';
const PIN_OFF='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3.5h6M10 3.5l-.6 5.6L6.5 13h11l-2.9-3.9-.6-5.6M12 13v7.5M4 4l16 16"/></svg>';
const NOTE_PH='Escribe aquí. Las líneas que empiezan por un guion forman una lista y las que empiezan por [ ] son casillas.';
UI.projTab={}; UI.noteOpen=null; UI.noteEdit=null;

/* ---------- Data ---------- */
const noteRec = id => DB.projectNotes.find(n=>n&&n.id===id);
const noteTime = n => n.modified||n.created||'';
const noteCmp = (a,b) => (b.pinned?1:0)-(a.pinned?1:0) || (noteTime(a)<noteTime(b)?1:noteTime(a)>noteTime(b)?-1:0) || (String(a.id)<String(b.id)?-1:1);
function notesOf(pid){ return DB.projectNotes.filter(n=>n&&n.projectId===pid).sort(noteCmp); }
const projTab = pid => UI.projTab[pid]==='notes'?'notes':'tasks';
// The desktop column shows a project's notes
function deskNotesOn(){ if(!UI.wide) return false; const v=UI.deskView||''; if(!v.startsWith('project:')) return false; const id=v.slice(8); return id!=='none'&&projTab(id)==='notes'&&!!proj(id); }
function addNote(pid){ const t=new Date().toISOString(), n={id:uid(), projectId:pid, title:'', body:'', pinned:false, created:t, modified:t}; DB.projectNotes.push(n); save(); log('info','Nota de proyecto creada'); return n; }
// Typing is saved a moment after the last key; editPatch lets a reload from another window put it back (reloadFromStorage)
function saveNoteEdit(n, patch){ Object.assign(n, patch, {modified:new Date().toISOString()}); dataVer++;
  editPatch={id:n.id, note:true, patch:Object.assign(editPatch&&editPatch.id===n.id?editPatch.patch:{}, patch, {modified:n.modified})};
  clearTimeout(editSaveT); editSaveT=setTimeout(save, 400); }
const noteEmpty = n => !String(n.title||'').trim() && !String(n.body||'').trim();
// A note left with nothing written goes quietly. Returns true when it went
function noteLeft(id){ const n=id&&noteRec(id); if(!n) return false; flushEdits(); if(!noteEmpty(n)) return false;
  DB.projectNotes=DB.projectNotes.filter(x=>x!==n); if(UI.noteOpen===id) UI.noteOpen=null; if(UI.noteEdit===id) UI.noteEdit=null; save(); log('info','Nota vacía descartada'); return true; }
// A space deleted takes the notes of its projects; what is cut comes back with Deshacer
function cutNotes(pids){ const out=DB.projectNotes.filter(n=>n&&pids.has(n.projectId)); if(out.length) DB.projectNotes=DB.projectNotes.filter(n=>!n||!pids.has(n.projectId)); return out; }
function putNotes(list){ (list||[]).forEach(n=>{ if(!DB.projectNotes.some(x=>x.id===n.id)) DB.projectNotes.push(n); }); }
// Search: the notes of the active space's projects (or of one project) whose title or text has the words. pid null (Sin proyecto): none
function noteHits(query, pid){ if(pid===null||!query) return []; const q=norm(query), ps=new Set(pid!==undefined?[pid]:activeProjects().map(p=>p.id));
  return DB.projectNotes.filter(n=>n&&ps.has(n.projectId)&&(norm(n.title).includes(q)||norm(n.body).includes(q))).sort(noteCmp); }

/* ---------- The body: plain text, with lists, boxes and links ---------- */
// '- text' (or '* ', '• ') is a list item; '[ ] text', '[x] text' and '- [ ] text' are boxes. Two spaces before the mark indent one level
const NL_RE=/^(\s*)(?:(?:[-*•]\s+)?\[([ xX]?)\]\s?|([-*•])\s+)(.*)$/;
function noteParse(body){ return String(body||'').split('\n').map((raw,i)=>{ const m=raw.match(NL_RE); if(!m) return {i, kind:raw.trim()?'text':'blank', text:raw, ind:0};
  const ind=Math.min(4, Math.floor(m[1].replace(/\t/g,'  ').length/2));
  return m[2]!==undefined ? {i, kind:'check', done:/x/i.test(m[2]), text:m[4], ind} : {i, kind:'item', text:m[4], ind}; }); }
function noteBodyHTML(body){ const ls=noteParse(body); let end=ls.length; while(end>0&&ls[end-1].kind==='blank') end--; // empty lines at the end are not drawn
  if(!end) return '<div class="nph">'+NOTE_PH+'</div>';
  return ls.slice(0,end).map(l=>{ const st=l.ind?' style="--ind:'+l.ind+'"':'';
    if(l.kind==='check') return '<div class="nl ck'+(l.done?' done':'')+'" data-ln="'+l.i+'"'+st+'><button class="ncheck'+(l.done?' done':'')+'" data-nck="'+l.i+'" role="checkbox" aria-checked="'+l.done+'" aria-label="'+(l.done?'Hecha':'Por hacer')+'" tabindex="-1">'+I.check+'</button><span class="nt">'+linkify(l.text)+'</span></div>';
    if(l.kind==='item') return '<div class="nl li" data-ln="'+l.i+'"'+st+'><span class="nb" aria-hidden="true"></span><span class="nt">'+linkify(l.text)+'</span></div>';
    return '<div class="nl'+(l.kind==='blank'?' blank':'')+'" data-ln="'+l.i+'">'+linkify(l.text)+'</div>'; }).join(''); }
// The title of a row (the first line of the text when the note has none) and the line under it: the first one, or the one a search found
function notePreview(n, q){ const ls=String(n.body||'').split('\n').map(l=>l.replace(LIST_MARK,'').trim()).filter(Boolean), t=String(n.title||'').trim();
  let title=t, rest=ls; if(!title&&ls.length){ title=ls[0]; rest=ls.slice(1); }
  let prev=rest[0]||''; if(q){ const nq=norm(q), hit=rest.find(l=>norm(l).includes(nq)); if(hit) prev=hit; }
  return {title:title||'Nueva nota', prev}; }
const noteWhen = iso => { if(!iso) return ''; const d=localDay(iso); return d===todayStr()?fmtTime(iso):fmtDate(d); };
const noteMeta = n => { const w=fmtDateTime(noteTime(n)); return w?'Modificada '+w[0].toLowerCase()+w.slice(1):''; };
// A box ticked or unticked rewrites its line: '[ ]' and '[x]'
function toggleNoteCheck(id, i){ const n=noteRec(id); if(!n) return; flushEdits(); const ls=String(n.body||'').split('\n'), l=ls[i]; if(l==null) return; const m=l.match(NL_RE); if(!m||m[2]===undefined) return;
  const done=/x/i.test(m[2]); ls[i]=l.replace(/\[[ xX]?\]/, done?'[ ]':'[x]'); n.body=ls.join('\n'); n.modified=new Date().toISOString(); save(); haptic(done?6:10); notePaint(id); }

/* ---------- Drawing ---------- */
function noteRowInner(n, q, withProj){ const v=notePreview(n, q), p=withProj?proj(n.projectId):null;
  return '<div class="nr-t">'+(n.pinned?'<span class="npin" title="Fijada" aria-label="Fijada">'+PIN_F+'</span>':'')+'<span class="nr-tt">'+esc(v.title)+'</span></div>'+
    '<div class="nr-s"><span class="nr-d">'+esc(noteWhen(noteTime(n)))+'</span>'+(p?'<span class="nr-pj"><span class="dot" style="background:'+p.color+'"></span>'+esc(p.name)+'</span>':'')+'<span class="nr-pv">'+esc(v.prev||'Sin más texto')+'</span></div>'; }
// iPhone: a row that slides to Eliminar (as the voice notes) and lifts on a long press. Desktop: an item of the list
function noteRowHTML(n, o){ o=o||{}; const attrs=' data-pn="'+esc(n.id)+'"'+(o.q?' data-q="'+esc(o.q)+'"':'')+(o.proj?' data-pj="1"':'');
  if(UI.wide) return '<button class="nli'+(o.on?' on':'')+(o.proj?' nres':'')+'"'+attrs+' role="option" aria-selected="'+!!o.on+'">'+noteRowInner(n, o.q, o.proj)+'</button>';
  return '<div class="vn nrow"'+attrs+'><div class="vn-bg r"><button data-nact="del">Eliminar</button></div><div class="vn-c nrow-c">'+noteRowInner(n, o.q, o.proj)+'</div></div>'; }
// Search results: a group Notas after the tasks found
function noteHitsHTML(ns){ if(!ns.length) return ''; const q=UI.query; return '<div class="group-title">Notas</div><div class="group nhits">'+ns.map(n=>noteRowHTML(n, {q, proj:true})).join('')+'</div>'; }
// Segment Tareas and Notas of a project, with how many of each
function projSegHTML(p){ const t=projTab(p.id), nt=pendingFor('todas', p.id).length, nn=DB.projectNotes.filter(n=>n&&n.projectId===p.id).length;
  const b=(k,l,n)=>'<button data-pseg="'+k+'" data-pid="'+esc(p.id)+'" class="'+(t===k?'on':'')+'" role="tab" aria-selected="'+(t===k)+'">'+l+'<span class="n">'+n+'</span></button>';
  return '<div class="seg pseg" role="tablist" aria-label="Contenido del proyecto">'+b('tasks','Tareas',nt)+b('notes','Notas',nn)+'</div>'; }
// iPhone: the notes of a project, pinned ones first
function notesListHTML(p){ const ns=notesOf(p.id);
  if(!ns.length) return '<div class="empty">'+I.note.replace('<svg','<svg style="width:44px;height:44px"')+'<b>Sin notas</b>Apunta aquí lo que no es una tarea: acuerdos, contactos o ideas del proyecto.<div class="acts"><button class="btn-link" data-act="newNote" data-project="'+esc(p.id)+'">Nueva nota</button></div></div>';
  const pin=ns.filter(n=>n.pinned), rest=ns.filter(n=>!n.pinned), R=n=>noteRowHTML(n);
  return (pin.length?'<div class="group-title">Fijadas</div><div class="group">'+pin.map(R).join('')+'</div>'+(rest.length?'<div class="group-title">Notas</div>':''):'')+(rest.length?'<div class="group">'+rest.map(R).join('')+'</div>':'')+
    '<div class="group"><button class="cell link" data-act="newNote" data-project="'+esc(p.id)+'">'+I.plus.replace('<svg','<svg style="width:18px;height:18px"')+'<span class="lbl">Nueva nota</span></button></div>'+
    '<div class="footnote">Desliza una nota a la izquierda para eliminarla. Mantenla pulsada para fijarla arriba o compartirla.</div>'; }
// The note itself: title, when it changed, and the text (the drawn view, or the text area while it is being written)
function noteEditorHTML(n){ const ed=UI.noteEdit===n.id;
  return '<div class="nedit" data-note="'+esc(n.id)+'">'+(UI.wide?noteToolsHTML(n):'')+
    '<textarea class="ntitle" data-role="ntitle" rows="1" placeholder="Título" enterkeyhint="next" autocomplete="off" aria-label="Título de la nota">'+esc(n.title||'')+'</textarea>'+
    '<div class="nmeta">'+esc(noteMeta(n))+'</div>'+
    '<div class="nbw'+(ed?' editing':'')+'"><div class="nview" aria-label="Texto de la nota">'+noteBodyHTML(n.body)+'</div><textarea class="nbody" data-role="nbody" placeholder="'+esc(NOTE_PH)+'" autocomplete="off" aria-label="Texto de la nota">'+esc(n.body||'')+'</textarea></div></div>'; }
function noteToolsHTML(n){ return '<div class="ntools"><span class="grow"></span>'+
  '<button class="ntb" data-act="noteTasks" title="Crea tareas del proyecto con las líneas seleccionadas o con las de la lista">'+I.list+'<span>Crear tareas</span></button>'+
  '<button class="ntb'+(n.pinned?' on':'')+'" data-act="notePin" aria-pressed="'+!!n.pinned+'" title="'+(n.pinned?'Quitar fijado':'Fijar arriba')+'" aria-label="'+(n.pinned?'Quitar fijado':'Fijar')+'">'+(n.pinned?PIN_F:PIN_I)+'</button>'+
  '<button class="ntb" data-act="noteShare" title="Compartir" aria-label="Compartir">'+I.share+'</button>'+
  '<button class="ntb" data-act="noteMenu" title="Más" aria-label="Más">'+I.more+'</button></div>'; }
// iPhone: Crear tareas under the note, when its text has list lines or boxes
function noteTasksCellHTML(n){ const k=noteTaskLines(n.body).length; return k?'<div class="group ntasks"><button class="cell link" data-act="noteTasks">'+I.list.replace('<svg','<svg style="width:18px;height:18px"')+'<span class="lbl">Crear tareas</span><span class="val">'+k+(k===1?' línea':' líneas')+'</span></button></div>':''; }
function viewNote(id){ const n=noteRec(id); if(!n) return ''; const p=proj(n.projectId);
  return '<header class="nav"><div class="nav-row"><button class="back" data-act="back">'+I.back+'Atrás</button><div class="nav-title">'+(p?'<span class="pdot" style="width:10px;height:10px;border-radius:50%;background:'+p.color+';display:inline-block;margin-right:6px;vertical-align:1px"></span>'+esc(p.name):'Nota')+'</div><div class="actions"><button class="action" data-act="noteShare" aria-label="Compartir">'+I.share+'</button><button class="action" data-act="noteMenu" aria-label="Más">'+I.more+'</button></div></div></header>'+
    '<div class="scroll"><div class="group nedit-g">'+noteEditorHTML(n)+'</div>'+noteTasksCellHTML(n)+'</div>'; }
// Desktop: the list of the project's notes beside the open one; the search of the column head filters the list
function deskNotesHTML(p){ const all=notesOf(p.id), q=UI.query, list=q?noteHits(q, p.id):all; let cur=noteRec(UI.noteOpen);
  if(!cur||cur.projectId!==p.id||(q&&!list.includes(cur))) cur=list[0]||null; UI.noteOpen=cur?cur.id:null;
  const pin=list.filter(n=>n.pinned), rest=list.filter(n=>!n.pinned), R=n=>noteRowHTML(n, {on:cur===n, q});
  const items=list.length?(pin.length?'<div class="ngt">Fijadas</div>'+pin.map(R).join('')+(rest.length?'<div class="ngt">Notas</div>':''):'')+rest.map(R).join(''):'<div class="nlempty">'+(q?'Sin resultados':'Todavía ninguna')+'</div>';
  return '<div class="nsplit"><div class="nlist" data-keep="nlist" role="listbox" aria-label="Notas de '+esc(p.name)+'"><button class="nnew" data-act="newNote" data-project="'+esc(p.id)+'" title="Nueva nota ('+MODK+' N)">'+I.plus+'<span>Nueva nota</span><span class="kbd">N</span></button>'+items+'</div>'+
    '<div class="ned" data-keep="ned:'+(cur?esc(cur.id):'')+'">'+(cur?noteEditorHTML(cur):'<div class="empty">'+I.note+'<b>Sin notas</b>Crea una con Nueva nota o con '+MODK+' N.</div>')+'</div></div>'; }

/* ---------- Repainting in place while typing (the field keeps its focus and the iPhone keyboard stays) ---------- */
// The rows of a note in any list on screen, its date line and its Crear tareas; the order follows on the next drawing
function noteRowsPaint(n){ document.querySelectorAll('[data-pn="'+CSS.escape(n.id)+'"]').forEach(r=>{ const c=r.classList.contains('nli')?r:r.querySelector('.nrow-c'); if(c) c.innerHTML=noteRowInner(n, r.dataset.q||'', !!r.dataset.pj); });
  document.querySelectorAll('.nedit[data-note="'+CSS.escape(n.id)+'"] .nmeta').forEach(e=>{ e.textContent=noteMeta(n); }); }
function noteTasksPaint(id){ const n=noteRec(id); if(!n||UI.wide) return; document.querySelectorAll('.screen.note').forEach(s=>{ const g=s.querySelector('.ntasks'), h=noteTasksCellHTML(n), ed=s.querySelector('.nedit[data-note="'+CSS.escape(id)+'"]'); if(!ed) return;
  if(g&&g.outerHTML===h) return; if(g) g.remove(); if(h) ed.closest('.group').insertAdjacentHTML('afterend', h); }); }
// After a change made outside the text (a box ticked, a pin): the views of the note and its rows
function notePaint(id){ const n=noteRec(id); if(!n) return; document.querySelectorAll('.nedit[data-note="'+CSS.escape(id)+'"]').forEach(ed=>{ const v=ed.querySelector('.nview'), ta=ed.querySelector('.nbody');
    if(v) v.innerHTML=noteBodyHTML(n.body); if(ta&&document.activeElement!==ta&&ta.value!==n.body) ta.value=n.body||''; });
  noteRowsPaint(n); noteTasksPaint(id); }
// A text area as tall as its text; the box that scrolls around it keeps its place
function noteGrow(ta){ if(!ta||!ta.isConnected) return; const sc=ta.closest('.scroll, .ned'), y=sc?sc.scrollTop:0; ta.style.height='auto'; const h=ta.scrollHeight; ta.style.height=h?(ta.classList.contains('nbody')?Math.max(160, h):h)+'px':''; if(sc) sc.scrollTop=y; }

/* ---------- Editing ---------- */
// The view becomes the text area, focused inside the tap (iOS opens the keyboard only then, point 18), with the caret at the end of line ln
function noteEditAt(ed, ln, start){ const w=ed&&ed.querySelector('.nbw'), ta=w&&w.querySelector('.nbody'); if(!ta||!noteRec(ed.dataset.note)) return;
  w.classList.add('editing'); UI.noteEdit=ed.dataset.note; noteGrow(ta);
  let pos=ta.value.length; if(start) pos=0; else if(ln!=null){ const ls=ta.value.split('\n'); pos=0; for(let k=0;k<=Math.min(ln, ls.length-1);k++) pos+=ls[k].length+(k<ln?1:0); }
  ta.focus(); try{ ta.setSelectionRange(pos,pos); }catch(e){} }
// Intro on a list line or a box starts the next one; on an empty one it ends the list (as in Notas)
function noteEnter(e, ta){ if(e.key!=='Enter'||e.shiftKey||e.isComposing||e.altKey||e.metaKey||e.ctrlKey) return; const v=ta.value, s=ta.selectionStart; if(s!==ta.selectionEnd) return;
  const a=v.lastIndexOf('\n', s-1)+1, line=v.slice(a, s), m=line.match(/^(\s*)((?:[-*•]\s+)?\[[ xX]?\]\s?|[-*•]\s+)(.*)$/); if(!m) return;
  const after=v.slice(s, v.indexOf('\n', s)<0?v.length:v.indexOf('\n', s)); e.preventDefault();
  if(!m[3].trim()&&!after.trim()) ta.setRangeText('', a, s, 'end');
  else ta.setRangeText('\n'+m[1]+m[2].replace(/\[[ xX]?\]\s?/, '[ ] '), s, s, 'end');
  ta.dispatchEvent(new Event('input', {bubbles:true})); }
// The fields of a drawn note get their listeners and heights (iPhone screen or desktop column)
function bindNote(scope){ const ed=scope&&scope.querySelector('.nedit[data-note]'); if(!ed||ed._nb) return; ed._nb=1; const id=ed.dataset.note;
  const ti=ed.querySelector('[data-role=ntitle]'), bo=ed.querySelector('[data-role=nbody]'); let bt=null;
  noteGrow(ti); if(ed.querySelector('.nbw.editing')) noteGrow(bo);
  ti.addEventListener('input', ()=>{ const n=noteRec(id); if(!n) return; const v=ti.value.replace(/\n/g,' '); if(v!==ti.value) ti.value=v; saveNoteEdit(n, {title:v}); noteGrow(ti); noteRowsPaint(n); });
  ti.addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.isComposing){ e.preventDefault(); noteEditAt(ed, null, true); } }); // Intro goes on to the text, the keyboard stays
  ti.addEventListener('blur', ()=>{ if(!deskRedraw) flushEdits(); });
  bo.addEventListener('input', ()=>{ const n=noteRec(id); if(!n) return; saveNoteEdit(n, {body:bo.value}); noteGrow(bo); noteRowsPaint(n); clearTimeout(bt); bt=setTimeout(()=>noteTasksPaint(id), 400); });
  bo.addEventListener('keydown', e=>noteEnter(e, bo));
  // Leaving the text draws it again. The window losing the focus leaves it as it is (the field is still the active one), and so does a redraw
  bo.addEventListener('blur', ()=>{ if(deskRedraw) return; flushEdits(); setTimeout(()=>{ if(!bo.isConnected||document.activeElement===bo) return; const w=bo.closest('.nbw'), n=noteRec(id); if(!w) return;
    w.classList.remove('editing'); if(UI.noteEdit===id) UI.noteEdit=null; if(n) w.querySelector('.nview').innerHTML=noteBodyHTML(n.body); noteTasksPaint(id); }, 0); });
  if(UI.wide) ['select','keyup','mouseup'].forEach(k=>bo.addEventListener(k, noteSelPaint)); }
function bindNotesDesk(d){ const ned=d.querySelector('.main .ned'); if(ned) bindNote(ned); noteSelPaint(); }

/* ---------- Actions ---------- */
function setProjTab(pid, tab){ if(projTab(pid)===tab) return; flushEdits(); if(tab!=='notes'&&UI.noteOpen) noteLeft(UI.noteOpen); UI.projTab[pid]=tab; haptic(4);
  if(UI.wide){ UI.deskDetail=null; UI.dsel.ids.clear(); UI.dsel.mode=false; UI.dsel.edit=null; UI.query=''; UI.searchDone=false; render(); return; }
  render(); const top=UI.stack[UI.stack.length-1], sc=top&&top.el.querySelector('.scroll'); if(sc) sc.scrollTop=0; }
// A new note opens with its title focused, inside the tap: on the iPhone the keyboard comes up with the screen
function newNote(pid){ const p=proj(pid); if(!p) return null; flushEdits(); if(UI.wide&&UI.noteOpen) noteLeft(UI.noteOpen);
  const n=addNote(pid); haptic(8); UI.projTab[pid]='notes'; UI.noteEdit=null;
  if(UI.wide){ UI.noteOpen=n.id; UI.query=''; UI.searchDone=false; if(UI.deskView!=='project:'+pid) setDeskView('project:'+pid); else render(); const t=$('#desk .ned [data-role=ntitle]'); if(t) t.focus(); return n; }
  push('note', n.id); const s=UI.stack[UI.stack.length-1], t=s&&s.el.querySelector('[data-role=ntitle]'); if(t) t.focus({preventScroll:true}); return n; }
function openNote(id){ const n=noteRec(id); if(!n) return; flushEdits();
  if(UI.wide){ if(UI.noteOpen&&UI.noteOpen!==id) noteLeft(UI.noteOpen); UI.projTab[n.projectId]='notes'; UI.noteOpen=id; UI.noteEdit=null; if(UI.deskView!=='project:'+n.projectId) setDeskView('project:'+n.projectId); else render();
    const it=document.querySelector('#desk .nli.on'); if(it) it.scrollIntoView({block:'nearest'}); return; }
  push('note', id); }
// Desktop: the arrows move through the list of notes
function noteStep(dir){ const its=[...document.querySelectorAll('#desk .nlist [data-pn]')], i=its.findIndex(e=>e.dataset.pn===UI.noteOpen), nx=its[i<0?0:Math.max(0, Math.min(its.length-1, i+dir))];
  if(nx&&nx.dataset.pn!==UI.noteOpen) openNote(nx.dataset.pn); }
// Eliminar, with Deshacer. From the note's own screen (iPhone) the screen goes back first; on the desktop the next note of the list opens
function deleteNote(id){ const i=DB.projectNotes.findIndex(n=>n&&n.id===id); if(i<0) return; flushEdits();
  let next=null; if(UI.wide&&UI.noteOpen===id){ const its=[...document.querySelectorAll('#desk .nlist [data-pn]')].map(e=>e.dataset.pn), k=its.indexOf(id); next=its[k+1]||its[k-1]||null; }
  const [n]=DB.projectNotes.splice(i,1); if(UI.noteEdit===id) UI.noteEdit=null; if(UI.noteOpen===id) UI.noteOpen=next; save(); haptic(14); log('info','Nota de proyecto eliminada');
  const top=!UI.wide&&UI.stack[UI.stack.length-1]; if(top&&top.kind==='note'&&top.id===id) pop(); else render();
  if(noteEmpty(n)) return; // nothing written: nothing to give back
  toast('Nota eliminada', ()=>{ if(!noteRec(n.id)) DB.projectNotes.push(n); if(UI.wide&&deskNotesOn()) UI.noteOpen=n.id; save(); }); }
function togglePin(id){ const n=noteRec(id); if(!n) return; flushEdits(); n.pinned=!n.pinned; n.modified=new Date().toISOString(); save(); haptic(8); log('info', n.pinned?'Nota fijada':'Nota sin fijar');
  if(UI.wide||!UI.stack.length||UI.stack[UI.stack.length-1].kind!=='note') render(); else { notePaint(id); UI.stack.slice(0,-1).forEach(s=>{ s.el.dataset.dirty='1'; }); scheduleRefresh(); } // the note's own screen stays as it is
  toast(n.pinned?'Nota fijada arriba':'Nota sin fijar'); }
// The note as text, for the share sheet (Claude, WhatsApp, Mail, Teams) or the clipboard
function noteShareText(id){ const n=noteRec(id); if(!n) return ''; const p=proj(n.projectId), t=String(n.title||'').trim(), b=String(n.body||'').trim();
  return [t?'Nota: '+t:'Nota', p?'Proyecto: '+p.name:''].filter(Boolean).join('\n')+(b?'\n\n'+b:''); }
async function shareNote(id){ flushEdits(); const n=noteRec(id), t=noteShareText(id); if(!t) return;
  try{ if(navigator.share){ await navigator.share({title:String(n.title||'').trim()||'Nota', text:t}); log('info','Nota compartida'); return; } }catch(e){ if(e&&e.name==='AbortError') return; }
  copyText(t,'Texto copiado. Pégalo en Claude, WhatsApp o Mail.'); }
function noteMenu(id, at){ const n=noteRec(id); if(!n) return; const k=noteTaskLines(n.body).length;
  popMenu(Object.assign(at||{}, {groups:[[{label:n.pinned?'Quitar fijado':'Fijar', icon:n.pinned?PIN_OFF:PIN_I, fn:()=>togglePin(id)}],
    [{label:'Compartir', icon:mi('<path d="M12 3v13M7 8l5-5 5 5M5 13v7h14v-7"/>'), fn:()=>shareNote(id)}].concat(k?[{label:UI.wide?'Crear tareas…':'Crear tareas', icon:mi('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/>'), fn:()=>noteTasksSheet(id)}]:[]),
    [{label:'Eliminar', icon:MI.trash, red:true, key:UI.wide?'Supr':undefined, fn:()=>deleteNote(id)}]]})); }

/* ---------- Decision 47.3: lines of a note become tasks of its project ---------- */
// The lines a note offers: its list items and its boxes (a ticked box is offered unselected)
function noteTaskLines(body){ return noteParse(body).filter(l=>(l.kind==='item'||l.kind==='check')&&l.text.trim()).map(l=>({i:l.i, text:l.text.trim(), on:!(l.kind==='check'&&l.done)})); }
// The tasks, in the note's project: each line cleaned as a pasted list (R6) and read as a quick-add title (the date written at its end, R7), one Deshacer
function noteMakeTasks(pid, lines){ const ls=pasteLines(lines.join('\n')); if(!ls.length) return []; const ids=addMany(ls, {date:null, projectId:pid, priority:'none'}); render();
  log('info','Tareas creadas desde una nota', {n:ids.length}); toast(ids.length===1?'1 tarea creada':ids.length+' tareas creadas', ()=>removeTasks(ids)); return ids; }
// Which lines to make: the list lines and boxes, each one chosen (the iPhone way, and the desktop without a selection)
function noteTasksSheet(id){ const n=noteRec(id), p=n&&proj(n.projectId); if(!n||!p) return; flushEdits(); const ls=noteTaskLines(n.body);
  if(!ls.length){ toast(UI.wide?'Selecciona líneas de la nota o escribe una lista':'La nota no tiene listas ni casillas'); return; }
  const base={date:null, projectId:p.id, priority:'none'}, on=ls.map(l=>l.on);
  const meta=r=>{ const m=[]; if(r.date) m.push(fmtDate(r.date)); if(r.reminder) m.push(fmtTime(r.reminder)); if(r.projectId&&r.projectId!==p.id){ const o=proj(r.projectId); if(o) m.push(o.name); } if(r.priority!=='none') m.push(r.priority==='high'?'!!!':'!!'); return m.join(', '); };
  const row=(l,k)=>{ const r=quickTask(l.text, base); return '<button class="cell ntl'+(on[k]?' on':'')+'" data-k="'+k+'" role="checkbox" aria-checked="'+on[k]+'"><span class="ntl-c">'+I.check+'</span><span class="lbl">'+esc(r.title||l.text)+'</span>'+(meta(r)?'<span class="val">'+esc(meta(r))+'</span>':'')+'</button>'; };
  const okText=()=>{ const c=on.filter(Boolean).length; return c?'Crear '+(c===1?'1 tarea':c+' tareas'):'Crear'; };
  openSheet('<h2>Crear tareas</h2><div class="hint">En '+esc(p.name)+'. Toca una línea para quitarla o volver a ponerla.</div><div class="group ntlist">'+ls.map(row).join('')+'</div>'+
    '<div class="sheet-actions"><button class="btn" data-x="cancel">Cancelar</button><span style="flex:1"></span><button class="btn primary" data-x="ok">'+okText()+'</button></div>', s=>{
    s.onclick=e=>{ const it=e.target.closest('.ntl[data-k]'); if(it){ const k=+it.dataset.k; on[k]=!on[k]; it.classList.toggle('on', on[k]); it.setAttribute('aria-checked', String(on[k])); const ok=s.querySelector('[data-x=ok]'); ok.textContent=okText(); ok.disabled=!on.some(Boolean); haptic(4); return; }
      const b=e.target.closest('[data-x]'); if(!b) return; if(b.dataset.x==='cancel'){ closeSheet(); return; }
      const pick=ls.filter((l,k)=>on[k]).map(l=>l.text); if(!pick.length) return; closeSheet(); noteMakeTasks(p.id, pick); }; }); }
// Desktop: the whole lines the selection touches, in the text area or in the drawn view
function noteSelLines(){ const ed=document.querySelector('#desk .ned .nedit[data-note]'); if(!ed) return []; const n=noteRec(ed.dataset.note); if(!n) return []; const ta=ed.querySelector('.nbody');
  if(document.activeElement===ta){ if(ta.selectionStart===ta.selectionEnd) return []; const v=ta.value, a=v.lastIndexOf('\n', ta.selectionStart-1)+1, e=ta.selectionEnd;
    let b=e>a&&v[e-1]==='\n'?e-1:v.indexOf('\n', e); if(b<0) b=v.length; // whole lines; one only reached at its start is left out
    return v.slice(a, b).split('\n').filter(l=>l.trim()); }
  const s=getSelection(), view=ed.querySelector('.nview'); if(!s||s.isCollapsed||!s.rangeCount||!view) return []; const r=s.getRangeAt(0); if(!view.contains(r.startContainer)||!view.contains(r.endContainer)) return [];
  const ln=nd=>{ const e=(nd.nodeType===1?nd:nd.parentElement); const l=e&&e.closest('[data-ln]'); return l?+l.dataset.ln:null; };
  const a=ln(r.startContainer); let b=ln(r.endContainer); if(a==null||b==null) return []; if(b>a&&r.endOffset===0) b--; // a selection that ends where a line starts leaves it out
  return String(n.body||'').split('\n').slice(a, b+1).filter(l=>l.trim()); }
// The desktop button says how many tasks the selection makes
function noteSelPaint(){ if(!UI.wide) return; const b=document.querySelector('#desk .ned [data-act=noteTasks] span'); if(!b) return; const k=noteSelLines().length; const t=k?'Crear '+(k===1?'1 tarea':k+' tareas'):'Crear tareas'; if(b.textContent!==t) b.textContent=t; }
document.addEventListener('selectionchange', ()=>{ if(UI.wide&&deskNotesOn()) noteSelPaint(); });
// The desktop button: the selected lines at once (with Deshacer), or the lines of the list to choose from
function noteTasksDesk(id){ const n=noteRec(id); if(!n) return; const sel=noteSelLines(); if(sel.length){ flushEdits(); noteMakeTasks(n.projectId, sel); return; } noteTasksSheet(id); }

/* ---------- Events ---------- */
// The note a tap acts on: the drawn note it is inside, the desktop's open note, or the note of the iPhone screen tapped
function noteIdOf(e){ const ed=e.target.closest('[data-note]'); if(ed) return ed.dataset.note; if(UI.wide) return UI.noteOpen; const s=UI.stack.find(x=>x.el===e.currentTarget); return s&&s.kind==='note'?s.id:null; }
// Called by onClick first: true when the tap was the notes'
function noteClick(e){ const t=e.target;
  const ps=t.closest('[data-pseg]'); if(ps){ setProjTab(ps.dataset.pid, ps.dataset.pseg); return true; }
  const na=t.closest('[data-nact]'); if(na){ const el=na.closest('[data-pn]'); if(el){ closeVn(el); deleteNote(el.dataset.pn); } return true; }
  const ck=t.closest('[data-nck]'); if(ck){ const ed=ck.closest('[data-note]'); if(ed) toggleNoteCheck(ed.dataset.note, +ck.dataset.nck); return true; }
  const vw=t.closest('.nview'); if(vw){ if(t.closest('a')) return true; // a link opens; the rest of the text edits it, at the line tapped
    if(UI.wide&&!getSelection().isCollapsed) return true; // a selection being made on the desktop (Crear tareas) is not a click to edit
    const l=t.closest('[data-ln]'), ed=vw.closest('.nedit'); noteEditAt(ed, l?+l.dataset.ln:null); return true; }
  const act=t.closest('[data-act]'), a=act&&act.dataset.act;
  if(a==='newNote'){ newNote(act.dataset.project||(UI.deskView||'').slice(8)); return true; }
  if(a==='noteShare'||a==='noteMenu'||a==='notePin'||a==='noteTasks'){ const id=noteIdOf(e); if(!id) return true;
    if(a==='noteShare') shareNote(id); else if(a==='notePin') togglePin(id); else if(a==='noteTasks'){ if(UI.wide) noteTasksDesk(id); else noteTasksSheet(id); }
    else noteMenu(id, {anchor:act, align:'right'}); return true; }
  if(act) return false;
  const pn=t.closest('[data-pn]'); if(pn){ if(pn.dataset.open){ closeVn(pn); return true; } openNote(pn.dataset.pn); return true; }
  return false; }
// The desktop's toolbar button keeps the selection (it acts on the selected lines)
document.addEventListener('mousedown', e=>{ if(UI.wide&&e.target.closest&&e.target.closest('#desk .ned [data-act=noteTasks]')) e.preventDefault(); }, true);
// iPhone: the rows of the notes slide to Eliminar and lift on a long press (bindRows, also after a search)
function bindNoteRows(box){ if(UI.wide) return; box.querySelectorAll('.vn[data-pn]').forEach(el=>{ bindVnGestures(el); bindLongPress(el, src=>noteMenu(el.dataset.pn, {lift:src&&src.row, x:src&&src.x, y:src&&src.y})); }); }
/* Desktop keys while Notas shows: Comando or Control N (also while writing) and N make a note; the arrows move through the list; Intro edits the
   open note; Supr deletes it (with Deshacer); Esc leaves the text. Registered before the desktop's own keys, which then do not see them */
document.addEventListener('keydown', e=>{ if(!UI.wide||!deskNotesOn()) return; if(sheet.classList.contains('on')||asheet.classList.contains('on')||menuOpen()) return;
  const t=e.target||{}, role=t.dataset&&t.dataset.role, typing=/^(input|textarea|select)$/i.test(t.tagName||'')||!!t.isContentEditable, k=e.key, mod=e.metaKey||e.ctrlKey;
  const stop=()=>{ e.preventDefault(); e.stopImmediatePropagation(); }, pid=UI.deskView.slice(8);
  if(mod&&!e.altKey&&!e.shiftKey&&(k==='n'||k==='N')){ stop(); newNote(pid); return; }
  if(k==='Escape'&&(role==='ntitle'||role==='nbody')){ stop(); t.blur(); return; }
  if(typing||mod||e.altKey||e.isComposing) return;
  if(k==='n'||k==='N'){ stop(); newNote(pid); return; }
  if(k==='ArrowDown'||k==='ArrowUp'||k==='j'||k==='k'){ stop(); noteStep(k==='ArrowDown'||k==='j'?1:-1); return; }
  if(k==='Enter'){ if(t.closest&&t.closest('button,a,[role=button]')) return; const ed=document.querySelector('#desk .ned .nedit'); if(ed){ stop(); noteEditAt(ed, null); } return; }
  if((k==='Delete'||k==='Backspace')&&UI.noteOpen){ stop(); deleteNote(UI.noteOpen); } });
