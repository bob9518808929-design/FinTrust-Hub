"""
生成移动端测试二维码 (高清版)
输出: public/qr-*.png + tests/manual/_artifacts/qr-*.png
"""
import qrcode
from PIL import Image, ImageDraw, ImageFont
import os

BASE = 'http://192.168.1.9:5173'
PUBLIC = r'c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/public'
ARTIFACTS = r'c:/Users/Windws/Desktop/caiwu/jinrong/production/frontend/tests/manual/_artifacts'
os.makedirs(ARTIFACTS, exist_ok=True)

targets = [
    ('qr-worker-login',  f'{BASE}/m/login', '工人登录入口', '企业码 E001 + 工号 W01'),
    ('qr-worker-scan',    f'{BASE}/m/scan',  '扫码确权',     '登录后自动跳转此页'),
    ('qr-worker-pts',     f'{BASE}/m/pts',   '积分钱包',     '需先登录'),
    ('qr-worker-bot',     f'{BASE}/m/bot',   '我的分身',     'AI 助理 Bot'),
]

QR_OPTS = qrcode.QRCode(
    version=None,  # 自动版本
    error_correction=qrcode.constants.ERROR_CORRECT_M,  # 30% 纠错
    box_size=14,   # 每模块 14px (高清)
    border=4,      # 标准白边
)

print('=== 生成移动端测试二维码 ===\n')
for name, url, label, desc in targets:
    QR_OPTS.clear()
    QR_OPTS.add_data(url)
    QR_OPTS.make(fit=True)
    img = QR_OPTS.make_image(fill_color='#020617', back_color='white').convert('RGB')

    # 加标签
    canvas = Image.new('RGB', (img.width + 40, img.height + 80), 'white')
    canvas.paste(img, (20, 20))
    draw = ImageDraw.Draw(canvas)
    try:
        font_label = ImageFont.truetype('arial.ttf', 28)
        font_desc = ImageFont.truetype('arial.ttf', 20)
    except:
        font_label = ImageFont.load_default()
        font_desc = ImageFont.load_default()

    # 标签文字
    draw.text((20, img.height + 30), label, fill='#020617', font=font_label)
    draw.text((20, img.height + 58), desc, fill='#64748b', font=font_desc)

    pub_path = os.path.join(PUBLIC, f'{name}.png')
    art_path = os.path.join(ARTIFACTS, f'{name}.png')
    canvas.save(pub_path, 'PNG')
    canvas.save(art_path, 'PNG')
    print(f'✅ {label}: {url}')
    print(f'   📁 {pub_path}')
    print(f'   📁 {art_path}')
    print(f'   💡 {desc}\n')

print('=== 全部生成完毕 ===')
print('\n浏览器访问: http://localhost:5173/qr-worker-login.png')
print('手机扫一扫或浏览器打开图片, 微信扫一扫可直接识别')
