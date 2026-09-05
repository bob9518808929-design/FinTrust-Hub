// 检查所有 JS 文件中是否有浏览器不友好的特殊字符
const fs = require('fs');
const path = require('path');
const jsDir = 'c:\\Users\\Windws\\Desktop\\caiwu\\jinrong\\simulation\\js';
const files = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));

const problematic = [
  { code: 0x2028, name: 'U+2028 LINE SEPARATOR' },
  { code: 0x2029, name: 'U+2029 PARAGRAPH SEPARATOR' },
  { code: 0xFEFF, name: 'U+FEFF BOM/ZWNBSP' },
  { code: 0x0000, name: 'NULL' },
  { code: 0x0007, name: 'BEL' },
  { code: 0x000B, name: 'VT' },
  { code: 0x000C, name: 'FF' },
];

let totalIssues = 0;
for (const f of files) {
  const fp = path.join(jsDir, f);
  const buf = fs.readFileSync(fp);
  const text = buf.toString('utf8');
  const issues = [];
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i);
    const p = problematic.find(x => x.code === cp);
    if (p) {
      issues.push({ offset: i, code: p.name, context: text.substring(Math.max(0, i - 30), i + 30) });
    }
    if (cp > 0xFFFF) i++; // surrogate pair
  }
  if (issues.length > 0) {
    console.log(`\n=== ${f} (${issues.length} issues) ===`);
    issues.slice(0, 5).forEach((x, idx) => {
      console.log(`  [${idx + 1}] offset=${x.offset} ${x.code}`);
      console.log(`      context: ${JSON.stringify(x.context)}`);
    });
    totalIssues += issues.length;
  } else {
    console.log(`  ${f}: CLEAN (no problematic chars)`);
  }
}
console.log(`\nTotal issues: ${totalIssues}`);
