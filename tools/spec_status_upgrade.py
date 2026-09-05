#!/usr/bin/env python3
"""
spec_status_upgrade.py — 把 spec.md 中已彻底实现的 Requirement 从 "部分实现" 升级为 "已实现(production)"

策略:
  - 接收一组 Spec ID 列表 (B 类已彻底实现的项)
  - 在 spec.md 中找到对应 Requirement 段落
  - 把 **Status**: 部分实现 → **Status**: 已实现(production)
  - 同时更新 Code Ref 描述 (可选)
  - 输出 diff 报告

用法:
  python tools/spec_status_upgrade.py --dry-run        # 预览改动
  python tools/spec_status_upgrade.py --apply          # 实际写入
  python tools/spec_status_upgrade.py --apply --ids MOD-01,MOD-02  # 指定子集
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC_PATH = ROOT / ".trae" / "specs" / "build-fintech-trust-hub" / "spec.md"

# B 类 18 项已彻底实现的 Spec ID (V3 路线图覆盖的 18 项, 不含 A 类外部依赖阻塞的 10 项)
B_CLASS_UPGRADED_IDS = [
    "MOD-01",  # 资金监管 (资金流向图谱 API)
    "MOD-02",  # 风控 (仪表盘数据 API)
    "MOD-05",  # 保险 (投保流程 + 保单管理)
    "MOD-06",  # 履约评分 (历史趋势预测)
    "MOD-07",  # 隐私计算 (性能基准 + FedAvg)
    "MOD-12",  # IoT 感知 (设备认证)
    "MOD-13",  # 多方协作 (e签宝/法大大 SDK)
    "MOD-15",  # 兜底引擎 (Dockerfile + 断网 E2E)
    "INFRA-04",  # 改造沙箱 (PDF 报告导出)
    "INFRA-05",  # RPA (多银行 PDF 模板)
    "CORE-01",  # 跨服务编排 (3 业务 DAG)
    "DATA-04",  # IoT EMQX 自部署完善
    "APP-01",  # 银行端 (交互面板)
    "APP-02",  # 企业端 (移动 APP)
    "APP-03",  # 财务顾问 (客户管理 + 工作流)
    "APP-04",  # 监管沙盒 (穿透报告模态窗)
    "APP-07",  # 关联机构 (Kanban 看板)
    "CORE-04",  # F1 触发引导
    "CORE-05",  # 通用组件库
]


def find_requirement_section(spec_text: str, spec_id: str) -> tuple[int, int, str] | None:
    """找到指定 Spec ID 的 Requirement 段落 (从 ### Requirement: 到下一个 ### 或文件尾)."""
    # 匹配 ### Requirement: XXX-XX 标题
    pattern = re.compile(
        rf'^(###\s+Requirement:\s+{re.escape(spec_id)}\b[^\n]*$)',
        re.MULTILINE
    )
    m = pattern.search(spec_text)
    if not m:
        return None
    start = m.start()
    # 找下一个 ### 标题或 --- 分隔线
    next_pattern = re.compile(r'^###\s|^---\s*$', re.MULTILINE)
    next_m = next_pattern.search(spec_text, m.end())
    end = next_m.start() if next_m else len(spec_text)
    return start, end, spec_text[start:end]


def upgrade_status(section_text: str) -> tuple[str, bool]:
    """把段落中的 Status 从部分实现升级为已实现(production)."""
    changed = False
    new_text = section_text

    # **Status**: 部分实现 → **Status**: 已实现(production)
    # 也处理 **Status**: 部分实现 (Scenario, ...) 这种带括号的情况
    patterns = [
        (r'(\*\*Status\*\*:\s*)部分实现\s*\(Scenario[^\)]*\)', r'\1已实现(production)'),
        (r'(\*\*Status\*\*:\s*)部分实现', r'\1已实现(production)'),
    ]
    for pat, repl in patterns:
        new_text, n = re.subn(pat, repl, new_text)
        if n > 0:
            changed = True
            break

    return new_text, changed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='预览改动, 不写入文件')
    parser.add_argument('--apply', action='store_true', help='实际写入 spec.md')
    parser.add_argument('--ids', type=str, help='指定 Spec ID 子集 (逗号分隔), 默认全部 B 类')
    args = parser.parse_args()

    if not args.dry_run and not args.apply:
        print('请指定 --dry-run 或 --apply')
        return 1

    ids = args.ids.split(',') if args.ids else B_CLASS_UPGRADED_IDS

    spec_text = SPEC_PATH.read_text(encoding='utf-8')
    upgraded = 0
    skipped = []

    for spec_id in ids:
        result = find_requirement_section(spec_text, spec_id)
        if not result:
            skipped.append((spec_id, '段落未找到'))
            continue
        start, end, section = result
        new_section, changed = upgrade_status(section)
        if changed:
            spec_text = spec_text[:start] + new_section + spec_text[end:]
            upgraded += 1
            print(f'  ✓ 升级 {spec_id}: 部分实现 → 已实现(production)')
        else:
            # 检查是否已经是已实现
            if '已实现' in section:
                skipped.append((spec_id, '已是已实现状态, 跳过'))
            else:
                skipped.append((spec_id, 'Status 行未匹配, 可能格式异常'))

    print(f'\n=== 汇总 ===')
    print(f'升级: {upgraded} 项')
    print(f'跳过: {len(skipped)} 项')
    for sid, reason in skipped:
        print(f'  {sid}: {reason}')

    if args.apply and upgraded > 0:
        SPEC_PATH.write_text(spec_text, encoding='utf-8')
        print(f'\n[OK] 已写入 {SPEC_PATH} (升级 {upgraded} 项)')
    elif args.dry_run:
        print(f'\n[DRY-RUN] 未写入文件 (--apply 实际写入)')

    return 0


if __name__ == '__main__':
    sys.exit(main())
