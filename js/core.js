'use strict';
/* Tareas. Core: version, log, utilities, data (DB in localStorage), UI state, Deshacer toast and the task actions.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file. */
const APP_VERSION = '0.25.1';
let pendingSW = null; // service worker installed and waiting to take over
let updateRequested = false; // the user asked for the waiting worker to take over

/* ---------- Log: errors and app events, kept in localStorage for copy-and-paste debugging ---------- */
const LOGKEY = 'tareas-log';
let LOG = []; try{ LOG = JSON.parse(localStorage.getItem(LOGKEY)||'[]'); if(!Array.isArray(LOG)) LOG=[]; }catch(e){ LOG=[]; }
function log(level, msg, extra){
  const e = { t:new Date().toISOString(), l:level, m:String(msg) };
  if(extra!==undefined){ try{ e.x = typeof extra==='string' ? extra : JSON.stringify(extra); }catch(err){ e.x = String(extra); } }
  LOG.push(e); if(LOG.length>400) LOG = LOG.slice(-400);
  try{ localStorage.setItem(LOGKEY, JSON.stringify(LOG)); }catch(err){}
}
window.addEventListener('error', e => log('error', e.message||'Error', (e.filename||'').split('/').pop()+':'+e.lineno+':'+e.colno+(e.error&&e.error.stack?'\n'+e.error.stack:'')));
window.addEventListener('unhandledrejection', e => log('error', 'Promesa rechazada: '+(e.reason&&e.reason.message||e.reason), e.reason&&e.reason.stack));
const _consoleError = console.error.bind(console);
console.error = (...a) => { log('error', a.map(x=>x&&x.message||String(x)).join(' ')); _consoleError(...a); };
function logText(){
  const d = (typeof DB!=='undefined'&&DB) ? ' | espacios '+DB.spaces.length+', proyectos '+DB.projects.length+', tareas '+DB.tasks.length+', notas de voz '+DB.voiceNotes.length+', adjuntos '+(DB.attachments||[]).length+', pasos '+(DB.subtasks||[]).length+', notas de proyecto '+(DB.projectNotes||[]).length : '';
  let st='?'; try{ st = (navigator.standalone===true||matchMedia('(display-mode: standalone)').matches)?'instalada':'navegador'; }catch(e){}
  const head = 'Tareas v'+APP_VERSION+' | '+st+' | '+navigator.userAgent+' | '+new Date().toString()+d;
  const lines = LOG.map(e=>{ const t=e.t.replace('T',' ').slice(5,19); return t+' ['+e.l+'] '+e.m+(e.x?' | '+e.x:''); });
  return head+'\n'+(lines.length?lines.join('\n'):'(sin entradas)');
}

/* ---------- Utilities ---------- */
const $ = (s, el=document) => el.querySelector(s);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-'+Date.now()+'-'+Math.random().toString(16).slice(2));
const todayStr = () => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const addDays = (s, n) => { const d = new Date(s+'T00:00:00'); d.setDate(d.getDate()+n); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const DIAS = ['dom','lun','mar','mié','jue','vie','sáb'];
const DIAS_FULL = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
function fmtDate(s){ if(!s) return ''; const t=todayStr(); if(s===t) return 'Hoy'; if(s===addDays(t,1)) return 'Mañana'; if(s===addDays(t,-1)) return 'Ayer'; const d=new Date(s+'T00:00:00'); const diff=Math.round((new Date(t+'T00:00:00')-d)/864e5); if(diff<0&&diff>-7) return DIAS_FULL[d.getDay()]; return d.getDate()+' '+MESES[d.getMonth()]+(d.getFullYear()!==new Date().getFullYear()?' '+d.getFullYear():''); }
function fmtTime(iso){ if(!iso) return ''; const d=new Date(iso); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function localDay(iso){ const d=new Date(iso); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fmtDateTime(iso){ if(!iso) return ''; const d=new Date(iso); const s=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); return fmtDate(s)+' '+fmtTime(iso); }
const MESES_FULL = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const WD = {domingo:0,lunes:1,martes:2,'miércoles':3,miercoles:3,jueves:4,viernes:5,'sábado':6,sabado:6};
// Next occurrence of a weekday (0 = Sunday); strict skips today
function nextWeekday(dow, strict){ const t=todayStr(); const d=new Date(t+'T00:00:00'); let diff=(dow-d.getDay()+7)%7; if(diff===0&&strict) diff=7; return addDays(t,diff); }
// Quick options without repeats: one whose date (or instant) is already offered is left out, so on a Thursday 'Viernes' is not a second 'Mañana'
const uniqueBy = (list, key) => { const seen=new Set(); return list.filter(o=>{ const k=key(o); if(seen.has(k)) return false; seen.add(k); return true; }); };
// 'Fin de semana' in Aplazar: the next weekend day, so on a Saturday it is Sunday (the same as 'Mañana') and never a week ahead
function weekendDay(){ const t=todayStr(); return new Date(t+'T00:00:00').getDay()===6 ? addDays(t,1) : nextWeekday(6,true); }
// Day and optional month (1-12) to the next matching date from today
function dateFromDM(day, month){ const t=todayStr(); const y=+t.slice(0,4), m=+t.slice(5,7); const mk=(yy,mm)=>{ if(day<1||day>new Date(yy,mm,0).getDate()) return null; return yy+'-'+String(mm).padStart(2,'0')+'-'+String(day).padStart(2,'0'); };
  if(month){ if(month<1||month>12) return null; const c=mk(y,month); return (c&&c>=t)?c:mk(y+1,month); }
  for(let k=0;k<3;k++){ const mm=(m-1+k)%12+1, yy=y+Math.floor((m-1+k)/12); const c=mk(yy,mm); if(c&&c>=t) return c; } return null; } // a month without that day is skipped: 'el 30' on 31 January is 30 March
// Trailing date words in a quick-add title: 'hoy', 'mañana', 'pasado mañana', a weekday, 'el 12', '12/11', '12 de noviembre'
function quickDateMatch(text){
  const t=todayStr(); const rules=[
    [/\s+pasado\s+mañana\s*$/i, ()=>addDays(t,2)],
    [/\s+mañana\s*$/i, ()=>addDays(t,1)],
    [/\s+hoy\s*$/i, ()=>t],
    [/\s+(?:el\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s*$/i, m=>nextWeekday(WD[m[1].toLowerCase()], true)],
    [/\s+(?:el\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s*$/i, m=>dateFromDM(+m[1], MESES_FULL.indexOf(m[2].toLowerCase())+1)],
    [/\s+(?:el\s+)?(\d{1,2})\/(\d{1,2})\s*$/, m=>dateFromDM(+m[1],+m[2])],
    [/\s+el\s+(?:día\s+)?(\d{1,2})\s*$/i, m=>dateFromDM(+m[1],null)] ];
  for(const [re,fn] of rules){ const m=text.match(re); if(m){ const d=fn(m); if(d) return {index:m.index, len:m[0].length, date:d}; } }
  return null;
}
function parseQuickDate(text){ const m=quickDateMatch(text); return m?{title:text.slice(0,m.index).trim(), date:m.date, match:text.substr(m.index,m.len).trim()}:null; }
/* R7: projects named by '#pro' in a title. A word of the name (or the whole name run together) starts with it, accents ignored.
   A whole-name match wins over the others ('#flc' picks FLC, not FLC Fase 2); otherwise two or more matches are ambiguous. */
const projKey = name => norm(name).replace(/[^a-z0-9]/g,'');
function projectMatches(tok){ const k=projKey(tok); if(!k) return []; const ps=activeProjects();
  const exact=ps.filter(p=>projKey(p.name)===k); if(exact.length===1) return exact;
  return ps.filter(p=>projKey(p.name).startsWith(k) || norm(p.name).split(/[^a-z0-9]+/).some(w=>w&&w.startsWith(k))); }
/* R7: everything a quick-add title says besides its text. '#pro' anywhere picks a project; at the end, in any order,
   a date (the parseQuickDate words), a time ('a las 9', 'a las 9:30', 'a las 18h', 'a la 1 de la tarde') and '!!!' or '!!' for the priority.
   tokens: the recognised ranges of the text, to highlight them and to drop them from the title. */
function parseQuick(text){
  const src=String(text||''); const toks=[]; const out={title:'', date:null, projectId:null, priority:null, time:null, ambiguous:null, tokens:toks};
  for(const m of src.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)){ if(out.projectId) break; const start=m.index+m[1].length, ps=projectMatches(m[2]);
    if(ps.length===1){ out.projectId=ps[0].id; out.ambiguous=null; toks.push({kind:'proj', start, end:start+1+m[2].length}); }
    else if(ps.length>1&&!out.ambiguous) out.ambiguous={tok:'#'+m[2], names:ps.map(p=>p.name)}; }
  const blank=(w,a,b)=>w.slice(0,a)+' '.repeat(b-a)+w.slice(b); let work=src; toks.forEach(t=>{ work=blank(work,t.start,t.end); });
  const take=(kind,a,b)=>{ while(a<b&&/\s/.test(work[a])) a++; toks.push({kind, start:a, end:b}); work=blank(work,a,b); };
  for(let more=true; more;){ more=false; let m;
    // the time goes first: in 'a las 9 de la mañana', 'mañana' is part of the time, not tomorrow
    if(!out.time && (m=work.match(/\s+a\s+las?\s+(\d{1,2})(?:[:.h](\d{2}))?\s*(?:h|hs|horas?)?(?:\s+de\s+la\s+(mañana|tarde|noche))?\s*$/i))){ let h=+m[1]; const mi=m[2]?+m[2]:0; const part=(m[3]||'').toLowerCase();
      if(part&&part!=='mañana'&&h<12) h+=12; if(h<=23&&mi<=59){ out.time={h, m:mi}; take('time', m.index, m.index+m[0].trimEnd().length); more=true; continue; } }
    if(!out.priority && (m=work.match(/\s(!{2,3})\s*$/))){ out.priority=m[1].length===3?'high':'mid'; take('pri', m.index, m.index+1+m[1].length); more=true; continue; }
    if(!out.date){ const d=quickDateMatch(work); if(d){ out.date=d.date; take('date', d.index, d.index+work.substr(d.index,d.len).trimEnd().length); more=true; } } }
  toks.sort((a,b)=>a.start-b.start); out.title=quickTitle(src, toks); return out; }
function quickTitle(src, toks){ let t='', last=0; toks.forEach(k=>{ t+=src.slice(last,k.start)+' '; last=k.end; }); return (t+src.slice(last)).replace(/\s+/g,' ').trim(); }
// R7: the reminder for a written time: on the task's date or, with none, today, or tomorrow when that time has passed. null when it would be in the past.
function quickReminder(time, date){ if(!time) return null; const at=d=>{ const x=new Date(d+'T00:00:00'); x.setHours(time.h, time.m, 0, 0); return x; };
  if(date){ const x=at(date); return x.getTime()>Date.now()?x.toISOString():null; }
  let x=at(todayStr()); if(x.getTime()<=Date.now()) x=at(addDays(todayStr(),1)); return x.toISOString(); }
// R7: the task a quick-add title describes, over the values chosen by hand (base: date, projectId, priority).
// A time that has already passed on the written day sets no reminder and stays in the title (late).
function quickTask(text, base){ base=base||{}; const q=parseQuick(text); let toks=q.tokens, reminder=null, late=false; const date=q.date||base.date||null;
  if(q.time){ reminder=quickReminder(q.time, date); if(!reminder){ late=true; toks=toks.filter(t=>t.kind!=='time'); } }
  return {q, toks, title:late?quickTitle(String(text||''), toks):q.title, date:date||(reminder?localDay(reminder):null), projectId:q.projectId||base.projectId||null, priority:q.priority||base.priority||'none', reminder, late}; }
// R7: a short line with what was read in the title, and why something was not taken
function quickSaid(r){ const q=r.q, out=[], warn=[];
  if(q.date) out.push(fmtDate(q.date));
  if(q.projectId){ const p=proj(q.projectId); if(p) out.push('proyecto '+p.name); }
  if(q.priority) out.push(q.priority==='high'?'prioridad alta':'prioridad media');
  if(r.reminder) out.push('recordatorio '+(!q.date?fmtDate(localDay(r.reminder)).toLowerCase()+' ':'')+'a las '+fmtTime(r.reminder));
  if(q.ambiguous) warn.push(q.ambiguous.tok+' coincide con '+q.ambiguous.names.slice(0,-1).join(', ')+' y '+q.ambiguous.names.slice(-1)+'. No se asigna proyecto.');
  if(r.late) warn.push('Esa hora ya ha pasado. No se pone recordatorio.');
  return {out, warn}; }
// R6: the values a line of a list will get, in short
function quickMeta(r){ const m=[]; if(r.date) m.push(fmtDate(r.date)); if(r.reminder) m.push(fmtTime(r.reminder)); const p=r.projectId&&proj(r.projectId); if(p) m.push(p.name); if(r.priority!=='none') m.push(r.priority==='high'?'!!!':'!!'); return m.join(', '); }
// R7: the field with the recognised parts tinted behind its text
function qinHTML(input){ return '<div class="qin"><div class="qhl" aria-hidden="true"><span></span></div>'+input+'</div>'; }
function paintQuick(inp, toks){ const hl=inp.parentNode&&inp.parentNode.querySelector('.qhl span'); if(!hl) return; const v=inp.value; let o='', last=0;
  toks.forEach(t=>{ o+=esc(v.slice(last,t.start))+'<mark>'+esc(v.slice(t.start,t.end))+'</mark>'; last=t.end; }); hl.innerHTML=o+esc(v.slice(last)); syncQuick(inp); }
function syncQuick(inp){ const hl=inp.parentNode&&inp.parentNode.querySelector('.qhl span'); if(hl) hl.style.transform='translateX('+(-inp.scrollLeft)+'px)'; }
function bindQuickScroll(inp){ ['scroll','keyup','select','click','focus'].forEach(n=>inp.addEventListener(n,()=>syncQuick(inp))); }
// R7: Tab in a '#pro' token completes the project; with several matches each Tab moves to the next one
function completeProjectTag(inp){ const pos=inp.selectionStart, v=inp.value; const m=v.slice(0,pos).match(/(^|\s)#([\p{L}\p{N}_-]*)$/u); if(!m) return false;
  const tail=v.slice(pos).match(/^[\p{L}\p{N}_-]*/u)[0]; const start=pos-m[2].length; const typed=inp.dataset.tagBase&&inp.dataset.tagAt==String(start)?inp.dataset.tagBase:m[2]+tail;
  const ps=typed?projectMatches(typed):activeProjects(); if(!ps.length) return false;
  const word=p=>{ const w=p.name.split(/[^\p{L}\p{N}]+/u).find(x=>norm(x).startsWith(norm(typed))); const one=w&&projectMatches(w); return one&&one.length===1&&one[0].id===p.id?w:p.name.replace(/[^\p{L}\p{N}_-]+/gu,''); };
  const cur=m[2]+tail; const names=ps.map(word); const i=names.indexOf(cur); const next=names[(i+1)%names.length];
  inp.value=v.slice(0,start)+next+v.slice(pos+tail.length); const at=start+next.length; inp.setSelectionRange(at,at);
  inp.dataset.tagBase=typed; inp.dataset.tagAt=String(start); inp.dispatchEvent(new Event('input')); return true; }
// R6: pasted lines to task titles, without bullets, numbering or check boxes; empty lines dropped
const LIST_MARK=/^\s*(?:(?:[-*•·◦▪–—+]|\d{1,3}[.)]|[a-zA-Z]\))\s+|\[[ xX]?\]\s*|[☐☑✓✔]\s*)+/;
const pasteLines = text => String(text||'').split(/\r?\n/).map(l=>l.replace(LIST_MARK,'').replace(/\s+/g,' ').trim()).filter(Boolean);
// R6: lines of a note that read as pending items: '- ', '* ', '[ ]' or '☐' (a ticked box is left out)
const NOTE_ITEM=/^\s*(?:[-*•]\s+(?:\[ ?\]\s*)?|\[ ?\]\s*|☐\s*)(?!\[[xX]\])(\S.*)$/;
const noteItems = notes => String(notes||'').split(/\r?\n/).map(l=>{ const m=l.match(NOTE_ITEM); return m?m[1].replace(LIST_MARK,'').trim():''; }).filter(Boolean);
const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const tint = (hex,a) => { const n=parseInt(String(hex).slice(1),16); return isNaN(n)?'transparent':'rgba('+(n>>16&255)+','+(n>>8&255)+','+(n&255)+','+a+')'; };
const URL_RE=/(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi, TEL_RE=/(\+?\d[\d .-]{7,}\d)/g;
// Links and phone numbers found in free text, in one pass over the raw text so a phone never matches inside a URL
const LINK_RE=new RegExp(URL_RE.source+'|'+TEL_RE.source,'gi'), DATE_LIKE=/(^|\D)(\d{4}-(0?[1-9]|1[0-2])-\d{1,2}|\d{1,2}[-.](0?[1-9]|1[0-2])[-.]\d{2,4})(\D|$)/;
function scanLinks(text){ const t=String(text||''), out=[];
  for(const m of t.matchAll(LINK_RE)){ let s=m[0]; const at=m.index;
    if(m[1]){ // a URL leaves out trailing punctuation, and a closing bracket it never opened
      for(;;){ const c=s.slice(-1); if('.,;:!?\'"'.includes(c) || (c===')'&&s.split('(').length<s.split(')').length) || (c===']'&&s.split('[').length<s.split(']').length)) s=s.slice(0,-1); else break; }
      if(/^(?:https?:\/\/|www\.)./i.test(s)) out.push({kind:'url', start:at, end:at+s.length, text:s, href:/^https?:/i.test(s)?s:'https://'+s}); }
    else { // only real phone shapes: Spanish 9 digits or international; not dates, invoice numbers or IBANs
      const d=s.replace(/[^\d+]/g,''), prev=t.charAt(at-1);
      if(!/[A-Za-zÀ-ɏ\d]/.test(prev) && !DATE_LIKE.test(s) && (/^(?:\+|00)\d{9,15}$/.test(d)||/^[6789]\d{8}$/.test(d))) out.push({kind:'tel', start:at, end:at+s.length, text:s, href:'tel:'+d}); } }
  return out; }
function extractLinks(text){ const ls=scanLinks(text), seen=new Set(); // links first, then phones, each target once
  return ls.filter(l=>l.kind==='url').concat(ls.filter(l=>l.kind==='tel')).filter(l=>!seen.has(l.href)&&seen.add(l.href)).map(l=>({label:l.kind==='url'?l.text.replace(/^https?:\/\//i,'').replace(/^www\./i,'').split(/[\/?#]/)[0]:l.text.trim(), href:l.href})); }
function linkify(text){ const t=String(text||''); let o='', last=0;
  scanLinks(t).forEach(l=>{ o+=esc(t.slice(last,l.start))+'<a href="'+esc(l.href)+'"'+(l.kind==='url'?' target="_blank" rel="noopener"':'')+'>'+esc(l.text)+'</a>'; last=l.end; });
  return o+esc(t.slice(last)); }
const esc = s => String(s??'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// iOS Safari has no vibrate(); toggling a native switch inside a user gesture gives a haptic tick on iOS 17.4 and later
const haptic = (ms=10) => { try{ if(navigator.vibrate){ navigator.vibrate(ms); return; } const sw=document.getElementById('hap'); if(sw){ sw.click(); } }catch(e){} };
// Decision 33: 16 project colours in two rows. Row 1: red, orange, yellow, green, blue, purple, pink, brown; row 2: mint, cyan, indigo, gray,
// maroon, olive, navy, coral. Apple's system values where they exist; a project keeps the colour it has (stored as its hex)
const COLORS = ['#FF3B30','#FF9500','#FFCC00','#34C759','#007AFF','#AF52DE','#FF2D55','#A2845E',
  '#00C7BE','#32ADE6','#5856D6','#8E8E93','#9B2242','#7D8A2E','#1F3A8A','#FF7A5C'];

const I = {
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>',
  chev:'<svg viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5L6.5 7l-5 5.5"/></svg>',
  chevD:'<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5l4.5 4.5L11.5 5"/></svg>',
  back:'<svg viewBox="0 0 12 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2L2 10l8 8"/></svg>',
  search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  mic:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>',
  share:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13M7 8l5-5 5 5M5 13v7h14v-7"/></svg>',
  bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0112 0v4l2 3H4l2-3zM10 20a2 2 0 004 0"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  more:'<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  list:'<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6" cy="7" r="2"/><circle cx="6" cy="13" r="2"/><circle cx="6" cy="19" r="2"/><path d="M11 7h10M11 13h10M11 19h10"/></svg>',
  folder:'<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 012-2h5l2 3h9a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
  gear:'<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="13" r="3.5"/><path d="M13 3v3M13 20v3M3 13h3M20 13h3M6 6l2 2M18 18l2 2M6 20l2-2M18 8l2-2"/></svg>',
  cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  flag:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4h12l-2 4 2 4H5"/></svg>',
  note:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 7h14M5 12h14M5 17h8"/></svg>',
  inbox:'<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 28l4-16h24l4 16v10H8z"/><path d="M8 28h10a6 6 0 0012 0h10"/></svg>',
  copy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3"/></svg>',
  listF:'<svg viewBox="0 0 26 26" fill="currentColor" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="6" cy="7" r="2.4" stroke="none"/><circle cx="6" cy="13" r="2.4" stroke="none"/><circle cx="6" cy="19" r="2.4" stroke="none"/><path d="M11 7h10M11 13h10M11 19h10" fill="none"/></svg>',
  folderF:'<svg viewBox="0 0 26 26" fill="currentColor"><path d="M3 7a2 2 0 012-2h5l2 3h9a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
  clip:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 11.5l-8.2 8.2a5 5 0 01-7.1-7.1l8.6-8.6a3.4 3.4 0 014.8 4.8l-8.6 8.6a1.7 1.7 0 01-2.4-2.4l7.9-7.9"/></svg>',
  photo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 15.5l-5-5L6 19"/></svg>',
  wave:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>',
  play:'<svg class="ic-play" viewBox="0 0 24 24" fill="currentColor"><path d="M7.5 4.8v14.4a.8.8 0 001.2.7l11.6-7.2a.8.8 0 000-1.4L8.7 4.1a.8.8 0 00-1.2.7z"/></svg>',
  pause:'<svg class="ic-pause" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
  download:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13M7 11l5 5 5-5M5 20h14"/></svg>',
  chevL:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  chevR:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  gearF:'<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="13" cy="13" r="4.5" fill="currentColor" stroke="none"/><path d="M13 3v3M13 20v3M3 13h3M20 13h3M6 6l2 2M18 18l2 2M6 20l2-2M18 8l2-2"/></svg>',
  repeat:'<svg class="i-rep" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2.5l3 3-3 3"/><path d="M4 11.5v-2a4 4 0 014-4h12"/><path d="M7 21.5l-3-3 3-3"/><path d="M20 12.5v2a4 4 0 01-4 4H4"/></svg>',
  star:'<svg class="i-star" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2.8l2.85 5.78 6.38.93-4.62 4.5 1.09 6.35L12 17.36l-5.7 3 1.09-6.35-4.62-4.5 6.38-.93z"/></svg>',
  starF:'<svg class="i-star on" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2.8l2.85 5.78 6.38.93-4.62 4.5 1.09 6.35L12 17.36l-5.7 3 1.09-6.35-4.62-4.5 6.38-.93z"/></svg>',
};

/* ---------- Data ---------- */
const KEY = 'tareas-v1';
let DB = null;
function blank(){
  const t=new Date().toISOString();
  return { spaces:[{id:'trabajo',name:'Trabajo',order:0,created:t},{id:'personal',name:'Personal',order:1,created:t}], projects:[], tasks:[], voiceNotes:[], attachments:[], subtasks:[], projectNotes:[], settings:{activeSpace:'trabajo', summaryState:'auto', filter:'hoy', doneOpen:false, theme:'auto', tipsSeen:false, shakeUndo:false, allGroup:'date', hoyGroup:'date'} };
}
let lastRaw = null; // the stored text this window last read or wrote; another window may have changed it since
function load(){
  let raw=null; try{ raw=localStorage.getItem(KEY); }catch(e){ log('error','No se pudieron leer los datos: '+(e&&e.message||e)); }
  lastRaw=raw; if(!raw) return blank();
  let d=null; try{ d=JSON.parse(raw); }catch(e){}
  const b=blank(), lists=['spaces','projects','tasks','voiceNotes','attachments','subtasks','projectNotes']; // subtasks: decision 46; projectNotes: decision 47
  if(!d || typeof d!=='object' || Array.isArray(d) || !lists.some(k=>Array.isArray(d[k]))){
    // Unreadable data: keep the raw text aside before the first save replaces it
    try{ localStorage.setItem(KEY+'-corrupt', raw); }catch(e){}
    log('error','Datos guardados no reconocidos: se empieza en blanco y se conserva el texto en '+KEY+'-corrupt', raw.slice(0,120));
    return b;
  }
  if(!Array.isArray(d.spaces) || !d.spaces.length){ d.spaces=b.spaces; log('warn','Datos guardados sin espacios: se crean Trabajo y Personal'); }
  lists.forEach(k=>{ if(!Array.isArray(d[k])) d[k]=b[k]; });
  const s=(d.settings&&typeof d.settings==='object')?d.settings:{};
  // Before v0.7 the summary kept a boolean summaryCollapsed; carry it over to summaryState
  if(s.summaryState===undefined && 'summaryCollapsed' in s) s.summaryState=s.summaryCollapsed?'closed':'auto';
  delete s.summaryCollapsed;
  return Object.assign(b, d, {settings:Object.assign(b.settings, s)});
}
let saveFailed = false; // the last save did not reach localStorage
let saveErrorNow = false; // set until the current task ends, so the action's own toast reports the failure
// A bulk action changes many tasks with updTask: inside batch() their saves become one write at the end
let saveHold=0, saveDirty=false;
let dataVer=0; // bumped on every save: a screen drawn at an older version shows stale data (see swapHTML, pop)
let staleView=false; // data reloaded from another window while something was being typed or picked: not yet drawn (reloadFromStorage)
function batch(fn){ saveHold++; try{ return fn(); } finally{ if(--saveHold===0 && saveDirty){ saveDirty=false; save(); } } }
// Typing in a detail's title or notes is saved a moment after the last key, not on every key: each save writes all the data.
// editPatch keeps what is waiting, so a reload from another window can put it back. Any save() writes it too.
let editSaveT=null, editPatch=null;
function saveEdit(x, patch){ Object.assign(x, patch, {modified:new Date().toISOString()}); dataVer++;
  editPatch={id:x.id, patch:Object.assign(editPatch&&editPatch.id===x.id?editPatch.patch:{}, patch, {modified:x.modified})};
  clearTimeout(editSaveT); editSaveT=setTimeout(save, 400); }
function flushEdits(){ if(editSaveT) save(); }
function save(){
  if(saveHold){ saveDirty=true; return true; }
  dataVer++; clearTimeout(editSaveT); editSaveT=null; editPatch=null; // this write carries any typing still waiting for its save
  const raw=JSON.stringify(DB);
  try{ localStorage.setItem(KEY, raw); }
  catch(e){
    // Storage full: free the space the log takes and try once more
    try{ LOG=LOG.slice(-50); localStorage.setItem(LOGKEY, JSON.stringify(LOG)); }catch(err){ try{ localStorage.removeItem(LOGKEY); }catch(err2){} }
    try{ localStorage.setItem(KEY, raw); }
    catch(e2){ if(!saveFailed) log('error','No se pudo guardar: '+(e2&&e2.message||e2)); saveFailed=true; saveErrorNow=true; Promise.resolve().then(()=>{ saveErrorNow=false; }); toast('No se pudo guardar en el dispositivo'); return false; }
  }
  lastRaw=raw;
  if(saveFailed){ saveFailed=false; log('info','Se vuelve a guardar con normalidad'); }
  syncChanged(); // signed in: the change goes up a moment later (block 8)
  return true;
}
DB = load();
let SY=null; // sync state (block 8), set up by the SYNC block below; null while the app is local only
try{ navigator.storage && navigator.storage.persist && navigator.storage.persist(); }catch(e){}
function applyTheme(){ const t=DB.settings.theme||'auto'; if(t==='auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme',t);
  // Browser and status bar tint: a chosen theme overrides both metas; in auto each one keeps its media query
  document.querySelectorAll('meta[name="theme-color"]').forEach(m=>{ m.content = t==='dark'?'#161618':t==='light'?'#F9F9F9':(m.media?'#161618':'#F9F9F9'); }); }
applyTheme();

const space = () => DB.spaces.find(s=>s.id===DB.settings.activeSpace) || DB.spaces[0];
const proj = id => DB.projects.find(p=>p.id===id);
const task = id => DB.tasks.find(t=>t.id===id);
const activeProjects = () => DB.projects.filter(p=>p.spaceId===space().id && !p.archived).sort((a,b)=>a.order-b.order);
const spaceTasks = () => DB.tasks.filter(t=>t.spaceId===space().id);
const PRI = {high:0, mid:1, none:2};

function orderTasks(list){
  const t = todayStr();
  const grp = x => { if(x.date && x.date<t) return 0; if(x.date===t || dlDue(x)) return 1; if(x.priority==='high') return 2; return 3; }; // decision 48a: a deadline that has come counts as today
  return list.slice().sort((a,b)=>{
    const ga=grp(a), gb=grp(b); if(ga!==gb) return ga-gb;
    if(ga===0||ga===1){ const pa=PRI[a.priority], pb=PRI[b.priority]; if(pa!==pb) return pa-pb; }
    if(ga===3){ if(a.date&&b.date&&a.date!==b.date) return a.date<b.date?-1:1; if(a.date&&!b.date) return -1; if(!a.date&&b.date) return 1; const pa=PRI[a.priority], pb=PRI[b.priority]; if(pa!==pb) return pa-pb; }
    return a.created<b.created?-1:1;
  });
}
// The query is normalised once and the voice notes searched once per list, not once per task
function queryMatcher(query){ const q=norm(query); const vn=new Set(DB.voiceNotes.filter(v=>norm(v.text).includes(q)).map(v=>v.taskId)), sv=new Set(DB.subtasks.filter(s=>s&&norm(s.title).includes(q)).map(s=>s.taskId)); // decision 46: the steps' titles too
  return x => norm(x.title).includes(q) || norm(x.notes).includes(q) || (x.waitingFor && norm(x.waitingFor).includes(q)) || (x.projectId && norm((proj(x.projectId)||{}).name).includes(q)) || vn.has(x.id) || sv.has(x.id); }
function matchesQuery(x, query){ return queryMatcher(query)(x); }
// R18: while one screen is drawn (drawing) each pending list is worked out once: the summary, the counts and the list ask for the same ones,
// and nothing changes the data in between. Callers only read the lists
let PF=null;
function drawing(fn){ if(PF) return fn(); PF=new Map(); try{ return fn(); } finally{ PF=null; } }
function pendingFor(filter, projectId, query){ if(!PF) return pendingCalc(filter, projectId, query);
  const k=filter+'|'+projectId+'|'+(query||''); let v=PF.get(k); if(!v){ v=pendingCalc(filter, projectId, query); PF.set(k,v); } return v; }
function pendingCalc(filter, projectId, query){
  const t=todayStr();
  let list = spaceTasks().filter(x=>x.status==='pending' || (x.status==='waiting' && (query || waitIn(x)))); // decision 41: a task waiting for confirmation joins the lists on its review day (and in a search); decision 48a: or once its deadline has come
  if(projectId!==undefined) list = list.filter(x=> projectId===null ? !x.projectId : x.projectId===projectId);
  if(filter==='hoy') list = list.filter(x=>(x.date && x.date<=t) || dlDue(x)); // decision 48a: its deadline brings it, once
  if(query) list = list.filter(queryMatcher(query));
  return orderTasks(list);
}
/* Decision 41: Por confirmar. status 'waiting' sits between pending and done; waitingFor is who or what it waits for (optional free text).
   Such a task leaves Hoy and Todas for the folded block Por confirmar at the end of the list, and comes back to Hoy on its review day (its
   date, or after it: rollOver never carries it), marked Revisar. The rest of the time it counts nowhere */
const waitDue = x => x.status==='waiting' && !!x.date && x.date<=todayStr();
const isOpen = x => x.status!=='done'; // pending or waiting: not done
/* Decision 48a: Fecha límite. Task.deadline (Supabase tasks.deadline) is the day the task is due, a date apart from its work date; null when none.
   An open task comes to Hoy on that day and stays there after it, whatever its date (later, postponed, or none), once and never marked Aplazada;
   it counts in para hoy and in the badge. rollOver, Aplazar and the calendar move the date only; a new date never changes the deadline.
   The rows say "Entrega jueves": grey, orange from two days before, red on the day and after; no colour once done. No notification of its own */
const dlDue = x => !!x.deadline && x.deadline<=todayStr() && isOpen(x);
const inHoy = x => (!!x.date && x.date<=todayStr()) || dlDue(x); // pending or waiting, in Hoy (a waiting one also needs waitIn)
const waitIn = x => waitDue(x) || (x.status==='waiting' && dlDue(x)); // a waiting task in the lists: its review day or its deadline has come
const carriedOn = x => !!x.carried && !!x.date && x.date<=todayStr(); // Aplazada: by its date, never by a deadline
function dlLevel(x){ if(!x.deadline||x.status==='done') return ''; const t=todayStr(); return x.deadline<=t?'due':x.deadline<=addDays(t,2)?'soon':''; }
const dlText = d => { const s=fmtDate(d); return 'Entrega '+s[0].toLowerCase()+s.slice(1); }; // "Entrega hoy", "Entrega jueves", "Entrega 12 nov"
// The block Por confirmar: the waiting tasks of the space (of a project, or under the project filter) whose review day has not come
function waitingList(projectId){ let list=spaceTasks().filter(x=>x.status==='waiting'&&!waitIn(x));
  if(projectId!==undefined) list=list.filter(x=> projectId===null ? !x.projectId : x.projectId===projectId);
  return list.sort((a,b)=>(a.date||'9999')<(b.date||'9999')?-1:(a.date||'9999')>(b.date||'9999')?1:a.created<b.created?-1:1); }
function doneList(projectId){
  const lim = Date.now()-30*864e5;
  let list = spaceTasks().filter(x=>x.status==='done' && x.completed && new Date(x.completed).getTime()>lim);
  if(projectId!==undefined) list = list.filter(x=> projectId===null ? !x.projectId : x.projectId===projectId);
  return list.sort((a,b)=>a.completed<b.completed?1:-1);
}

/* ---------- UI state ---------- */
const CAL_VIEWS=['day','week','month'], H0=7*60, H1=21*60, SLOT=30, SH=22; // R12, R19, R20: the calendar views; the hours grid's first and last minute, its slot and the slot's height in px
const UI = { tab:'tareas', query:'', stack:[], scroll:{}, sumFilter:null, summaryFirst:false, searchDone:false, select:null, projFilter:null, wide:false, deskView:'hoy', deskDetail:null, weekStart:null, calDay:null, calMonth:null, miniYM:null, addDraft:'', addPaste:null, convertedNotes:{}, deskScroll:{}, deskKey:null,
  dsel:{cur:null, ids:new Set(), anchor:null, mode:false, edit:null, idx:0, order:[], key:null, follow:false} }; // R15, R16: the desktop selection (see deskOrder)
let deskRedraw=false; // while renderDesktop replaces the markup: a field it takes away is not a field the user left (R15)
const MODK=/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent||'')?'Comando':'Control'; // the key a Mac calls Comando
const bulkN = n => n+(n===1?' tarea':' tareas');
const AX={open:false, notes:'', voice:'', voiceOn:false, rec:null, date:undefined, projectId:undefined, priority:undefined, time:null, opened:false}; // decision 31: the desktop add bar's composer (axOpen)

/* ---------- Toast with undo ---------- */
let toastTimer=null, undoFn=null, toastLbl=null; // toastLbl: the button is not Deshacer (Actualizar, Completar tarea): Comando Z and shaking leave it alone
function toast(text, undo, label){ toastLbl=undo&&label||null;
  if(saveErrorNow && !label) text='No se pudo guardar en el dispositivo'; // an action whose save failed must not claim success
  const el=$('#toast'); $('#toastText').textContent=text; undoFn=undo||null; const b=$('#toastBtn'); b.textContent=label||'Deshacer'; b.style.display=undo?'':'none';
  el.classList.add('on'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>{el.classList.remove('on'); undoFn=null;}, label?12000:4000);
}
$('#toastBtn').addEventListener('click',()=>{ if(undoFn){ undoFn(); undoFn=null; } $('#toast').classList.remove('on'); clearTimeout(toastTimer); renderAnimated(); });

/* ---------- Decision 38: tasks that repeat ----------
   Task.repeat holds the rule as text (Supabase tasks.repeat), null when the task does not repeat: '<rule>@<anchor>#<series>'.
     D<n>             every n days                                         'D1', 'D3'
     WD               every weekday, Monday to Friday                      'WD'
     W<n>:<days>      every n weeks on those days (MO TU WE TH FR SA SU)   'W1:MO', 'W2:MO,TH'
     M<n>:<d>         every n months on day d; a shorter month takes its last day        'M1:15', 'M1:31'
     M<n>:<k><DD>     every n months on the k-th weekday, k 1 to 4 or L for the last     'M1:1MO', 'M1:LFR'
     Y<n>:<MM>-<DD>   every n years on that day; 29 February is the 28th in other years  'Y1:11-03'
   anchor (YYYY-MM-DD): the day the series counts from, so 'every 2 weeks' and 'every 3 days' keep their rhythm.
   series: an id every task of the series shares (one pending at a time); it stays when the rule changes. No other column is needed.
   Example: 'W2:MO,TH@2026-11-02#k3f9a2c1'. Days are worked out on calendar dates, never on times, so a time zone or summer time cannot shift them */
const REP_DAYS=['SU','MO','TU','WE','TH','FR','SA'], DIAS_L=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const REP_RE=/^(?:D(\d{1,3})|(WD)|W(\d{1,2}):((?:SU|MO|TU|WE|TH|FR|SA)(?:,(?:SU|MO|TU|WE|TH|FR|SA))*)|M(\d{1,2}):(?:(\d{1,2})|([1-4L])(SU|MO|TU|WE|TH|FR|SA))|Y(\d{1,2}):(\d\d)-(\d\d))(?:@(\d{4}-\d\d-\d\d))?(?:#([\w-]{1,40}))?$/;
const monFirst = d => (d+6)%7; // Monday 0 ... Sunday 6
function repParse(s){ const m=REP_RE.exec(String(s||'')); if(!m) return null; const r={anchor:m[12]||null, series:m[13]||null};
  if(m[1]){ r.f='D'; r.n=+m[1]; } else if(m[2]){ r.f='WD'; r.n=1; }
  else if(m[3]){ r.f='W'; r.n=+m[3]; r.days=[...new Set(m[4].split(',').map(d=>REP_DAYS.indexOf(d)))].sort((a,b)=>monFirst(a)-monFirst(b)); }
  else if(m[5]){ r.f='M'; r.n=+m[5]; if(m[6]) r.day=+m[6]; else { r.nth=m[7]==='L'?-1:+m[7]; r.wd=REP_DAYS.indexOf(m[8]); } }
  else { r.f='Y'; r.n=+m[9]; r.mo=+m[10]; r.day=+m[11]; }
  if(r.n<1||(r.day!==undefined&&(r.day<1||r.day>31))||(r.f==='Y'&&(r.mo<1||r.mo>12))) return null;
  return r; }
const pad2 = n => String(n).padStart(2,'0');
function repFreq(r){ if(r.f==='D') return 'D'+r.n; if(r.f==='WD') return 'WD'; if(r.f==='W') return 'W'+r.n+':'+r.days.map(d=>REP_DAYS[d]).join(',');
  if(r.f==='M') return 'M'+r.n+':'+(r.day?r.day:(r.nth<0?'L':r.nth)+REP_DAYS[r.wd]); return 'Y'+r.n+':'+pad2(r.mo)+'-'+pad2(r.day); }
const repString = r => repFreq(r)+(r.anchor?'@'+r.anchor:'')+(r.series?'#'+r.series:'');
const repSeries = s => { const r=repParse(s); return r&&r.series; };
// Days since 1970-01-01 of a calendar date, with no time zone in between
const dayNum = s => Math.round(Date.UTC(+s.slice(0,4), +s.slice(5,7)-1, +s.slice(8,10))/864e5);
const dimOf = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
// Whether a date belongs to the series (r parsed); before its anchor too, so a task dated earlier still finds its next date
function repHas(r, d){ const y=+d.slice(0,4), mo=+d.slice(5,7), dd=+d.slice(8,10), dow=new Date(Date.UTC(y,mo-1,dd)).getUTCDay(), a=r.anchor||d, mod=(x,n)=>((x%n)+n)%n;
  switch(r.f){
    case 'D': return mod(dayNum(d)-dayNum(a), r.n)===0;
    case 'WD': return dow>=1&&dow<=5;
    case 'W': { if(!r.days.includes(dow)) return false; const wk=s=>Math.floor((dayNum(s)-4)/7); return mod(wk(d)-wk(a), r.n)===0; } // 1970-01-05 (day 4) was a Monday
    case 'M': { if(mod((y*12+mo-1)-(+a.slice(0,4)*12+ +a.slice(5,7)-1), r.n)!==0) return false;
      if(r.day) return dd===Math.min(r.day, dimOf(y,mo)); if(dow!==r.wd) return false; return r.nth<0 ? dd+7>dimOf(y,mo) : Math.ceil(dd/7)===r.nth; }
    case 'Y': return mod(y-(+a.slice(0,4)), r.n)===0 && mo===r.mo && dd===Math.min(r.day, dimOf(y,mo)); }
  return false; }
// The first date of the series on or after 'from' (repFirst) or after 'after' (repNext); null for a rule that never matches
function repFirst(s, from){ const r=typeof s==='string'?repParse(s):s; if(!r) return null; let d=from; for(let i=0;i<4000;i++){ if(repHas(r, d)) return d; d=addDays(d,1); } return null; }
const repNext = (s, after) => repFirst(s, addDays(after,1));
const listY = a => a.length<2 ? a.join('') : a.slice(0,-1).join(', ')+' y '+a[a.length-1];
const ORDS={'1':'primer','2':'segundo','3':'tercer','4':'cuarto','-1':'último'};
// The rule in words: "Cada semana, lunes y jueves", "El primer lunes de cada mes"
function repSummary(s){ const r=typeof s==='string'?repParse(s):s; if(!r) return ''; const n=r.n;
  if(r.f==='D') return n===1?'Cada día':'Cada '+n+' días';
  if(r.f==='WD') return 'Cada día laborable';
  if(r.f==='W') return (n===1?'Cada semana':'Cada '+n+' semanas')+', '+(r.days.length===7?'todos los días':listY(r.days.map(d=>DIAS_L[d])));
  if(r.f==='M') return r.day ? (n===1?'Cada mes':'Cada '+n+' meses')+', el día '+r.day : 'El '+ORDS[r.nth]+' '+DIAS_L[r.wd]+(n===1?' de cada mes':' cada '+n+' meses');
  return (n===1?'Cada año':'Cada '+n+' años')+', el '+r.day+' de '+MESES_FULL[r.mo-1]; }
// The quick choices of the Repetir menu, from the task's date (or today): the week, the month and the year take its weekday and day
function repPreset(k, b){ const d=new Date(b+'T00:00:00'), dow=REP_DAYS[d.getDay()];
  return {daily:'D1', work:'WD', week:'W1:'+dow, week2:'W2:'+dow, month:'M1:'+d.getDate(), year:'Y1:'+b.slice(5)}[k]||null; }
function repPresetOf(s){ const r=repParse(s); if(!r) return 'none'; if(r.f==='D'&&r.n===1) return 'daily'; if(r.f==='WD') return 'work';
  if(r.f==='W'&&r.days.length===1&&r.n<=2) return r.n===1?'week':'week2'; if(r.f==='M'&&r.n===1&&r.day) return 'month'; if(r.f==='Y'&&r.n===1) return 'year'; return 'custom'; }
// "mañana", "el lunes 9", "el martes 1 de diciembre": a date said in a sentence
function dayWords(d){ const t=todayStr(); if(d===t) return 'hoy'; if(d===addDays(t,1)) return 'mañana'; const x=new Date(d+'T00:00:00');
  return 'el '+DIAS_L[x.getDay()]+' '+x.getDate()+(d.slice(0,7)!==t.slice(0,7)?' de '+MESES_FULL[x.getMonth()]:'')+(d.slice(0,4)!==t.slice(0,4)?' de '+d.slice(0,4):''); }
const repSeriesId = () => uid().replace(/-/g,'').slice(0,8);
/* Sets or clears the rule (freq: the rule without anchor or series). An undated task gets the first date of the series, today if it matches;
   the anchor is the task's date, so 'every 2 weeks' counts from its week. With Deshacer */
function setRepeat(id, freq){ const x=task(id); if(!x) return; const cur=repParse(x.repeat), old={repeat:x.repeat||null, date:x.date, carried:x.carried};
  if(!freq){ if(!x.repeat) return; updTask(id,{repeat:null}); haptic(6); render(); log('info','Repetición quitada'); toast('Ya no se repite', ()=>updTask(id,{repeat:old.repeat})); return; }
  const r=repParse(freq); if(!r) return; if(cur&&repFreq(cur)===repFreq(r)) return;
  const t=todayStr(); let date=x.date;
  if(!date) date=repFirst(Object.assign({}, r, {n:1, anchor:t}), t); // the first matching day from today; the rhythm then counts from it
  if(!date) return; r.anchor=date; r.series=cur&&cur.series||repSeriesId(); const dated=!x.date;
  updTask(id, Object.assign({repeat:repString(r)}, dated?{date, carried:false}:{})); haptic(8); render(); log('info','Repetición', {rule:repFreq(r)});
  toast('Se repite: '+repSummary(r).replace(/^./, c=>c.toLowerCase())+(dated?', desde '+dayWords(date):''), ()=>updTask(id, old)); }
/* Completing a task of a series creates the next one: the first date of the series after today (after its own date when that is later),
   with its title, project, priority, notes and the reminder's time on the new date; voice notes and attachments stay with the completed one.
   Only the device that completes it does this (a completion that arrives by sync creates nothing), and never a second pending one */
function spawnNext(x){ const r=repParse(x.repeat); if(!r) return null;
  if(r.series&&DB.tasks.some(o=>o!==x&&isOpen(o)&&repSeries(o.repeat)===r.series)) return null; // pending or waiting (decision 41)
  const t=todayStr(), date=repNext(r, x.date&&x.date>t?x.date:t); if(!date) return null;
  let reminder=null; if(x.reminder){ const a=new Date(x.reminder), d=new Date(date+'T00:00:00'); d.setHours(a.getHours(), a.getMinutes(), 0, 0); reminder=d.toISOString(); }
  const dl=dlShift(x, date); // decision 48a: its deadline as far from its date as the completed one's; none when that one had no date
  const n=addTask(Object.assign({title:x.title, spaceId:x.spaceId, projectId:x.projectId, priority:x.priority, notes:x.notes||'', date, reminder, repeat:x.repeat}, dl?{deadline:dl}:{}));
  copySteps(x.id, n.id); // decision 46: its steps, unchecked
  log('info','Siguiente tarea de la serie', {date}); return n; }
// Reopening a completed task of a series (Deshacer, or marking it pending again) takes back the next one it created, while nobody has touched it
function dropNext(x){ const s=repSeries(x.repeat); if(!s||!x.completed) return []; const c=Date.parse(x.completed)-2000;
  const out=DB.tasks.filter(o=>o!==x&&o.status==='pending'&&repSeries(o.repeat)===s&&Date.parse(o.created)>=c&&o.modified===o.created&&!DB.voiceNotes.some(v=>v.taskId===o.id)&&!hasAtt(o.id)&&!stepsTouched(o.id));
  if(out.length){ const ids=new Set(out.map(o=>o.id)); DB.tasks=DB.tasks.filter(o=>!ids.has(o.id)); cutSteps(ids); ids.forEach(i=>HELD.delete(i)); save(); log('info','Siguiente de la serie retirada'); }
  return out; }
// "Eliminar solo esta": the task moves to the next date of its series, with Deshacer (it also leaves Ahora). quiet: the caller gives the feedback
function skipOccurrence(id, quiet){ const x=task(id); if(!x) return null; const r=repParse(x.repeat); if(!r) return null; const t=todayStr(), d=repNext(r, x.date&&x.date>t?x.date:t); if(!d) return null;
  const old=Object.assign(daySnap(x), {focus:x.focus||null, deadline:x.deadline||null}), dl=dlShift(x, d); releaseHold(id); updTask(id, dayPatch(x, d, Object.assign({carried:false, focus:null}, dl?{deadline:dl}:{}))); log('info','Eliminada solo esta de una serie', {to:d}); // decision 48a: the deadline goes along, as for the next one
  const undo=()=>updTask(id, Object.assign({date:old.date, carried:old.carried, reminder:old.reminder, focus:old.focus}, dl?{deadline:old.deadline}:{}));
  if(!quiet){ haptic(14); toast('Eliminada solo esta, la siguiente '+dayWords(d), undo); } return undo; }
/* Two devices that complete the same task of a series while offline each create its next one. When their data meets (a sync, or the
   start), two pending tasks of the same series on the same date are one: the one with the lowest id stays (the same choice on every
   device) and the others are removed as any deletion is, so the server marks them deleted. Different series or dates are never touched.
   W: an object with tasks, voiceNotes, attachments and subtasks (DB, or the working copy of a sync). Returns how many went */
function dedupeSeries(W){ const by=new Map(), out=[];
  W.tasks.forEach(x=>{ if(!x||x.status!=='pending'||!x.date) return; const s=repSeries(x.repeat); if(!s) return; const k=s+'|'+x.date, o=by.get(k);
    if(!o){ by.set(k, x); return; } if(String(x.id)<String(o.id)){ out.push(o); by.set(k, x); } else out.push(x); });
  if(!out.length) return 0; const ids=new Set(out.map(x=>x.id));
  W.tasks=W.tasks.filter(x=>!x||!ids.has(x.id)); W.voiceNotes=W.voiceNotes.filter(v=>!v||!ids.has(v.taskId)); W.attachments=(W.attachments||[]).filter(a=>!a||!ids.has(a.taskId)); if(W.subtasks) W.subtasks=W.subtasks.filter(s=>!s||!ids.has(s.taskId));
  log('info','Tarea repetida de una serie retirada: dos dispositivos crearon la misma siguiente', {ids:[...ids]}); return out.length; }
// After a completion: the toast says when the next one of the series comes
const doneText = (n, nx) => n===1&&nx ? 'Tarea completada, la siguiente '+dayWords(nx.date) : n===1?'Tarea completada':n+' tareas completadas';

/* ---------- Decision 39: Ahora ----------
   Task.focus (Supabase tasks.focus) is when the task was put in Ahora, null otherwise. Up to five pending tasks per space, in the order
   they were put there; the task keeps its date and its place in the lists. Completing it takes it out; the first start of a day empties it */
const AHORA_MAX=5, AHORA_FULL='Ahora ya tiene 5 tareas. Quita una antes.';
function ahoraTasks(spaceId){ const sp=spaceId||space().id; return DB.tasks.filter(x=>x.focus&&x.status==='pending'&&x.spaceId===sp).sort((a,b)=>a.focus<b.focus?-1:a.focus>b.focus?1:0); }
function toggleFocus(id){ const x=task(id); if(!x) return false;
  if(x.focus){ const old=x.focus; updTask(id,{focus:null}); haptic(6); renderAnimated(); toast('Quitada de Ahora', ()=>updTask(id,{focus:old})); return true; }
  if(x.status!=='pending') return false;
  if(ahoraTasks(x.spaceId).length>=AHORA_MAX){ haptic(10); toast(AHORA_FULL); return false; }
  updTask(id,{focus:new Date().toISOString()}); haptic(8); renderAnimated(); log('info','Añadida a Ahora'); toast('Añadida a Ahora', ()=>updTask(id,{focus:null})); return true; }
// Several at once (rows dropped on Ahora, A with a selection on the desktop): all of them or, past five, none
function addToAhora(ids){ const xs=ids.map(task).filter(x=>x&&x.status==='pending'&&!x.focus); if(!xs.length){ render(); return false; }
  if(ahoraTasks(xs[0].spaceId).length+xs.length>AHORA_MAX){ haptic(10); render(); toast(AHORA_FULL); return false; }
  const t0=Date.now(); xs.forEach(x=>releaseHold(x.id)); batch(()=>xs.forEach((x,i)=>updTask(x.id,{focus:new Date(t0+i).toISOString()}))); haptic(8); renderAnimated(); log('info','Añadidas a Ahora', {n:xs.length});
  toast(xs.length===1?'Añadida a Ahora':xs.length+' tareas añadidas a Ahora', ()=>batch(()=>xs.forEach(x=>{ if(task(x.id)) updTask(x.id,{focus:null}); }))); return true; }
function removeFromAhora(ids){ const xs=ids.map(task).filter(x=>x&&x.focus); if(!xs.length) return false; const prev=xs.map(x=>({id:x.id, focus:x.focus}));
  batch(()=>xs.forEach(x=>updTask(x.id,{focus:null}))); haptic(6); renderAnimated(); toast(xs.length===1?'Quitada de Ahora':xs.length+' tareas quitadas de Ahora', ()=>batch(()=>prev.forEach(o=>{ if(task(o.id)) updTask(o.id,{focus:o.focus}); }))); return true; }

/* Decision 41: mark a task Por confirmar (who: Esperando a, optional; date: the review day, undefined to keep the task's date) or edit it.
   It leaves Ahora; its reminder goes with the day (decision 25). With Deshacer */
const waitSnap = x => ({status:x.status, waitingFor:x.waitingFor||null, date:x.date, carried:x.carried, reminder:x.reminder||null, focus:x.focus||null});
function waitUndo(id, o){ const x=task(id); if(!x) return; const p={status:o.status, waitingFor:o.waitingFor, date:o.date, carried:o.carried, reminder:o.reminder}; if(o.focus||x.focus) p.focus=o.focus; updTask(id, p); }
function setWaiting(id, who, date){ const x=task(id); if(!x||x.status==='done') return; const old=waitSnap(x), was=x.status==='waiting';
  const p=Object.assign(date!==undefined&&date!==x.date ? dayPatch(x, date) : {}, {status:'waiting', waitingFor:String(who||'').trim()||null, carried:false}); if(x.focus) p.focus=null;
  releaseHold(id); updTask(id, p); haptic(8); log('info', was?'Por confirmar cambiada':'Por confirmar', {date:x.date});
  const when=x.date&&x.date>todayStr()?', revisar '+dayWords(x.date):x.date?', revisar hoy':'';
  toast('Por confirmar'+(x.waitingFor?', esperando a '+x.waitingFor:'')+when, ()=>waitUndo(id, old)); }
// Volver a pendiente: the task comes back to the lists as it was before it waited (a past date becomes today, carried, as rollOver)
function unWait(id){ const x=task(id); if(!x||x.status!=='waiting') return; const old=waitSnap(x), t=todayStr();
  releaseHold(id); updTask(id, Object.assign(x.date&&x.date<t ? dayPatch(x, t, {carried:true}) : {}, {status:'pending', waitingFor:null})); haptic(6); log('info','Vuelve a pendiente');
  toast('Vuelve a pendiente', ()=>waitUndo(id, old)); }

/* ---------- Actions ---------- */
function addTask(data){
  const t=new Date().toISOString();
  const x = Object.assign({id:uid(), title:'', spaceId:space().id, projectId:null, date:null, reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:t, modified:t, completed:null}, data);
  if(x.projectId){ const p=proj(x.projectId); if(p) x.spaceId=p.spaceId; }
  DB.tasks.push(x); save(); return x;
}
function updTask(id, patch){ const x=task(id); if(!x) return; if('date' in patch && !('carried' in patch)) patch.carried=false;
  // Block 9: a reminder that changes notifies once more (reminderSent cleared), unless it is already past: then it is marked as sent and never notifies
  if('reminder' in patch && !('reminderSent' in patch) && (patch.reminder||null)!==(x.reminder||null)) patch.reminderSent=sentStamp(patch.reminder);
  Object.assign(x, patch, {modified:new Date().toISOString()}); save(); }
/* Decision 25: a task that changes day through rollOver, Aplazar, Pasar lo pendiente a mañana, the reviews, planning, the desktop quick dates
   or a calendar drag takes a reminder set on its old day to the new day, at the same time. If that time has already passed (yesterday's
   tasks rolled over to today), the reminder stays but is marked as sent, so it never notifies. The one helper every one of those paths uses;
   'extra' joins the patch (carried, status). The Fecha and Recordatorio sheets are manual edits and do not use it */
const sentStamp = iso => iso && Date.parse(iso)<=Date.now() ? new Date().toISOString() : null;
function dayPatch(x, date, extra){ const p=Object.assign({date}, extra||{});
  if(x && x.reminder && x.date && date && date!==x.date && localDay(x.reminder)===x.date){ const r=new Date(x.reminder), d=new Date(date+'T00:00:00');
    d.setHours(r.getHours(), r.getMinutes(), r.getSeconds(), r.getMilliseconds()); p.reminder=d.toISOString(); p.reminderSent=sentStamp(p.reminder); }
  return p; }
// What Deshacer needs to put a task back on its day: the date, the Aplazada mark and the reminder (updTask works out reminderSent again)
const daySnap = x => ({id:x.id, date:x.date, carried:x.carried, reminder:x.reminder||null});
const undoDay = o => updTask(o.id, {date:o.date, carried:o.carried, reminder:o.reminder});
/* Roll over: pending tasks dated before today move to today and are flagged as carried.
   Runs at start and whenever the app comes back to the foreground (the day may have changed). */
// It leaves 'modified' alone: every device repeats it, so it must not beat a real edit in an import ('newer wins').
// Decision 39: Ahora empties with the day; a task put there before today goes back to its usual place (focus cleared, modified untouched)
// Decision 38: a carried task of a series stays one task: no copies for the days it missed
function rollOver(){ const t=todayStr(); let n=0, f=0; if(DB.settings.summaryDay!==t){ DB.settings.summaryDay=t; UI.summaryFirst=true; save(); } DB.tasks.forEach(x=>{ if(x.status==='pending'&&x.date&&x.date<t){ Object.assign(x, dayPatch(x, t, {carried:true})); n++; } if(x.focus&&localDay(x.focus)<t){ x.focus=null; f++; } });
  if(f) log('info','Ahora vaciada con el cambio de día', {n:f}); const dd=dedupeSeries(DB); if(n||f||dd) save(); return n; } // decision 38: duplicates of a series, at the start too
/* The data side of completing or reopening, with no feedback. Completing takes the task out of Ahora (decision 39) and, in a series,
   creates the next one (decision 38), which it returns; reopening takes that next one back */
function applyDone(id, done){ const x=task(id); if(!x||(x.status==='done')===done) return null;
  if(done){ updTask(id, Object.assign({status:'done', completed:new Date().toISOString()}, x.focus?{focus:null}:{})); return x.repeat?spawnNext(x):null; }
  dropNext(x); const t=todayStr(); updTask(id, x.date&&x.date<t ? dayPatch(x, t, {status:'pending', completed:null, carried:true}) : {status:'pending', completed:null}); return null; } // a reopened task never comes back overdue (decision 8.5), as rollOver
// Deshacer of a completion: the task pending (or waiting, decision 41) again as it was (in Ahora if it was there), without the next one of its series
function undoDone(o){ const x=task(o.id); if(!x) return; if(x.status==='done'&&o.status!=='done') dropNext(x); const p={status:o.status, completed:o.completed};
  ['date','carried'].forEach(k=>{ if(k in o) p[k]=o[k]; }); if(o.focus||x.focus) p.focus=o.focus||null; updTask(o.id, p); } // focus only when it was or is set: no new key on other tasks
const doneSnap = x => ({id:x.id, status:x.status, completed:x.completed, date:x.date, carried:x.carried, focus:x.focus||null});
function completeTask(id, silent){
  const x=task(id); if(!x) return;
  const was = x.status, prev={id, status:was, completed:null, focus:x.focus||null}; const nx=applyDone(id, was!=='done'); // a waiting task completes too (decision 41)
  if(was!=='done'){ haptic(12); if(!silent) toast(doneText(1, nx), ()=>undoDone(prev)); }
  else haptic(8);
}
/* R1: the circle and the swipe to the right mark a row and leave it where it is, dimmed, for HOLD_MS.
   Each new mark restarts the wait, so several can be marked in a row without the list moving under the finger;
   then all of them leave together, with one toast and one Deshacer. A second tap on a marked row (or a swipe) unmarks it.
   HELD maps a task to the state it is about to take (true: done, false: pending again); rowHTML draws it so,
   whatever renders meanwhile, and the data changes only when the marks settle (flushHeld). */
const HELD=new Map(), HOLD_MS=1500; let heldT=null;
function holdRows(id){ const x=task(id), on=HELD.has(id), d=on?HELD.get(id):!!x&&x.status==='done';
  document.querySelectorAll('.row[data-id="'+id+'"]').forEach(r=>{ r.classList.toggle('held', on); const c=r.querySelector('.check'); if(!c) return; c.classList.toggle('done', d); c.classList.toggle('just', on&&d); }); }
function toggleHold(id){ const x=task(id); if(!x) return;
  if(HELD.has(id)){ HELD.delete(id); haptic(6); } else { HELD.set(id, x.status!=='done'); haptic(x.status==='done'?8:12); }
  holdRows(id); clearTimeout(heldT); heldT=HELD.size?setTimeout(()=>flushHeld(false), HOLD_MS):null; }
// Another action on a marked task (postpone, delete, the row menu) takes it out of the marks first
function releaseHold(id){ if(!HELD.has(id)) return; HELD.delete(id); holdRows(id); if(!HELD.size){ clearTimeout(heldT); heldT=null; } }
// quiet: the app is going to the background or another mode starts; the data is saved at once and drawn without the exit
function flushHeld(quiet){ clearTimeout(heldT); heldT=null; if(!HELD.size) return;
  const items=[...HELD].filter(([id,d])=>{ const x=task(id); return x&&(x.status==='done')!==d; }); HELD.clear();
  if(items.length){ const prev=items.map(([id])=>doneSnap(task(id)));
    let nx=null; batch(()=>items.forEach(([id,d])=>{ const r=applyDone(id,d); if(r) nx=r; }));
    const n=items.filter(([,d])=>d).length; // reopened tasks are drawn back without a toast, as before
    if(n) toast(doneText(n, nx), ()=>batch(()=>prev.forEach(undoDone))); }
  if(quiet||!items.length){ render(); return; }
  items.forEach(([id])=>leaveRows(id)); setTimeout(renderAnimated, 240); }
/* Decision 48a: set or clear the deadline (null clears it), with Deshacer (the pickers offer no past day). The work date, its Aplazada mark and the reminder stay */
function setDeadline(id, d){ const x=task(id); d=d||null; if(!x||(x.deadline||null)===d) return; const old=x.deadline||null; releaseHold(id);
  updTask(id, {deadline:d}); haptic(8); renderAnimated(); log('info', d?'Fecha límite':'Fecha límite quitada', d?{d}:undefined);
  toast(d?'Entrega '+dayWords(d):'Sin fecha límite', ()=>updTask(id, {deadline:old})); }
// Decision 48a: a task of a series keeps its deadline as far from its date as the one before: the deadline for a new date (null without one)
// The offset is measured from the occurrence's own series date (the last one on or before its date), not from a date rollOver or
// Aplazar moved forward: a task carried from Monday to Wednesday keeps its Monday plus two, and the series does not drift
function repOn(x){ const r=repParse(x.repeat); if(!r||!x.date) return x.date; for(let d=x.date, k=0; k<400; k++, d=addDays(d,-1)){ if(r.anchor&&d<r.anchor) break; if(repHas(r, d)) return d; } return x.date; }
const dlShift = (x, date) => { if(!(x.deadline&&x.date&&date)) return null; const base=repOn(x); return addDays(date, dayNum(x.deadline)-dayNum(base)); };
function rescheduleTask(id, date, label){ const x=task(id); if(!x) return; const old=daySnap(x); updTask(id, dayPatch(x, date)); haptic(10); toast('Aplazada a '+label, ()=>undoDay(old)); } // undo gives back the Aplazadas mark and the reminder too
function tomorrowTask(id){ const x=task(id); if(!x) return; const old=daySnap(x); updTask(id, dayPatch(x, addDays(todayStr(),1))); haptic(10); toast('Aplazada a mañana', ()=>undoDay(old)); }
function deleteTask(id){
  const i=DB.tasks.findIndex(t=>t.id===id); if(i<0) return;
  const [x]=DB.tasks.splice(i,1); const vn=DB.voiceNotes.filter(v=>v.taskId===id); DB.voiceNotes=DB.voiceNotes.filter(v=>v.taskId!==id); const at=cutAttachments(new Set([id])), ss=cutSteps(new Set([id])); save(); haptic(14);
  toast('Tarea eliminada', ()=>{ DB.tasks.push(x); DB.voiceNotes.push(...vn); putAttachments(at); putSteps(ss); save(); });
}
function addSpace(name){ const t=new Date().toISOString(); const sp={id:uid(), name, order:DB.spaces.length, created:t, modified:t}; DB.spaces.push(sp); save(); return sp; }
/* Decision 28a: a space goes with everything in it: its projects (archived too), its tasks (completed long ago too) and their voice notes.
   spaceLoad lists them; deleteSpace takes them out in one save and returns what puts them back (null for the only space) */
function spaceLoad(id){ const ps=DB.projects.filter(p=>p.spaceId===id), pids=new Set(ps.map(p=>p.id)); const ts=DB.tasks.filter(x=>x.spaceId===id||(x.projectId&&pids.has(x.projectId))), tids=new Set(ts.map(x=>x.id));
  return {ps, ts, vs:DB.voiceNotes.filter(v=>tids.has(v.taskId)), as:DB.attachments.filter(a=>tids.has(a.taskId)), ss:DB.subtasks.filter(s=>tids.has(s.taskId)), ns:DB.projectNotes.filter(n=>pids.has(n.projectId))}; } // ns: decision 47, the notes of its projects
function deleteSpace(id){ const i=DB.spaces.findIndex(sp=>sp.id===id); if(DB.spaces.length<2||i<0) return null;
  const sp=DB.spaces[i], L=spaceLoad(id), was=DB.settings.activeSpace===id, P=new Set(L.ps), T=new Set(L.ts), V=new Set(L.vs), AT=new Set(L.as), SS=new Set(L.ss);
  DB.spaces.splice(i,1); DB.projects=DB.projects.filter(p=>!P.has(p)); DB.tasks=DB.tasks.filter(x=>!T.has(x)); DB.voiceNotes=DB.voiceNotes.filter(v=>!V.has(v)); DB.attachments=DB.attachments.filter(a=>!AT.has(a)); DB.subtasks=DB.subtasks.filter(s=>!SS.has(s)); cutNotes(new Set(L.ps.map(p=>p.id)));
  L.ts.forEach(x=>HELD.delete(x.id)); if(was){ DB.settings.activeSpace=DB.spaces.slice().sort((a,b)=>a.order-b.order)[0].id; resetListState(); } save();
  return ()=>{ if(DB.spaces.some(x=>x.id===id)) return; DB.spaces.splice(Math.min(i, DB.spaces.length), 0, sp);
    const has=(list, o)=>list.some(x=>x.id===o.id); L.ps.forEach(p=>{ if(!has(DB.projects,p)) DB.projects.push(p); }); L.ts.forEach(x=>{ if(!has(DB.tasks,x)) DB.tasks.push(x); }); L.vs.forEach(v=>{ if(!has(DB.voiceNotes,v)) DB.voiceNotes.push(v); }); L.as.forEach(a=>{ if(!has(DB.attachments,a)) DB.attachments.push(a); }); putSteps(L.ss); putNotes(L.ns);
    if(was){ DB.settings.activeSpace=id; resetListState(); } save(); }; }
function addProject(name, color){ const t=new Date().toISOString(); const p={id:uid(), spaceId:space().id, name, color, order:DB.projects.length, archived:false, created:t, modified:t}; DB.projects.push(p); save(); return p; }
