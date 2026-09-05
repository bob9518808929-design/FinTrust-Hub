# tools/ — Spec/Tasks/Checklist/Code 追溯工具

对齐 spec.md L5 状态约定:

> 每个 `### Requirement:` 段落下方须标注 `**Status** / **Priority** / **Code Ref**` 三字段
> （已实现/部分实现/未开始, P0/P1/P2, 对应代码路径）

## 工具清单

### spec_trace.py — Spec 追溯脚本

**职责**: 扫描 `spec.md` 全部 Requirement, 提取 Status/Priority/Code Ref, 校验代码路径是否真实存在.

**用法**:

```bash
# 全量扫描 + 控制台报告
python tools/spec_trace.py

# 仅打印 dangling/未标注项
python tools/spec_trace.py --missing

# 输出 JSON 报告
python tools/spec_trace.py --json tools/trace_report.json

# 自定义 spec 路径
python tools/spec_trace.py --spec path/to/spec.md
```

**输出字段** (JSON 模式):

| 字段 | 说明 |
|---|---|
| `req_id` | Requirement 标题 |
| `status` | 已实现 / 部分实现 / 未开始 / 未标注 |
| `priority` | P0 / P1 / P2 |
| `code_ref` | spec.md 原始 Code Ref 文本 |
| `code_ref_exists` | 路径是否真实存在 (bool) |
| `code_ref_locations` | 解析后的真实路径列表 |
| `dangling_paths` | 不存在的路径 (代码引用悬空) |
| `line_no` | 在 spec.md 中的行号 |

**判定逻辑**:

- `Code Ref` 文本含 `production/xxx/yyy.py` → 在 `production/backend`、`production/frontend/src`、`production/ai-engine` 下查找
- `Code Ref` 文本含 `simulation/xxx` → 在 `simulation/` 下查找
- 文本为 `spec v3.x 新增...` 或 `无 production 代码` → 视为合法 (未实现但已声明)
- 含 `.py/.ts/.vue` 等代码扩展名 → 强制校验文件存在

## 与 P2.2 的关系

P1.4/P1.5/P1.6 修复后, 大量 service 文件已创建但 spec.md 中的 Code Ref 仍标注"未开始".
P2.2 任务: 把 spec.md 的 Code Ref 字段扩展为三列 `(sim | prod-be | prod-fe)`, 与实际代码同步.

本脚本作为 P2.2 的支撑工具, 先暴露不一致, 再批量更新 spec.md.
