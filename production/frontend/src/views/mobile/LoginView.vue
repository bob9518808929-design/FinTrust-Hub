<!--
  LoginView.vue — APP-02 工人极简登录 (PWA MVP)
  -------------------------------------------------------------
  设计 (project_memory 傻瓜式操作):
    责任链工人不会打字, 企业码可扫码自动填, 工号手输或扫码.
    成功后跳 redirect (或 /m/scan 扫码确权首页), 失败 toast 提示.
    不使用阻塞模态窗 (登录失败用 toast z-index=9500, 由 client.ts 统一处理).

  依赖:
    - useWorkerAuth (登录态)
    - ScanInput (扫码自动填企业码, v-model + @scanned)
    - useSpeech (登录成功语音播报, 可选)
-->
<template>
  <div class="login-view">
    <header class="login-header">
      <h2 class="login-title">工人登录</h2>
      <p class="login-subtitle">FinTrust Hub · 责任链扫码确权</p>
    </header>

    <form class="login-form" @submit.prevent="onSubmit">
      <ScanInput
        v-model="enterpriseCode"
        label="企业码"
        placeholder="企业码 (如 E001, 可扫码)"
        scan-label="扫码"
        scan-tooltip="扫企业二维码自动填企业码"
        :disabled="loading"
        @scanned="onEnterpriseScanned"
      />

      <el-input
        v-model="workerNo"
        class="login-field"
        placeholder="工号 (如 W01)"
        maxlength="20"
        :disabled="loading"
        clearable
      />

      <el-button
        type="primary"
        class="login-submit"
        :loading="loading"
        native-type="submit"
      >
        {{ loading ? '登录中...' : '提交' }}
      </el-button>

      <p v-if="errorMsg" class="login-error" role="alert">{{ errorMsg }}</p>
    </form>

    <footer class="login-footer">
      <span class="login-hint">提示: 企业码可点扫码自动填, 工号请向管理员索取</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import ScanInput from '@/components/common/ScanInput.vue';
import { useWorkerAuth } from '@/composables/useWorkerAuth';
import { useSpeech } from '@/composables/useSpeech';

const route = useRoute();
const router = useRouter();
const { login } = useWorkerAuth();
const { speak } = useSpeech();

const enterpriseCode = ref('');
const workerNo = ref('');
const loading = ref(false);
const errorMsg = ref('');

/** 扫码成功后自动填企业码 (ScanInput 已通过 v-model 更新, 此处仅可做格式校验). */
function onEnterpriseScanned(payload: { text: string }): void {
  // 扫到的 text 可能含 "E001" 或完整 URL, 取最后一段作为企业码
  const text = (payload.text || '').trim();
  const seg = text.split(/[/?=]/).filter(Boolean).pop() || text;
  enterpriseCode.value = seg.toUpperCase().slice(0, 8);
}

async function onSubmit(): Promise<void> {
  errorMsg.value = '';
  if (!enterpriseCode.value || !workerNo.value) {
    errorMsg.value = '请填写企业码和工号';
    ElMessage.warning({ message: '请填写企业码和工号', duration: 4000 });
    return;
  }
  loading.value = true;
  try {
    const result = await login(enterpriseCode.value, workerNo.value);
    speak(`登录成功, 欢迎工号 ${workerNo.value}`);
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '';
    await router.push(redirect || '/m/scan');
    void result;
  } catch {
    // client.ts 响应拦截器已弹 toast; 此处补充行内错误文案 + 语音提示
    errorMsg.value = '企业码或工号错误';
    speak('登录失败, 请检查企业码或工号');
  } finally {
    loading.value = false;
  }
}
</script>

<style lang="scss" scoped>
// 移动端登录 · Deepspace AI 深色版 (Experience 1072379: 禁止写死 #fff/#303133)
@use '@/styles/variables.scss' as *;

.login-view {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 24px 20px;
  color: $text-primary;
  background:
    radial-gradient(600px 300px at 10% -10%, rgba(34,211,238,0.18), transparent 60%),
    radial-gradient(600px 300px at 110% 10%, rgba(192,132,252,0.16), transparent 55%),
    linear-gradient(180deg, #030712 0%, #050b1c 100%);
  background-attachment: fixed;
  box-sizing: border-box;
}

.login-header {
  text-align: center;
  margin-bottom: 24px;
  padding-top: 12px;
}

.login-title {
  margin: 0 0 6px;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 0.02em;
  background: $ai-gradient;
  -webkit-background-clip: text;
          background-clip: text;
  color: transparent;
}

.login-subtitle {
  margin: 0;
  font-size: 13px;
  color: $text-secondary;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: linear-gradient(180deg, rgba(15,23,42,0.72), rgba(3,7,18,0.82));
  padding: 20px 16px;
  border-radius: 16px;
  border: 1px solid $border-color;
  backdrop-filter: blur(14px) saturate(160%);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
  box-shadow: $shadow-lg;
}

.login-field :deep(.el-input__inner) {
  height: 44px;
}

.login-submit {
  height: 46px;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.login-error {
  margin: 0;
  color: #fca5a5;
  background: rgba(248,113,113,0.10);
  border: 1px solid rgba(248,113,113,0.30);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 13px;
  text-align: center;
}

.login-footer {
  margin-top: auto;
  padding-top: 16px;
  text-align: center;
}

.login-hint {
  font-size: 12px;
  color: $text-secondary;
}
</style>
