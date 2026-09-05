/**
 * utils/imageCompress.ts — 图片压缩工具 (移动端确权取证)
 *
 * 设计依据: APP02_MOBILE_PLAN.md §4.2 Task 1.6
 *   - Canvas 重绘至最长边 720px (等比缩放)
 *   - toBlob('image/jpeg', 0.6) 输出 < 200KB
 *   - 若输出 > 200KB, 递减质量 0.5 / 0.4 / 0.3 重试
 *   - 同步用 FileReader.readAsDataURL 转 Base64 (供 IndexedDB 队列存储)
 *
 * project_memory 硬约束:
 *   - async/await 风格, 禁止 callback
 *   - 输入非图片或加载失败 → 返回原文件 + 空 base64 + console.warn (降级原则)
 */

export interface CompressedImage {
  /** 压缩后的 Blob (image/jpeg) */
  blob: Blob;
  /** Base64 字符串 (data URL 格式, 可直接用于 <img :src> 或 fetch().blob()) */
  base64: string;
  /** 实际输出宽度 (px) */
  width: number;
  /** 实际输出高度 (px) */
  height: number;
  /** 最终压缩质量 (0~1) */
  quality: number;
}

/** 最长边上限 (px) */
const MAX_EDGE = 720;
/** 输出体积上限 (bytes) */
const MAX_SIZE = 200 * 1024;
/** 质量递减阶梯 */
const QUALITY_STEPS = [0.6, 0.5, 0.4, 0.3];
/** 输入文件大小预检上限 (bytes). 大于此值直接降级, 避免 createImageBitmap OOM */
const INPUT_MAX_SIZE = 20 * 1024 * 1024; // 20MB
/** iOS 默认 HEIC / HEIF MIME. Chrome 等无法原生解码, 需提示用户转 JPEG 后重传 */
const HEIC_MIME_RE = /image\/(hei[cf]|heif-sequence)/i;

/**
 * 将图片文件压缩为 JPEG Blob + Base64 字符串.
 *
 * @param file 输入图片 (image/*)
 * @returns 压缩结果; 失败时返回 { blob: file, base64: '', width:0, height:0, quality:0 } + console.warn
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  // 1. 输入校验: 非图片直接降级
  if (!file.type.startsWith('image/')) {
    console.warn('[imageCompress] 输入非图片类型, 跳过压缩:', file.type, file.name);
    return { blob: file, base64: '', width: 0, height: 0, quality: 0 };
  }

  // 1b. 预检: iOS HEIC/HEIF 无法在 Chrome/Android 原生解码, 直接降级 + 明确提示
  if (HEIC_MIME_RE.test(file.type)) {
    console.warn(
      `[imageCompress] 检测到 HEIC/HEIF 格式 (${file.type}), 当前浏览器不支持解码, ` +
      `请在 iOS 相机设置中切换为 "兼容性最佳" (JPEG) 或拍照后再导入.`,
    );
    return { blob: file, base64: '', width: 0, height: 0, quality: 0 };
  }

  // 1c. 预检: 超大文件避免 createImageBitmap 浏览器 OOM, 直接降级
  if (file.size > INPUT_MAX_SIZE) {
    console.warn(
      `[imageCompress] 输入文件过大 ${Math.round(file.size / 1024 / 1024)}MB ` +
      `> ${INPUT_MAX_SIZE / 1024 / 1024}MB 上限, 跳过压缩避免 OOM`,
    );
    return { blob: file, base64: '', width: 0, height: 0, quality: 0 };
  }

  // 2. 加载图片为 ImageBitmap (失败回退 createObjectURL + Image)
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch (e) {
    // createImageBitmap 不支持时回退到 Image + createObjectURL
    bitmap = null;
  }

  let imgWidth: number;
  let imgHeight: number;
  let drawSource: CanvasImageSource;

  if (bitmap) {
    imgWidth = bitmap.width;
    imgHeight = bitmap.height;
    drawSource = bitmap;
  } else {
    // 回退路径: URL.createObjectURL + Image
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      imgWidth = img.naturalWidth || img.width;
      imgHeight = img.naturalHeight || img.height;
      drawSource = img;
    } catch (e) {
      // 真实降级: 图片损坏 / Safari 隐私模式 / HEIC 漏网 → 不抛错, 回原文件
      console.warn('[imageCompress] Image 加载失败, 降级返回原文件:', e);
      return { blob: file, base64: '', width: 0, height: 0, quality: 0 };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // 3. 等比缩放: 最长边 > 720 时缩放, 否则保持原尺寸
  const scale = Math.min(1, MAX_EDGE / Math.max(imgWidth, imgHeight));
  const outW = Math.max(1, Math.round(imgWidth * scale));
  const outH = Math.max(1, Math.round(imgHeight * scale));

  // 4. Canvas 重绘
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.warn('[imageCompress] Canvas 2D context 不可用, 跳过压缩');
    return { blob: file, base64: '', width: 0, height: 0, quality: 0 };
  }
  // 白底 (避免 PNG 透明区域在 JPEG 转换后变黑)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(drawSource, 0, 0, outW, outH);

  // 释放 bitmap
  if (bitmap && 'close' in bitmap) bitmap.close();

  // 5. 递减质量 toBlob, 直到 < 200KB 或质量阶梯用尽
  let blob: Blob | null = null;
  let usedQuality: number = QUALITY_STEPS[QUALITY_STEPS.length - 1] ?? 0.3;
  for (const q of QUALITY_STEPS) {
    blob = await canvasToBlob(canvas, 'image/jpeg', q);
    if (blob && blob.size <= MAX_SIZE) {
      usedQuality = q;
      break;
    }
    if (blob) {
      // 记录当前质量, 后续若仍超限则用最小质量的结果
      usedQuality = q;
    }
  }

  if (!blob) {
    console.warn('[imageCompress] canvas.toBlob 全部失败, 跳过压缩');
    return { blob: file, base64: '', width: 0, height: 0, quality: 0 };
  }

  // 6. Base64 转换 (FileReader.readAsDataURL)
  let base64 = '';
  try {
    base64 = await blobToBase64(blob);
  } catch (e) {
    console.warn('[imageCompress] Base64 转换失败, 返回空 base64:', e);
  }

  return { blob, base64, width: outW, height: outH, quality: usedQuality };
}

/** Canvas.toBlob 的 Promise 包装 (避免 callback 风格) */
function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (b) => resolve(b),
      type,
      quality,
    );
  });
}

/** Blob → Base64 data URL (FileReader 包装) */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Image.onload 的 Promise 包装 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}
