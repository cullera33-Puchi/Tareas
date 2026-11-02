// Every test writes its screenshots, downloads and logs under tests/out (gitignored), whatever the working directory.
// Relative paths in the scripts (page.screenshot({path:'x.png'}), export.json) resolve there.
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, '..', 'out');
fs.mkdirSync(OUT, { recursive: true });
process.chdir(OUT);
module.exports = OUT;
