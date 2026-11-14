// v0.37.4 (decision 84, lote C, U6): on the iPhone Ajustes is an index; its sections live in subscreens (push('settings', key)), the
// theme, the shake gesture and the version stay on the index. openSetting(page, what) shows Ajustes and, on the iPhone, the subscreen
// that holds `what` (a key of SET_SUBS, or a selector found in one of them), as a tap on its index cell does. On the desktop it shows the
// whole page. It resolves to the selector of the screen that shows it, to prefix the test's own selectors.
const ROOT = '.screen.root[data-root=ajustes]', SUB = '.screen.pushed-screen.settings';
async function openSetting(page, what){
  const key = await page.evaluate(w=>{
    if(UI.wide){ setDeskView('settings'); return 'desk'; }
    UI.stack.forEach(s=>s.el.remove()); UI.stack=[]; if(UI.tab!=='ajustes') switchTab('ajustes'); render();
    let k = w && SET_SUBS[w] ? w : null;
    if(!k && w) for(const c of Object.keys(SET_SUBS)){ const d=document.createElement('div'); d.innerHTML=viewAjustes(c); if(d.querySelector(w)){ k=c; break; } }
    if(k){ const cell=document.querySelector('.screen.root[data-root=ajustes] [data-settings="'+k+'"]'); if(cell) cell.click(); else push('settings', k); }
    return k; }, what||null);
  if(key==='desk'){ await page.waitForTimeout(300); return '#desk'; }
  if(!key){ await page.waitForTimeout(400); return ROOT; }
  await page.waitForFunction(()=>{ const s=document.querySelector('.screen.pushed-screen.settings'); return !!s&&s.classList.contains('shown'); }, null, {timeout:5000});
  await page.waitForTimeout(550); // the slide
  return SUB;
}
// A subscreen covers the tab bar, as any pushed screen: leave it (as Atrás would) before tapping a tab
async function closeSetting(page){ await page.evaluate(()=>{ if(UI.wide||!UI.stack.some(s=>s.kind==='settings')) return; UI.stack=UI.stack.filter(s=>{ if(s.kind!=='settings') return true; s.el.remove(); return false; }); render(); }); }
module.exports = { openSetting, closeSetting, SET_ROOT: ROOT, SET_SUB: SUB };
