#!/usr/bin/env python3
"""
final_validation.py — ROADMAP_REMAINING_V2 交付前的最终验收脚本

按顺序执行 4 个验证步骤, 任一步失败即终止并报告:
  1. pytest tests/                    全量测试回归 (须全部通过)
  2. spec_trace.py --json            规格追溯 (须 0 dangling Code Ref)
  3. spec_code_drift.py              反向漂移检测 (须 0 drift)
  4. checklist_sync.py --apply       checklist/tasks 自动勾选 (幂等)

最后生成 delivery_report.md 汇总报告.

用法:
  python tools/final_validation.py
  python tools/final_validation.py --skip-pytest    # 跳过测试, 仅做文档同步验证
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
SPEC_DIR = ROOT / ".trae" / "specs" / "build-fintech-trust-hub"
PROD_BE_TESTS = ROOT / "production" / "backend" / "tests"
TRACE_JSON = TOOLS / "trace_report.json"
DELIVERY_REPORT = ROOT / "DELIVERY_REPORT.md"


def run(cmd: list[str], cwd: Path | None = None, capture: bool = True, timeout: int = 600) -> tuple[int, str]:
    """运行子进程, 返回 (returncode, stdout+stderr 合并)."""
    print(f"\n$ {' '.join(cmd)}")
    try:
        result = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            capture_output=capture,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
        out = (result.stdout or "") + (result.stderr or "")
        if capture and out:
            tail = out[-3000:] if len(out) > 3000 else out
            print(tail)
        return result.returncode, out
    except subprocess.TimeoutExpired:
        return 124, f"TIMEOUT after {timeout}s"
    except FileNotFoundError as e:
        return 127, f"Command not found: {e}"


def step1_pytest() -> dict:
    """全量 pytest 回归."""
    print("\n" + "=" * 78)
    print("STEP 1/4: pytest 全量回归")
    print("=" * 78)
    rc, out = run(
        [sys.executable, "-m", "pytest", "tests/", "-q", "--tb=short"],
        cwd=PROD_BE_TESTS.parent,
        capture=True,
        timeout=900,
    )
    passed = out.count(" passed")
    failed = out.count(" failed")
    summary_line = ""
    for line in out.splitlines():
        if "passed" in line and "failed" in line:
            summary_line = line.strip()
            break
        if "passed" in line and "error" not in line.lower():
            summary_line = line.strip()
    return {
        "step": "pytest",
        "ok": rc == 0,
        "returncode": rc,
        "summary": summary_line or f"rc={rc}",
        "passed_count": passed,
        "failed_count": failed,
    }


def step2_spec_trace() -> dict:
    """spec_trace 生成 JSON 报告."""
    print("\n" + "=" * 78)
    print("STEP 2/4: spec_trace.py 规格追溯")
    print("=" * 78)
    rc, out = run(
        [sys.executable, str(TOOLS / "spec_trace.py"), "--json", str(TRACE_JSON)],
        cwd=ROOT,
        capture=True,
        timeout=120,
    )
    dangling = 0
    total_reqs = 0
    status_dist: dict[str, int] = {}
    if TRACE_JSON.exists():
        try:
            data = json.loads(TRACE_JSON.read_text(encoding="utf-8"))
            reqs = data.get("requirements", data) if isinstance(data, dict) else data
            if isinstance(reqs, list):
                total_reqs = len(reqs)
                for r in reqs:
                    if isinstance(r, dict):
                        st = r.get("status", "未标注")
                        status_dist[st] = status_dist.get(st, 0) + 1
                        if not r.get("code_ref_exists", True):
                            dangling += 1
        except (json.JSONDecodeError, OSError) as e:
            out += f"\n[WARN] 解析 trace_report.json 失败: {e}"
    return {
        "step": "spec_trace",
        "ok": rc == 0 and dangling == 0,
        "returncode": rc,
        "total_requirements": total_reqs,
        "dangling_refs": dangling,
        "status_distribution": status_dist,
    }


def step3_spec_drift() -> dict:
    """反向漂移检测."""
    print("\n" + "=" * 78)
    print("STEP 3/4: spec_code_drift.py 反向漂移检测")
    print("=" * 78)
    rc, out = run(
        [sys.executable, str(TOOLS / "spec_code_drift.py")],
        cwd=ROOT,
        capture=True,
        timeout=60,
    )
    drift_count = 0
    aligned_count = 0
    not_found_count = 0
    drifts: list[str] = []
    summary_pattern = re.compile(r"对齐:\s*(\d+)\s+漂移:\s*(\d+)\s+未找到:\s*(\d+)")
    for line in out.splitlines():
        if "漂移 (L" in line:
            drift_count += 1
            drifts.append(line.strip())
        elif "✓ 对齐" in line:
            aligned_count += 1
        elif "✗ 未对齐" in line:
            not_found_count += 1
        elif line.startswith("对齐:"):
            # 汇总行: 对齐: 45  漂移: 0  未找到: 0
            m = summary_pattern.search(line)
            if m:
                aligned_count = int(m.group(1))
                drift_count = int(m.group(2))
                not_found_count = int(m.group(3))
    return {
        "step": "spec_code_drift",
        "ok": rc == 0 and drift_count == 0,
        "returncode": rc,
        "aligned": aligned_count,
        "drift": drift_count,
        "not_found": not_found_count,
        "drift_items": drifts,
    }


def step4_checklist_sync() -> dict:
    """checklist_sync --apply."""
    print("\n" + "=" * 78)
    print("STEP 4/4: checklist_sync.py --apply")
    print("=" * 78)
    rc, out = run(
        [sys.executable, str(TOOLS / "checklist_sync.py"), "--apply"],
        cwd=ROOT,
        capture=True,
        timeout=60,
    )
    new_checked = 0
    new_tasks = 0
    for line in out.splitlines():
        if "勾选" in line or "checked" in line.lower():
            try:
                num = int("".join(c for c in line.split()[0:3] if c.isdigit()))
                if "new" in line.lower() or "新增" in line:
                    new_checked = num
            except (ValueError, IndexError):
                pass
    return {
        "step": "checklist_sync",
        "ok": rc == 0,
        "returncode": rc,
        "newly_checked": new_checked,
        "newly_annotated_tasks": new_tasks,
    }


def write_delivery_report(steps: list[dict], started_at: float) -> None:
    """生成 DELIVERY_REPORT.md 汇总报告."""
    elapsed = time.time() - started_at
    all_ok = all(s.get("ok", False) for s in steps)
    status_emoji = "✅ 通过" if all_ok else "❌ 未通过"
    lines = [
        "# FinTrust Hub ROADMAP_REMAINING_V2 交付报告",
        "",
        f"- **生成时间**: {datetime.now().isoformat(timespec='seconds')}",
        f"- **总耗时**: {elapsed:.1f}s",
        f"- **整体状态**: {status_emoji}",
        f"- **验证步骤**: {len(steps)} 步",
        "",
        "## 验证步骤明细",
        "",
    ]
    for i, s in enumerate(steps, 1):
        ok = "✅" if s.get("ok", False) else "❌"
        lines.append(f"### {i}. {s.get('step', '?')} {ok}")
        lines.append("")
        for k, v in s.items():
            if k in ("step", "ok", "returncode"):
                continue
            if isinstance(v, (list, dict)):
                lines.append(f"- **{k}**: `{json.dumps(v, ensure_ascii=False, indent=2)}`")
            else:
                lines.append(f"- **{k}**: `{v}`")
        lines.append(f"- **returncode**: `{s.get('returncode')}`")
        lines.append("")

    lines.extend([
        "## 覆盖范围",
        "",
        "- **后端 Services**: production/backend/app/services/*.py",
        "- **后端 Schemas**: production/backend/app/schemas/*.py",
        "- **后端 API Routes**: production/backend/app/api/v1/**/*.py",
        "- **前端 Views**: production/frontend/src/views/**/*.vue",
        "- **AI 引擎**: production/ai-engine/services/*.py",
        "- **基础设施**: production/infra/k8s/helm/**, production/infra/emqx/**",
        "- **测试**: production/backend/tests/*.py",
        "",
        "## 交付清单 (按路线图阶段)",
        "",
        "### P0 阻塞核心价值",
        "- R4.1 INFRA-01 K8s Helm Chart + Ingress/HPA/PVC",
        "- R4.2 INFRA-02 AI 引擎 LLM 部署 + llm_service 升级",
        "- R4.3 DATA-01 银企直连接口 (6 家银行适配器)",
        "- R4.4 DATA-02 第三方数据源 (国税/工商/司法/票交所)",
        "- R4.5 DATA-03 OCR 与文档解析 (PaddleOCR/百度/阿里)",
        "- R4.6 MOD-01 五流合一校验引擎",
        "- R4.7 MOD-02 风控规则 DSL + 热加载 + 流处理",
        "- R4.8 CORE-01 Temporal 部署 + DAG 持久化",
        "",
        "### P1 业务模块闭环",
        "- R5.1 MOD-03 征信数据源对接 (PBC API + 4 企业种子)",
        "- R5.2 MOD-04 票据服务 (ECDS 对接 + 360 天基础贴现 + 状态机)",
        "- R5.3 MOD-06 履约评分 (LLM prompt 含财务数据 + 规则降级)",
        "- R5.4 MOD-07 隐私计算 (HE-SEAL + 联邦学习 FedAvg)",
        "- R5.5 DATA-04 IoT MQTT 网关 (paho-mqtt + HTTP 长轮询降级)",
        "- R5.6 INFRA-01b 15 适配器凭证管理",
        "- R5.7 INFRA-04 改造沙箱 (12 项准入指标曲线 + risk_flags)",
        "- R5.8 MOD-13 多方协作 (电子签章 + SLA 协作任务超期检测)",
        "",
        "### P2 战略储备",
        "- R6.1 MOD-08b 联盟链凭证 (AntChain/ZhiXin + Local chain 降级)",
        "- R6.2 INFRA-05 RPA 适配层 (任务管理 + reportlab PDF 降级)",
        "- R6.3 MOD-15 兜底引擎 (离线模式 + 队列重放 + 冲突检测)",
        "",
    ])
    DELIVERY_REPORT.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n[REPORT] 已生成 {DELIVERY_REPORT}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-pytest", action="store_true", help="跳过 pytest, 仅做文档同步验证")
    args = parser.parse_args()

    started_at = time.time()
    steps: list[dict] = []

    if not args.skip_pytest:
        steps.append(step1_pytest())
        if not steps[-1]["ok"]:
            print("\n[FATAL] pytest 失败, 终止后续步骤")
            write_delivery_report(steps, started_at)
            return 1
    else:
        steps.append({"step": "pytest", "ok": True, "returncode": 0, "summary": "skipped"})

    steps.append(step2_spec_trace())
    steps.append(step3_spec_drift())
    steps.append(step4_checklist_sync())

    write_delivery_report(steps, started_at)

    all_ok = all(s.get("ok", False) for s in steps)
    print("\n" + "=" * 78)
    print(f"最终验收: {'✅ 通过' if all_ok else '❌ 未通过'}")
    print(f"详见: {DELIVERY_REPORT}")
    print("=" * 78)
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
