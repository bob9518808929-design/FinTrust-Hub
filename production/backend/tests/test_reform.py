"""改造引擎 R0-R10 API 测试."""

import asyncio

import pytest

pytestmark = pytest.mark.asyncio


class TestReformPrecheck:
    """R0 接入意愿评估前置."""

    async def test_precheck(self, client, sample_enterprise_id):
        r = await client.post(f"/api/v1/reform/{sample_enterprise_id}/precheck")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0


class TestReformPortrait:
    """R1 全景画像."""

    async def test_full_portrait(self, client, sample_enterprise_id):
        r = await client.post(f"/api/v1/reform/{sample_enterprise_id}/portrait")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0


class TestReformPortraitSourceChain:
    """R1 画像单一事实源 + A/B/C 降级链.

    评分卡在 ECO-01 enclave 诊断产物定型 (A=DeepSeek 锚定±10 / B=规则基线),
    R1 直接消费, 禁止二次调 LLM; 无产物时 C 档 runtime 推导 + 工作台侧 LLM 兜底.
    """

    DIMS = ("subject", "finance", "tax", "business", "assets", "credit", "policy", "capital")

    def _inject_burn_result(self, eid: str, engine: str = "llm"):
        from app.schemas.eco import BurnDiagnosisResult
        from app.schemas.scorecard import GapItem, Scorecard8D
        from app.services.eco_service import eco_burn_service

        card = Scorecard8D(
            subject=73, finance=66, tax=58, business=70,
            assets=62, credit=69, policy=60, capital=55,
        )
        gaps = [GapItem(
            dimension="subject", current=73, target=85, delta=12, severity="medium",
            suggestedActions=["x"], estimatedDays=6, estimatedCost=12000,
        )]
        eco_burn_service._results[eid] = BurnDiagnosisResult(
            enterpriseId=eid, scorecard=card, gaps=gaps,
            completedAt="2026-09-05T00:00:00+00:00", rawHash="test-hash", engine=engine,
        )
        # 模拟密封存储恢复的已定型产物 (R1 调 getResult 时不得再触发 LLM)
        eco_burn_service._llm_refined.add(eid)
        return eco_burn_service, card

    def _clear_burn(self, svc, eid: str) -> None:
        svc._results.pop(eid, None)
        svc._llm_refined.discard(eid)

    async def test_portrait_consumes_enclave_result_without_double_llm(self, client, monkeypatch):
        """A/B 档: enclave 产物存在 → R1 原样消费, 即使 LLM 可用也禁止二次调用."""
        from app.services.llm_service import llm_service

        svc, card = self._inject_burn_result("E001", engine="llm")
        called = {"n": 0}

        async def spy_chat(*args, **kwargs):
            called["n"] += 1
            raise AssertionError("R1 消费 enclave 已定型产物时禁止二次调用 LLM")

        monkeypatch.setattr(type(llm_service), "available", property(lambda self: True))
        monkeypatch.setattr(llm_service, "chat", spy_chat)
        try:
            r = await client.post("/api/v1/reform/E001/portrait")
            assert r.status_code == 200
            data = r.json()["data"]
            for dim in self.DIMS:
                assert data[dim] == getattr(card, dim), f"R1 必须消费 ECO-01 产物评分 ({dim})"
            assert called["n"] == 0, "评分卡已在 enclave 定型, R1 不得重复调 LLM"
        finally:
            self._clear_burn(svc, "E001")

    async def test_portrait_runtime_fallback_llm_anchored(self, client, monkeypatch, sample_enterprise_id):
        """C+ 档: 无 enclave 产物 → runtime 基线 + 工作台侧 LLM 微调, 越界值锚定 ±10."""
        import json as _json

        from app.services.eco_service import eco_burn_service
        from app.services.llm_service import llm_service

        self._clear_burn(eco_burn_service, sample_enterprise_id)

        # 先取 runtime 基线 (LLM 不可用)
        monkeypatch.setattr(type(llm_service), "available", property(lambda self: False))
        r0 = await client.post(f"/api/v1/reform/{sample_enterprise_id}/portrait")
        baseline = r0.json()["data"]

        async def fake_chat(*args, **kwargs):
            return {
                "content": _json.dumps({
                    "subject": 99, "finance": 99, "tax": 0, "business": 75,
                    "assets": 62, "credit": 69, "policy": 60, "capital": 55,
                    "rationale": "测试: 越界值必须被锚定",
                }),
                "model": "deepseek-chat", "fallback": "none", "usage": {}, "cache_hit": False,
            }

        monkeypatch.setattr(type(llm_service), "available", property(lambda self: True))
        monkeypatch.setattr(llm_service, "chat", fake_chat)
        r = await client.post(f"/api/v1/reform/{sample_enterprise_id}/portrait")
        assert r.status_code == 200
        data = r.json()["data"]
        assert data["subject"] == min(100, baseline["subject"] + 10), "99 越界 → 锚定基线+10"
        assert data["tax"] == max(0, baseline["tax"] - 10), "0 越界 → 锚定基线-10"
        for dim in self.DIMS:
            assert abs(data[dim] - baseline[dim]) <= 10, f"{dim} 必须锚定 ±10"

    async def test_portrait_runtime_llm_failure_falls_back(self, client, monkeypatch, sample_enterprise_id):
        """C 档 LLM 故障 → 回落 runtime 规则分, 画像不中断."""
        from app.services.eco_service import eco_burn_service
        from app.services.llm_service import llm_service

        self._clear_burn(eco_burn_service, sample_enterprise_id)

        async def boom(*args, **kwargs):
            raise RuntimeError("模拟 LLM 故障")

        monkeypatch.setattr(type(llm_service), "available", property(lambda self: True))
        monkeypatch.setattr(llm_service, "chat", boom)
        r = await client.post(f"/api/v1/reform/{sample_enterprise_id}/portrait")
        assert r.status_code == 200
        data = r.json()["data"]
        for dim in self.DIMS:
            assert isinstance(data[dim], int) and 0 <= data[dim] <= 100

    async def test_start_reuses_eco01_portrait_after_destroy(self, client, monkeypatch, sample_enterprise_id):
        """回归 (用户投诉"文档与项目没关系"): 材料销毁后启动改造, 画像不得静默降级为种子.

        链路: ECO-01 产物 → R1 消费 → 销毁 → R4 启动改造.
        缺陷期: R4 内部重算 R1 → 产物已销毁 → runtime 种子 → 评分与文档完全脱钩.
        修复期: R4 复用画像缓存的 ECO-01 产物评分卡.
        """
        from app.schemas.eco import BurnRawDataInput
        from app.services import eco_service as eco_mod
        from app.services.eco_service import eco_burn_service
        from app.services.reform_service import ReformService

        monkeypatch.setattr(ReformService, "_SCHED_TICK_SEC", 0.01)
        eid = sample_enterprise_id

        # ① ECO-01 诊断 (时间快进物化产物, LLM 默认禁用 → B 档规则基线)
        records = [{"date": "2026-08-01", "amount": 100000 + i} for i in range(50)]
        await eco_burn_service.loadRawData(BurnRawDataInput(
            enterpriseId=eid, dataType="contract_raw", records=records, source="enterprise_upload",
        ))
        await eco_burn_service.startDiagnosis(eid)
        frozen = eco_mod.time.time() + 9999
        monkeypatch.setattr(eco_mod.time, "time", lambda: frozen)
        product = await eco_burn_service.getResult(eid)
        assert product is not None

        # ② R1 消费产物 → 画像缓存定型
        r1 = await client.post(f"/api/v1/reform/{eid}/portrait")
        assert r1.status_code == 200
        for dim in self.DIMS:
            assert r1.json()["data"][dim] == getattr(product.scorecard, dim), \
                "R1 必须消费 ECO-01 产物评分"

        # ③ 物理销毁 (原始材料不可恢复)
        await eco_burn_service.secureDestroy(eid)

        # ④ R4 启动改造: 必须复用产物画像, 而非重算降级为种子
        r = await client.post(f"/api/v1/reform/{eid}/start", json={"aggression_level": "balanced"})
        assert r.status_code in (200, 201)
        started = r.json()["data"]
        for dim in self.DIMS:
            assert started["scorecard"]["current"][dim] == getattr(product.scorecard, dim), \
                f"销毁后 R4 必须复用 ECO-01 产物画像 ({dim}), 不得静默降级为 runtime 种子"

        # 清理调度器
        ReformService()._stop_scheduler(eid)

    async def test_portrait_after_destroy_warns_seed_fallback(self, client, monkeypatch, sample_enterprise_id):
        """回归: 材料已销毁且未消费产物时, 画像响应必须携带降级警告 (禁止静默降级)."""
        from app.schemas.eco import BurnRawDataInput
        from app.services.eco_service import eco_burn_service

        eid = sample_enterprise_id
        self._clear_burn(eco_burn_service, eid)

        # 真实链路产生销毁审计 — 销毁发生在诊断完成前 (无产物物化),
        # 此时画像才走 runtime 种子降级 (有产物时 R1 直接消费, 不警告)
        await eco_burn_service.loadRawData(BurnRawDataInput(
            enterpriseId=eid, dataType="bank_statement", records=[{"amount": 1}], source="bank_api",
        ))
        await eco_burn_service.startDiagnosis(eid)
        await eco_burn_service.secureDestroy(eid)

        r = await client.post(f"/api/v1/reform/{eid}/portrait")
        assert r.status_code == 200
        assert "与上传文档无关" in r.json()["message"], "种子降级必须携带可解释性警告"


class TestReformPlanOrchestration:
    """R3 方案编排: 规则分批保底 + LLM 编排精调."""

    def _current_target(self):
        """current 恰好产生 4 个差距维度 (delta>5): subject/tax/credit/policy."""
        from app.schemas.scorecard import Scorecard8D
        from app.services.reform_service import DEFAULT_SCORECARD_A

        current = Scorecard8D(subject=73, finance=78, tax=43, business=78,
                              assets=80, credit=47, policy=68, capital=75)
        return current, DEFAULT_SCORECARD_A

    async def _post_plan(self, client, sample_enterprise_id):
        current, target = self._current_target()
        return await client.post(
            f"/api/v1/reform/{sample_enterprise_id}/plan",
            json={"current": current.model_dump(), "target": target.model_dump(),
                  "aggressionLevel": "balanced"},
        )

    async def test_rule_plan_severity_batches_and_weights(self, client, sample_enterprise_id):
        """B 档: 严重度排序 + 分批标记 + 权重按差距占比归一.

        注: /plan 端点内部重跑 R2_gapAnalysis(current), 不吃外部 gaps —
        因此断言编排不变量 (权重归一/批次标记/阶段完整), 不断言具体维度顺序.
        """
        r = await self._post_plan(client, sample_enterprise_id)
        assert r.status_code == 200
        phases = r.json()["data"]
        assert len(phases) > 0
        total_w = sum(p["weight"] for p in phases)
        assert abs(total_w - 1.0) < 0.01, f"权重必须归一 (got {total_w})"
        assert all("[第" in p["description"] for p in phases), "每阶段描述必须带批次标记"
        batch_prefixes = {p["name"].split(" ")[0] for p in phases}
        assert all(name.startswith("第") for name in batch_prefixes)

    async def test_llm_orchestration_applies(self, client, monkeypatch, sample_enterprise_id):
        """A 档: LLM order/batches/daysAdjust 全部生效 (合法输出)."""
        import json as _json

        from app.services.llm_service import llm_service

        _current, _target = self._current_target()

        async def fake_chat(*args, **kwargs):
            return {
                "content": _json.dumps({
                    "order": ["subject", "policy", "tax", "credit"],
                    "batches": [
                        {"name": "第一批·合规确权筑基", "dimensions": ["subject", "policy"]},
                        {"name": "第二批·数据信用攻坚", "dimensions": ["tax", "credit"]},
                    ],
                    "daysAdjust": {"tax": 999, "credit": 1},  # 越界 → 钳制 90 / 3
                }),
                "model": "deepseek-chat", "fallback": "none", "usage": {}, "cache_hit": False,
            }

        monkeypatch.setattr(type(llm_service), "available", property(lambda self: True))
        monkeypatch.setattr(llm_service, "chat", fake_chat)
        r = await self._post_plan(client, sample_enterprise_id)
        assert r.status_code == 200
        phases = r.json()["data"]
        dims = [p["dimension"] for p in phases]
        assert dims == ["subject", "policy", "tax", "credit"], "LLM order 必须生效"
        assert "[第一批·合规确权筑基]" in phases[0]["description"]
        assert "[第二批·数据信用攻坚]" in phases[2]["description"]
        days = {p["dimension"]: p["estimatedDays"] for p in phases}
        assert days["tax"] == 90, "工期越界必须钳制到 90"
        assert days["credit"] == 3, "工期越界必须钳制到 3"

    async def test_llm_invalid_order_ignored(self, client, monkeypatch, sample_enterprise_id):
        """A 档: LLM order 缺维度 (非法) → 整体忽略, 回退规则排序, 不丢任何阶段."""
        import json as _json

        from app.services.llm_service import llm_service

        _current, _target = self._current_target()

        async def fake_chat(*args, **kwargs):
            return {
                "content": _json.dumps({
                    "order": ["tax", "credit"],  # 缺 subject/policy → 非法
                    "batches": [{"name": "x", "dimensions": ["nonexist"]}],
                }),
                "model": "deepseek-chat", "fallback": "none", "usage": {}, "cache_hit": False,
            }

        monkeypatch.setattr(type(llm_service), "available", property(lambda self: True))
        monkeypatch.setattr(llm_service, "chat", fake_chat)
        # 先取 LLM 关闭时的规则排序
        r0 = await self._post_plan(client, sample_enterprise_id)
        rule_dims = [p["dimension"] for p in r0.json()["data"]]
        r = await self._post_plan(client, sample_enterprise_id)
        phases = r.json()["data"]
        dims = [p["dimension"] for p in phases]
        assert sorted(dims) == sorted(rule_dims), "非法 order 回退规则排序, 阶段不丢"
        assert dims == rule_dims

    async def test_llm_failure_falls_back_to_rule(self, client, monkeypatch, sample_enterprise_id):
        """A 档失败 (LLM 抛异常) → B 档规则编排, 方案照常生成."""
        from app.services.llm_service import llm_service

        _current, _target = self._current_target()

        async def boom(*args, **kwargs):
            raise RuntimeError("模拟 LLM 故障")

        monkeypatch.setattr(type(llm_service), "available", property(lambda self: True))
        monkeypatch.setattr(llm_service, "chat", boom)
        r = await self._post_plan(client, sample_enterprise_id)
        assert r.status_code == 200
        phases = r.json()["data"]
        assert len(phases) > 0
        assert all("[第" in p["description"] for p in phases)


class TestReformScheduler:
    """R4 自动 DAG 调度器: start 后自动推进 phases 至 completed, pause 可停."""

    @pytest.fixture(autouse=True)
    def _cleanup_tasks(self):
        yield
        from app.services.reform_service import ReformService

        for eid in list(ReformService._sched_tasks):
            ReformService()._stop_scheduler(eid)

    async def _start(self, client, sample_enterprise_id):
        r = await client.post(
            f"/api/v1/reform/{sample_enterprise_id}/start",
            json={"aggression_level": "balanced"},
        )
        assert r.status_code in (200, 201)  # POST start 返回 201 Created
        return r.json()["data"]

    async def _state(self, client, sample_enterprise_id):
        r = await client.get(f"/api/v1/reform/{sample_enterprise_id}/state")
        return r.json()["data"]

    async def test_idempotent_start_revives_dead_scheduler(self, client, sample_enterprise_id, monkeypatch):
        """回归: in_progress 幂等返回时必须复活调度 runner —
        后端重启后 runner 消失但 state 仍 in_progress, 不复活则进度永久冻结."""
        from app.services.reform_service import ReformService

        monkeypatch.setattr(ReformService, "_SCHED_TICK_SEC", 0.01)
        await self._start(client, sample_enterprise_id)
        await asyncio.sleep(0.03)
        # 模拟后端重启: 杀掉 runner, state 仍 in_progress
        ReformService()._stop_scheduler(sample_enterprise_id)
        stuck = await self._state(client, sample_enterprise_id)
        assert stuck.get("status") == "in_progress"

        # 再次 /start (幂等分支) → runner 复活并推进至完成
        r = await client.post(
            f"/api/v1/reform/{sample_enterprise_id}/start",
            json={"aggression_level": "balanced"},
        )
        assert r.status_code == 200, "幂等分支必须返回 200 而非新建"
        final = None
        for _ in range(60):
            await asyncio.sleep(0.05)
            final = await self._state(client, sample_enterprise_id)
            if final and final.get("status") == "completed":
                break
        assert final is not None and final["status"] == "completed", \
            "幂等启动必须复活调度器, 不得让进度永久冻结"

    async def test_start_auto_completes(self, client, sample_enterprise_id, monkeypatch):
        """R4 启动后 runner 自动逐动作推进, 全部 phase 完成后 status=completed."""
        from app.services.reform_service import ReformService

        monkeypatch.setattr(ReformService, "_SCHED_TICK_SEC", 0.01)
        started = await self._start(client, sample_enterprise_id)
        assert started["status"] == "in_progress"

        final = None
        for _ in range(60):  # 最多等 3s (60 × 0.05)
            await asyncio.sleep(0.05)
            final = await self._state(client, sample_enterprise_id)
            if final and final.get("status") == "completed":
                break
        assert final is not None and final["status"] == "completed", "调度器必须自动跑完"
        assert abs(final["progress"] - 1.0) < 0.01
        assert all(p["status"] == "completed" for p in final["phases"])
        assert len(final["completedActions"]) == sum(len(p["actions"]) for p in final["phases"])
        # C 档兜底必须产出完整业务结果: 每个 action 有真实业务结论文本 + 证据链
        # (不允许空壳 "子引擎 xxx 执行成功")
        for phase in final["phases"]:
            for action in phase["actions"]:
                assert action.get("result"), f"{phase['dimension']} 动作缺少业务结果"
                assert "执行成功" not in (action.get("result") or ""), \
                    f"{phase['dimension']} 仍为空壳结果: {action.get('result')}"
                assert action.get("evidence"), f"{phase['dimension']} 动作缺少证据链"
                assert action.get("cost"), f"{phase['dimension']} 动作缺少费用"
        # 仿真收敛: current 不超过 target
        cur = final["scorecard"]["current"]
        tgt = final["scorecard"]["target"]
        assert all(cur[d] <= tgt[d] for d in cur), "收敛不得超过目标分"

    async def test_pause_stops_scheduler(self, client, sample_enterprise_id, monkeypatch):
        """pause 后 runner 停止, progress 不再变化."""
        from app.services.reform_service import ReformService

        monkeypatch.setattr(ReformService, "_SCHED_TICK_SEC", 0.02)
        await self._start(client, sample_enterprise_id)
        await asyncio.sleep(0.1)  # 跑几拍
        r = await client.post(f"/api/v1/reform/{sample_enterprise_id}/pause")
        assert r.status_code == 200
        assert r.json()["data"]["status"] == "paused"
        progress_at_pause = (await self._state(client, sample_enterprise_id))["progress"]
        await asyncio.sleep(0.25)  # 若 runner 未停, 会推进
        progress_after = (await self._state(client, sample_enterprise_id))["progress"]
        assert progress_after == progress_at_pause, "pause 后进度必须冻结"

    async def test_resume_restarts_scheduler(self, client, sample_enterprise_id, monkeypatch):
        """resume 后 runner 重启并最终跑完."""
        from app.services.reform_service import ReformService

        monkeypatch.setattr(ReformService, "_SCHED_TICK_SEC", 0.01)
        await self._start(client, sample_enterprise_id)
        await asyncio.sleep(0.06)
        r = await client.post(f"/api/v1/reform/{sample_enterprise_id}/resume")
        assert r.status_code == 200
        final = None
        for _ in range(60):
            await asyncio.sleep(0.05)
            final = await self._state(client, sample_enterprise_id)
            if final and final.get("status") == "completed":
                break
        assert final is not None and final["status"] == "completed"

    async def test_schedule_updates_carry_action_results(self, client, sample_enterprise_id, monkeypatch):
        """轮询端点必须携带子引擎执行产物 (result/evidence) — 不允许只给进度数字,
        否则前端时间线永远看不到真实业务结果."""
        from app.services.reform_service import ReformService

        monkeypatch.setattr(ReformService, "_SCHED_TICK_SEC", 0.01)
        await self._start(client, sample_enterprise_id)
        await asyncio.sleep(0.15)  # 至少完成一个动作

        r = await client.get(f"/api/v1/reform/{sample_enterprise_id}/schedule/updates")
        assert r.status_code == 200
        updates = r.json()["data"]
        assert updates, "必须有 phase updates"
        first = updates[0]
        assert "actions" in first, "update 必须携带 actions 详情"
        assert "stateStatus" in first, "update 必须携带 stateStatus (完成态推进)"
        all_actions = [a for u in updates for a in u.get("actions", [])]
        assert all_actions, "updates 必须包含动作"
        done = [a for a in all_actions if a.get("status") == "completed"]
        assert done, "调度已运行, 必须有已完成动作"
        assert any(a.get("result") for a in done), "已完成动作必须带业务结果文本"
        assert any(a.get("evidence") for a in done), "已完成动作必须带证据链"


class TestReformGapAnalysis:
    """R2 差距诊断."""

    async def test_gap_analysis(self, client, sample_enterprise_id):
        r = await client.post(f"/api/v1/reform/{sample_enterprise_id}/gap-analysis")
        # 200=成功, 422=端点已接通且校验输入(需要 scorecard 载荷)
        assert r.status_code in (200, 422)


class TestReformState:
    """改造状态查询 (GET /reform/{id}/state)."""

    async def test_get_state(self, client, sample_enterprise_id):
        r = await client.get(f"/api/v1/reform/{sample_enterprise_id}/state")
        assert r.status_code == 200
        body = r.json()
        # 改造未启动时 code 可能为 404 (合法), 启动后 code=0
        assert body["code"] in (0, 404)
        if body["code"] == 0:
            assert body["data"] is None or "status" in body["data"]


class TestReformCases:
    """R10 案例入库 + 案例库查询."""

    async def test_list_cases(self, client):
        r = await client.get("/api/v1/reform/cases")
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == 0
        assert isinstance(body["data"], list)
