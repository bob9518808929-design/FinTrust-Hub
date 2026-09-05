<!--
  ScanConfirmView.vue — APP-02 扫码确权页 (PWA MVP)
  -------------------------------------------------------------
  设计依据: APP02_MOBILE_PLAN.md §4.2 Task 3 + spec.md L2734-L2740
  4 步状态机: scan → photo → confirm (阻塞模态) → done
  复用 ScanInput (v-model + @scanned) 扫码识别物料 ID;
  三模定位兜底 (GPS / WiFi 指纹 / 手工修正) + 围栏校验;
  拍照取证 → compressImage 压至 < 200KB + Base64;
  提交走 awardPointsMobile 适配层 (multipart 上传, 非直接调 ptsAwardPoints);
  网络失败入 indexedDbQueue, onActivated + window.online 触发 flushPending;
  语音播报 useSpeech (speechSupported=false 时静默降级).

  project_memory 硬约束:
    - async/await, 禁止 callback
    - 阻塞模态窗 z-index=10000 (显式 inline style, 不依赖 variables.scss $z-modal=9000)
    - toast z-index=9500 (ElMessage customClass + 全局 style 覆盖)
    - 拇指热区: 主操作按钮位于屏幕底部 1/3
    - 重复点击 toast "无需重复操作"
    - 资源 URL 加 ?v=22
-->
<template>
  <div class="scan-confirm-view">
    <!-- 顶部: 待上传横幅 + 语音开关 -->
    <div v-if="pendingCount > 0" class="pending-banner" role="status">
      <span class="pending-text">待上传 {{ pendingCount }} 条</span>
      <button class="flush-btn" type="button" :disabled="flushing" @click="onFlush">
        {{ flushing ? '同步中...' : '立即同步' }}
      </button>
    </div>

    <button
      v-if="speechSupported"
      class="voice-toggle"
      type="button"
      :aria-pressed="voiceEnabled"
      @click="toggleVoice"
    >
      {{ voiceEnabled ? '关闭语音' : '开启语音' }}
    </button>

    <!-- 步骤 1: 扫码 -->
    <section v-if="step === 'scan'" class="step step-scan">
      <h2 class="step-title">扫码确权</h2>
      <p class="step-hint">对准物料条码扫描</p>
      <ScanInput
        v-model="scanText"
        label="物料码"
        placeholder="扫一扫自动识别 (无需手动输入)"
        scan-label="扫码"
        scan-tooltip="点击调用摄像头扫描物料条码"
        :disabled="submitting"
        @scanned="onScanned"
        @error="onScanError"
      />
      <div v-if="pendingCount > 0" class="resume-hint">
        检测到 {{ pendingCount }} 条未同步确权, 联网后自动上送
      </div>
    </section>

    <!-- 步骤 2: 拍照取证 + 定位 -->
    <section v-else-if="step === 'photo'" class="step step-photo">
      <h2 class="step-title">拍照取证</h2>
      <div class="material-info">
        <span class="mi-label">物料码:</span>
        <strong class="mi-value">{{ materialId }}</strong>
      </div>

      <!-- 拍照按钮 (label 包裹 input, 拇指热区大) -->
      <label class="photo-capture-btn" :class="{ disabled: photoDisabled }">
        <input
          ref="photoInputRef"
          type="file"
          accept="image/*"
          capture="environment"
          :disabled="photoDisabled"
          @change="onPhoto"
        />
        <span class="capture-label">{{ compressed ? '重新拍照' : '点击拍照取证' }}</span>
      </label>

      <!-- 照片预览 -->
      <div v-if="compressed" class="photo-preview">
        <img :src="compressed.base64" alt="取证照片预览" class="preview-img" />
        <div class="preview-meta">
          {{ compressed.width }}×{{ compressed.height }} · q={{ compressed.quality }} ·
          {{ Math.round(compressed.blob.size / 1024) }}KB
        </div>
      </div>

      <!-- 定位信息 -->
      <div class="location-info">
        <div class="loc-row">
          <span class="loc-label">定位:</span>
          <span v-if="location.type === 'gps'" class="loc-value">
            GPS {{ location.value }}
            <span v-if="gpsAccuracy !== null" class="loc-acc">(±{{ gpsAccuracy.toFixed(0) }}m)</span>
          </span>
          <span v-else-if="location.type === 'wifi'" class="loc-value">
            WiFi 指纹 {{ location.value }}
          </span>
          <span v-else class="loc-value loc-manual">手工 {{ location.value }}</span>
        </div>

        <!-- 手工修正表单 (仅 needsManual=true 显示) -->
        <div v-if="location.type === 'manual'" class="manual-form">
          <label class="manual-field">
            <span>纬度</span>
            <input
              v-model.number="manualLat"
              type="number"
              step="0.0001"
              :disabled="submitting"
              @change="onManualChange"
            />
          </label>
          <label class="manual-field">
            <span>经度</span>
            <input
              v-model.number="manualLng"
              type="number"
              step="0.0001"
              :disabled="submitting"
              @change="onManualChange"
            />
          </label>
        </div>

        <button
          v-if="needsManual && location.type !== 'manual'"
          class="manual-btn"
          type="button"
          @click="enterManual"
        >
          定位不准，请手工修正
        </button>

        <div v-if="!inFence" class="loc-warn" role="alert">
          超出作业范围 (距围栏中心 {{ Math.round(distanceToFence) }}m &gt; {{ FENCE.radius }}m)
        </div>
      </div>

      <!-- 底部 1/3 区域的主操作按钮 (拇指热区) -->
      <div class="action-row">
        <button class="btn-secondary" type="button" :disabled="submitting" @click="backToScan">
          返回扫码
        </button>
        <button
          class="btn-primary"
          type="button"
          :disabled="!canSubmit"
          @click="openConfirm"
        >
          {{ compressed ? '确认提交' : '完成拍照后提交' }}
        </button>
      </div>
    </section>

    <!-- 步骤 3: 阻塞模态窗二次确认 (z-index=10000 显式 inline) -->
    <div
      v-if="showConfirmModal"
      class="confirm-modal"
      style="z-index: 10000"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div class="confirm-mask"></div>
      <div class="confirm-box">
        <h3 id="confirm-title" class="confirm-title">确认确权</h3>
        <dl class="confirm-details">
          <div><dt>物料码</dt><dd>{{ materialId }}</dd></div>
          <div><dt>定位</dt><dd>{{ location.type.toUpperCase() }} {{ location.value }}</dd></div>
          <div v-if="compressed"><dt>照片</dt><dd>{{ Math.round(compressed.blob.size / 1024) }}KB</dd></div>
          <div><dt>围栏</dt><dd>{{ inFence ? '在围栏内' : '超出围栏' }}</dd></div>
        </dl>
        <div class="confirm-actions">
          <button class="btn-secondary" type="button" :disabled="submitting" @click="cancelConfirm">
            取消
          </button>
          <button class="btn-primary" type="button" :disabled="submitting" @click="doSubmit">
            {{ submitting ? '提交中...' : '确认确权' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 步骤 4: 完成 -->
    <section v-else-if="step === 'done'" class="step step-done">
      <h2 class="step-title">确权成功</h2>
      <p v-if="lastAwarded !== null" class="done-awarded">
        积分到账 +{{ lastAwarded }} 分
      </p>
      <p v-else class="done-awarded">确权已记录, 待联网上送</p>
      <button class="btn-primary continue-btn" type="button" @click="resetToScan">
        继续扫码
      </button>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onUnmounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import ScanInput from '@/components/common/ScanInput.vue';
import { useWorkerAuth } from '@/composables/useWorkerAuth';
import { useSpeech } from '@/composables/useSpeech';
import { usePendingSync, awardPointsMobile } from '@/composables/usePendingSync';
import { compressImage, type CompressedImage } from '@/utils/imageCompress';
import * as queue from '@/utils/indexedDbQueue';
import { QueueFullError } from '@/utils/indexedDbQueue';

defineOptions({ name: 'ScanConfirmView' });

const { workerId } = useWorkerAuth();
const { speechSupported, voiceEnabled, speak, toggleVoice } = useSpeech();
const { flushPending, dispose: disposeSync } = usePendingSync();

// === 状态机 ===
type Step = 'scan' | 'photo' | 'confirm' | 'done';
const step = ref<Step>('scan');

const scanText = ref('');
const materialId = ref('');
const compressed = ref<CompressedImage | null>(null);
const photoDisabled = ref(false);
const photoInputRef = ref<HTMLInputElement | null>(null);
const submitting = ref(false);
const showConfirmModal = ref(false);
const lastAwarded = ref<number | null>(null);
const pendingCount = ref(0);
const flushing = ref(false);

// === 围栏配置 (MVP 硬编码, TODO 后续从 GET /eco-pts/workers/{workerId}/geofence 拉取) ===
const FENCE = { lat: 31.2304, lng: 121.4737, radius: 100 };
const STATION_CENTER = { lat: 31.2304, lng: 121.4737 };

// === 定位状态 ===
interface LocState {
  type: 'gps' | 'wifi' | 'manual';
  value: string;
}
const location = ref<LocState>({ type: 'manual', value: `${STATION_CENTER.lat},${STATION_CENTER.lng}` });
const needsManual = ref(false);
const gpsAccuracy = ref<number | null>(null);
const manualLat = ref<number>(STATION_CENTER.lat);
const manualLng = ref<number>(STATION_CENTER.lng);

// === 计算属性 ===
const distanceToFence = computed(() => {
  const [lat, lng] = parseLatLng(location.value);
  if (lat === null || lng === null) return Infinity;
  return distanceMeters(lat, lng, FENCE.lat, FENCE.lng);
});

const inFence = computed(() => distanceToFence.value <= FENCE.radius);

const canSubmit = computed(() => {
  return (
    !!materialId.value &&
    !!compressed.value &&
    !!compressed.value.base64 &&
    inFence.value &&
    !submitting.value &&
    !photoDisabled.value
  );
});

// === 工具函数 ===
function parseLatLng(loc: LocState): [number | null, number | null] {
  if (loc.type === 'manual') return [manualLat.value, manualLng.value];
  const parts = loc.value.split(',');
  const lat = parseFloat(parts[0] ?? '');
  const lng = parseFloat(parts[1] ?? '');
  if (Number.isNaN(lat) || Number.isNaN(lng)) return [null, null];
  return [lat, lng];
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // 地球半径 (m)
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function toast(
  message: string,
  type: 'success' | 'warning' | 'error' | 'info' = 'info',
): void {
  const opts: Parameters<typeof ElMessage>[0] = {
    message,
    duration: 6500,
    showClose: true,
    customClass: 'mobile-toast',
  };
  switch (type) {
    case 'success': ElMessage.success(opts); break;
    case 'warning': ElMessage.warning(opts); break;
    case 'error': ElMessage.error(opts); break;
    default: ElMessage.info(opts);
  }
}

// === 扫码回调 ===
function onScanned(payload: { text: string }): void {
  const text = (payload.text || '').trim();
  if (!text) {
    toast('未识别到物料码', 'warning');
    return;
  }
  // 取最后一段作为物料 ID (支持 URL/纯码)
  materialId.value = text.split(/[/?=:]/).filter(Boolean).pop() || text;
  step.value = 'photo';
  // 异步取定位 (不阻塞 UI)
  void getLocation();
}

function onScanError(msg: string): void {
  toast(msg || '扫描失败, 请重试', 'error');
}

// === 三模定位兜底 ===
async function getLocation(): Promise<void> {
  // 主路径: GPS (5s 超时, accuracy > 50m 视为不可用)
  try {
    const pos = await new Promise<GeolocationPosition>((res, rej) => {
      navigator.geolocation.getCurrentPosition(res, rej, {
        timeout: 5000,
        enableHighAccuracy: true,
        maximumAge: 0,
      });
    });
    gpsAccuracy.value = pos.coords.accuracy;
    if (pos.coords.accuracy <= 50) {
      location.value = {
        type: 'gps',
        value: `${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`,
      };
      needsManual.value = false;
      return;
    }
    // accuracy > 50m: 落入兜底
    console.warn('[ScanConfirm] GPS accuracy too low:', pos.coords.accuracy);
  } catch (e) {
    console.warn('[ScanConfirm] GPS failed:', e);
  }

  // 兜底 1: WiFi 指纹 (navigator.connection, 仅做尽力而为采集)
  const conn = (navigator as unknown as {
    connection?: { type?: string; effectiveType?: string; downlink?: number };
  }).connection;
  if (conn) {
    const wifiFingerprint = `${conn.type || 'unknown'}|${conn.effectiveType || ''}|${conn.downlink || 0}`;
    location.value = { type: 'wifi', value: wifiFingerprint };
    needsManual.value = false;
    return;
  }

  // 兜底 2: 手工修正
  enterManual();
}

function enterManual(): void {
  location.value = {
    type: 'manual',
    value: `${manualLat.value},${manualLng.value}`,
  };
  needsManual.value = true;
}

function onManualChange(): void {
  location.value = {
    type: 'manual',
    value: `${manualLat.value},${manualLng.value}`,
  };
}

// === 拍照取证 ===
async function onPhoto(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  // 重置 input 以便同文件可重拍
  input.value = '';
  if (!file) return;

  try {
    const result = await compressImage(file);
    if (!result.base64) {
      toast('照片处理失败, 请重拍', 'error');
      return;
    }
    compressed.value = result;
  } catch (err) {
    console.error('[ScanConfirm] photo compress failed:', err);
    toast('照片处理失败, 请重拍', 'error');
  }
}

// === 步骤切换 ===
function backToScan(): void {
  step.value = 'scan';
}

function openConfirm(): void {
  if (!canSubmit.value) return;
  showConfirmModal.value = true;
}

function cancelConfirm(): void {
  showConfirmModal.value = false;
}

// === 提交确权 (走 awardPointsMobile 适配层, 不直接调 ptsAwardPoints) ===
async function doSubmit(): Promise<void> {
  if (submitting.value) {
    toast('无需重复操作', 'info');
    return;
  }
  if (!workerId.value || !materialId.value || !compressed.value) {
    showConfirmModal.value = false;
    return;
  }
  submitting.value = true;
  try {
    const resp = await awardPointsMobile({
      workerId: workerId.value,
      materialId: materialId.value,
      photoBase64: compressed.value.base64,
      location: location.value,
    });
    showConfirmModal.value = false;

    // fraudBlocked: 5 分钟内已确权
    if (resp.fraudBlocked) {
      toast('该物料 5 分钟内已确权，请勿重复操作', 'warning');
      speak('请勿重复操作');
      step.value = 'scan';
      return;
    }

    if (resp.awarded) {
      // awarded 字段是 boolean, MVP 用固定 +10 分提示 (扫码: credit+2/carbon+5/easyTrust+3 = 10)
      const awarded = 10;
      lastAwarded.value = awarded;
      toast(
        `积分到账 +${awarded} (信用 ${resp.newBalances.credit} / 碳 ${resp.newBalances.carbon} / 信易 ${resp.newBalances.easyTrust})`,
        'success',
      );
      speak(`积分到账 ${awarded} 分`);
      step.value = 'done';
    } else {
      toast(resp.reason || '确权未通过, 请稍后重试', 'warning');
      step.value = 'scan';
    }
  } catch (err) {
    // QueueFullError: 队列满, 禁用拍照
    if (err instanceof QueueFullError) {
      photoDisabled.value = true;
      toast('存储空间不足，请联网同步后继续操作', 'error');
      showConfirmModal.value = false;
      return;
    }
    // 其他错误 (网络/HTTP): 入离线队列
    console.warn('[ScanConfirm] online submit failed, enqueuing:', err);
    try {
      await queue.push({
        id: queue.genId(),
        workerId: workerId.value,
        materialId: materialId.value,
        photoBase64: compressed.value.base64,
        location: location.value,
        timestamp: Date.now(),
      });
      pendingCount.value = await refreshPendingCount();
      toast(`已离线保存, 待联网同步 (共 ${pendingCount.value} 条)`, 'warning');
      speak('已离线保存');
      showConfirmModal.value = false;
      lastAwarded.value = null;
      step.value = 'done';
    } catch (pushErr) {
      if (pushErr instanceof QueueFullError) {
        photoDisabled.value = true;
        toast('存储空间不足，请联网同步后继续操作', 'error');
      } else {
        console.error('[ScanConfirm] enqueue failed:', pushErr);
        toast('保存失败, 请重试', 'error');
      }
      showConfirmModal.value = false;
    }
  } finally {
    submitting.value = false;
  }
}

// === 离线恢复上送 (onActivated + window.online 由 usePendingSync 自动触发) ===
async function onFlush(): Promise<void> {
  if (flushing.value) {
    toast('无需重复操作', 'info');
    return;
  }
  flushing.value = true;
  try {
    const { success, failed } = await flushPending();
    pendingCount.value = await refreshPendingCount();
    if (success > 0) {
      toast(`已同步 ${success} 条确权`, 'success');
      speak(`已同步 ${success} 条确权`);
    }
    if (failed > 0) {
      toast(`${failed} 条同步失败, 稍后重试`, 'warning');
    }
    if (success === 0 && failed === 0 && pendingCount.value === 0) {
      // 静默 (无待上传)
    }
  } finally {
    flushing.value = false;
  }
}

async function refreshPendingCount(): Promise<number> {
  try {
    const items = await queue.getAll();
    return items.length;
  } catch {
    return pendingCount.value;
  }
}

function resetToScan(): void {
  step.value = 'scan';
  scanText.value = '';
  materialId.value = '';
  compressed.value = null;
  photoDisabled.value = false;
  location.value = { type: 'manual', value: `${STATION_CENTER.lat},${STATION_CENTER.lng}` };
  needsManual.value = false;
  gpsAccuracy.value = null;
  lastAwarded.value = null;
}

// === 生命周期 ===
onActivated(async () => {
  // KeepAlive 唤醒: 触发离线 flush
  pendingCount.value = await refreshPendingCount();
  if (pendingCount.value > 0 && typeof navigator !== 'undefined' && navigator.onLine) {
    void onFlush();
  }
});

onUnmounted(() => {
  // 清理 usePendingSync 的 online 监听 (避免泄漏)
  disposeSync();
});
</script>

<style>
/* ElMessage 全局 z-index=9500 (customClass=mobile-toast 覆盖)
   非 scoped 因 ElMessage 挂载到 body 外部 */
.mobile-toast {
  z-index: 9500 !important;
}
.mobile-toast .el-message__closeBtn {
  /* 确保 × 关闭按钮可点 */
  pointer-events: auto;
}
</style>

<style scoped>
.scan-confirm-view {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: 12px 16px 24px;
  box-sizing: border-box;
  background: #f5f7fa;
  position: relative;
}

/* 顶部横幅 */
.pending-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #ecf5ff;
  border: 1px solid #d9ecff;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 8px;
  color: #409eff;
  font-size: 13px;
}
.flush-btn {
  background: #409eff;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 13px;
  min-height: 36px;
}
.flush-btn:disabled {
  opacity: 0.6;
}

.voice-toggle {
  align-self: flex-end;
  background: transparent;
  border: 1px solid #dcdfe6;
  border-radius: 14px;
  padding: 4px 12px;
  font-size: 12px;
  color: #606266;
  margin-bottom: 8px;
  min-height: 28px;
}

/* 步骤通用 */
.step {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
}
.step-title {
  margin: 0;
  font-size: 20px;
  color: #303133;
}
.step-hint {
  margin: 0;
  font-size: 13px;
  color: #909399;
}
.resume-hint {
  font-size: 12px;
  color: #e6a23c;
  background: #fdf6ec;
  border-radius: 6px;
  padding: 8px 10px;
}

/* 拍照步 */
.material-info {
  background: #fff;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  color: #606266;
}
.mi-value {
  color: #303133;
  margin-left: 4px;
  word-break: break-all;
}

.photo-capture-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #409eff;
  color: #fff;
  border-radius: 10px;
  padding: 18px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  min-height: 56px;
  transition: background 0.2s;
}
.photo-capture-btn:active:not(.disabled) {
  background: #337ecc;
}
.photo-capture-btn.disabled {
  background: #c0c4cc;
  cursor: not-allowed;
}
.photo-capture-btn input[type='file'] {
  display: none;
}

.photo-preview {
  background: #fff;
  border-radius: 8px;
  padding: 8px;
  text-align: center;
}
.preview-img {
  width: 100%;
  max-height: 240px;
  object-fit: contain;
  border-radius: 6px;
}
.preview-meta {
  font-size: 11px;
  color: #909399;
  margin-top: 4px;
}

/* 定位信息 */
.location-info {
  background: #fff;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.loc-row {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #606266;
}
.loc-label {
  color: #909399;
  min-width: 48px;
}
.loc-value {
  color: #303133;
  word-break: break-all;
}
.loc-acc {
  color: #909399;
  font-size: 12px;
}

.manual-form {
  display: flex;
  gap: 8px;
}
.manual-field {
  flex: 1;
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: #909399;
  gap: 2px;
}
.manual-field input {
  height: 36px;
  padding: 0 8px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  font-size: 14px;
  color: #303133;
}

.manual-btn {
  align-self: flex-start;
  background: #fdf6ec;
  color: #e6a23c;
  border: 1px solid #f5dab1;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  min-height: 36px;
}

.loc-warn {
  color: #f56c6c;
  background: #fef0f0;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
}

/* 底部主操作区 (位于屏幕底部 1/3, 拇指热区) */
.action-row {
  display: flex;
  gap: 10px;
  margin-top: auto;
  padding-top: 16px;
}
.btn-primary,
.btn-secondary {
  flex: 1;
  height: 48px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  border: none;
  cursor: pointer;
}
.btn-primary {
  background: #409eff;
  color: #fff;
}
.btn-primary:disabled {
  background: #c0c4cc;
  cursor: not-allowed;
}
.btn-secondary {
  background: #fff;
  color: #606266;
  border: 1px solid #dcdfe6;
}
.btn-secondary:disabled {
  color: #c0c4cc;
  cursor: not-allowed;
}

/* 二次确认模态窗 (z-index=10000 由 inline style 显式设置) */
.confirm-modal {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.confirm-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
}
.confirm-box {
  position: relative;
  background: #fff;
  border-radius: 12px;
  padding: 20px 18px;
  width: calc(100% - 48px);
  max-width: 360px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.confirm-title {
  margin: 0 0 12px;
  font-size: 17px;
  color: #303133;
  text-align: center;
}
.confirm-details {
  margin: 0 0 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.confirm-details > div {
  display: flex;
  font-size: 13px;
}
.confirm-details dt {
  color: #909399;
  width: 64px;
}
.confirm-details dd {
  margin: 0;
  color: #303133;
  flex: 1;
  word-break: break-all;
}
.confirm-actions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}

/* 完成步 */
.step-done {
  align-items: center;
  text-align: center;
  padding-top: 40px;
}
.done-awarded {
  font-size: 18px;
  color: #67c23a;
  margin: 12px 0 24px;
}
.continue-btn {
  max-width: 220px;
}
</style>
