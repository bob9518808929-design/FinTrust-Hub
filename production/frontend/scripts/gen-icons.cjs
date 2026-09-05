/**
 * gen-icons.cjs — 生成 PWA 占位图标 (纯色 PNG, 背景 #0ea5e9 + 白色 "FT" 像素字样)
 *
 * 无外部依赖, 仅用 Node.js 内置 zlib + 手写 PNG 编码.
 * 生成: public/icons/icon-192.png, public/icons/icon-512.png
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 表
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// 5x7 像素字体 (F, T) — 简化点阵, 1=填充
const FONT = {
  F: [
    [1,1,1,1,1],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,1,1,1,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
  ],
  T: [
    [1,1,1,1,1],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
  ],
};

function generatePng(size, bgColor, fgColor) {
  // 背景
  const pixels = new Uint8Array(size * size * 4); // RGBA
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4 + 0] = bgColor[0];
    pixels[i * 4 + 1] = bgColor[1];
    pixels[i * 4 + 2] = bgColor[2];
    pixels[i * 4 + 3] = 255;
  }

  // 居中绘制 "FT" — 字符像素放大 scale 倍
  const charW = 5, charH = 7, gap = 1;
  const textW = charW * 2 + gap; // "F" + gap + "T"
  const scale = Math.floor(size / (textW + 4)); // 留边
  if (scale < 1) {
    // 太小, 跳过文字, 仅纯色
  } else {
    const drawW = textW * scale;
    const drawH = charH * scale;
    const offX = Math.floor((size - drawW) / 2);
    const offY = Math.floor((size - drawH) / 2);

    function drawChar(ch, xOff) {
      const grid = FONT[ch];
      for (let r = 0; r < charH; r++) {
        for (let c = 0; c < charW; c++) {
          if (grid[r][c]) {
            for (let dy = 0; dy < scale; dy++) {
              for (let dx = 0; dx < scale; dx++) {
                const px = xOff + c * scale + dx;
                const py = offY + r * scale + dy;
                if (px >= 0 && px < size && py >= 0 && py < size) {
                  const idx = (py * size + px) * 4;
                  pixels[idx + 0] = fgColor[0];
                  pixels[idx + 1] = fgColor[1];
                  pixels[idx + 2] = fgColor[2];
                  pixels[idx + 3] = 255;
                }
              }
            }
          }
        }
      }
    }

    drawChar('F', offX);
    drawChar('T', offX + (charW + gap) * scale);
  }

  // 构造扫描行 (每行前加 filter byte 0)
  const rowLen = size * 4;
  const raw = Buffer.alloc((rowLen + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (rowLen + 1)] = 0; // filter: None
    const srcStart = y * rowLen;
    Buffer.from(pixels.buffer, srcStart, rowLen).copy(raw, y * (rowLen + 1) + 1);
  }

  const compressed = zlib.deflateSync(raw);

  // PNG 签名
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.resolve(__dirname, '../public/icons');
fs.mkdirSync(outDir, { recursive: true });

const bg = [0x0e, 0xa5, 0xe9]; // #0ea5e9
const fg = [0xff, 0xff, 0xff];  // white

fs.writeFileSync(path.join(outDir, 'icon-192.png'), generatePng(192, bg, fg));
fs.writeFileSync(path.join(outDir, 'icon-512.png'), generatePng(512, bg, fg));

console.log('Generated: public/icons/icon-192.png, public/icons/icon-512.png');
