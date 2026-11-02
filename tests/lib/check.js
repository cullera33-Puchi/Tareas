// Reads one test's output and decides pass or fail, the same way the old scratchpad summary did, but strictly:
// every "errors..." and "fails..." array printed by the test must be empty. The "settings" test throws "Error de prueba"
// on purpose to check the log, so there the only accepted entries are that error.
// Usage: node check.js <test name> <output file> <exit code>. Prints one summary line; exit 0 on pass.
const fs = require('fs');
const [name, file, code] = process.argv.slice(2);
const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
// String-aware scan for the array that follows each "errors*" or "fails*" key
function arrays(src) {
  const out = [], re = /"((?:errors|fails)[A-Za-z_]*)"\s*:\s*\[/g; let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length - 1, depth = 0, inStr = false, esc = false, end = -1;
    for (; i < src.length; i++) {
      const c = src[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === '[') depth++; else if (c === ']') { depth--; if (!depth) { end = i; break; } }
    }
    if (end < 0) { out.push({ key: m[1], value: null }); continue; }
    let value = null; try { value = JSON.parse(src.slice(m.index + m[0].length - 1, end + 1)); } catch (e) {}
    out.push({ key: m[1], value });
  }
  return out;
}
const found = arrays(text), problems = [];
if (+code !== 0) problems.push('exit ' + code);
if (!found.length) problems.push('no errors array printed');
for (const { key, value } of found) {
  if (!Array.isArray(value)) { problems.push(key + ' unreadable'); continue; }
  const bad = name === 'settings' && key === 'errors' ? value.filter(e => !/Error de prueba/.test(String(e))) : value;
  if (name === 'settings' && key === 'errors' && !value.length) problems.push('expected "Error de prueba" missing');
  if (bad.length) problems.push(key + ': ' + JSON.stringify(bad).slice(0, 300));
}
const first = (text.match(/^.*(Timeout|Error:|TypeError).*$/m) || [''])[0].slice(0, 160);
if (problems.length && first) problems.push(first.trim());
console.log(problems.length ? 'FAIL ' + problems.join(' | ') : 'ok' + (name === 'settings' ? ' (expected "Error de prueba")' : ''));
process.exit(problems.length ? 1 : 0);
