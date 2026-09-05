/**
 * imageCompress 单元测试 - 覆盖容错路径
 *
 * 用 vitest + jsdom, mock canvas/blob/fileReader API
 * 覆盖:
 *   1. 输入非图片 → 降级返回原文件 + 空 base64
 *   2. createImageBitmap 成功 → 走主路径
 *   3. createImageBitmap 失败 → 走 URL.createObjectURL + Image 回退
 *   4. canvas.toBlob 失败 → 降级返回原文件
 *   5. 正常输入 → 返回 { blob, base64, width, height, quality }
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock canvas + ImageBitmap + File + FileReader
class MockImageBitmap {
  width = 64;
  height = 64;
  close() {}
}

class MockImage {
  naturalWidth = 64;
  naturalHeight = 64;
  width = 64;
  height = 64;
  src = '';
  onload: (() => void) | null = null;
  onerror: ((e: any) => void) | null = null;
}

class MockFileReader {
  result: string | ArrayBuffer | null = null;
  onload: (() => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  readAsDataURL(_blob: Blob) {
    this.result = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    setTimeout(() => this.onload?.(), 0);
  }
}

class MockCanvas {
  width = 0;
  height = 0;
  getContext() {
    return {
      fillStyle: '',
      fillRect: () => {},
      drawImage: () => {},
    };
  }
  toBlob(cb: (b: Blob | null) => void, _type: string, _quality: number) {
    // 模拟成功生成 blob
    cb(new Blob(['mock-jpeg-data'], { type: 'image/jpeg' }));
  }
}

// 全局 mock
const g = globalThis as any;
g.ImageBitmap = MockImageBitmap;
g.Image = MockImage;
g.FileReader = MockFileReader;
g.HTMLCanvasElement = MockCanvas;
g.document = {
  createElement: (_tag: string) => new MockCanvas(),
};
g.URL = {
  createObjectURL: () => 'blob:mock',
  revokeObjectURL: () => {},
};
g.createImageBitmap = vi.fn();

import { compressImage } from '../../src/utils/imageCompress';

describe('imageCompress 容错路径', () => {

  beforeEach(() => {
    g.createImageBitmap.mockReset();
  });

  it('1. 输入非图片 → 降级返回原文件 + 空 base64', async () => {
    const file = new File(['x'], 'test.txt', { type: 'text/plain' });
    const result = await compressImage(file);
    expect(result.blob).toBe(file);
    expect(result.base64).toBe('');
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
    expect(result.quality).toBe(0);
  });

  it('2. createImageBitmap 成功 → 走主路径返回压缩图', async () => {
    g.createImageBitmap.mockResolvedValue(new MockImageBitmap());
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
    const result = await compressImage(file);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe('image/jpeg');
    expect(result.base64).toContain('data:image/jpeg;base64,');
    expect(result.width).toBe(64);
    expect(result.height).toBe(64);
    expect(result.quality).toBe(0.6);
  });

  it('3. createImageBitmap 失败 → 走 URL.createObjectURL + Image 回退', async () => {
    g.createImageBitmap.mockRejectedValue(new Error('not supported'));
    // mock Image.onload 立即触发
    const origImage = g.Image;
    g.Image = class extends MockImage {
      constructor() {
        super();
        setTimeout(() => this.onload?.(), 0);
      }
    };
    try {
      const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
      const result = await compressImage(file);
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.base64).toContain('data:image/jpeg;base64,');
      expect(result.width).toBe(64);
    } finally {
      g.Image = origImage;
    }
  });

  it('4. canvas.toBlob 全部失败 → 降级返回原文件', async () => {
    g.createImageBitmap.mockResolvedValue(new MockImageBitmap());
    // mock canvas.toBlob 失败
    const origCreateElement = g.document.createElement;
    g.document.createElement = (_tag: string) => {
      const c = new MockCanvas();
      c.toBlob = (cb: (b: Blob | null) => void) => cb(null);
      return c;
    };
    try {
      const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
      const result = await compressImage(file);
      expect(result.blob).toBe(file);
      expect(result.base64).toBe('');
      expect(result.quality).toBe(0);
    } finally {
      g.document.createElement = origCreateElement;
    }
  });

  it('5. 正常输入 → 返回完整 CompressedImage 对象', async () => {
    g.createImageBitmap.mockResolvedValue(new MockImageBitmap());
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
    const result = await compressImage(file);
    expect(result).toHaveProperty('blob');
    expect(result).toHaveProperty('base64');
    expect(result).toHaveProperty('width');
    expect(result).toHaveProperty('height');
    expect(result).toHaveProperty('quality');
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.base64.length).toBeGreaterThan(0);
    expect(result.quality).toBeGreaterThanOrEqual(0.3);
    expect(result.quality).toBeLessThanOrEqual(0.6);
  });

  it('6. HEIC/HEIF 格式 → 直接降级返回原文件 (Chrome 无法解码)', async () => {
    const file = new File(['x'], 'IMG_0001.HEIC', { type: 'image/heic' });
    const result = await compressImage(file);
    expect(result.blob).toBe(file);
    expect(result.base64).toBe('');
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
    expect(result.quality).toBe(0);
  });

  it('7. 输入 > 20MB 大文件 → 预检 OOM 降级, 不调用 createImageBitmap', async () => {
    const gMock = vi.fn();
    const orig = g.createImageBitmap;
    g.createImageBitmap = gMock;
    try {
      // 创建一个大小为 20MB + 1 字节的 File (File 构造器第1参 chunks 决定 size)
      const bigBuf = new ArrayBuffer(20 * 1024 * 1024 + 1);
      const bigFile = new File([bigBuf], 'huge.jpg', { type: 'image/jpeg' });
      const result = await compressImage(bigFile);
      expect(result.blob).toBe(bigFile);
      expect(result.base64).toBe('');
      expect(result.width).toBe(0);
      expect(gMock).not.toHaveBeenCalled();
    } finally {
      g.createImageBitmap = orig;
    }
  });

  it('8. createImageBitmap 失败且 Image.onerror 触发 → 真实环境降级 (修复前会抛错)', async () => {
    g.createImageBitmap.mockRejectedValue(new Error('not supported'));
    const origImage = g.Image;
    g.Image = class extends MockImage {
      constructor() {
        super();
        setTimeout(() => this.onerror?.(new Error('corrupted image')), 0);
      }
    };
    try {
      const file = new File(['bad-data'], 'corrupted.jpg', { type: 'image/jpeg' });
      // 修复前: 未 catch, await 会 reject → 测试抛错
      // 修复后: try/catch 降级, 返回原文件
      const result = await compressImage(file);
      expect(result.blob).toBe(file);
      expect(result.base64).toBe('');
      expect(result.width).toBe(0);
      expect(result.height).toBe(0);
      expect(result.quality).toBe(0);
    } finally {
      g.Image = origImage;
    }
  });
});
