<!--
  PtsWalletView.vue — APP-02 积分钱包页 (PWA MVP)
  -------------------------------------------------------------
  设计依据: APP02_MOBILE_PLAN.md §4.2 Task 4 + spec.md L2741-L2745
  三区结构:
    1. 余额区: ptsGetAccount(workerId) → balances (credit/carbon/easyTrust 三种, 无 total)
       MVP 大字号显示三项, 总和展示为"可用积分"
    2. 明细区: ptsListOrders(workerId) 取最近 10 条, 渲染时间/类型/±积分/来源 4 列
    3. 商品列表区: ptsListShopItems() 网格 2 列布局
  兑换交互:
    - 点击"兑换"弹阻塞模态窗 (z-index=10000) 二次确认
    - 确认后调 ptsPlaceOrder(workerId, itemId)
    - 成功 toast"兑换成功，待发货"; 失败 toast"积分不足"或"商品已下架"
    - 重复点击 toast"无需重复操作"

  project_memory 硬约束:
    - async/await
    - 阻塞模态窗 z-index=10000 (inline style)
    - toast z-index=9500 (customClass + 全局 style)
    - 拇指热区: 兑换按钮 ≥ 44px 高
    - 资源 URL 加 ?v=22
-->
<template>
  <div class="pts-wallet-view">
    <!-- 1. 余额区 -->
    <section class="balance-section">
      <div v-if="loading" class="loading-hint">加载中...</div>
      <template v-else-if="account">
        <div class="balance-total">
          <span class="bt-label">可用积分</span>
          <span class="bt-value">{{ totalBalance }}</span>
        </div>
        <div class="balance-breakdown">
          <div class="bb-item">
            <span class="bb-label">信用分</span>
            <span class="bb-value credit">{{ account.balances.credit }}</span>
          </div>
          <div class="bb-item">
            <span class="bb-label">碳积分</span>
            <span class="bb-value carbon">{{ account.balances.carbon }}</span>
          </div>
          <div class="bb-item">
            <span class="bb-label">信易分</span>
            <span class="bb-value easytrust">{{ account.balances.easyTrust }}</span>
          </div>
        </div>
      </template>
      <div v-else class="loading-hint">暂无账户信息</div>
    </section>

    <!-- 2. 明细区 -->
    <section class="orders-section">
      <h3 class="section-title">兑换明细</h3>
      <div v-if="ordersLoading" class="loading-hint">加载中...</div>
      <div v-else-if="orders.length === 0" class="empty-hint">暂无明细记录</div>
      <ul v-else class="orders-list">
        <li v-for="order in orders" :key="order.orderId" class="order-row">
          <div class="or-col or-time">
            <span class="or-date">{{ formatDate(order.placedAt) }}</span>
            <span class="or-source">{{ order.itemName }}</span>
          </div>
          <div class="or-col or-behavior">
            <span class="or-tag">兑换</span>
          </div>
          <div class="or-col or-points">
            <span class="or-delta">-{{ order.creditCost }}</span>
          </div>
          <div class="or-col or-status">
            <span class="or-status-text" :class="statusClass(order.status)">{{ statusText(order.status) }}</span>
          </div>
        </li>
      </ul>
    </section>

    <!-- 3. 商品列表区 -->
    <section class="shop-section">
      <h3 class="section-title">积分商城</h3>
      <div v-if="shopLoading" class="loading-hint">加载中...</div>
      <div v-else-if="shopItems.length === 0" class="empty-hint">暂无可兑换商品</div>
      <div v-else class="shop-grid">
        <article
          v-for="item in shopItems"
          :key="item.itemId"
          class="shop-card"
        >
          <img
            v-if="item.icon"
            :src="iconUrl(item.icon)"
            :alt="item.name"
            class="shop-icon"
            loading="lazy"
          />
          <div v-else class="shop-icon-placeholder">{{ item.name.slice(0, 1) }}</div>
          <div class="shop-meta">
            <div class="shop-name">{{ item.name }}</div>
            <div class="shop-cost">{{ item.creditCost }} 积分</div>
            <div class="shop-stock" :class="{ 'out': item.stock <= 0 }">
              {{ item.stock > 0 ? `库存 ${item.stock}` : '已售罄' }}
            </div>
          </div>
          <button
            class="btn-redeem"
            type="button"
            :disabled="item.stock <= 0 || redeemingId === item.itemId"
            @click="openRedeemModal(item)"
          >
            {{ redeemingId === item.itemId ? '兑换中...' : (item.stock <= 0 ? '售罄' : '兑换') }}
          </button>
        </article>
      </div>
    </section>

    <!-- 兑换阻塞模态窗 (z-index=10000 显式 inline) -->
    <div
      v-if="showRedeemModal"
      class="redeem-modal"
      style="z-index: 10000"
      role="dialog"
      aria-modal="true"
      aria-labelledby="redeem-title"
    >
      <div class="redeem-mask"></div>
      <div class="redeem-box">
        <h3 id="redeem-title" class="redeem-title">确认兑换</h3>
        <p v-if="selectedItem" class="redeem-desc">
          使用 <strong>{{ selectedItem.creditCost }} 积分</strong> 兑换
          《<strong>{{ selectedItem.name }}</strong>》？
        </p>
        <div class="redeem-actions">
          <button class="btn-secondary" type="button" :disabled="redeemSubmitting" @click="cancelRedeem">
            取消
          </button>
          <button class="btn-primary" type="button" :disabled="redeemSubmitting" @click="doRedeem">
            {{ redeemSubmitting ? '兑换中...' : '确认兑换' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useWorkerAuth } from '@/composables/useWorkerAuth';
import {
  ptsGetAccount,
  ptsListOrders,
  ptsListShopItems,
  ptsPlaceOrder,
} from '@/api/eco';
import type { WorkerAccount, ExchangeOrder, ShopItem } from '@contracts/eco';

defineOptions({ name: 'PtsWalletView' });

const { workerId } = useWorkerAuth();

// === 余额状态 ===
const account = ref<WorkerAccount | null>(null);
const loading = ref(false);
const totalBalance = computed(() => {
  if (!account.value) return 0;
  const b = account.value.balances;
  return b.credit + b.carbon + b.easyTrust;
});

// === 订单状态 ===
const orders = ref<ExchangeOrder[]>([]);
const ordersLoading = ref(false);

// === 商品状态 ===
const shopItems = ref<ShopItem[]>([]);
const shopLoading = ref(false);
const selectedItem = ref<ShopItem | null>(null);
const showRedeemModal = ref(false);
const redeemSubmitting = ref(false);
const redeemingId = ref<string>('');

// === 工具 ===
function toast(message: string, type: 'success' | 'warning' | 'error' | 'info' = 'info'): void {
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

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

function statusText(status: ExchangeOrder['status']): string {
  switch (status) {
    case 'pending': return '待发货';
    case 'shipped': return '已发货';
    case 'delivered': return '已签收';
    case 'cancelled': return '已取消';
    default: return status;
  }
}

function statusClass(status: ExchangeOrder['status']): string {
  switch (status) {
    case 'pending': return 'st-pending';
    case 'shipped': return 'st-shipped';
    case 'delivered': return 'st-delivered';
    case 'cancelled': return 'st-cancelled';
    default: return '';
  }
}

/** 资源 URL 加 ?v=22 (project_memory 硬约束) */
function iconUrl(icon: string): string {
  if (!icon) return '';
  const sep = icon.includes('?') ? '&' : '?';
  return `${icon}${sep}v=22`;
}

// === 数据加载 ===
async function loadAccount(): Promise<void> {
  if (!workerId.value) return;
  loading.value = true;
  try {
    account.value = await ptsGetAccount(workerId.value);
  } catch (err) {
    console.warn('[PtsWallet] loadAccount failed:', err);
    toast('账户信息加载失败', 'error');
  } finally {
    loading.value = false;
  }
}

async function loadOrders(): Promise<void> {
  if (!workerId.value) return;
  ordersLoading.value = true;
  try {
    const list = await ptsListOrders(workerId.value);
    // 取最近 10 条 (按 placedAt DESC, 若后端未排序则本地排)
    orders.value = list
      .slice()
      .sort((a, b) => (a.placedAt < b.placedAt ? 1 : -1))
      .slice(0, 10);
  } catch (err) {
    console.warn('[PtsWallet] loadOrders failed:', err);
    // 失败不阻塞页面, 仅提示
    toast('明细加载失败', 'error');
  } finally {
    ordersLoading.value = false;
  }
}

async function loadShopItems(): Promise<void> {
  shopLoading.value = true;
  try {
    shopItems.value = await ptsListShopItems();
  } catch (err) {
    console.warn('[PtsWallet] loadShopItems failed:', err);
    toast('商品列表加载失败', 'error');
  } finally {
    shopLoading.value = false;
  }
}

// === 兑换交互 ===
function openRedeemModal(item: ShopItem): void {
  if (redeemSubmitting.value) {
    toast('无需重复操作', 'info');
    return;
  }
  if (item.stock <= 0) {
    toast('商品已售罄', 'warning');
    return;
  }
  if (account.value && totalBalance.value < item.creditCost) {
    toast('积分不足', 'warning');
    return;
  }
  selectedItem.value = item;
  showRedeemModal.value = true;
}

function cancelRedeem(): void {
  showRedeemModal.value = false;
  selectedItem.value = null;
}

async function doRedeem(): Promise<void> {
  if (redeemSubmitting.value) {
    toast('无需重复操作', 'info');
    return;
  }
  if (!workerId.value || !selectedItem.value) {
    showRedeemModal.value = false;
    return;
  }
  redeemSubmitting.value = true;
  redeemingId.value = selectedItem.value.itemId;
  try {
    const order = await ptsPlaceOrder(workerId.value, selectedItem.value.itemId);
    showRedeemModal.value = false;
    toast(`兑换成功，待发货 (订单 ${order.orderId})`, 'success');
    // 刷新余额 + 明细
    await Promise.all([loadAccount(), loadOrders()]);
  } catch (err) {
    console.warn('[PtsWallet] doRedeem failed:', err);
    // 后端可能返回业务错误 (积分不足 / 已下架), client.ts 已弹默认 toast
    // 这里补充具体文案 (基于错误类型判断)
    const msg = (err as Error)?.message || '';
    if (msg.includes('积分') || msg.includes('余额')) {
      toast('积分不足', 'warning');
    } else if (msg.includes('下架') || msg.includes('stock')) {
      toast('商品已下架', 'warning');
    } else {
      toast('兑换失败, 请稍后重试', 'error');
    }
  } finally {
    redeemSubmitting.value = false;
    redeemingId.value = '';
    selectedItem.value = null;
  }
}

onMounted(() => {
  void loadAccount();
  void loadOrders();
  void loadShopItems();
});
</script>

<style>
/* ElMessage 全局 z-index=9500 (PtsWalletView 共用) */
.mobile-toast {
  z-index: 9500 !important;
}
.mobile-toast .el-message__closeBtn {
  pointer-events: auto;
}
</style>

<style scoped>
.pts-wallet-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 16px 24px;
  box-sizing: border-box;
  background: #f5f7fa;
  min-height: 100%;
}

/* === 余额区 === */
.balance-section {
  background: linear-gradient(135deg, #409eff 0%, #337ecc 100%);
  color: #fff;
  border-radius: 12px;
  padding: 20px 16px;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.2);
}
.balance-total {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 14px;
}
.bt-label {
  font-size: 13px;
  opacity: 0.9;
}
.bt-value {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: 1px;
}
.balance-breakdown {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
}
.bb-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  padding: 8px 4px;
}
.bb-label {
  font-size: 11px;
  opacity: 0.85;
}
.bb-value {
  font-size: 16px;
  font-weight: 600;
}
.bb-value.credit { color: #ffe082; }
.bb-value.carbon { color: #a5d6a7; }
.bb-value.easytrust { color: #ffab91; }

/* === 通用区段标题 === */
.section-title {
  margin: 0 0 8px;
  font-size: 15px;
  color: #303133;
  border-left: 3px solid #409eff;
  padding-left: 8px;
}
.loading-hint,
.empty-hint {
  padding: 16px;
  text-align: center;
  color: #909399;
  font-size: 13px;
  background: #fff;
  border-radius: 8px;
}

/* === 明细区 === */
.orders-section {
  background: #fff;
  border-radius: 8px;
  padding: 12px;
}
.orders-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.order-row {
  display: grid;
  grid-template-columns: 1.4fr 0.6fr 0.6fr 0.8fr;
  align-items: center;
  gap: 4px;
  padding: 10px 0;
  border-bottom: 1px solid #f0f2f5;
  font-size: 13px;
}
.order-row:last-child {
  border-bottom: none;
}
.or-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.or-time {
  color: #606266;
}
.or-date {
  font-weight: 500;
}
.or-source {
  font-size: 11px;
  color: #909399;
  word-break: break-all;
}
.or-behavior {
  align-items: center;
}
.or-tag {
  background: #ecf5ff;
  color: #409eff;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
}
.or-points {
  align-items: flex-end;
}
.or-delta {
  color: #f56c6c;
  font-weight: 600;
}
.or-status-text {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
}
.st-pending { color: #e6a23c; background: #fdf6ec; }
.st-shipped { color: #409eff; background: #ecf5ff; }
.st-delivered { color: #67c23a; background: #f0f9eb; }
.st-cancelled { color: #909399; background: #f4f4f5; }

/* === 商品列表区 === */
.shop-section {
  background: #fff;
  border-radius: 8px;
  padding: 12px;
}
.shop-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.shop-card {
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: center;
}
.shop-icon {
  width: 56px;
  height: 56px;
  object-fit: contain;
  margin: 0 auto;
}
.shop-icon-placeholder {
  width: 56px;
  height: 56px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #d9ecff;
  color: #409eff;
  font-size: 24px;
  font-weight: 700;
  border-radius: 8px;
}
.shop-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.shop-name {
  font-size: 13px;
  color: #303133;
  font-weight: 500;
  word-break: break-all;
  line-height: 1.3;
  min-height: 34px;
}
.shop-cost {
  color: #f56c6c;
  font-size: 13px;
  font-weight: 600;
}
.shop-stock {
  font-size: 11px;
  color: #909399;
}
.shop-stock.out {
  color: #c0c4cc;
}
.btn-redeem {
  margin-top: 4px;
  height: 36px;
  background: #409eff;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn-redeem:disabled {
  background: #c0c4cc;
  cursor: not-allowed;
}

/* === 兑换模态窗 === */
.redeem-modal {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.redeem-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
}
.redeem-box {
  position: relative;
  background: #fff;
  border-radius: 12px;
  padding: 20px 18px;
  width: calc(100% - 48px);
  max-width: 360px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.redeem-title {
  margin: 0 0 14px;
  font-size: 17px;
  color: #303133;
  text-align: center;
}
.redeem-desc {
  margin: 0 0 18px;
  font-size: 14px;
  color: #606266;
  line-height: 1.6;
  text-align: center;
}
.redeem-desc strong {
  color: #f56c6c;
}
.redeem-actions {
  display: flex;
  gap: 10px;
}
.btn-primary,
.btn-secondary {
  flex: 1;
  height: 44px;
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
</style>
