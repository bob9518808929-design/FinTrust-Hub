"""ECO 9 模块 API 端到端测试.

覆盖每个 ECO 模块的核心端点, 验证端到端贯通:
    ECO-01 阅后即焚  ECO-02 阶梯定价  ECO-03 无接口适配器
    ECO-04 联盟链凭证  ECO-05 反向竞拍  ECO-06 积分商城
    ECO-07 行业指数  ECO-08 政府背书  ECO-09 数字分身

验证策略:
    - GET 端点: 断言 200 (端点返回数据)
    - POST 端点: 断言 200|201|422 (200/201=处理成功, 422=端点已接通且 Pydantic 校验输入)
    - 404/405 = 端点缺失或方法错误 (测试失败)
"""

import pytest

pytestmark = pytest.mark.asyncio

# POST 端点可接受状态: 成功(200/201) 或 输入校验失败(422, 证明端点已接通)
POST_OK = {200, 201, 422}


class TestEcoBurn:
    """ECO-01 阅后即焚零信任诊断. prefix=/eco-burn"""

    async def test_status(self, client):
        r = await client.get("/api/v1/eco-burn/status")
        assert r.status_code == 200
        assert r.json()["code"] == 0

    async def test_load_with_valid_payload(self, client, sample_enterprise_id):
        r = await client.post(
            "/api/v1/eco-burn/load",
            json={
                "enterpriseId": sample_enterprise_id,
                "dataType": "bank_statement",
                "records": [{"date": "2026-08-01", "amount": 100000, "counterparty": "测试对手"}],
                "source": "bank_api",
            },
        )
        assert r.status_code in {200, 201}, f"expected 200/201, got {r.status_code}: {r.text}"

    async def test_progress_and_result(self, client, sample_enterprise_id):
        for sub in ("progress", "result"):
            r = await client.get(f"/api/v1/eco-burn/{sample_enterprise_id}/{sub}")
            assert r.status_code == 200

    async def test_result_materialized_after_progress_completes(self, monkeypatch, sample_enterprise_id):
        """回归: 进度走到 100% 后必须能取到脱敏诊断产物.

        历史缺陷: EcoBurnService 只推进度计时, 从不生成 _results,
        前端轮询到 percentage>=1 后调 /result 永远 404 "无诊断结果".
        """
        from app.schemas.eco import BurnRawDataInput
        from app.services import eco_service as eco_mod

        svc = eco_mod.eco_burn_service
        eid = sample_enterprise_id
        records = [{"date": f"2026-08-{i % 28 + 1:02d}", "amount": 10000 + i} for i in range(60)]
        await svc.loadRawData(BurnRawDataInput(
            enterpriseId=eid, dataType="bank_statement", records=records, source="bank_api",
        ))
        await svc.startDiagnosis(eid)

        # 诊断未走完 → 无产物
        assert await svc.getResult(eid) is None

        # 时间快进超过 120s 诊断窗口 (monkeypatch 自动还原全局 time.time)
        frozen = eco_mod.time.time() + 9999
        monkeypatch.setattr(eco_mod.time, "time", lambda: frozen)

        progress = await svc.getProgress(eid)
        assert progress.percentage >= 1.0

        result = await svc.getResult(eid)
        assert result is not None, "进度 100% 后 /result 必须返回脱敏产物"
        assert result.enterprise_id == eid
        assert result.raw_hash
        assert len(result.gaps) > 0
        for dim in ("subject", "finance", "tax", "business", "assets", "credit", "policy", "capital"):
            assert 0 <= getattr(result.scorecard, dim) <= 100

        # 销毁: 审计报告必须完整 (rawHash 与脱敏产物对账 + 链上存证 + 覆写证明), 且永久可查
        trail = await svc.secureDestroy(eid)
        assert trail.raw_hash == result.raw_hash, "销毁审计 rawHash 必须与脱敏产物一致 (销毁的即诊断的那份)"
        assert trail.three_pass_overwrite is True
        assert trail.weak_ref_finalized is True
        assert len(trail.chain_evidence) == 1
        assert trail.chain_evidence[0].action == "destroyed"
        # 审计内容: 数据概况 (脱敏) + 诊断结论摘要
        assert trail.data_summary is not None, "审计必须含被销毁数据概况"
        assert trail.data_summary.record_count == 60
        assert trail.data_summary.data_type == "bank_statement"
        assert trail.diagnosis_summary is not None, "审计必须含诊断结论摘要"
        assert trail.diagnosis_summary.gap_count == len(result.gaps)
        assert trail.diagnosis_summary.scorecard.subject == result.scorecard.subject
        assert len(trail.diagnosis_summary.top_gaps) <= 3
        assert await svc.getAuditTrail(eid) is not None, "审计报告销毁后必须持久可查 (刷新不丢)"
        # 约束: 原始数据销毁后, 脱敏产物仍持久化保留
        assert await svc.getResult(eid) is not None

    async def test_destroy_with_none_key_records_produces_audit(self, monkeypatch, sample_enterprise_id):
        """回归: 脏 records (非 str key, 如 CSV restkey 的 None key) 不得炸毁销毁审计.

        历史缺陷: 上传行数不齐的 CSV → DictReader 把多余值挂 None key →
        secureDestroy 的 json.dumps(records, sort_keys=True) 抛
        TypeError ('<' not supported between NoneType and str) → 500 → 审计报告出不来.
        """
        from app.schemas.eco import BurnRawDataInput
        from app.services import eco_service as eco_mod

        svc = eco_mod.eco_burn_service
        eid = sample_enterprise_id
        dirty = [{"date": "2026-08-01", "amount": 1000, None: ["多余值1", "多余值2"]},
                 {"company": "甲公司", None: "孤立多余值"}]
        await svc.loadRawData(BurnRawDataInput(
            enterpriseId=eid, dataType="bank_statement", records=dirty, source="bank_api",
        ))
        # enclave 入口必须已清洗: 无非 str key (否则落盘/哈希/审计全链都会炸)
        stored = svc._raw_data[eid]["records"]
        for rec in stored:
            assert all(isinstance(k, str) for k in rec), f"enclave 入口未清洗非 str key: {rec.keys()}"
        assert stored[0]["_extra"], "None key 的多余值必须并入 _extra 字段 (不丢数据)"

        await svc.startDiagnosis(eid)
        frozen = eco_mod.time.time() + 9999
        monkeypatch.setattr(eco_mod.time, "time", lambda: frozen)
        await svc.getProgress(eid)
        trail = await svc.secureDestroy(eid)
        assert trail.raw_hash, "脏 records 必须能走完销毁链路"
        assert await svc.getAuditTrail(eid) is not None, "审计报告必须正常产出 (500 回归)"

    async def test_csv_ragged_rows_cleaned_at_source(self):
        """回归: CSV 行字段数多于表头时, 解析层直接清洗 restkey (双保险)."""
        from app.services.raw_file_loader import _parse_csv

        content = "date,amount\n2026-08-01,1000\n2026-08-02,2000,多出的字段A,多出的字段B\n".encode()
        rows = _parse_csv(content)
        assert len(rows) == 2
        for r in rows:
            assert all(isinstance(k, str) for k in r), f"解析结果含非 str key: {r}"
        assert "多出的字段A" in rows[1]["_extra"], "多余字段值并入 _extra 保留"

    async def test_sealed_storage_survives_restart(self, monkeypatch, sample_enterprise_id):
        """密封存储回归: "重启"后脱敏产物/销毁审计/哈希链必须恢复, 原始数据绝不恢复.

        历史缺陷: 脱敏产物/审计纯内存, 后端重启即丢 → 工作台拉不到审计、R1 画像断链.
        """
        from app.schemas.eco import BurnRawDataInput
        from app.services import eco_service as eco_mod

        svc = eco_mod.eco_burn_service
        eid = "E-SEAL-TEST"
        records = [{"amount": i} for i in range(30)]
        await svc.loadRawData(BurnRawDataInput(
            enterpriseId=eid, dataType="tax_detail", records=records, source="tax_api",
        ))
        await svc.startDiagnosis(eid)
        frozen = eco_mod.time.time() + 9999
        monkeypatch.setattr(eco_mod.time, "time", lambda: frozen)
        await svc.getProgress(eid)
        result = await svc.getResult(eid)
        assert result is not None
        trail = await svc.secureDestroy(eid)
        block_after = svc._block_no

        # 模拟重启: 新服务实例从密封存储恢复
        svc2 = eco_mod.EcoBurnService()
        audit2 = await svc2.getAuditTrail(eid)
        assert audit2 is not None, "重启后销毁审计必须恢复"
        assert audit2.raw_hash == trail.raw_hash
        assert audit2.data_summary is not None and audit2.data_summary.record_count == 30
        assert audit2.diagnosis_summary is not None
        result2 = await svc2.getResult(eid)
        assert result2 is not None, "重启后脱敏产物必须恢复 (工作台 R1 画像可持续消费)"
        assert result2.raw_hash == result.raw_hash
        assert svc2._block_no == block_after, "哈希链高度必须延续, 不能重置"
        # 硬约束: 原始数据绝不落盘/恢复
        assert eid not in svc2._raw_data, "原始材料重启后绝不可恢复 (ECO-01 硬约束)"

    async def test_diagnosis_llm_refine_anchored_at_source(self, monkeypatch):
        """A 档: DeepSeek 在 enclave 诊断源头微调评分 (锚定规则基线±10) + 定制动作.

        硬约束: ①越界分数锚定 ②提示词只含脱敏聚合 (记录内容不出 enclave)
        ③engine 标记 llm ④重传后重新允许 LLM.
        """
        import json as _json

        from app.schemas.eco import BurnRawDataInput
        from app.services import eco_service as eco_mod
        from app.services.llm_service import llm_service

        svc = eco_mod.eco_burn_service
        eid = "E-LLM-A"
        records = [{"amount": 1000 + i, "secret_memo": f"原始明细{i}"} for i in range(80)]
        captured = {}

        async def fake_chat(messages=None, **kwargs):
            captured["user"] = messages[1]["content"]
            return {
                "content": _json.dumps({
                    "scores": {
                        "subject": 99, "finance": 0, "tax": 99, "business": 99,
                        "assets": 99, "credit": 99, "policy": 0, "capital": 99,
                    },
                    "actions": {"tax": "接入税务明细并验真发票, 两套账并轨, 三十天内完成整改闭环"},
                }),
                "model": "deepseek-chat", "fallback": "none", "usage": {}, "cache_hit": False,
            }

        try:
            # 第一轮: LLM 不可用 → 规则基线
            await svc.loadRawData(BurnRawDataInput(
                enterpriseId=eid, dataType="bank_statement", records=records, source="bank_api"))
            await svc.startDiagnosis(eid)
            frozen = eco_mod.time.time() + 9999
            monkeypatch.setattr(eco_mod.time, "time", lambda: frozen)
            await svc.getProgress(eid)
            baseline = await svc.getResult(eid)
            assert baseline is not None and baseline.engine == "rule"

            # 第二轮 (重传): LLM 可用 → A 档深度诊断
            monkeypatch.setattr(type(llm_service), "available", property(lambda self: True))
            monkeypatch.setattr(llm_service, "chat", fake_chat)
            await svc.loadRawData(BurnRawDataInput(
                enterpriseId=eid, dataType="bank_statement", records=records, source="bank_api"))
            await svc.startDiagnosis(eid)
            await svc.getProgress(eid)
            result = await svc.getResult(eid)

            assert result is not None and result.engine == "llm", "A 档产物必须标记 engine=llm"
            # ① 锚定: 99 → 基线+10 封顶; 0 → 基线-10 封底
            assert result.scorecard.subject == min(100, baseline.scorecard.subject + 10)
            assert result.scorecard.finance == max(0, baseline.scorecard.finance - 10)
            assert result.scorecard.policy == max(0, baseline.scorecard.policy - 10)
            for dim in ("subject", "finance", "tax", "business", "assets", "credit", "policy", "capital"):
                assert abs(getattr(result.scorecard, dim) - getattr(baseline.scorecard, dim)) <= 10
            # ② 零知识: 原始记录的内容值不得离开 enclave (字段名属 schema 元数据, 允许)
            assert "原始明细" not in captured["user"], "原始明细内容禁止离开 enclave"
            # ③ LLM 定制动作生效
            tax_gap = next((g for g in result.gaps if g.dimension == "tax"), None)
            assert tax_gap is not None and "税务明细" in tax_gap.suggested_actions[0]
        finally:
            for store in (svc._results, svc._audits, svc._raw_data, svc._progress):
                store.pop(eid, None)
            svc._llm_refined.discard(eid)

    async def test_llm_receives_real_content_evidence(self, monkeypatch):
        """LLM 诊断必须消费材料实际内容特征 (术语/数值统计), 禁止只喂元数据 —
        否则同类型不同内容的文档会得到雷同诊断 (假接入)."""
        import json as _json

        from app.schemas.eco import BurnRawDataInput
        from app.services import eco_service as eco_mod
        from app.services.llm_service import llm_service

        svc = eco_mod.eco_burn_service
        eid = "E-CONTENT"
        records = [
            {"type": "page", "text": "本公司为高新技术企业, 研发投入占营收12%, "
                                     "存在2笔逾期欠息记录, 对外担保余额较高。"},
            {"type": "row", "资产负债率": 0.72, "逾期笔数": 2, "营收": 5800},
        ]
        captured = {}

        async def fake_chat(messages=None, **kwargs):
            captured["user"] = messages[1]["content"]
            cur = svc._results.get(eid)
            scores = {d: getattr(cur.scorecard, d) for d in
                      ("subject", "finance", "tax", "business", "assets", "credit", "policy", "capital")} if cur else {}
            return {
                "content": _json.dumps({"scores": scores, "actions": {}}),
                "model": "deepseek-chat", "fallback": "none", "usage": {}, "cache_hit": False,
            }

        try:
            monkeypatch.setattr(type(llm_service), "available", property(lambda self: True))
            monkeypatch.setattr(llm_service, "chat", fake_chat)
            await svc.loadRawData(BurnRawDataInput(
                enterpriseId=eid, dataType="contract_raw", records=records, source="enterprise_upload"))
            await svc.startDiagnosis(eid)
            frozen = eco_mod.time.time() + 9999
            monkeypatch.setattr(eco_mod.time, "time", lambda: frozen)
            await svc.getProgress(eid)
            result = await svc.getResult(eid)

            assert result is not None
            # 产物携带内容特征摘要, 且反映材料实际术语
            assert result.content_digest, "产物必须携带材料内容特征摘要"
            assert any(("逾期" in line or "高新技术企业" in line) for line in result.content_digest), \
                f"摘要必须反映材料实际术语: {result.content_digest}"
            # LLM payload 携带 contentEvidence (真实内容统计), 且原文段落不离开 enclave
            assert "contentEvidence" in captured["user"], "LLM 必须收到材料内容特征"
            assert "逾期" in captured["user"] and "高新技术企业" in captured["user"], \
                "LLM 收到的特征必须含材料真实术语"
            assert "存在2笔逾期欠息记录" not in captured["user"], "原文整段不得离开 enclave"
        finally:
            for store in (svc._results, svc._audits, svc._raw_data, svc._progress):
                store.pop(eid, None)
            svc._llm_refined.discard(eid)

    async def test_content_digest_survives_destroy_in_audit(self, monkeypatch):
        """销毁审计报告必须携带材料内容特征 (诊断依据可回溯, 不因销毁而丢失)."""
        from app.schemas.eco import BurnRawDataInput
        from app.services import eco_service as eco_mod

        svc = eco_mod.eco_burn_service
        eid = "E-DIGEST"
        records = [{"type": "page", "text": "企业实缴注册资本5000万元, 纳税等级A级, 无逾期记录。"}]
        try:
            await svc.loadRawData(BurnRawDataInput(
                enterpriseId=eid, dataType="tax_detail", records=records, source="enterprise_upload"))
            await svc.startDiagnosis(eid)
            frozen = eco_mod.time.time() + 9999
            monkeypatch.setattr(eco_mod.time, "time", lambda: frozen)
            await svc.getProgress(eid)
            result = await svc.getResult(eid)
            assert result is not None and result.content_digest

            audit = await svc.secureDestroy(eid)
            assert audit.diagnosis_summary is not None
            assert audit.diagnosis_summary.content_digest == result.content_digest, \
                "审计摘要必须携带与产物同源的内容特征"
        finally:
            for store in (svc._results, svc._audits, svc._raw_data, svc._progress):
                store.pop(eid, None)

    async def test_diagnosis_llm_failure_keeps_rule_baseline(self, monkeypatch):
        """A 档失败 (LLM 抛异常) → 非破坏回退: B 档规则产物照常可用, engine=rule."""
        from app.schemas.eco import BurnRawDataInput
        from app.services import eco_service as eco_mod
        from app.services.llm_service import llm_service

        svc = eco_mod.eco_burn_service
        eid = "E-LLM-FAIL"

        async def boom(*args, **kwargs):
            raise RuntimeError("模拟 DeepSeek 爆炸")

        try:
            monkeypatch.setattr(type(llm_service), "available", property(lambda self: True))
            monkeypatch.setattr(llm_service, "chat", boom)
            await svc.loadRawData(BurnRawDataInput(
                enterpriseId=eid, dataType="tax_detail",
                records=[{"i": i} for i in range(40)], source="tax_api"))
            await svc.startDiagnosis(eid)
            frozen = eco_mod.time.time() + 9999
            monkeypatch.setattr(eco_mod.time, "time", lambda: frozen)
            await svc.getProgress(eid)
            result = await svc.getResult(eid)
            assert result is not None, "LLM 故障时诊断产物必须可用 (非破坏回退)"
            assert result.engine == "rule"
            assert len(result.gaps) > 0
        finally:
            for store in (svc._results, svc._audits, svc._raw_data, svc._progress):
                store.pop(eid, None)
            svc._llm_refined.discard(eid)

    async def test_audit(self, client, sample_enterprise_id):
        r = await client.get(f"/api/v1/eco-burn/{sample_enterprise_id}/audit")
        assert r.status_code == 200


class TestEcoPricing:
    """ECO-02 成果导向阶梯定价. prefix=/eco-pricing"""

    async def test_enterprise_pricing(self, client, sample_enterprise_id):
        r = await client.get(f"/api/v1/eco-pricing/enterprise/{sample_enterprise_id}")
        assert r.status_code == 200
        assert r.json()["code"] == 0

    async def test_calculate(self, client):
        r = await client.post("/api/v1/eco-pricing/calculate", json={})
        assert r.status_code in POST_OK


class TestEcoAdapter:
    """ECO-03 无接口适配器. prefix=/eco-adapter"""

    async def test_generate_application(self, client, sample_enterprise_id):
        r = await client.post(
            "/api/v1/eco-adapter/application",
            json={"enterpriseId": sample_enterprise_id},
        )
        assert r.status_code in POST_OK


class TestEcoCredential:
    """ECO-04 信用凭证联盟链. prefix=/eco-credential"""

    async def test_issue(self, client, sample_enterprise_id):
        r = await client.post(
            "/api/v1/eco-credential/issue",
            json={"enterpriseId": sample_enterprise_id},
        )
        assert r.status_code in POST_OK

    async def test_enterprise_credentials(self, client, sample_enterprise_id):
        r = await client.get(f"/api/v1/eco-credential/enterprise/{sample_enterprise_id}")
        assert r.status_code == 200


class TestEcoBid:
    """ECO-05 反向竞拍融资大厅. prefix=/eco-bid"""

    async def test_list_tenders(self, client):
        r = await client.get("/api/v1/eco-bid/tenders")
        assert r.status_code == 200

    async def test_create_tender(self, client, sample_enterprise_id):
        r = await client.post(
            "/api/v1/eco-bid/tenders",
            json={"enterpriseId": sample_enterprise_id},
        )
        assert r.status_code in POST_OK


class TestEcoPts:
    """ECO-06 积分商城与行为挖矿. prefix=/eco-pts"""

    async def test_shop(self, client):
        r = await client.get("/api/v1/eco-pts/shop")
        assert r.status_code == 200

    async def test_orders(self, client):
        # APP-02: workerId 必传 (移动端 PWA 分页)
        r = await client.get("/api/v1/eco-pts/orders?worker_id=E001-W01")
        assert r.status_code == 200
        assert r.json()["code"] == 0

    async def test_cooperation(self, client):
        r = await client.get("/api/v1/eco-pts/cooperation")
        assert r.status_code == 200


class TestEcoIndex:
    """ECO-07 FinTrust 企业合规指数. prefix=/eco-index"""

    async def test_compare(self, client):
        r = await client.get("/api/v1/eco-index/compare")
        # 200=有数据, 422=需要查询参数(端点已接通)
        assert r.status_code in (200, 422)

    async def test_calculate(self, client):
        r = await client.post("/api/v1/eco-index/calculate", json={})
        assert r.status_code in POST_OK


class TestEcoGov:
    """ECO-08 监管/政府背书催化剂. prefix=/eco-gov"""

    async def test_list_reports(self, client):
        r = await client.get("/api/v1/eco-gov/reports")
        assert r.status_code == 200

    async def test_submit_report(self, client):
        r = await client.post("/api/v1/eco-gov/reports", json={})
        assert r.status_code in POST_OK

    async def test_endorsements(self, client):
        r = await client.get("/api/v1/eco-gov/endorsements")
        assert r.status_code == 200


class TestEcoBot:
    """ECO-09 微信/钉钉数字分身. prefix=/eco-bot"""

    async def test_parse(self, client):
        r = await client.post("/api/v1/eco-bot/parse", json={"message": "查询融资进度"})
        assert r.status_code in POST_OK

    async def test_config(self, client, sample_enterprise_id):
        r = await client.get(f"/api/v1/eco-bot/config/{sample_enterprise_id}")
        assert r.status_code == 200
