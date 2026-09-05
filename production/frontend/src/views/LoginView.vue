<!--
  LoginView.vue — PC 端身份选择登录页

  设计哲学 (project_memory 傻瓜式操作 + API 接入优先 + 独立兜底备选):
    前因: 当前是 dev-admin 兜底模式, 后端 deps.py 在非 production 环境对未认证请求
          返回默认 dev-admin 用户, 前端用任何身份"登录"都能进系统. 真正的 SSO/OAuth2
          接入是路线图项 (P3), 当前先做 UI 入口, 让用户在视觉上理解"我是谁".
    用法: 4 张大卡片选身份, 点哪个就跳到对应端首页.
    后果: 后端记录 X-Client 头标识来源, 未来接 SSO 后这里会变成真正的认证跳转.
-->
<template>
  <div class="login-view">
    <div class="login-card">
      <div class="login-header">
        <div class="brand">
          <span class="brand-icon">FT</span>
          <span class="brand-text">FinTrust Hub</span>
        </div>
        <h1 class="login-title">请选择你的身份登录</h1>
        <p class="login-subtitle">
          点击下方对应身份卡片进入系统 · 当前为开发模式 (dev-admin 兜底)
        </p>
      </div>

      <el-row :gutter="16" class="role-row">
        <el-col v-for="role in roles" :key="role.key" :xs="24" :sm="12" :md="12" :lg="6">
          <el-card
            shadow="hover"
            :class="['role-card', `role-${role.theme}`]"
            @click="onRoleClick(role)"
          >
            <div class="role-icon-wrap">
              <el-icon :size="48" :color="role.color">
                <component :is="role.icon" />
              </el-icon>
            </div>
            <div class="role-title">{{ role.title }}</div>
            <div class="role-desc">{{ role.desc }}</div>
            <el-button type="primary" size="default" class="role-cta">
              {{ role.cta }} →
            </el-button>
          </el-card>
        </el-col>
      </el-row>

      <el-divider />

      <div class="login-footer">
        <p class="footer-hint">
          📱 移动端工人请在手机浏览器/微信扫码访问
          <el-link type="primary" underline="never" @click="goMobile">/m/login</el-link>
        </p>
        <p class="footer-hint">
          🔐 生产环境将通过 SSO/OAuth2 接入真实身份认证 (路线图 P3)
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import {
  UserFilled, OfficeBuilding, CreditCard, Lock,
} from '@element-plus/icons-vue';
import { isMobileDevice } from '@/composables/useDevice';

defineOptions({ name: 'LoginView' });

const router = useRouter();
const route = useRoute();

interface RoleEntry {
  key: string;
  title: string;
  desc: string;
  cta: string;
  path: string;
  icon: typeof UserFilled;
  color: string;
  theme: string;
}

const roles: RoleEntry[] = [
  {
    key: 'advisor',
    title: '我是财务顾问',
    desc: '运营 FinTrust Hub, 一对多服务多家企业, 启动改造与融资撮合',
    cta: '顾问登录',
    path: '/advisor',
    icon: UserFilled,
    color: '#3b82f6',
    theme: 'blue',
  },
  {
    key: 'enterprise',
    title: '我是企业老板',
    desc: '看自己企业的改造进度 / 信用分 / 融资单, 跟 AI 数字分身对话',
    cta: '企业登录',
    path: '/portal/enterprise',
    icon: OfficeBuilding,
    color: '#10b981',
    theme: 'green',
  },
  {
    key: 'bank',
    title: '我是银行客户经理',
    desc: '查看客户企业的资金水位 / 监管账户 / 审批融资申请',
    cta: '银行登录',
    path: '/bank',
    icon: CreditCard,
    color: '#8b5cf6',
    theme: 'purple',
  },
  {
    key: 'institution',
    title: '我是担保/保险公司',
    desc: '处理担保代偿 / 保险理赔申请, 协同核保核赔',
    cta: '机构登录',
    path: '/institution',
    icon: Lock,
    color: '#f59e0b',
    theme: 'amber',
  },
];

function onRoleClick(r: RoleEntry) {
  // 携带 redirect 参数回到原页面 (若有)
  const redirect = (route.query.redirect as string) || r.path;
  // dev 模式直接跳, 不做真实认证
  ElMessage.success(`以「${r.title}」身份登录 (dev-admin 兜底, 真实认证待 SSO 接入)`);
  router.push(redirect);
}

function goMobile() {
  if (isMobileDevice()) {
    router.push('/m/login');
  } else {
    ElMessage.info('请在手机端浏览器/微信扫码访问 /m/login, PC 端不开放移动工作流');
  }
}
</script>

<style lang="scss" scoped>
// Deepspace AI 版登录页 (避免 Experience 1072379 深色切换不完整)
// 规则: 所有颜色只允许引用 @use 变量 / var(--el-xxx) / var(--ft-xxx), 禁止写死 #fff / #1f2937
@use '@/styles/variables.scss' as *;

.login-view {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: $spacing-xl $spacing-lg;
  color: $text-primary;
  // 背景: 透明 → 透出 body::before 的深空霓虹光晕
  background:
    radial-gradient(600px 300px at 20% 20%, rgba(34,211,238,0.12), transparent 60%),
    radial-gradient(600px 300px at 80% 90%, rgba(192,132,252,0.14), transparent 55%),
    transparent;
  isolation: isolate;

  .login-card {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 1100px;
    padding: $spacing-xxl;
    color: $text-primary;
    background: linear-gradient(180deg, rgba(15,23,42,0.70), rgba(3,7,18,0.78));
    backdrop-filter: blur(20px) saturate(160%);
    -webkit-backdrop-filter: blur(20px) saturate(160%);
    border: 1px solid $border-light;
    border-radius: $radius-xl;
    box-shadow: $shadow-lg;

    &::before {
      content: '';
      position: absolute;
      inset: -1px;
      border-radius: inherit;
      padding: 1px;
      background: linear-gradient(135deg, rgba(34,211,238,0.55), rgba(129,140,248,0.25) 45%, rgba(192,132,252,0.65) 100%);
      -webkit-mask:
        linear-gradient(#000 0 0) content-box,
        linear-gradient(#000 0 0);
      -webkit-mask-composite: xor;
              mask-composite: exclude;
      pointer-events: none;
      opacity: 0.9;
    }

    .login-header {
      text-align: center;
      margin-bottom: $spacing-xxl;

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 14px;

        .brand-icon {
          width: 40px;
          height: 40px;
          background-image: $ai-gradient;
          border-radius: 10px;
          color: #020617;
          font-weight: 800;
          font-size: 14px;
          letter-spacing: 0.03em;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: $shadow-glow-cyan;
        }

        .brand-text {
          font-size: 24px;
          font-weight: 800;
          background: $ai-gradient;
          -webkit-background-clip: text;
                  background-clip: text;
          color: transparent;
          letter-spacing: 0.01em;
        }
      }

      .login-title {
        font-size: 26px;
        font-weight: 700;
        color: $text-primary;
        margin: 0 0 10px 0;
        letter-spacing: 0.01em;
      }

      .login-subtitle {
        font-size: 13px;
        color: $text-secondary;
        margin: 0;
      }
    }

    .role-row {
      .role-card {
        cursor: pointer;
        text-align: center;
        transition: transform $transition-base, box-shadow $transition-base, border-color $transition-base, background $transition-base;
        height: 100%;
        background: rgba(15, 23, 42, 0.55) !important;
        border: 1px solid $border-color !important;
        border-radius: $radius-lg !important;
        backdrop-filter: blur(10px) saturate(140%);
        -webkit-backdrop-filter: blur(10px) saturate(140%);
        overflow: hidden;

        &:hover {
          transform: translateY(-4px);
          border-color: $border-light !important;
          box-shadow:
            0 12px 28px rgba(0, 0, 0, 0.55),
            0 0 0 1px rgba(192,132,252,0.22),
            0 0 22px rgba(56,189,248,0.18);
        }

        &.role-blue   { box-shadow: inset 0 3px 0 #38bdf8, $shadow-base; }
        &.role-green  { box-shadow: inset 0 3px 0 #10b981, $shadow-base; }
        &.role-purple { box-shadow: inset 0 3px 0 #c084fc, $shadow-base; }
        &.role-amber  { box-shadow: inset 0 3px 0 #fbbf24, $shadow-base; }

        &.role-blue:hover   { box-shadow: inset 0 3px 0 #38bdf8, 0 0 18px rgba(56,189,248,0.35); }
        &.role-green:hover  { box-shadow: inset 0 3px 0 #10b981, 0 0 18px rgba(16,185,129,0.30); }
        &.role-purple:hover { box-shadow: inset 0 3px 0 #c084fc, 0 0 20px rgba(192,132,252,0.35); }
        &.role-amber:hover  { box-shadow: inset 0 3px 0 #fbbf24, 0 0 18px rgba(251,191,36,0.30); }

        .role-icon-wrap {
          margin: 14px auto 16px;
          width: 84px;
          height: 84px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: $ai-gradient-soft;
          border: 1px solid $border-color;
        }

        .role-title {
          font-size: 16px;
          font-weight: 700;
          color: $text-primary;
          margin-bottom: 8px;
        }

        .role-desc {
          font-size: 12px;
          color: $text-secondary;
          line-height: 1.7;
          margin-bottom: 16px;
          min-height: 56px;
          padding-inline: 6px;
        }

        .role-cta {
          width: 100%;
        }
      }
    }

    .login-footer {
      text-align: center;
      margin-top: $spacing-lg;

      .footer-hint {
        font-size: 12px;
        color: $text-secondary;
        margin: 6px 0;

        a, :deep(.el-link) { color: $color-primary; }
        a:hover, :deep(.el-link:hover) { color: $color-primary-2; text-shadow: 0 0 8px rgba(56,189,248,0.45); }
      }
    }
  }
}

// 让 el-divider 在登录页玻璃卡片上不刺眼
:deep(.el-divider) {
  --el-border-color: #{ $border-color };
}
</style>
