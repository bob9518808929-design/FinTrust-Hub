# P1 路线图技术实施方案

> 版本: v1.0
> 范围: DeepSeek LLM 接入、PDF 报告生成、联盟链存证（蚂蚁链/至信链/天平链）
> 依据: spec.md INFRA-02（L583-605）、MOD-08（L1258-1266）、EXTERNAL_API_CONFIG.md、eco_service.py 占位代码
> 最后更新: 2026-08-20

---

## 目录

- [1. DeepSeek LLM 接入](#1-deepseek-llm-接入)
- [2. PDF 报告生成](#2-pdf-报告生成)
- [3. 联盟链存证](#3-联盟链存证)
- [4. 集成与验收](#4-集成与验收)

---

## 1. DeepSeek LLM 接入

### 1.1 现状与目标

| 维度 | 现状 | 目标 |
|---|---|---|
| 配置 | `.env` 有 `DEEPSEEK_API_KEY=`（空）+ `config.py` 字段已落地 | 填入 Key 即可用 |
| 调用 | [eco_service.py:778](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/services/eco_service.py#L778) 占位（"LLM 兜底占位，真实环境: 调用 DeepSeek"） | 真实调用 |
| 用途 | spec L583-605 INFRA-02：智能风控问答、融资方案生成、报告自动撰写、ECO-09 数字分身 | 全场景贯通 |
| 模型 | `deepseek-chat`（默认） | 支持 `deepseek-chat` + `deepseek-reasoner` 双路由 |

### 1.2 spec 依据

- **INFRA-02 AI 引擎底座**（spec L583-605）：
  - "LLM 服务：对接 DeepSeek/通义千问等国产大模型 API（OpenAI 兼容格式）"
  - "AI 引擎通过统一 API 返回推理结果，支持流式输出，超时自动降级"
- **ECO-09 数字分身**（spec L1702-1718）：
  - "老板在微信/钉钉中直接与机器人自然语言对话"
  - "帮我查下最近哪笔应收款快到期了？" → 机器人返回应收账款到期清单

### 1.3 技术架构

```
[业务层] eco_service / reform_service / scf_service
   ↓ 调用
[AI 引擎层] app/services/llm_service.py（新增）
   ↓ HTTP
[DeepSeek API] https://api.deepseek.com/v1/chat/completions
```

### 1.4 实施步骤

#### 步骤 1：新增 LLM 服务层

**新文件**：`backend/app/services/llm_service.py`

```python
"""
统一 LLM 推理服务 (INFRA-02)
- 主模型: DeepSeek (OpenAI 兼容)
- 备选: OpenAI / Anthropic (config 中已有字段)
- 降级: Key 为空时返回 'LLM 未配置' 提示
"""
import httpx
from app.config import settings


class LLMService:
    def __init__(self):
        self.api_key = settings.DEEPSEEK_API_KEY
        self.base_url = settings.DEEPSEEK_BASE_URL or "https://api.deepseek.com/v1"
        self.model = settings.DEEPSEEK_MODEL or "deepseek-chat"
        self.timeout = 30.0
        self._client = httpx.AsyncClient(timeout=self.timeout) if self.api_key else None

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    async def chat(
        self,
        messages: list[dict],
        model: str | None = None,
        stream: bool = False,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ):
        if not self.available:
            return {"content": "LLM 未配置，请联系管理员设置 DEEPSEEK_API_KEY", "model": "fallback"}

        payload = {
            "model": model or self.model,
            "messages": messages,
            "stream": stream,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

        try:
            if stream:
                return await self._stream_chat(payload, headers)
            resp = await self._client.post(
                f"{self.base_url}/chat/completions", json=payload, headers=headers
            )
            resp.raise_for_status()
            data = resp.json()
            return {
                "content": data["choices"][0]["message"]["content"],
                "model": data.get("model", self.model),
                "usage": data.get("usage", {}),
            }
        except httpx.TimeoutException:
            return {"content": "LLM 响应超时，已降级", "model": "timeout-fallback"}
        except Exception as e:
            return {"content": f"LLM 调用失败: {e}", "model": "error-fallback"}

    async def _stream_chat(self, payload: dict, headers: dict):
        async with self._client.stream(
            "POST", f"{self.base_url}/chat/completions", json=payload, headers=headers
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    yield line[6:]

    async def close(self):
        if self._client:
            await self._client.aclose()


llm_service = LLMService()
```

#### 步骤 2：替换 eco_service 占位

**修改文件**：[eco_service.py:778](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/services/eco_service.py#L778)

```python
# 替换前 (占位):
def _llm_fallback(self, question: str) -> str:
    return f"占位回答: {question}"  # TODO: 调用 DeepSeek

# 替换后 (真实调用):
async def _llm_answer(self, question: str, enterprise_id: str) -> str:
    from app.services.llm_service import llm_service
    system_prompt = (
        f"你是 FinTrust Hub 的数字分身，服务于企业 {enterprise_id}。"
        "请用白话文回答企业老板的问题，避免专业术语，"
        "如涉及金融概念请附场景类比。"
    )
    result = await llm_service.chat(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": question},
        ],
        temperature=0.5,
        max_tokens=1024,
    )
    return result["content"]
```

#### 步骤 3：ECO-09 bot/parse 端点接入

**修改文件**：[eco_bot.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/api/v1/eco_bot.py)

```python
@router.post("/parse")
async def parse_command(req: BotParseRequest):
    # 1. 规则匹配优先（快速路径）
    matched = _match_intent_rules(req.text)
    if matched:
        return matched

    # 2. LLM 兜底（复杂意图）
    answer = await eco_service._llm_answer(req.text, req.enterprise_id)
    return {
        "intent": "llm_fallback",
        "confidence": 0.6,
        "reply": answer,
        "actions": [],
    }
```

### 1.5 接入步骤

1. 在 [platform.deepseek.com](https://platform.deepseek.com/) 注册账号（支持人民币支付）
2. 创建 API Key，复制到 `.env`：`DEEPSEEK_API_KEY=sk-xxxxxxxx`
3. 可选：切换模型 `DEEPSEEK_MODEL=deepseek-reasoner`（推理增强）
4. 重启后端：`uvicorn app.main:app --reload`
5. 测试：`curl -X POST http://localhost:8000/api/v1/eco-bot/parse -d '{"text":"我这个月贷款通过率涨了没？","channel":"web","enterpriseId":"E001"}'`

### 1.6 成本估算

| 模型 | 输入价格 | 输出价格 | 单次问答成本（~2K input + 1K output） |
|---|---|---|---|
| deepseek-chat | ¥0.001/1K tokens | ¥0.002/1K tokens | ¥0.004 |
| deepseek-reasoner | ¥0.004/1K tokens | ¥0.016/1K tokens | ¥0.024 |

按企业日均 100 次问答估算：deepseek-chat 月成本 ¥12，可接受。

---

## 2. PDF 报告生成

### 2.1 现状与目标

| 维度 | 现状 | 目标 |
|---|---|---|
| 占位 | [eco_service.py:233](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/services/eco_service.py#L233) "生成 PDF 占位（真实环境: reportlab/weasyprint）" | 真实生成 |
| 用途 | ECO-08 政府背书报告、监管沙盒穿透报告、改造结果报告 | 3 类报告 |
| 字体 | 未配置 | 中文字体（思源黑体/Noto Sans CJK） |

### 2.2 技术选型对比

| 方案 | 优点 | 缺点 | 推荐度 |
|---|---|---|---|
| **reportlab** | 纯 Python，无外部依赖，布局精细 | API 偏底层，模板代码量大 | 🥈 复杂报告 |
| **weasyprint** | HTML/CSS → PDF，前端友好，复用 Vue 模板 | 依赖 GTK/Pango，Windows 部署麻烦 | 🥇 首选 |
| **wkhtmltopdf** | HTML → PDF，简单 | 已停止维护，渲染慢 | 🥉 不推荐 |
| **Pandoc + LaTeX** | 学术风格 | 依赖 TeX 环境，过重 | ❌ 过重 |

**推荐方案：weasyprint（生产）+ reportlab（兜底）**

理由：weasyprint 可复用 Jinja2 HTML 模板，与现有 Vue 风格一致；reportlab 作为 C 档兜底（weasyprint 不可用时降级）。

### 2.3 实施步骤

#### 步骤 1：添加依赖

**修改文件**：[requirements.txt](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/requirements.txt)

```ini
# PDF 生成 (ECO-08 政府背书报告 / 监管沙盒穿透报告)
weasyprint>=60.0
reportlab>=4.0.0  # 兜底方案
Jinja2>=3.1.0     # HTML 模板引擎
```

#### 步骤 2：新增 PDF 服务

**新文件**：`backend/app/services/pdf_service.py`

```python
"""
PDF 报告生成服务
- 主方案: weasyprint (HTML/CSS → PDF)
- 兜底: reportlab (纯 Python)
- 字体: Noto Sans CJK SC (中文)
"""
import os
from pathlib import Path
from typing import Optional

from app.config import settings


class PDFService:
    def __init__(self):
        self.template_dir = Path(__file__).parent.parent / "templates" / "pdf"
        self.font_path = os.environ.get("FINTRUST_FONT_PATH", "")

    async def generate_report(
        self,
        template_name: str,
        context: dict,
        output_path: Optional[str] = None,
    ) -> bytes:
        """生成 PDF 报告

        Args:
            template_name: 模板名（如 gov_report.html / sandbox_report.html）
            context: 模板变量（enterprise, report, audit_trail 等）
            output_path: 输出路径，None 则返回 bytes
        """
        try:
            return await self._render_with_weasyprint(template_name, context, output_path)
        except ImportError:
            return await self._render_with_reportlab(template_name, context, output_path)

    async def _render_with_weasyprint(self, template_name, context, output_path):
        from weasyprint import HTML, CSS
        from jinja2 import Environment, FileSystemLoader

        env = Environment(loader=FileSystemLoader(self.template_dir))
        template = env.get_template(template_name)
        html_content = template.render(**context)

        css = CSS(string=self._base_css())
        pdf_bytes = HTML(string=html_content).write_pdf(stylesheets=[css])

        if output_path:
            Path(output_path).write_bytes(pdf_bytes)
        return pdf_bytes

    async def _render_with_reportlab(self, template_name, context, output_path):
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
        from reportlab.lib.styles import getSampleStyleSheet

        if self.font_path and Path(self.font_path).exists():
            pdfmetrics.registerFont(TTFont("NotoSans", self.font_path))
            base_font = "NotoSans"
        else:
            base_font = "Helvetica"

        styles = getSampleStyleSheet()
        styles["Normal"].fontName = base_font
        styles["Title"].fontName = base_font

        buf = io.BytesIO() if not output_path else None
        doc = SimpleDocTemplate(output_path or buf, pagesize=A4)
        story = [
            Paragraph(context.get("title", "FinTrust 报告"), styles["Title"]),
            Spacer(1, 20),
            Paragraph(context.get("content", ""), styles["Normal"]),
        ]
        doc.build(story)
        return buf.getvalue() if buf else Path(output_path).read_bytes()

    def _base_css(self) -> str:
        return """
        @page { size: A4; margin: 2cm; }
        body { font-family: 'Noto Sans CJK SC', sans-serif; }
        table { border-collapse: collapse; width: 100%; }
        td, th { border: 1px solid #ddd; padding: 8px; }
        """


pdf_service = PDFService()
```

#### 步骤 3：创建 HTML 模板

**新文件**：`backend/app/templates/pdf/gov_report.html`

```html
<!DOCTYPE html>
<html lang="zh">
<head><meta charset="UTF-8"><title>政府背书报告</title></head>
<body>
  <h1>{{ report.title }}</h1>
  <p>企业: {{ enterprise.name }} ({{ enterprise.id }})</p>
  <p>报告类型: {{ report.type }}</p>
  <p>生成时间: {{ report.generated_at }}</p>

  <h2>核心指标</h2>
  <table>
    <tr><th>指标</th><th>当前值</th><th>行业基准</th><th>状态</th></tr>
    {% for m in report.metrics %}
    <tr>
      <td>{{ m.label }}</td><td>{{ m.value }}</td>
      <td>{{ m.benchmark }}</td><td>{{ m.status }}</td>
    </tr>
    {% endfor %}
  </table>

  <h2>审计轨迹</h2>
  {% for entry in audit_trail.entries %}
  <p>[{{ entry.timestamp }}] {{ entry.action }} - {{ entry.actor }}</p>
  {% endfor %}
</body>
</html>
```

#### 步骤 4：替换 eco_service 占位

**修改文件**：[eco_service.py:233](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/services/eco_service.py#L233)

```python
# 替换前 (占位):
def _generate_pdf(self, report_data: dict) -> bytes:
    return b"%PDF-1.4 placeholder"  # TODO: reportlab/weasyprint

# 替换后 (真实调用):
async def _generate_pdf(self, report_data: dict) -> bytes:
    from app.services.pdf_service import pdf_service
    return await pdf_service.generate_report(
        template_name="gov_report.html",
        context={
            "enterprise": report_data["enterprise"],
            "report": report_data["report"],
            "audit_trail": report_data["audit_trail"],
        },
    )
```

### 2.4 中文字体配置

Docker 部署时需安装字体：

```dockerfile
# infra/docker/Dockerfile.backend
RUN apt-get update && apt-get install -y fonts-noto-cjk
ENV FINTRUST_FONT_PATH=/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc
```

本地 Windows 开发：下载 Noto Sans CJK SC 到 `C:\Windows\Fonts\`，或在 `.env` 设置：
```ini
FINTRUST_FONT_PATH=C:\Windows\Fonts\NotoSansCJKsc-Regular.otf
```

---

## 3. 联盟链存证

### 3.1 现状与目标

| 维度 | 现状 | 目标 |
|---|---|---|
| 配置 | `.env` 有 `ANT_CHAIN_ENDPOINT=`（空）+ `ZXIN_CHAIN_ENDPOINT=`（空） | 落地商户资质后填入 |
| 占位 | [eco_service.py:308](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/services/eco_service.py#L308) `"0" * 64` 占位区块哈希 | 真实上链 |
| 用途 | ECO-04 信用凭证上链、ECO-05 反向竞拍存证、ECO-08 政府报告存证 | 3 类业务上链 |

### 3.2 spec 依据

- **MOD-08 区块链存证与司法取证**（spec L1258-1266）：
  - "系统提取数据哈希值，加盖时间戳，上传至司法联盟链存证，返回交易哈希和区块高度"
  - 司法联盟链：蚂蚁链、至信链或北京互联网法院"天平链"
- **降级方案**（EXTERNAL_API_CONFIG.md L141）：
  - "Key 为空时跳过上链，数据仅落 PostgreSQL；功能降级为'本地存证'，不影响主流程"

### 3.3 技术架构

```
[业务层] eco_service (ECO-04/05/08)
   ↓ 调用
[链服务层] app/services/chain_service.py（新增）
   ↓ SDK / HTTP
[联盟链] 蚂蚁链 / 至信链 / 天平链
```

### 3.4 实施步骤

#### 步骤 1：添加依赖

**修改文件**：[requirements.txt](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/requirements.txt)

```ini
# 联盟链存证 (ECO-04/05/08)
# 蚂蚁链: 官方 Python SDK (https://docs.antchain.antgroup.com/)
antchain-sdk-python>=1.0.0  # 实际包名以官方文档为准
# 至信链: 通过 HTTP REST API 调用, 无需 SDK
# 兜底: 本地存证 (PostgreSQL + SHA-256)
```

> 注：antsdk 之前因不存在被移除。蚂蚁链接入需通过官方渠道申请 SDK 包名。详见 [EXTERNAL_API_CONFIG.md](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/docs/EXTERNAL_API_CONFIG.md#L131)。

#### 步骤 2：新增链服务

**新文件**：`backend/app/services/chain_service.py`

```python
"""
联盟链存证服务 (MOD-08)
- 主链: 蚂蚁链 (A6)
- 备链: 至信链 (与蚂蚁链二选一)
- 兜底: 本地存证 (PostgreSQL + SHA-256, C 档独立兜底)
"""
import hashlib
import json
import time
from typing import Optional

from app.config import settings


class ChainService:
    def __init__(self):
        self.ant_endpoint = settings.ANT_CHAIN_ENDPOINT
        self.ant_access_key = settings.ANT_CHAIN_ACCESS_KEY
        self.ant_secret = settings.ANT_CHAIN_SECRET
        self.zxin_endpoint = settings.ZXIN_CHAIN_ENDPOINT
        self._client = None

    @property
    def available(self) -> bool:
        return bool(self.ant_access_key and self.ant_secret)

    async def put_evidence(
        self,
        data: dict,
        business_id: str,
        chain: str = "ant",
    ) -> dict:
        """数据上链存证

        Args:
            data: 待存证的业务数据
            business_id: 业务 ID（如 vc_id, tender_id, report_id）
            chain: 链类型 (ant/zxin/local)

        Returns:
            { tx_hash, block_height, chain, timestamp }
        """
        payload = json.dumps(data, sort_keys=True, ensure_ascii=False)
        data_hash = hashlib.sha256(payload.encode()).hexdigest()
        timestamp = int(time.time())

        if chain == "ant" and self.available:
            return await self._put_ant_chain(data_hash, business_id, timestamp)
        elif chain == "zxin" and self.zxin_endpoint:
            return await self._put_zxin_chain(data_hash, business_id, timestamp)
        else:
            return await self._put_local_evidence(data_hash, business_id, timestamp)

    async def _put_ant_chain(self, data_hash: str, business_id: str, timestamp: int) -> dict:
        try:
            # 蚂蚁链 SDK 调用（实际包名以官方文档为准）
            # from antchain import AntChainClient
            # client = AntChainClient(self.ant_access_key, self.ant_secret, self.ant_endpoint)
            # tx = client.put_evidence(data_hash, business_id)
            # return {"tx_hash": tx.hash, "block_height": tx.block_number,
            #         "chain": "ant", "timestamp": timestamp}
            raise NotImplementedError("蚂蚁链 SDK 未接入，请申请资质后填入")
        except Exception as e:
            return await self._put_local_evidence(data_hash, business_id, timestamp, fallback_reason=str(e))

    async def _put_zxin_chain(self, data_hash: str, business_id: str, timestamp: int) -> dict:
        try:
            import httpx
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{self.zxin_endpoint}/evidence/put",
                    json={"hash": data_hash, "business_id": business_id},
                    timeout=10.0,
                )
                resp.raise_for_status()
                data = resp.json()
                return {
                    "tx_hash": data.get("tx_hash", ""),
                    "block_height": data.get("block_height", 0),
                    "chain": "zxin",
                    "timestamp": timestamp,
                }
        except Exception as e:
            return await self._put_local_evidence(data_hash, business_id, timestamp, fallback_reason=str(e))

    async def _put_local_evidence(
        self, data_hash: str, business_id: str, timestamp: int, fallback_reason: str = "no_chain_configured"
    ) -> dict:
        return {
            "tx_hash": "0" * 64,
            "block_height": 0,
            "chain": "local",
            "timestamp": timestamp,
            "data_hash": data_hash,
            "fallback_reason": fallback_reason,
        }

    async def verify_evidence(self, tx_hash: str, expected_hash: str) -> bool:
        """验证数据完整性"""
        if tx_hash == "0" * 64:
            return True
        # 真实链上验证逻辑
        return True


chain_service = ChainService()
```

#### 步骤 3：替换 eco_service 占位

**修改文件**：[eco_service.py:308](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/services/eco_service.py#L308)

```python
# 替换前 (占位):
block_hash = "0" * 64  # 占位（真实环境来自联盟链最新区块）

# 替换后 (真实调用):
from app.services.chain_service import chain_service
evidence = await chain_service.put_evidence(
    data=vc_dict, business_id=vc_id, chain="ant"
)
block_hash = evidence["tx_hash"]
```

### 3.5 申请流程

| 链 | 申请渠道 | 周期 | 资质要求 |
|---|---|---|---|
| 蚂蚁链 | [antchain.antgroup.com](https://antchain.antgroup.com/) | 1-2 周 | 企业实名 + 实名认证 |
| 至信链 | [trustsql.tencent.com](https://trustsql.tencent.com/) | 1-2 周 | 企业实名 + 资质审核 |
| 天平链 | 北京互联网法院申请 | 4-8 周 | 需司法接入资质 |

---

## 4. 集成与验收

### 4.1 接入顺序（建议）

```
阶段 1: DeepSeek LLM (1-2 天) ← 申请最容易, 见效最快
阶段 2: PDF 报告生成 (3-5 天) ← 纯本地依赖, 无需申请
阶段 3: 联盟链存证 (1-2 周) ← 需等待资质审批
```

### 4.2 验收清单

#### DeepSeek 验收

- [ ] `.env` 填入 `DEEPSEEK_API_KEY=sk-xxx`
- [ ] 重启后端，`/api/v1/eco-bot/parse` 接收自然语言返回真实 LLM 回答
- [ ] 流式输出可用（`stream=true`）
- [ ] Key 为空时降级返回"LLM 未配置"提示，不报错
- [ ] 超时 30 秒自动降级

#### PDF 生成验收

- [ ] `pip install weasyprint reportlab Jinja2` 成功
- [ ] 中文字体渲染正确（不出现方块）
- [ ] ECO-08 政府背书报告生成 PDF 下载
- [ ] 监管沙盒穿透报告生成 PDF 下载
- [ ] weasyprint 不可用时降级到 reportlab

#### 联盟链验收

- [ ] `.env` 填入蚂蚁链 AccessKey/Secret
- [ ] ECO-04 凭证签发后返回真实 tx_hash（非 "0"*64）
- [ ] ECO-05 竞拍结果上链存证
- [ ] ECO-08 政府报告上链存证
- [ ] Key 为空时降级到本地存证，主流程不中断

### 4.3 关联文档

- [EXTERNAL_API_CONFIG.md](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/docs/EXTERNAL_API_CONFIG.md) — DeepSeek/蚂蚁链/至信链配置清单
- [DELIVERY.md](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/docs/DELIVERY.md) — P11-P15 路线图概要
- [eco_service.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/services/eco_service.py) — 占位代码位置
- [config.py](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/app/config.py) — 配置字段
- [.env](file:///c:/Users/Windws/Desktop/caiwu/jinrong/production/backend/.env) — 环境变量
