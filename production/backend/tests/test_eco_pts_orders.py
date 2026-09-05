"""APP-02 Task 7: GET /eco-pts/orders 分页测试.

覆盖:
    1. workerId=W001 返回订单列表按时间倒序
    2. 不传 workerId → 422 (FastAPI Required)
    3. workerId=W999 不存在 → 200 + 空数组 []
    4. page=2&page_size=5 → 返回第 6-10 条
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.schemas.eco import ExchangeOrder
from app.services.eco_service import eco_pts_service

pytestmark = pytest.mark.asyncio


WORKER_ID = "E001-W01"


def _make_order(order_id: str, worker_id: str, placed_at_iso: str) -> ExchangeOrder:
    """构造 ExchangeOrder (内存种子)."""
    return ExchangeOrder(
        orderId=order_id,
        workerId=worker_id,
        itemId="shop-002",
        itemName="保温杯 316不锈钢",
        creditCost=20,
        currencyCost=25,
        status="pending",
        placedAt=placed_at_iso,
        shippedAt=None,
    )


@pytest.fixture
async def seed_orders():
    """为 W001 注入 10 条订单 (placedAt 递增), 供分页测试.

    直接操作单例内存 store (conftest 把 get_db 覆盖为 None, 走内存路径).
    """
    base = datetime(2026, 8, 1, 12, 0, 0, tzinfo=UTC)
    saved = eco_pts_service._orders
    injected_ids = []
    for i in range(10):
        oid = f"ord-seed-{i:02d}"
        ts = (base + timedelta(minutes=i)).isoformat()
        saved[oid] = _make_order(oid, WORKER_ID, ts)
        injected_ids.append(oid)
    yield injected_ids
    # 清理
    for oid in injected_ids:
        saved.pop(oid, None)


class TestListOrdersPagination:
    """APP-02 Task 7: GET /eco-pts/orders 分页."""

    async def test_orders_sorted_desc_by_time(self, client, seed_orders):
        """用例 1: workerId=W001 返回订单列表按时间倒序."""
        r = await client.get(f"/api/v1/eco-pts/orders?worker_id={WORKER_ID}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["code"] == 0
        items = body["data"]
        assert len(items) == 10
        # 倒序: 第一个应为 ord-seed-09 (placedAt 最大)
        assert items[0]["orderId"] == "ord-seed-09"
        assert items[-1]["orderId"] == "ord-seed-00"

    async def test_missing_worker_id_returns_422(self, client):
        """用例 2: 不传 workerId → 422 (FastAPI Required 校验)."""
        r = await client.get("/api/v1/eco-pts/orders")
        assert r.status_code == 422

    async def test_unknown_worker_returns_empty_array(self, client):
        """用例 3: workerId=W999 不存在 → 200 + 空数组 []."""
        r = await client.get("/api/v1/eco-pts/orders?worker_id=W999-not-exists")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["code"] == 0
        assert body["data"] == []

    async def test_pagination_page2_size5_returns_6th_to_10th(self, client, seed_orders):
        """用例 4: page=2&page_size=5 → 返回第 6-10 条 (倒序后第 6-10 条).

        倒序后顺序: ord-seed-09, 08, 07, 06, 05, 04, 03, 02, 01, 00
        page=1 size=5 → 09,08,07,06,05
        page=2 size=5 → 04,03,02,01,00
        """
        r = await client.get(
            f"/api/v1/eco-pts/orders?worker_id={WORKER_ID}&page=2&page_size=5"
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["code"] == 0
        items = body["data"]
        assert len(items) == 5
        # page=2 切片 [5:10] 应为 04,03,02,01,00
        assert items[0]["orderId"] == "ord-seed-04"
        assert items[-1]["orderId"] == "ord-seed-00"
