// 检查 state.js 文件开头是否有 BOM 或异常字节
const fs = require('fs');
const path = 'c:\\Users\\Windws\\Desktop\\caiwu\\jinrong\\simulation\\js\\state.js';
const buf = fs.readFileSync(path);
console.log('Total bytes:', buf.length);
console.log('First 10 bytes hex:', [...buf.slice(0, 10)].map(b => b.toString(16).padStart(2, '0')).join(' '));
console.log('Has UTF-8 BOM (EF BB BF):', buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF);
// 找出非 ASCII 字符第一次出现的位置
for (let i = 0; i < buf.length; i++) {
  if (buf[i] > 0x7F) {
    console.log(`First non-ASCII byte at offset ${i}: 0x${buf[i].toString(16)}`);
    console.log('Context (20 bytes):', [...buf.slice(Math.max(0, i - 10), i + 10)].map(b => b.toString(16).padStart(2, '0')).join(' '));
    console.log('Context (decoded as UTF-8):', buf.slice(Math.max(0, i - 20), i + 20).toString('utf8'));
    break;
  }
}
// 验证整个文件可以 UTF-8 解码
try {
  const text = buf.toString('utf8');
  console.log('UTF-8 decode: SUCCESS, length:', text.length);
  // 尝试 eval 一段含中文的 FallbackTrace 行
  const sample = text.indexOf('FallbackTrace');
  console.log('First FallbackTrace at char:', sample);
  console.log('Sample line:', text.substring(sample, sample + 100).split('\n')[0]);
} catch (e) {
  console.log('UTF-8 decode FAILED:', e.message);
}
