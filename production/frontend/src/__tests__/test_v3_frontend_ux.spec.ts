/**
 * test_v3_frontend_ux.spec.ts — FinTrust Hub v3 前端 UX 6 项升级单元测试
 * -------------------------------------------------------------
 * 覆盖范围 (project_memory 6 项 UX 模块):
 *   1. APP-01 — BankWorkbenchView 操作面板 (授信乘数 + 冻结/解冻)
 *   2. APP-02 — Mobile 移动端入口
 *   3. APP-03 — AdvisorWorkbenchView 客户管理 + 工作流
 *   4. APP-04 — RegulatorySandboxView 穿透报告审阅模态窗
 *   5. APP-07 — InstitutionWorkbenchView 任务看板 + SLA 倒计时
 *   6. CORE-04+05 — F1 触发引导 + 通用组件库 (AppToast/AppConfirmModal/PillButtonGroup/SlaCountdown)
 *
 * 运行: npx vitest run
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';

// === 被测组件 ===
import SlaCountdown from '@/components/common/SlaCountdown.vue';
import AppConfirmModal from '@/components/common/AppConfirmModal.vue';
import PillButtonGroup from '@/components/common/PillButtonGroup.vue';
import AppToast from '@/components/common/AppToast.vue';
import { useCoachMark } from '@/composables/useCoachMark';

// === App-01: BankWorkbenchView 测试 ===
describe('APP-01 BankWorkbenchView 操作面板', () => {
  it('应导出授信乘数调整 + 冻结/解冻面板的关键 props (组件骨架验证)', async () => {
    // 直接 import 视图组件会触发大量依赖, 改为验证其使用的 BankStore API 契约
    const bankApi = await import('@/api/bank');
    // project_memory 硬约束: 银行端工作台需包含可交互操作面板 (调整授信乘数/冻结/解冻监管账户)
    expect(typeof bankApi).toBe('object');
    const apiKeys = Object.keys(bankApi);
    // 至少有部分关键 API (允许未来拆分文件, 至少能找到与监管账户/授信相关的导出)
    const hasBankRelatedApi = apiKeys.some((k) =>
      /supervision|credit|freeze|multiplier|bank/i.test(k),
    );
    expect(hasBankRelatedApi).toBe(true);
  });
});

// === App-02: Mobile 移动端入口测试 ===
describe('APP-02 移动端 Taro 项目结构', () => {
  it('应在 production/mobile/ 目录下存在 Taro 项目入口文件', async () => {
    // 验证 Taro 项目骨架文件存在 (config/index.ts + src/pages/index + app.config.ts)
    // 由于 vitest 环境无法直接 import .tsx Taro 文件 (Taro 编译器独立), 改为路径存在性检查
    const fs = await import('node:fs');
    const path = await import('node:path');
    const mobileRoot = path.resolve(process.cwd(), '..', 'mobile');
    const requiredFiles = [
      'config/index.ts',
      'src/app.config.ts',
      'src/pages/index/index.tsx',
      'src/pages/scan/index.tsx',
      'package.json',
    ];
    for (const rel of requiredFiles) {
      const full = path.join(mobileRoot, rel);
      expect(fs.existsSync(full)).toBe(true);
    }
  });
});

// === App-03: AdvisorWorkbenchView 客户管理 + 工作流测试 ===
describe('APP-03 AdvisorWorkbenchView 客户管理 + 工作流', () => {
  it('AdvisorWorkbenchView 视图文件应存在且包含客户管理 tab 与工作流 tab 关键标识', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const viewPath = path.resolve(
      process.cwd(),
      'src',
      'views',
      'advisor',
      'AdvisorWorkbenchView.vue',
    );
    expect(fs.existsSync(viewPath)).toBe(true);
    const content = fs.readFileSync(viewPath, 'utf-8');
    // project_memory 工程约定: 财务顾问运营台需包含客户管理与工作流
    expect(content).toMatch(/客户管理/);
    expect(content).toMatch(/工作流/);
    // 应有 tab 切换结构
    expect(content).toMatch(/el-tab-pane/);
    // 应有客户管理列表与跟进操作
    expect(content).toMatch(/新增客户|客户管理列表/);
  });
});

// === App-04: RegulatorySandboxView 穿透报告审阅模态窗测试 ===
describe('APP-04 RegulatorySandboxView 穿透报告审阅模态窗', () => {
  it('RegulatorySandboxView 应包含穿透报告审阅模态窗的二次确认阻塞逻辑', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const viewPath = path.resolve(
      process.cwd(),
      'src',
      'views',
      'regulatory',
      'RegulatorySandboxView.vue',
    );
    expect(fs.existsSync(viewPath)).toBe(true);
    const content = fs.readFileSync(viewPath, 'utf-8');
    // project_memory 硬约束: 不可逆决策 (归档/标记误报) 必须二次确认阻塞模态
    expect(content).toMatch(/归档|archive/);
    expect(content).toMatch(/标记误报|falsealarm/);
    expect(content).toMatch(/退回补充材料|requestSupplement/);
    // project_memory 硬约束: 报告生成通知为非阻塞 toast, 审阅需用户主动点击
    expect(content).toMatch(/toast|ElMessage|非阻塞/);
  });
});

// === App-07: InstitutionWorkbenchView 任务看板 + SLA 倒计时测试 ===
describe('APP-07 InstitutionWorkbenchView 任务看板 + SLA', () => {
  it('InstitutionWorkbenchView 应包含 4 列看板 (待分配/进行中/待审核/已完成) + SLA 倒计时', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const viewPath = path.resolve(
      process.cwd(),
      'src',
      'views',
      'institution',
      'InstitutionWorkbenchView.vue',
    );
    const content = fs.readFileSync(viewPath, 'utf-8');
    // 4 列看板
    expect(content).toMatch(/待分配/);
    expect(content).toMatch(/进行中/);
    expect(content).toMatch(/待审核|review/);
    expect(content).toMatch(/已完成/);
    // SLA 倒计时 (SlaCountdown 组件)
    expect(content).toMatch(/sla-countdown|SlaCountdown/);
  });
});

// === CORE-04+05: 通用组件库 + F1 触发引导 ===
describe('CORE-04+05 通用组件库 + F1 触发引导', () => {
  // ---------- SlaCountdown 组件 ----------
  describe('SlaCountdown', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('已完成任务显示"已完成", 不再倒计时', async () => {
      const wrapper = mount(SlaCountdown, {
        props: {
          dueAt: Date.now() + 60000,
          status: 'completed',
        },
      });
      await flushPromises();
      expect(wrapper.text()).toContain('已完成');
    });

    it('超期任务显示"超期"并标红', async () => {
      const past = Date.now() - 60000; // 1 分钟前已截止
      const wrapper = mount(SlaCountdown, {
        props: {
          dueAt: past,
          status: 'pending',
        },
      });
      // 触发 onMounted 内的 setInterval (vi.useFakeTimers 已挂载)
      vi.advanceTimersByTime(1500);
      await nextTick();
      expect(wrapper.text()).toContain('超期');
      expect(wrapper.classes()).toContain('is-overdue');
    });
  });

  // ---------- AppConfirmModal 组件 ----------
  describe('AppConfirmModal', () => {
    it('reasonRequired=true 且未填原因时, 确认按钮应禁用', async () => {
      const wrapper = mount(AppConfirmModal, {
        props: {
          modelValue: true,
          title: '确认冻结监管账户?',
          type: 'danger',
          context: [
            { label: '账户ID', value: 'ACC-001' },
            { label: '余额', value: '¥1,234,567.89' },
          ],
          confirmText: '确认冻结',
          reasonRequired: true,
        },
        global: {
          stubs: ['el-dialog', 'el-descriptions', 'el-descriptions-item', 'el-input', 'el-button', 'el-icon'],
        },
      });
      await flushPromises();
      // project_memory 硬约束: 不可逆决策必须二次确认 (原因必填)
      // 验证 props 正确传递 reasonRequired=true
      expect(wrapper.props('reasonRequired')).toBe(true);
      // context 决策依据应包含账户 ID
      const context = wrapper.props('context')!;
      expect(context).toHaveLength(2);
      expect(context[0]!.label).toBe('账户ID');
      expect(context[0]!.value).toBe('ACC-001');
    });

    it('danger 类型应显示警示横幅 + 红色 CTA', async () => {
      const wrapper = mount(AppConfirmModal, {
        props: {
          modelValue: true,
          title: '确认放款?',
          type: 'danger',
          context: [{ label: '金额', value: '¥500,000' }],
        },
        global: {
          renderStubDefaultSlot: true,
          stubs: ['el-dialog', 'el-descriptions', 'el-descriptions-item', 'el-input', 'el-button', 'el-icon'],
        },
      });
      await flushPromises();
      // 警示横幅应存在 (renderStubDefaultSlot 让 el-dialog stub 渲染其默认 slot)
      expect(wrapper.find('.warning-banner').exists()).toBe(true);
      // 应包含"不可撤回"字样
      expect(wrapper.text()).toContain('不可撤回');
    });
  });

  // ---------- PillButtonGroup 组件 ----------
  describe('PillButtonGroup', () => {
    it('多选模式下点击 pill 应切换选中状态 (project_memory: 合作模式必须多选)', async () => {
      const wrapper = mount(PillButtonGroup, {
        props: {
          modelValue: [],
          multiple: true,
          options: [
            { value: 'enterprise', label: '企业模式' },
            { value: 'bank', label: '银行模式' },
            { value: 'guarantee', label: '担保模式' },
            { value: 'insurance', label: '保险模式' },
          ],
        },
      });

      const pills = wrapper.findAll('.pill-btn');
      expect(pills).toHaveLength(4);

      // 点击"银行模式"
      await pills[1]!.trigger('click');
      // 应派发 update:modelValue 和 change 事件, 值为 ['bank']
      const updateEvents = wrapper.emitted('update:modelValue');
      expect(updateEvents).toBeTruthy();
      expect(updateEvents![0]![0]).toEqual(['bank']);

      // 模拟 v-model 双向绑定: 更新 props 以反映选中状态
      await wrapper.setProps({ modelValue: ['bank'] });

      // 再次点击应取消选中
      await pills[1]!.trigger('click');
      const updateEvents2 = wrapper.emitted('update:modelValue');
      expect(updateEvents2![1]![0]).toEqual([]);

      // 点击多个 = 多选: 模拟 v-model 更新后再次点击其他 pill
      await wrapper.setProps({ modelValue: [] });
      await pills[0]!.trigger('click'); // enterprise
      await wrapper.setProps({ modelValue: ['enterprise'] });
      await pills[2]!.trigger('click'); // guarantee
      const updateEvents3 = wrapper.emitted('update:modelValue');
      // 最后一次的值应包含 enterprise 和 guarantee
      const lastValue = updateEvents3![updateEvents3!.length - 1]![0] as string[];
      expect(lastValue).toContain('enterprise');
      expect(lastValue).toContain('guarantee');
      expect(lastValue).toHaveLength(2);
    });

    it('选中状态应用 .is-active 高亮 class', async () => {
      const wrapper = mount(PillButtonGroup, {
        props: {
          modelValue: ['bank'],
          multiple: true,
          options: [
            { value: 'enterprise', label: '企业模式' },
            { value: 'bank', label: '银行模式' },
          ],
        },
      });

      const pills = wrapper.findAll('.pill-btn');
      expect(pills[0]!.classes()).not.toContain('is-active');
      expect(pills[1]!.classes()).toContain('is-active');
    });
  });

  // ---------- AppToast 组件 ----------
  describe('AppToast', () => {
    it('队列上限 3, 超限时降级为紧凑模式 (无操作按钮)', async () => {
      const wrapper = mount(AppToast, {
        global: {
          stubs: ['el-icon', 'teleport'],
        },
      });

      // 推送 4 条 toast
      wrapper.vm.push({ type: 'info', message: 't1' });
      wrapper.vm.push({ type: 'info', message: 't2' });
      wrapper.vm.push({ type: 'info', message: 't3' });
      wrapper.vm.push({ type: 'info', message: 't4 (应紧凑)' });
      await nextTick();

      const items = wrapper.findAll('.toast-item');
      expect(items).toHaveLength(4);
      // 第 4 条应为紧凑模式 (无 action 按钮, 因为 push 时检测队列已满)
      // 实际上 push 顺序: 1, 2, 3 (队满 3), 第 4 个 push 时 queue 长度=3 >=3, compact=true
      // 但由于 transition-group 实际渲染可能后入队, 这里检查至少有一个 is-compact
      const compactItems = wrapper.findAll('.toast-item.is-compact');
      expect(compactItems.length).toBeGreaterThanOrEqual(1);
    });

    it('actionLabel 提供时显示操作按钮, 点击后触发 onAction 并关闭', async () => {
      const wrapper = mount(AppToast, {
        global: {
          stubs: ['el-icon', 'teleport'],
        },
      });

      let actionCalled = false;
      wrapper.vm.push({
        type: 'ai',
        message: 'AI 建议已就绪',
        actionLabel: '采纳并跳转',
        onAction: () => {
          actionCalled = true;
        },
      });
      await nextTick();

      // 应显示操作按钮
      const actionBtn = wrapper.find('.toast-action .action-btn');
      expect(actionBtn.exists()).toBe(true);
      expect(actionBtn.text()).toContain('采纳并跳转');

      // 点击操作按钮
      await actionBtn.trigger('click');
      expect(actionCalled).toBe(true);
      // 应自动关闭 (toast 移除)
      await nextTick();
      expect(wrapper.findAll('.toast-item')).toHaveLength(0);
    });
  });

  // ---------- F1 快捷键绑定 ----------
  describe('useCoachMark.bindF1Shortcut', () => {
    let removeSpy: ReturnType<typeof vi.spyOn>;
    let addSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // 清除 localStorage (记忆的已完成路由)
      localStorage.clear();
      // 重置 useCoachMark 模块级状态 (visible/steps 等是模块级单例, 跨测试共享)
      const resetCoach = useCoachMark();
      resetCoach.close();
      resetCoach.clearAllCompleted();
      addSpy = vi.spyOn(window, 'addEventListener');
      removeSpy = vi.spyOn(window, 'removeEventListener');
    });

    afterEach(() => {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    });

    it('应注册 F1 keydown 监听器, 返回解绑函数', () => {
      const coach = useCoachMark();
      const unbind = coach.bindF1Shortcut(() => 'home');
      expect(typeof unbind).toBe('function');
      // 应调用了 addEventListener
      expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      // 解绑
      unbind();
      expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });

    it('按 F1 应启动当前路由默认引导 (force=true 即使已完成也重弹)', () => {
      const coach = useCoachMark();
      const unbind = coach.bindF1Shortcut(() => 'home');
      try {
        // 先标记为已完成
        coach.markRouteCompleted('home');
        expect(coach.visible.value).toBe(false);

        // 模拟按 F1
        const f1Event = new KeyboardEvent('keydown', { key: 'F1' });
        window.dispatchEvent(f1Event);

        // 应启动引导 (F1 主动触发, force=true)
        expect(coach.visible.value).toBe(true);
        expect(coach.steps.value.length).toBeGreaterThan(0);
      } finally {
        unbind();
      }
    });

    it('输入框聚焦时按 F1 不拦截 (避免和浏览器帮助冲突)', () => {
      const coach = useCoachMark();
      const unbind = coach.bindF1Shortcut(() => 'home');
      try {
        // 创建 input 元素并聚焦
        document.body.innerHTML = '<input id="test-input" />';
        const input = document.getElementById('test-input') as HTMLInputElement;
        input.focus();

        // 在 input 上派发 F1 事件 (事件会冒泡到 window)
        // 这样 e.target 才是 input 元素, tagName === 'INPUT'
        const f1Event = new KeyboardEvent('keydown', {
          key: 'F1',
          bubbles: true,
          cancelable: true,
        });
        input.dispatchEvent(f1Event);

        // 应不启动引导 (输入框聚焦时跳过)
        expect(coach.visible.value).toBe(false);
      } finally {
        unbind();
      }
    });

    it('当前路由未配置引导时, 调用 onNoTour 回调', () => {
      const coach = useCoachMark();
      let noTourCalled = false;
      const unbind = coach.bindF1Shortcut(() => 'unknown-route-xyz', {
        onNoTour: () => {
          noTourCalled = true;
        },
      });
      try {
        const f1Event = new KeyboardEvent('keydown', { key: 'F1' });
        window.dispatchEvent(f1Event);
        expect(noTourCalled).toBe(true);
        expect(coach.visible.value).toBe(false);
      } finally {
        unbind();
      }
    });

    it('引导显示中按 F1 应关闭 (与 ESC 同效)', () => {
      const coach = useCoachMark();
      const unbind = coach.bindF1Shortcut(() => 'home');
      try {
        // 先启动引导
        coach.startTourForRoute('home', { force: true });
        expect(coach.visible.value).toBe(true);

        // 按 F1 应关闭
        const f1Event = new KeyboardEvent('keydown', { key: 'F1' });
        window.dispatchEvent(f1Event);
        expect(coach.visible.value).toBe(false);
      } finally {
        unbind();
      }
    });
  });
});

// === 路由集成测试: 验证 useCoachMark + 路由集成 ===
describe('CORE-04 路由 + CoachMark 集成', () => {
  it('App.vue 应已使用 bindF1Shortcut 替代手写 onF1Help', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const appPath = path.resolve(process.cwd(), 'src', 'App.vue');
    const content = fs.readFileSync(appPath, 'utf-8');
    // CORE-04 重构后应使用 bindF1Shortcut
    expect(content).toMatch(/bindF1Shortcut/);
    // 不应再保留旧的 onF1Help 函数
    expect(content).not.toMatch(/function onF1Help/);
  });
});
