/**
 * 生成移动端测试二维码 (高清版)
 * 输出: public/qr-*.png + tests/manual/_artifacts/qr-cards.png
 */
import QRCode from 'qrcode';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE = 'http://192.168.1.9:5173';
const PUBLIC = 'c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/public';
const ARTIFACTS = 'tests/manual/_artifacts';
if (!existsSync(ARTIFACTS)) mkdirSync(ARTIFACTS, { recursive: true });

const targets = [
  { name: 'qr-worker-login',  url: `${BASE}/m/login`, label: '工人登录入口', desc: '企业码 E001 + 工号 W01' },
  { name: 'qr-worker-scan',    url: `${BASE}/m/scan`,  label: '扫码确权',     desc: '登录后自动跳转此页' },
  { name: 'qr-worker-pts',     url: `${BASE}/m/pts`,   label: '积分钱包',     desc: '需先登录' },
  { name: 'qr-worker-bot',    url: `${BASE}/m/bot`,   label: '我的分身',     desc: 'AI 助理 Bot' },
];

const QR_OPTS = {
  errorCorrectionLevel: 'M',  // 30% 纠错, 扫描更稳
  width: 600,                 // 高清 600px
  margin: 4,                  // 标准白边
  color: { dark: '#020617', light: '#ffffff' },  // 深空黑码点
};

for (const t of targets) {
  const pubPath = join(PUBLIC, `${t.name}.png`);
  const artPath = join(ARTIFACTS, `${t.name}.png`);
  await QRCode.toFile(pubPath, t.url, QR_OPTS);
  await QRCode.toFile(artPath, t.url, QR_OPTS);
  console.log(`✅ ${t.label}: ${t.url}`);
  console.log(`   📁 ${pubPath}`);
  console.log(`   📁 ${artPath}`);
  console.log(`   💡 ${t.desc}\n`);
}

console.log('=== 全部生成完毕 ===');
console.log('\n浏览器访问: http://localhost:5173/qr-worker-login.png');
console.log('手机扫一扫 public/qr-worker-login.png 即可');
