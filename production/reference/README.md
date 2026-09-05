# reference/ — 业务逻辑参考实现

> **定位**: 本目录存放从 `../../simulation/js/` 迁移过来的 11 个 ECO 模块纯 JS 文件，作为 **业务逻辑参考**，供 `frontend/` 用 Vue 3 + TypeScript 重写时参考流程与数据结构。
>
> **不是生产代码**: 这些文件用纯 JS + localStorage + setTimeout + crypto.subtle 写成，是浏览器端演示原型，**不会**被 production/ 任何层直接引用。

## 文件清单（11 个）

| 模块 | 核心引擎 | UI 视图 | 来源 |
|---|---|---|---|
| ECO-01 阅后即烕 | `eco-burn.js` (37KB) | `view-eco-burn.js` (33KB) | Wave 1 完整产出 |
| ECO-03 无接口适配器 | `eco-rpa.js` (40KB) | `view-eco-rpa.js` (37KB) | Wave 1 完整产出 |
| ECO-06 积分商城 | `eco-pts.js` (43KB) | `view-eco-pts.js` (39KB) | Wave 1 完整产出 |
| ECO-09 数字分身 | `eco-bot.js` (46KB) | `view-eco-bot.js` (34KB) | Wave 1 完整产出 |
| ECO-05 反向竞拍 | `eco-bid.js` (41KB) | （视图未写） | Wave 2 被 kill 前完成核心引擎 |
| ECO-08 政府背书 | `eco-gov.js` (40KB) | `view-eco-gov.js` (40KB) | Wave 2 被 kill 前完整产出 |

**未产出的 3 个模块**（Wave 2 被 kill 时尚未写文件）：
- ECO-02 成果导向阶梯定价 → 重写时直接对齐 spec.md L3849-3892
- ECO-04 MOD-08b 联盟链凭证 → 重写时直接对齐 spec.md L1297-1344
- ECO-07 FinTrust 企业合规指数 → 重写时直接对齐 spec.md L3402-3444

## 如何使用本参考

Vue 3 + TypeScript 重写每个模块时：

1. **读 spec.md 对应章节** 获取 Gherkin 场景与验收项
2. **读本目录对应 JS 文件** 参考：
   - 状态机阶段（如 `idle→loaded→diagnosing→completed→destroyed`）
   - 数据结构字段（如 `eightDimScore / twelveGap / rawFieldsRemoved`）
   - 业务规则（如分成比例 绿 20% / 黄 30% / 橙 40% / R5-Lite 15%）
   - 防刷分逻辑（如 GPS 围栏 / 设备指纹 / 重复扫码）
3. **不要复制代码**，只参考逻辑——纯 JS 与 Vue 3 + TS 不兼容
4. **真实接入替代 mock**：
   - localStorage → PostgreSQL + Redis
   - setTimeout → Kafka + Temporal
   - crypto.subtle → HE-SEAL + FF1 + Shamir
   - SHA-256 模拟链 → 蚂蚁链/至信链 SDK
   - Blob 下载 → Apache POI + iText/PDFBox
   - 模拟聊天 UI → 企业微信 + 钉钉机器人 API
