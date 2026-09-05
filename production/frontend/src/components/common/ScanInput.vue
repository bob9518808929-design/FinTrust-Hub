<!-- 文件名：ScanInput.vue 职责：扫一扫/拍照填空组件,调浏览器相机+BarcodeDetector 提取条码二维码,不可用降级 base64
  -------------------------------------------------------------
  设计哲学 (project_memory 傻瓜式操作):
    责任链工人(仓管/物流)不会打字, 拿手机/扫码枪扫一下就能填空.
    调用浏览器原生 file input + capture, 支持:
      - 拍照 (移动端调相机, 桌面端调摄像头/图片选择)
      - 选择图片文件 (含扫码 PDF)
    自动提取条码/二维码文本 (用浏览器原生 BarcodeDetector API,
    不可用时降级为 base64 占位 + 用户手动复制/OCR 后填).

  使用:
    <ScanInput v-model="invoiceNo" placeholder="扫发票号" />
    <ScanInput
      v-model="containerCode"
      label="集装箱号"
      scan-mode="image"
      @scanned="onScan"
    />
-->
<template>
  <div class="scan-input">
    <el-input
      v-model="localValue"
      :placeholder="placeholder"
      :disabled="disabled"
      class="scan-input-field"
      clearable
    >
      <template #prepend v-if="label">
        <span class="scan-label">{{ label }}</span>
      </template>
      <template #append>
        <!-- 隐藏文件输入, 由按钮触发 -->
        <input
          ref="fileInputRef"
          type="file"
          class="scan-file-input"
          :accept="acceptAttr"
          :capture="captureAttr"
          @change="onFileSelected"
        />
        <el-tooltip :content="scanTooltip" placement="top" effect="dark">
          <el-button
            class="scan-btn"
            :loading="scanning"
            :disabled="disabled"
            @click="triggerScan"
          >
            <el-icon class="scan-icon"><Iphone /></el-icon>
            <span class="scan-text">{{ scanLabel }}</span>
          </el-button>
        </el-tooltip>
      </template>
    </el-input>

    <!-- 已扫预览缩略图 -->
    <div v-if="previewUrl" class="scan-preview">
      <img :src="previewUrl" alt="扫描结果预览" class="preview-img" />
      <el-button
        link
        type="danger"
        size="small"
        :icon="Close"
        @click="clearPreview"
      >
        移除
      </el-button>
    </div>

    <div v-if="scanError" class="scan-error">
      <el-icon><WarningFilled /></el-icon>
      <span>{{ scanError }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Close, Iphone, WarningFilled } from '@element-plus/icons-vue';

const props = withDefaults(
  defineProps<{
    /** 双向绑定文本值 (扫到的条码/二维码字符串) */
    modelValue?: string;
    /** 输入框 label */
    label?: string;
    /** 输入框 placeholder */
    placeholder?: string;
    /** 扫描模式: image=选图/拍照, environment=后置摄像头, user=前置摄像头 */
    scanMode?: 'image' | 'environment' | 'user';
    /** 扫描按钮文案 */
    scanLabel?: string;
    /** 扫描按钮 tooltip */
    scanTooltip?: string;
    /** 是否禁用 */
    disabled?: boolean;
  }>(),
  {
    modelValue: '',
    scanMode: 'image',
    scanLabel: '扫一扫',
    scanTooltip: '点击调用摄像头/选图扫描条码',
    placeholder: '扫码自动填充, 也可手动输入',
    disabled: false,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void;
  (e: 'scanned', payload: { text: string; image?: string }): void;
  (e: 'error', msg: string): void;
}>();

const localValue = computed({
  get: () => props.modelValue,
  set: (v: string) => emit('update:modelValue', v),
});

const fileInputRef = ref<HTMLInputElement | null>(null);
const scanning = ref(false);
const scanError = ref('');
const previewUrl = ref('');

const acceptAttr = computed(() => 'image/*');
const captureAttr = computed(() => {
  // image 模式不强制 capture, 让用户选择文件或拍照
  if (props.scanMode === 'image') return undefined;
  return props.scanMode;
});

function triggerScan() {
  scanError.value = '';
  fileInputRef.value?.click();
}

async function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  // 重置 input 以便同文件可重复扫
  input.value = '';
  if (!file) return;

  scanning.value = true;
  try {
    const imageUrl = URL.createObjectURL(file);
    previewUrl.value = imageUrl;
    const text = await extractTextFromImage(file);
    if (text) {
      localValue.value = text;
      emit('scanned', { text, image: imageUrl });
    } else {
      // 没扫到条码, 仍保留预览让用户手动看
      scanError.value = '未识别出条码/二维码, 请核对图片后手动输入';
      emit('error', scanError.value);
    }
  } catch (err) {
    scanError.value = (err as Error)?.message ?? '扫描失败, 请重试';
    emit('error', scanError.value);
  } finally {
    scanning.value = false;
  }
}

/**
 * 用浏览器原生 BarcodeDetector API 提取条码/二维码文本.
 * 兼容性: Chrome/Edge 88+ (Android), 桌面部分支持.
 * 不可用时返回空, 由 UI 提示用户手动输入.
 */
type DetectedBarcode = { rawValue?: string };
type BarcodeDetectorCtor = new (opts?: unknown) => {
  detect: (source: ImageBitmap) => Promise<DetectedBarcode[]>;
};

async function extractTextFromImage(file: File): Promise<string> {
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  const AnyBarcodeDetector = w.BarcodeDetector;
  if (!AnyBarcodeDetector) {
    return '';
  }
  try {
    const detector = new AnyBarcodeDetector();
    const bitmap = await createImageBitmap(file);
    const codes = await detector.detect(bitmap);
    const first = codes?.[0];
    if (first && first.rawValue) {
      return first.rawValue;
    }
    return '';
  } catch {
    return '';
  }
}

function clearPreview() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = '';
  localValue.value = '';
  scanError.value = '';
}

watch(
  () => props.modelValue,
  (v) => {
    if (!v) clearPreview();
  },
);
</script>

<style lang="scss" scoped>
.scan-input {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;

  .scan-label {
    color: $text-regular;
    font-size: $font-size-sm;
    white-space: nowrap;
  }

  .scan-file-input {
    display: none;
  }

  .scan-btn {
    background: $color-info !important;
    border-color: $color-info !important;
    color: white !important;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 4px;

    &:hover:not(.is-disabled) {
      background: lighten($color-info, 8%) !important;
      border-color: lighten($color-info, 8%) !important;
    }
  }

  .scan-preview {
    display: flex;
    align-items: center;
    gap: $spacing-sm;
    padding: $spacing-xs $spacing-sm;
    background: $bg-tertiary;
    border: 1px solid $border-color;
    border-radius: $radius-base;

    .preview-img {
      width: 64px;
      height: 64px;
      object-fit: cover;
      border-radius: $radius-sm;
      border: 1px solid $border-light;
    }
  }

  .scan-error {
    display: flex;
    align-items: center;
    gap: $spacing-xs;
    color: $color-warning;
    font-size: $font-size-sm;
    padding: $spacing-xs $spacing-sm;
    background: rgba(245, 158, 11, 0.1);
    border-radius: $radius-sm;
  }
}
</style>
