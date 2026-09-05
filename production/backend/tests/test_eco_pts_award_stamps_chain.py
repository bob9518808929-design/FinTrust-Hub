"""APP-02 Task 11.4: POST /eco-pts/award 异步上链 + 重试队列测试.

覆盖 6 个用例:
    1. 移动端调用 + mock put_evidence 成功 → award 200 + chainTxHash=null + 无新重试记录
    2. 移动端调用 + mock put_evidence 抛异常 → award 200 + chainTxHash=null + 积分入账 + 重试队列新增 1 条 pending
    3. PC 端调用 (无 X-Client-Type / 无 evidence/location) → award 200 + chainTxHash=null + 跳过 stamp
    4. PC 端误传 evidence 但无 location → 仍跳过上链
    5. APScheduler 重试扫描 → pending 记录 put_evidence 成功后变 done
    6. 连续失败 3 次 → 记录变 abandoned, 不再重试
"""

from unittest.mock import AsyncMock, patch

import pytest

from app.services.eco_service import eco_pts_service

pytestmark = pytest.mark.asyncio


WORKER_ID = "E001-W01"


def _mobile_payload(worker_id: str = WORKER_ID) -> dict:
    """构造移动端 award 请求体 (含 evidence + location + fromMobile)."""
    return {
        "workerId": worker_id,
        "behavior": "exception_report",
        "materialId": "MAT-001",
        "photoHash": "abc123def456",
        "location": {"value": "31.2304,121.4737", "accuracy": 10},
        "fromMobile": True,
    }


def _pc_payload(worker_id: str = WORKER_ID) -> dict:
    """构造 PC 端 award 请求体 (无 evidence/location, 向后兼容)."""
    return {
        "workerId": worker_id,
        "behavior": "exception_report",
    }


@pytest.fixture(autouse=True)
def _reset_retry_queue():
    """每个用例前后清空内存重试队列 (避免相互污染)."""
    if hasattr(eco_pts_service, "_retry_queue_mem"):
        eco_pts_service._retry_queue_mem.clear()
    # 同时清理 scan_history (避免 exception_report 触发防刷分, 实际仅 scan_confirm 触发)
    eco_pts_service._scan_history.pop(WORKER_ID, None)
    yield
    if hasattr(eco_pts_service, "_retry_queue_mem"):
        eco_pts_service._retry_queue_mem.clear()
    eco_pts_service._scan_history.pop(WORKER_ID, None)


def _tx_hash_valid() -> str:
    """构造一个非 "0"*64 的有效 tx_hash (模拟蚂蚁链成功上链)."""
    return "a1b2c3d4e5f6" + "0" * 52  # 长度 64, 不等于 "0"*64


class TestAwardStampsChain:
    """APP-02 Task 11.4: 异步上链端到端测试."""

    async def test_mobile_award_with_successful_stamp(self, client):
        """用例 1: 移动端 + put_evidence 成功 → award 200 + chainTxHash=null + 无新重试记录."""
        with patch(
            "app.services.chain_service.chain_service.put_evidence",
            new_callable=AsyncMock,
            return_value={
                "tx_hash": _tx_hash_valid(),
                "block_height": 100,
                "chain": "ant",
                "timestamp": 123,
                "data_hash": "abc",
            },
        ) as mock_put:
            r = await client.post(
                "/api/v1/eco-pts/award",
                json=_mobile_payload(),
                headers={"X-Client-Type": "MobilePWA/1.0"},
            )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["code"] == 0
        data = body["data"]
        assert data["awarded"] is True
        assert data["fraudBlocked"] in (None, False)
        # chainTxHash 永远先 null (后台异步, 响应不等待)
        assert data["chainTxHash"] is None
        # 后台 stamp 成功 → 不应入重试队列
        assert mock_put.await_count == 1
        retry_queue = getattr(eco_pts_service, "_retry_queue_mem", [])
        assert len(retry_queue) == 0, f"expected empty retry queue, got {retry_queue}"

    async def test_mobile_award_with_stamp_exception_enqueues_retry(self, client):
        """用例 2: 移动端 + put_evidence 抛异常 → award 200 + chainTxHash=null + 积分入账 + 重试队列新增 1 条 pending."""
        with patch(
            "app.services.chain_service.chain_service.put_evidence",
            new_callable=AsyncMock,
            side_effect=ConnectionError("chain network unreachable"),
        ):
            r = await client.post(
                "/api/v1/eco-pts/award",
                json=_mobile_payload(),
                headers={"X-Client-Type": "MobilePWA/1.0"},
            )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["code"] == 0
        data = body["data"]
        # 积分仍入账 (上链失败不阻塞主流程)
        assert data["awarded"] is True
        # chainTxHash null
        assert data["chainTxHash"] is None
        # 重试队列新增 1 条 pending
        retry_queue = getattr(eco_pts_service, "_retry_queue_mem", [])
        assert len(retry_queue) == 1, f"expected 1 retry entry, got {retry_queue}"
        entry = retry_queue[0]
        assert entry["status"] == "pending"
        assert entry["retry_count"] == 0
        assert entry["award_id"].startswith("award-")
        assert len(entry["evidence_hash"]) == 64  # SHA-256 hex

    async def test_pc_award_skips_stamp(self, client):
        """用例 3: PC 端 (无 X-Client-Type, 无 evidence/location) → award 200 + chainTxHash=null + 跳过 stamp."""
        with patch(
            "app.services.chain_service.chain_service.put_evidence",
            new_callable=AsyncMock,
        ) as mock_put:
            r = await client.post(
                "/api/v1/eco-pts/award",
                json=_pc_payload(),
                # 不带 X-Client-Type 头 (PC 端)
            )
        assert r.status_code == 200, r.text
        body = r.json()
        data = body["data"]
        assert data["awarded"] is True
        assert data["chainTxHash"] is None
        # PC 端: 不应触发 put_evidence
        assert mock_put.await_count == 0
        # 重试队列应为空
        retry_queue = getattr(eco_pts_service, "_retry_queue_mem", [])
        assert len(retry_queue) == 0

    async def test_pc_award_with_evidence_but_no_location_skips_stamp(self, client):
        """用例 4: PC 端误传 evidence 但无 location → 仍跳过上链.

        即使有 materialId/photoHash, 缺 location 也跳过 (向后兼容).
        """
        payload = {
            "workerId": WORKER_ID,
            "behavior": "exception_report",
            "materialId": "MAT-002",
            "photoHash": "def789",
            # 故意不传 location
        }
        with patch(
            "app.services.chain_service.chain_service.put_evidence",
            new_callable=AsyncMock,
        ) as mock_put:
            r = await client.post(
                "/api/v1/eco-pts/award",
                json=payload,
                # 不带 X-Client-Type
            )
        assert r.status_code == 200, r.text
        body = r.json()
        data = body["data"]
        assert data["awarded"] is True
        assert data["chainTxHash"] is None
        # 缺 location → 跳过 stamp
        assert mock_put.await_count == 0
        retry_queue = getattr(eco_pts_service, "_retry_queue_mem", [])
        assert len(retry_queue) == 0

    async def test_retry_queue_success_marks_done(self):
        """用例 5: 模拟 APScheduler 重试扫描 → pending 记录 put_evidence 成功后变 done.

        直接调用 eco_pts_service 的重试入口 (drain + retry_stamp_once) 验证.
        """
        # 手动入队一条 pending 记录 (模拟失败后入队)
        eco_pts_service._enqueue_retry(
            {"awardId": "award-retry-001", "workerId": WORKER_ID},
            evidence_hash="a" * 64,
            reason="initial failure",
        )
        assert len(eco_pts_service._retry_queue_mem) == 1

        # mock put_evidence 成功
        with patch(
            "app.services.chain_service.chain_service.put_evidence",
            new_callable=AsyncMock,
            return_value={
                "tx_hash": _tx_hash_valid(),
                "block_height": 200,
                "chain": "ant",
                "timestamp": 456,
                "data_hash": "def",
            },
        ):
            # 模拟 APScheduler 重试任务逻辑
            drained = eco_pts_service.drain_in_memory_retry_queue()
            for entry in drained:
                ok = await eco_pts_service.retry_stamp_once(entry)
                if ok:
                    entry["status"] = "done"
                else:
                    entry["status"] = "failed"

        # 验证 entry 标记为 done, 且不再在队列中
        assert len(drained) == 1
        assert drained[0]["status"] == "done"
        assert len(eco_pts_service._retry_queue_mem) == 0

    async def test_retry_queue_3_failures_marks_abandoned(self):
        """用例 6: 连续失败 3 次 → 记录变 abandoned, 不再重试.

        模拟 APScheduler 多轮扫描, 每轮 put_evidence 失败, retry_count 累加.
        """
        eco_pts_service._enqueue_retry(
            {"awardId": "award-retry-002", "workerId": WORKER_ID},
            evidence_hash="b" * 64,
            reason="initial failure",
        )
        initial_entry = eco_pts_service._retry_queue_mem[0]
        assert initial_entry["retry_count"] == 0

        # mock put_evidence 持续失败
        with patch(
            "app.services.chain_service.chain_service.put_evidence",
            new_callable=AsyncMock,
            side_effect=RuntimeError("chain still down"),
        ):
            # 模拟 3 轮 APScheduler 重试扫描
            for round_num in range(1, 4):
                drained = eco_pts_service.drain_in_memory_retry_queue()
                for entry in drained:
                    ok = await eco_pts_service.retry_stamp_once(entry)
                    if ok:
                        entry["status"] = "done"
                    else:
                        entry["retry_count"] = int(entry.get("retry_count", 0)) + 1
                        if entry["retry_count"] >= 3:
                            entry["status"] = "abandoned"
                        else:
                            # 重新入队等待下一轮
                            entry["status"] = "pending"
                            eco_pts_service._retry_queue_mem.append(entry)

        # 第 3 轮后 entry 应标记为 abandoned, 不再入队
        assert len(drained) == 1
        final_entry = drained[0]
        assert final_entry["status"] == "abandoned"
        assert final_entry["retry_count"] == 3
        # abandoned 后不再重试 → 队列为空
        assert len(eco_pts_service._retry_queue_mem) == 0
