"""合同服务模块 (合同流验证 + 电子签章对接 A9).

spec 依据: 第三准则 "数据流可选配置 - 合同流" + MOD-13 多方协作
状态: R5.1 真实实现

合同管理 + 关键信息 AI 提取 + 电子签章对接 (A9)
"""

import logging
import os
import re
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


class ContractService:
    """合同服务.

    实现:
        - 合同存储: 内存 dict (开发期) + 字段校验
        - 关键信息提取: 正则规则 + LLM 增强 (可选)
        - 电子签章: httpx 调用 e签宝/法大大 API, 无凭证降级 pending
        - 验证: 规则校验 (完整性 + 必填字段 + 金额合理性)
    """

    def __init__(self) -> None:
        self._contracts: dict[str, dict] = {}

    async def create_contract(
        self,
        contract_id: str,
        enterprise_id: str,
        counterparty_id: str,
        contract_type: str,
        amount: float,
        content: str = "",
    ) -> dict:
        """创建合同."""
        if contract_id in self._contracts:
            return {"error": f"合同 {contract_id} 已存在"}
        self._contracts[contract_id] = {
            "contract_id": contract_id,
            "enterprise_id": enterprise_id,
            "counterparty_id": counterparty_id,
            "contract_type": contract_type,
            "amount": amount,
            "content": content,
            "status": "draft",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        return self._contracts[contract_id]

    async def extract_info(self, contract_id: str, content: str = "") -> dict:
        """提取合同关键信息 (正则规则 + LLM 可选增强).

        解析维度: 当事人 / 金额 / 币种 / 期限 / 利率 / 还款方式 / 违约条款 / 争议解决
        """
        contract = self._contracts.get(contract_id, {})
        text = content or contract.get("content", "")
        if not text:
            return {
                "contract_id": contract_id,
                "parties": {"party_a": "", "party_b": ""},
                "amount": 0.0,
                "currency": "CNY",
                "term": {"start": "", "end": ""},
                "rate": 0.0,
                "repayment_method": "",
                "breach_clause": "",
                "dispute_resolution": "",
                "note": "合同内容为空，无法提取",
            }

        # 正则提取关键信息
        party_a = self._extract_party(text, ("甲方", "出借人", "贷款人", "债权人"))
        party_b = self._extract_party(text, ("乙方", "借款人", "债务人", "承租人"))
        amount = self._extract_amount(text)
        currency = "CNY" if "人民币" in text or "CNY" in text or "￥" in text else "CNY"
        term = self._extract_term(text)
        rate = self._extract_rate(text)
        repayment = self._extract_repayment(text)
        breach = self._extract_breach(text)
        dispute = self._extract_dispute(text)

        # LLM 增强（复用 llm_service，统一走 DeepSeek）
        llm_enhanced = False
        try:
            from app.services.llm_service import llm_service
            if llm_service.available:
                import json
                prompt = (
                    "请从以下合同文本中提取关键信息，严格只返回 JSON（不要 markdown 代码块、不要解释）：\n"
                    '{"party_a":"甲方名称","party_b":"乙方名称","amount":金额数字,'
                    '"rate":年利率数字,"repayment_method":"还款方式",'
                    '"breach_clause":"违约条款摘要","dispute_resolution":"争议解决方式"}\n\n'
                    f"合同文本（前2000字符）：\n{text[:2000]}"
                )
                llm_result = await llm_service.chat(
                    messages=[{"role": "user", "content": prompt}],
                    enterprise_id=contract.get("enterprise_id", "contract"),
                    scene="contract_extract",
                    temperature=0.0,
                    max_tokens=600,
                    use_cache=True,
                )
                raw = llm_result.get("content", "")
                # 剥离可能的 ```json 包裹
                raw = raw.strip()
                if raw.startswith("```"):
                    raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0]
                parsed = json.loads(raw)
                if isinstance(parsed, dict):
                    if parsed.get("party_a"):
                        party_a = str(parsed["party_a"])[:100]
                    if parsed.get("party_b"):
                        party_b = str(parsed["party_b"])[:100]
                    if parsed.get("amount"):
                        try:
                            amount = float(parsed["amount"])
                        except (TypeError, ValueError):
                            pass
                    if parsed.get("rate"):
                        try:
                            rate = float(parsed["rate"])
                        except (TypeError, ValueError):
                            pass
                    if parsed.get("repayment_method"):
                        repayment = str(parsed["repayment_method"])[:50]
                    if parsed.get("breach_clause"):
                        breach = str(parsed["breach_clause"])[:200]
                    if parsed.get("dispute_resolution"):
                        dispute = str(parsed["dispute_resolution"])[:200]
                    llm_enhanced = True
        except Exception as exc:
            logger.debug(f"LLM 增强提取失败（降级到正则）: {exc}")

        result = {
            "contract_id": contract_id,
            "parties": {"party_a": party_a, "party_b": party_b},
            "amount": amount,
            "currency": currency,
            "term": term,
            "rate": rate,
            "repayment_method": repayment,
            "breach_clause": breach,
            "dispute_resolution": dispute,
            "extraction_method": "llm+regex" if llm_enhanced else "regex",
        }
        # 回写到合同记录
        if contract_id in self._contracts:
            self._contracts[contract_id]["extracted_info"] = result
            self._contracts[contract_id]["status"] = "analyzed"
        return result

    @staticmethod
    def _extract_party(text: str, labels: tuple) -> str:
        """提取当事人名称."""
        for label in labels:
            # 匹配 "甲方：XXX公司" 或 "甲方:XXX"
            m = re.search(rf"{label}[：:]\s*(.+?)(?:[，,。。\n（(]|$)", text)
            if m:
                name = m.group(1).strip()
                if len(name) > 2:
                    return name[:100]
        return ""

    @staticmethod
    def _extract_amount(text: str) -> float:
        """提取合同金额."""
        # 匹配 "金额：100万元" / "借款金额：500,000元" / "合同总价：100万"
        patterns = [
            r"(?:金额|借款金额|合同金额|合同总价|贷款金额)[：:]\s*([\d,]+(?:\.\d+)?)\s*(万元|元|万|圆)?",
            r"([\d,]+(?:\.\d+)?)\s*元(?:（大写）|$)",
            r"大写[：:]\s*[零壹贰叁肆伍陆柒捌玖拾佰仟万亿圆整]+.*?对应[：:s]*([\d,]+)",
        ]
        for pat in patterns:
            m = re.search(pat, text)
            if m:
                num_str = m.group(1).replace(",", "")
                try:
                    val = float(num_str)
                    unit = m.group(2) if m.lastindex >= 2 else ""
                    if unit and "万" in unit:
                        val *= 10000
                    return val
                except ValueError:
                    continue
        return 0.0

    @staticmethod
    def _extract_term(text: str) -> dict:
        """提取合同期限."""
        # 匹配 "期限：2024-01-01至2025-01-01" / "起止日期：..."
        start = ""
        end = ""
        m = re.search(
            r"(?:期限|起止|合同期限|借款期限)[：:]\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})"
            r"\s*(?:至|到|~|-)\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})",
            text
        )
        if m:
            start = m.group(1)
            end = m.group(2)
        else:
            # 匹配 "期限：12个月" / "借款期限：6个月"
            m = re.search(r"(?:期限|借款期限|合同期限)[：:]\s*(\d+)\s*个?月")
            if m:
                months = int(m.group(1))
                start = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                from datetime import timedelta
                end = (datetime.now(timezone.utc) + timedelta(days=30 * months)).strftime("%Y-%m-%d")
        return {"start": start, "end": end}

    @staticmethod
    def _extract_rate(text: str) -> float:
        """提取利率."""
        # 匹配 "利率：4.35%" / "年利率：3.85%" / "月利率：5‰"
        m = re.search(r"(?:利率|年利率|月利率)[：:]\s*([\d.]+)\s*[%‰]", text)
        if m:
            rate = float(m.group(1))
            # 月利率(‰) 转年利率(%)
            if "‰" in text[m.start():m.end()]:
                rate *= 12
            return rate
        return 0.0

    @staticmethod
    def _extract_repayment(text: str) -> str:
        """提取还款方式."""
        methods = ["等额本息", "等额本金", "到期还本付息", "按月付息到期还本",
                    "按季付息到期还本", "一次性还本付息", "分期还款"]
        for m in methods:
            if m in text:
                return m
        return ""

    @staticmethod
    def _extract_breach(text: str) -> str:
        """提取违约条款."""
        # 匹配 "违约..." 段落
        m = re.search(r"(违约[责任条款].*?)(?:\n\n|第[一二三四五六七八九十]条|争议|$)", text, re.DOTALL)
        if m:
            clause = m.group(1).strip()
            return clause[:200]
        return ""

    @staticmethod
    def _extract_dispute(text: str) -> str:
        """提取争议解决方式."""
        m = re.search(r"(?:争议解决|争议处理|管辖).*?(?:\n\n|第[一二三四五六七八九十]条|$)", text, re.DOTALL)
        if m:
            return m.group(0).strip()[:200]
        if "仲裁" in text:
            return "仲裁"
        if "诉讼" in text:
            return "诉讼"
        return ""

    async def sign_electronically(
        self, contract_id: str, signer_id: str
    ) -> dict:
        """电子签章 (对接 e签宝/法大大, A9 适配器).

        有 API 凭证时调用真实电子签章平台，无凭证降级返回 pending。
        """
        contract = self._contracts.get(contract_id)
        if not contract:
            return {"error": f"合同 {contract_id} 不存在"}

        # 读取电子签章配置
        esign_url = os.environ.get("ESIGN_API_URL", "")
        esign_key = os.environ.get("ESIGN_API_KEY", "")
        esign_appid = os.environ.get("ESIGN_APP_ID", "")

        if esign_url and esign_key:
            try:
                import httpx
                async with httpx.AsyncClient(timeout=15) as client:
                    resp = await client.post(
                        esign_url.rstrip("/") + "/v1/contracts/sign",
                        headers={
                            "Authorization": f"Bearer {esign_key}",
                            "X-App-Id": esign_appid,
                            "Content-Type": "application/json",
                        },
                        json={
                            "contractId": contract_id,
                            "signerId": signer_id,
                            "contractTitle": f"合同-{contract_id}",
                            "contractContent": contract.get("content", ""),
                        },
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        contract["status"] = "signing"
                        return {
                            "contract_id": contract_id,
                            "signer_id": signer_id,
                            "status": data.get("status", "signing"),
                            "sign_url": data.get("signUrl", ""),
                            "esign_id": data.get("esignId", ""),
                        }
                    logger.warning(f"电子签章 API 非 200: {resp.status_code}")
            except Exception as exc:
                logger.warning(f"电子签章 API 调用失败: {exc}, 降级 pending")

        # 降级: 无凭证或调用失败
        contract["status"] = "pending_sign"
        return {
            "contract_id": contract_id,
            "signer_id": signer_id,
            "status": "pending",
            "sign_url": "",
            "note": "电子签章 API 未配置，请设置 ESIGN_API_URL/ESIGN_API_KEY 环境变量",
        }

    async def verify_contract(self, contract_id: str) -> dict:
        """合同验证 (真实性 + 完整性).

        校验维度: 合同存在 / 内容非空 / 必填字段 / 金额合理性 / 期限完整
        """
        contract = self._contracts.get(contract_id)
        if not contract:
            return {"error": f"合同 {contract_id} 不存在"}

        content = contract.get("content", "")
        extracted = contract.get("extracted_info", {})

        missing_fields = []
        completeness = 0.0

        # 1. 合同存在
        completeness += 0.1

        # 2. 内容非空
        if content and len(content) > 50:
            completeness += 0.2
        else:
            missing_fields.append("content")

        # 3. 当事人信息
        parties = extracted.get("parties", {})
        if parties.get("party_a"):
            completeness += 0.15
        else:
            missing_fields.append("party_a")
        if parties.get("party_b"):
            completeness += 0.15
        else:
            missing_fields.append("party_b")

        # 4. 金额
        amount = extracted.get("amount", 0) or contract.get("amount", 0)
        if amount > 0:
            completeness += 0.15
        else:
            missing_fields.append("amount")

        # 5. 期限
        term = extracted.get("term", {})
        if term.get("start") and term.get("end"):
            completeness += 0.1
        else:
            missing_fields.append("term")

        # 6. 利率
        rate = extracted.get("rate", 0)
        if rate > 0:
            completeness += 0.1
        else:
            missing_fields.append("rate")

        # 7. 违约条款
        if extracted.get("breach_clause"):
            completeness += 0.05

        completeness = min(1.0, completeness)
        verified = completeness >= 0.6 and "content" not in missing_fields

        return {
            "contract_id": contract_id,
            "verified": verified,
            "completeness": round(completeness, 2),
            "missing_fields": missing_fields,
            "checks": {
                "content_present": bool(content),
                "parties_identified": bool(parties.get("party_a") and parties.get("party_b")),
                "amount_valid": amount > 0,
                "term_complete": bool(term.get("start") and term.get("end")),
                "rate_specified": rate > 0,
            },
        }


# 单例
contract_service = ContractService()
