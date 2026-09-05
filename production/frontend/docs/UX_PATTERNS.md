# FinTrust Hub 傻瓜化 UI/UX 组件规范 (UX-06)

> 设计哲学: **不让用户做选择题, 只让用户做判断题(是/否)或填空题(扫一扫).**
>
> 用户群体: 企业老板 / 责任链工人(仓管/物流) / 财务顾问. 多数不懂金融和 IT.
> 因此每个界面必须在 5 秒内能被看懂, 主操作永远只有一个绿色大按钮.

本规范定义 FinTrust Hub 前端可复用的"傻瓜化"组件模式.
所有组件位于 `src/components/common/`, 全部 `<script setup lang="ts">` + 暗色 SCSS.

---

## 一、6 条傻瓜化设计原则

### 1. 只有一个主操作, 永远绿色显眼
每屏只放一个绿色主操作按钮(`PlainButton`), 其余操作降级为文字按钮或下拉.
不要让用户在两个等权重按钮间纠结.

### 2. 判断题代替选择题
当用户面对的是"是否同意"类决策, 用 `YesNoChoice` 两按钮(绿是/红否),
而不是下拉框或单选组. 文案要场景化 ("同意放款" 而不是 "是").

### 3. 填空题代替打字
责任链工人(仓管/物流)不会打字, 用 `ScanInput` 扫码枪/拍照自动填空.
不能扫码的地方用 `PlainTextTooltip` 悬停看白话文, 不要弹弹窗让用户切走.

### 4. 专业术语必须配白话文翻译
凡是出现 "反向保理" / "实控人穿透" / "LPR" 等术语, 必须包 `PlainTextTooltip`,
悬停一句白话文. 术语词典见 `src/utils/plainTextTranslator.ts` (≥ 50 条).

### 5. 异常用红绿灯清单, 不用滚动告警
异常列表必须按 "严重 红 / 警告 橙 / 提示 蓝" 三色分组, 默认展开红色组,
让用户一眼知道下一步处理什么. 不要堆时间线.

### 6. 不可逆决策必须二次确认 + 全文反馈
涉及放款/删除/签署等不可逆操作, 用 `ElMessageBox.confirm` 二次确认,
确认后用 `ElMessage` 即时反馈结果, 严重错误用 `ElNotification` 横幅跳转.

---

## 二、8 个组件使用示例

> 下面示例全部可在任意 view 直接 import 使用, 假设 `@/components/common/` 已配别名.

### 示例 1: 判断题 — 是/否 二选一 (`YesNoChoice`)

场景: 顾问在审批台决定是否同意 80 万放款.

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import YesNoChoice from '@/components/common/YesNoChoice.vue';

const approved = ref<boolean | null>(null);

function onChange(v: boolean) {
  ElMessage.success(v ? '已记录: 同意放款, 进入放款队列' : '已记录: 打回, 通知顾问补充资料');
}
</script>

<template>
  <YesNoChoice
    v-model="approved"
    question="是否同意本次 80 万贷款放款?"
    yes-text="同意放款"
    no-text="打回补充资料"
    @change="onChange"
  />
</template>
```

### 示例 2: 填空题 — 扫码自动填充 (`ScanInput`)

场景: 仓管扫运单号自动填入系统.

```vue
<script setup lang="ts">
import { ref } from 'vue';
import ScanInput from '@/components/common/ScanInput.vue';

const containerCode = ref('');

function onScanned(payload: { text: string }) {
  console.log('扫到:', payload.text);
}
</script>

<template>
  <ScanInput
    v-model="containerCode"
    label="集装箱号"
    placeholder="扫码枪扫一下, 或手动输入"
    scan-mode="image"
    @scanned="onScanned"
  />
</template>
```

### 示例 3: 红绿灯异常清单 (基于 `el-table` + 自定义 row-class)

场景: 工作台首页显示企业待办异常.

```vue
<script setup lang="ts">
import { ref } from 'vue';

interface AlertItem { level: 'red' | 'orange' | 'blue'; text: string; }
const alerts = ref<AlertItem[]>([
  { level: 'red', text: '应付账款逾期 3 天, 金额 12 万' },
  { level: 'orange', text: 'LPR 上浮 25 BP, 需重新评估融资成本' },
  { level: 'blue', text: '有 5 份新合同待审批' },
]);

function rowClass({ row }: { row: AlertItem }) {
  return `alert-row-${row.level}`;
}
</script>

<template>
  <el-table :data="alerts" :row-class-name="rowClass" :default-sort="{ prop: 'level' }">
    <el-table-column prop="level" label="级别" width="80">
      <template #default="{ row }">
        <el-tag :type="row.level === 'red' ? 'danger' : row.level === 'orange' ? 'warning' : 'primary'">
          {{ row.level === 'red' ? '红' : row.level === 'orange' ? '橙' : '蓝' }}
        </el-tag>
      </template>
    </el-table-column>
    <el-table-column prop="text" label="事项" />
  </el-table>
</template>

<style lang="scss" scoped>
:deep(.alert-row-red) td { background: rgba(239, 68, 68, 0.15) !important; }
:deep(.alert-row-orange) td { background: rgba(245, 158, 11, 0.12) !important; }
:deep(.alert-row-blue) td { background: rgba(59, 130, 246, 0.10) !important; }
</style>
```

### 示例 4: 白话文 tooltip (`PlainTextTooltip`)

场景: 在融资流程页出现术语 "反向保理", 让老板悬停看白话.

```vue
<script setup lang="ts">
import PlainTextTooltip from '@/components/common/PlainTextTooltip.vue';
</script>

<template>
  <p>
    本次融资采用
    <PlainTextTooltip term="反向保理">
      <strong>反向保理</strong>
    </PlainTextTooltip>
    模式, 由核心企业牵头发起.
  </p>

  <!-- 也可不传 slot, 默认显示 term 本身 -->
  <p>利率参考 <PlainTextTooltip term="LPR" /> 报价.</p>
</template>
```

### 示例 5: 求助引导 (`CoachMark` + F1)

场景: 新手第一次进系统, 自动弹出首页引导.

```vue
<!-- App.vue 已挂载 <CoachMark />, 业务页面无需再挂 -->

<script setup lang="ts">
import { useCoachMark } from '@/composables/useCoachMark';

const coach = useCoachMark();

// 任意时刻可强制调起自定义引导
function startMyTour() {
  coach.startTour([
    { target: '.flow-step-1', title: '第一步', content: '确认应收账款金额', placement: 'right' },
    { target: '.flow-step-2', title: '第二步', content: '上传发票', placement: 'right' },
    { target: '.flow-step-3', title: '第三步', content: '点击放款', placement: 'left' },
  ]);
}
</script>

<template>
  <el-button @click="startMyTour">查看本页引导</el-button>
</template>
```

> 全局: 顶部"求助"按钮或键盘 `F1` 即可调起当前路由默认引导,
> 已完成的路由不再自动弹出 (localStorage 记忆).

### 示例 6: 决策反馈 toast (`ElMessage`)

场景: 顾问采纳 AI 建议后立即给反馈.

```vue
<script setup lang="ts">
import { ElMessage } from 'element-plus';
import PlainButton from '@/components/common/PlainButton.vue';

function onAdopt() {
  // ...提交采纳逻辑
  ElMessage.success({ message: '已采纳 AI 建议, 已提交审批', duration: 2500 });
}
</script>

<template>
  <PlainButton text="采纳" @click="onAdopt" />
</template>
```

### 示例 7: 不可逆决策 modal (`ElMessageBox.confirm`)

场景: 银行确认放款 80 万 (金额大, 不可逆).

```vue
<script setup lang="ts">
import { ElMessageBox, ElNotification } from 'element-plus';
import PlainButton from '@/components/common/PlainButton.vue';

async function onDisburse() {
  try {
    await ElMessageBox.confirm(
      '确认放款 80 万元到 XX 公司账户? 此操作不可撤销.',
      '放款二次确认',
      { confirmButtonText: '确认放款', cancelButtonText: '取消', type: 'warning' },
    );
    // ... 调 API
    ElNotification.success({ title: '放款成功', message: '资金已划转, 预计 2 分钟到账' });
  } catch {
    /* 用户取消, 不做处理 */
  }
}
</script>

<template>
  <PlainButton text="确认放款" size="large" @click="onDisburse" />
</template>
```

### 示例 8: 告警横幅跳转 (`ElNotification` + router push)

场景: 监管沙盒触发红色违规, 顶部弹横幅, 点击跳转处理.

```vue
<script setup lang="ts">
import { ElNotification } from 'element-plus';
import { useRouter } from 'vue-router';
import PlainButton from '@/components/common/PlainButton.vue';

const router = useRouter();

function notifyRegulatoryBreach() {
  const n = ElNotification({
    title: '监管告警',
    message: '检测到内保外贷额度超限, 需立即处理',
    type: 'error',
    duration: 0, // 不自动消失
    onClick: () => {
      router.push('/regulatory');
      n.close();
    },
  });
}
</script>

<template>
  <PlainButton text="模拟监管告警" @click="notifyRegulatoryBreach" />
</template>
```

---

## 三、组件速查表

| 组件 | 路径 | 用途 | 是否傻瓜式核心 |
| --- | --- | --- | --- |
| `PlainButton` | `components/common/PlainButton.vue` | 绿色大号主操作按钮, 默认 "✓ 采纳" | ✓ |
| `YesNoChoice` | `components/common/YesNoChoice.vue` | 是/否二选一, v-model boolean | ✓ |
| `ScanInput` | `components/common/ScanInput.vue` | 扫码枪/拍照自动填空 | ✓ |
| `PlainTextTooltip` | `components/common/PlainTextTooltip.vue` | 金融术语悬停白话文翻译 | ✓ |
| `CoachMark` | `components/common/CoachMark.vue` | 全局一键求助引导, F1 触发 | ✓ |
| `ScorecardRadar` | `components/common/ScorecardRadar.vue` | 8 维评分雷达图 (已有) | - |

## 四、相关文件

- 词典工具: `src/utils/plainTextTranslator.ts` (≥ 50 条术语, 含 `translateToPlain` / `getAllTerms` / `getTermsByCategory`)
- 引导 composable: `src/composables/useCoachMark.ts` (含 `DEFAULT_TOUR_MAP` 路由默认引导)
- 词汇表页: `src/views/help/GlossaryView.vue` (路由 `/glossary`, 由 router 单独集成)
- 全局挂载: `src/App.vue` (含 F1 监听 + `<CoachMark />`)
- 求助按钮入口: `src/components/layout/AppHeader.vue` (顶部红色按钮 + 用户菜单"操作指引")
