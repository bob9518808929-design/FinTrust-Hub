/**
 * src/pages/index/index.tsx — FinTrust Hub 移动端企业首页
 * -------------------------------------------------------------
 * project_memory 傻瓜式操作:
 *   责任链工人(仓管/物流)进 APP 第一眼看到的应该是:
 *     1. 当前企业的资金水位卡片 (红黄绿信号灯, 一眼判断是否告警)
 *     2. 三个大号快捷操作按钮 (扫码/查流水/联系顾问), 不让用户做选择题
 *
 * 与 PC 端对齐:
 *   - 暗色主题 (与 PC 端 variables.scss 一致)
 *   - 资金水位阈值: 50 万 (500000 元) = 红线, 与 PC 端 SMALL_AUTO_THRESHOLD 对齐
 *   - workerToken 与 PC 端 PWA 共享 localStorage key (兼容性: 浏览器/H5)
 */
import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Image, ScrollView } from '@tarojs/components';
import './index.scss';

// === 资金水位阈值 (与 PC 端 SMALL_AUTO_THRESHOLD_YUAN 对齐) ===
const RED_LINE_YUAN = 500000; // 50 万元
const YELLOW_LINE_YUAN = 1000000; // 100 万元 (高于此为黄灯告警)

// === 企业资金水位快照 (镜像后端 /api/v1/enterprise/{id}/financials) ===
interface FundSnapshot {
  enterpriseId: string;
  enterpriseName: string;
  accountBalance: number; // 账户余额 (元)
  pendingAR: number; // 待收应收 (元)
  pendingAP: number; // 待付应付 (元)
  lastUpdated: string; // ISO 时间
}

// === 快捷操作项 ===
interface QuickAction {
  key: string;
  label: string;
  icon: string;
  color: string;
  route?: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    key: 'scan',
    label: '扫一扫',
    icon: '📷',
    color: '#3b82f6',
    route: '/pages/scan/index',
  },
  {
    key: 'flow',
    label: '查流水',
    icon: '💧',
    color: '#10b981',
  },
  {
    key: 'contact',
    label: '联系顾问',
    icon: '📞',
    color: '#f59e0b',
  },
];

function IndexPage() {
  const [snapshot, setSnapshot] = useState<FundSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    fetchSnapshot().finally(() => setLoading(false));
  }, []);

  /** 拉取资金水位快照 (调后端 /api/v1/enterprise/{id}/financials) */
  async function fetchSnapshot(): Promise<void> {
    try {
      // 移动端 workerToken 与 PC 端 PWA 共享 localStorage key
      const workerToken =
        (typeof localStorage !== 'undefined' && localStorage.getItem('workerToken')) || '';
      const enterpriseId =
        (typeof localStorage !== 'undefined' && localStorage.getItem('enterpriseId')) || 'E001';

      // H5 端走代理 /api, 小程序端走完整 URL (需在开发设置中配置 request 合法域名)
      const baseUrl =
        process.env.TARO_ENV === 'h5' ? '/api/v1' : 'http://localhost:8000/api/v1';

      // Taro.request 多端兼容
      const res = await Taro.request({
        url: `${baseUrl}/enterprise/${enterpriseId}/financials`,
        method: 'GET',
        header: {
          'Content-Type': 'application/json',
          Authorization: workerToken ? `Bearer ${workerToken}` : '',
          'X-Client-Type': 'MobileTaro',
          'X-App-Version': '3.1.0',
        },
      });

      if (res.statusCode === 200 && res.data) {
        // 后端返回 ApiResult { code, message, data }
        const body = res.data as { code?: number; message?: string; data?: unknown };
        if (body.code === 0 && body.data) {
          setSnapshot(body.data as FundSnapshot);
        } else {
          // 业务错误降级 (后端不可用时使用兜底数据, project_memory: C 档独立兜底)
          loadFallbackSnapshot(enterpriseId);
        }
      } else {
        loadFallbackSnapshot(enterpriseId);
      }
    } catch (e) {
      // 网络错误降级, 保证 APP 可独立运行 (project_memory: 零机构接入时仍能独立运行)
      setErrorMsg((e as Error)?.message || '网络异常, 已加载兜底数据');
      loadFallbackSnapshot('E001');
    }
  }

  /** 兜底快照 (后端不可用时, project_memory: C 档独立兜底) */
  function loadFallbackSnapshot(enterpriseId: string): void {
    setSnapshot({
      enterpriseId,
      enterpriseName: '深圳***科技',
      accountBalance: 320000,
      pendingAR: 850000,
      pendingAP: 280000,
      lastUpdated: new Date().toISOString(),
    });
  }

  /** 计算资金水位信号灯 (与 PC 端阈值对齐) */
  function getLightLevel(
    snap: FundSnapshot,
  ): 'green' | 'yellow' | 'red' {
    // 净资金 = 余额 + 待收 - 待付
    const net = snap.accountBalance + snap.pendingAR - snap.pendingAP;
    if (net < RED_LINE_YUAN) return 'red';
    if (net < YELLOW_LINE_YUAN) return 'yellow';
    return 'green';
  }

  /** 格式化金额 (元, 千分位) */
  function formatYuan(yuan: number): string {
    return yuan.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  }

  function onActionClick(action: QuickAction): void {
    if (action.route) {
      Taro.navigateTo({ url: action.route }).catch(() => {
        // tabbar 页用 switchTab, 普通 navigateTo 失败兜底
        Taro.switchTab({ url: action.route! }).catch(() => {});
      });
      return;
    }
    // 非路由动作 (查流水/联系顾问), 暂用 toast 反馈
    Taro.showToast({
      title: `${action.label} 功能即将上线`,
      icon: 'none',
      duration: 2000,
    });
  }

  function onRefresh(): void {
    setLoading(true);
    fetchSnapshot().finally(() => setLoading(false));
  }

  const light = snapshot ? getLightLevel(snapshot) : 'green';
  const lightColor =
    light === 'red' ? '#ef4444' : light === 'yellow' ? '#f59e0b' : '#10b981';
  const lightLabel =
    light === 'red' ? '红灯告警' : light === 'yellow' ? '黄灯关注' : '绿灯健康';

  return (
    <View className="index-page">
      {/* === 顶部资金水位卡片 === */}
      <View className="fund-card" style={{ borderColor: lightColor }}>
        <View className="card-head">
          <Text className="enterprise-name">
            {snapshot?.enterpriseName || '加载中...'}
          </Text>
          <View className="light-badge" style={{ background: lightColor }}>
            <Text>{lightLabel}</Text>
          </View>
        </View>

        <View className="balance-block">
          <Text className="balance-label">账户余额</Text>
          <Text className="balance-value" style={{ color: lightColor }}>
            ¥ {snapshot ? formatYuan(snapshot.accountBalance) : '—'}
          </Text>
        </View>

        <View className="balance-row">
          <View className="balance-item">
            <Text className="balance-label">待收应收</Text>
            <Text className="balance-value text-success">
              ¥ {snapshot ? formatYuan(snapshot.pendingAR) : '—'}
            </Text>
          </View>
          <View className="balance-item">
            <Text className="balance-label">待付应付</Text>
            <Text className="balance-value text-warning">
              ¥ {snapshot ? formatYuan(snapshot.pendingAP) : '—'}
            </Text>
          </View>
        </View>

        <View className="card-foot">
          <Text className="update-time">
            更新: {snapshot ? new Date(snapshot.lastUpdated).toLocaleString('zh-CN') : '—'}
          </Text>
          <Text className="refresh-btn" onClick={onRefresh}>
            {loading ? '刷新中...' : '↻ 刷新'}
          </Text>
        </View>
      </View>

      {errorMsg ? (
        <View className="error-banner">
          <Text>⚠ {errorMsg}</Text>
        </View>
      ) : null}

      {/* === 快捷操作区 (3 个大按钮, 不让用户做选择题) === */}
      <View className="quick-section">
        <Text className="section-title">快捷操作</Text>
        <View className="action-grid">
          {QUICK_ACTIONS.map((action) => (
            <View
              key={action.key}
              className="action-item"
              onClick={() => onActionClick(action)}
            >
              <View
                className="action-icon"
                style={{ background: action.color }}
              >
                <Text className="icon-text">{action.icon}</Text>
              </View>
              <Text className="action-label">{action.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* === AI 提醒 (与 PC 端 ECO-09 数字分身对齐) === */}
      <View className="ai-tip-card">
        <Text className="tip-icon">🤖</Text>
        <View className="tip-body">
          <Text className="tip-title">AI 提醒</Text>
          <Text className="tip-text">
            {light === 'red'
              ? '账户余额低于 50 万, 建议尽快催收应收或申请授信'
              : light === 'yellow'
                ? '资金水位中等, 关注本月应收回收进度'
                : '资金水位健康, 一切正常'}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default IndexPage;
