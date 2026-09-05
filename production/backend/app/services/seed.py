"""开发期种子数据 (mock-data.js 镜像).

设计依据: simulation/js/mock-data.js 的 ENTERPRISES / BANKS / GUARANTORS / INSURERS.
用途: 开发期 init_db 后注入, 让前端无后端真实数据时也能联调.
生产期: 由数据迁移脚本 (alembic) 注入, 不在运行时加载.
"""

from datetime import UTC, datetime
from uuid import uuid4


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:8]}"


# === 企业种子 (镜像 mock-data.js ENTERPRISES E001-E004) ===

ENTERPRISES_SEED = [
    {
        "id": "E001",
        "name": "宏达精密制造有限公司",
        "industry": "manufacturing",
        "industryLabel": "制造业",
        "industryPolicy": "encourage",
        "riskProfile": "normal",
        "riskLabel": "一般风险",
        "dataFlows": {
            "fund": True, "contract": True, "invoice": True,
            "logistics": True, "iot": True, "personnel": False,
        },
        "modules": {
            "fundMonitor": "strong", "billService": True, "arInsurance": True,
            "iotPerception": True, "blockchainAnchor": False, "aiAutonomyMax": "L4",
        },
        "cooperation": {
            "enterpriseMode": ["custody", "planning"],
            "bankMode": ["pre_loan", "post_loan"],
            "guarantorMode": ["collaborate"],
            "insuranceMode": ["joint_underwriting"],
        },
        "dataVisibility": {
            "bank": ["credit_score", "financials", "responsibility_chain"],
            "guarantor": ["financials", "assets"],
            "insurance": ["bills", "ar"],
        },
        "financials": {
            "monthlyRevenue": 5000000,
            "monthlyExpense": 3200000,
            "accountBalance": 8000000,
            "pendingAR": 3500000,
            "billsHeld": [
                {
                    "billId": "B-2024-001",
                    "amount": 1200000,
                    "dueDate": "2026-12-31T00:00:00Z",
                    "type": "bank_acceptance",
                    "insured": True,
                }
            ],
        },
        "runtime": {
            "creditCompleteness": 0.72,
            "creditScore": 720,
            "maxAmountMultiplier": 1.5,
            "rateDiscount": 0.15,
            "creditGradeCap": "B",
            "approvalSpeed": "fast",
            "waterLevel": 0.62,
            "fiveStreams": {
                "fund": True, "contract": True, "invoice": True,
                "logistics": True, "iot": True, "personnel": False,
            },
            "guaranteeStatus": "active",
            "insuranceStatus": "active",
            "financingUnlocked": True,
            "responsibilityChain": {
                "nodes": [
                    {"nodeId": "N01", "name": "原料采购", "role": "采购", "operator": "周销售", "approver": "经理", "method": "扫码确权", "creditWeight": 10, "stage": "原料"},
                    {"nodeId": "N02", "name": "生产入库", "role": "生产", "operator": "赵生产", "method": "扫码确权", "creditWeight": 12, "stage": "生产"},
                    {"nodeId": "N03", "name": "成品出库", "role": "仓库", "operator": "张仓库", "method": "扫码确权", "creditWeight": 10, "stage": "仓储"},
                    {"nodeId": "N04", "name": "物流配送", "role": "物流", "operator": "孙物流", "method": "扫码确权", "creditWeight": 8, "stage": "物流"},
                ],
                "completeness": 0.85,
                "totalScore": 40,
                "complianceReport": None,
            },
        },
        "reform": {
            "status": "completed",
            "progress": 1.0,
            "currentLevel": "A",
            "targetLevel": "A",
            "aggressionLevel": "balanced",
            "startedAt": "2026-06-01T00:00:00Z",
            "completedAt": "2026-08-01T00:00:00Z",
        },
    },
    {
        "id": "E002",
        "name": "智芯科技有限公司",
        "industry": "high_tech",
        "industryLabel": "高科技",
        "industryPolicy": "encourage",
        "riskProfile": "premium",
        "riskLabel": "优质",
        "dataFlows": {
            "fund": True, "contract": True, "invoice": True,
            "logistics": False, "iot": True, "personnel": True,
        },
        "modules": {
            "fundMonitor": "strong", "billService": False, "arInsurance": True,
            "iotPerception": True, "blockchainAnchor": True, "aiAutonomyMax": "L4",
        },
        "cooperation": {
            "enterpriseMode": ["planning", "financing_advisory"],
            "bankMode": ["pre_loan", "consulting"],
            "guarantorMode": [],
            "insuranceMode": ["joint_underwriting"],
        },
        "dataVisibility": {
            "bank": ["credit_score", "financials", "iot"],
            "guarantor": [],
            "insurance": ["ar", "personnel"],
        },
        "financials": {
            "monthlyRevenue": 8000000,
            "monthlyExpense": 5000000,
            "accountBalance": 15000000,
            "pendingAR": 6000000,
            "billsHeld": [],
        },
        "runtime": {
            "creditCompleteness": 0.88,
            "creditScore": 780,
            "maxAmountMultiplier": 2.0,
            "rateDiscount": 0.25,
            "creditGradeCap": "A",
            "approvalSpeed": "fast",
            "waterLevel": 0.75,
            "fiveStreams": {
                "fund": True, "contract": True, "invoice": True,
                "logistics": False, "iot": True, "personnel": True,
            },
            "guaranteeStatus": "none",
            "insuranceStatus": "active",
            "financingUnlocked": True,
            "responsibilityChain": {
                "nodes": [
                    {"nodeId": "N01", "name": "研发立项", "role": "研发", "operator": "黄财务", "method": "扫码确权", "creditWeight": 15, "stage": "研发"},
                    {"nodeId": "N02", "name": "物料采购", "role": "采购", "operator": "林仓管", "method": "扫码确权", "creditWeight": 10, "stage": "采购"},
                ],
                "completeness": 0.90,
                "totalScore": 25,
                "complianceReport": None,
            },
        },
        "reform": {
            "status": "completed",
            "progress": 1.0,
            "currentLevel": "A",
            "targetLevel": "A",
            "aggressionLevel": "innovative",
            "startedAt": "2026-05-15T00:00:00Z",
            "completedAt": "2026-07-20T00:00:00Z",
        },
    },
    {
        "id": "E003",
        "name": "鑫达贸易有限公司",
        "industry": "trade",
        "industryLabel": "贸易",
        "industryPolicy": "neutral",
        "riskProfile": "high_risk",
        "riskLabel": "较高风险",
        "dataFlows": {
            "fund": True, "contract": True, "invoice": True,
            "logistics": True, "iot": False, "personnel": False,
        },
        "modules": {
            "fundMonitor": "weak", "billService": True, "arInsurance": False,
            "iotPerception": False, "blockchainAnchor": False, "aiAutonomyMax": "L2",
        },
        "cooperation": {
            "enterpriseMode": ["advisory"],
            "bankMode": ["discovery"],
            "guarantorMode": ["compensation"],
            "insuranceMode": [],
        },
        "dataVisibility": {
            "bank": ["credit_score"],
            "guarantor": ["financials"],
            "insurance": [],
        },
        "financials": {
            "monthlyRevenue": 3000000,
            "monthlyExpense": 2800000,
            "accountBalance": 2000000,
            "pendingAR": 4500000,
            "billsHeld": [],
        },
        "runtime": {
            "creditCompleteness": 0.45,
            "creditScore": 580,
            "maxAmountMultiplier": 0.8,
            "rateDiscount": 0.0,
            "creditGradeCap": "C",
            "approvalSpeed": "slow",
            "waterLevel": 0.35,
            "fiveStreams": {
                "fund": True, "contract": True, "invoice": True,
                "logistics": True, "iot": False, "personnel": False,
            },
            "guaranteeStatus": "pending",
            "insuranceStatus": "none",
            "financingUnlocked": False,
            "responsibilityChain": {
                "nodes": [
                    {"nodeId": "N01", "name": "采购入库", "role": "仓库", "operator": "吴司机", "method": "扫码确权", "creditWeight": 8, "stage": "仓储"},
                ],
                "completeness": 0.30,
                "totalScore": 8,
                "complianceReport": None,
            },
        },
        "reform": {
            "status": "in_progress",
            "progress": 0.45,
            "currentLevel": "C",
            "targetLevel": "A",
            "aggressionLevel": "balanced",
            "startedAt": "2026-08-01T00:00:00Z",
            "completedAt": None,
        },
    },
    {
        "id": "E004",
        "name": "绿源能源科技",
        "industry": "energy",
        "industryLabel": "新能源",
        "industryPolicy": "encourage",
        "riskProfile": "normal",
        "riskLabel": "一般风险",
        "dataFlows": {
            "fund": True, "contract": True, "invoice": True,
            "logistics": True, "iot": True, "personnel": True,
        },
        "modules": {
            "fundMonitor": "strong", "billService": True, "arInsurance": True,
            "iotPerception": True, "blockchainAnchor": True, "aiAutonomyMax": "L3",
        },
        "cooperation": {
            "enterpriseMode": ["custody", "self_operated"],
            "bankMode": ["pre_loan", "post_loan", "consulting"],
            "guarantorMode": ["counter_guarantee"],
            "insuranceMode": ["joint_underwriting", "claim_collab"],
        },
        "dataVisibility": {
            "bank": ["credit_score", "financials", "responsibility_chain", "iot"],
            "guarantor": ["financials", "assets", "bills"],
            "insurance": ["bills", "ar", "personnel"],
        },
        "financials": {
            "monthlyRevenue": 6500000,
            "monthlyExpense": 4200000,
            "accountBalance": 10000000,
            "pendingAR": 5000000,
            "billsHeld": [
                {
                    "billId": "B-2024-002",
                    "amount": 2000000,
                    "dueDate": "2027-03-31T00:00:00Z",
                    "type": "electronic",
                    "insured": False,
                }
            ],
        },
        "runtime": {
            "creditCompleteness": 0.80,
            "creditScore": 740,
            "maxAmountMultiplier": 1.7,
            "rateDiscount": 0.18,
            "creditGradeCap": "A",
            "approvalSpeed": "fast",
            "waterLevel": 0.68,
            "fiveStreams": {
                "fund": True, "contract": True, "invoice": True,
                "logistics": True, "iot": True, "personnel": True,
            },
            "guaranteeStatus": "active",
            "insuranceStatus": "active",
            "financingUnlocked": True,
            "responsibilityChain": {
                "nodes": [
                    {"nodeId": "N01", "name": "原料采购", "role": "采购", "operator": "郑采购", "method": "扫码确权", "creditWeight": 10, "stage": "原料"},
                    {"nodeId": "N02", "name": "生产装配", "role": "生产", "operator": "王生产", "method": "扫码确权", "creditWeight": 12, "stage": "生产"},
                    {"nodeId": "N03", "name": "成品检验", "role": "质检", "operator": "李质检", "method": "扫码确权", "creditWeight": 10, "stage": "质检"},
                    {"nodeId": "N04", "name": "成品出库", "role": "仓库", "operator": "张仓库", "method": "扫码确权", "creditWeight": 10, "stage": "仓储"},
                    {"nodeId": "N05", "name": "物流配送", "role": "物流", "operator": "孙物流", "method": "扫码确权", "creditWeight": 8, "stage": "物流"},
                ],
                "completeness": 0.92,
                "totalScore": 50,
                "complianceReport": None,
            },
        },
        "reform": {
            "status": "completed",
            "progress": 1.0,
            "currentLevel": "A",
            "targetLevel": "A",
            "aggressionLevel": "innovative",
            "startedAt": "2026-04-10T00:00:00Z",
            "completedAt": "2026-07-01T00:00:00Z",
        },
    },
]


# === 银行种子 (镜像 mock-data.js BANKS) ===

BANKS_SEED = [
    {
        "id": "BANK-001",
        "name": "中国工商银行",
        "baseRate": "LPR+1.5%",
        "baseRateValue": 0.0495,
        "maxAmount": 50000000,
        "requiresGuarantee": False,
        "label": "国有大行, 额度高, 审批慢",
        "bankGroup": "国有大行",
    },
    {
        "id": "BANK-002",
        "name": "招商银行",
        "baseRate": "LPR+2.0%",
        "baseRateValue": 0.0545,
        "maxAmount": 20000000,
        "requiresGuarantee": False,
        "label": "股份制, 审批快, 数字化强",
        "bankGroup": "股份制",
    },
    {
        "id": "BANK-003",
        "name": "中信银行",
        "baseRate": "LPR+1.8%",
        "baseRateValue": 0.0525,
        "maxAmount": 30000000,
        "requiresGuarantee": True,
        "label": "股份制, 供应链金融强",
        "bankGroup": "股份制",
    },
    {
        "id": "BANK-004",
        "name": "网商银行",
        "baseRate": "LPR+2.5%",
        "baseRateValue": 0.0595,
        "maxAmount": 5000000,
        "requiresGuarantee": False,
        "label": "互联网银行, 秒批秒贷",
        "bankGroup": "互联网",
    },
]


# === 担保公司种子 ===

GUARANTORS_SEED = [
    {
        "id": "GUA-001",
        "name": "中投保",
        "mode": "collaborate",
        "activeGuarantees": 42,
        "guaranteeRate": "1.5%",
    },
    {
        "id": "GUA-002",
        "name": "省融资担保公司",
        "mode": "compensation",
        "activeGuarantees": 18,
        "guaranteeRate": "1.2%",
    },
    {
        "id": "GUA-003",
        "name": "鑫达信用担保",
        "mode": "counter_guarantee",
        "activeGuarantees": 7,
        "guaranteeRate": "2.0%",
    },
]


# === 保险公司种子 ===

INSURERS_SEED = [
    {
        "id": "INS-001",
        "name": "中国人寿财险",
        "mode": "joint_underwriting",
        "activePolicies": 56,
        "premiumRate": "0.8%",
    },
    {
        "id": "INS-002",
        "name": "平安产险",
        "mode": "claim_collab",
        "activePolicies": 31,
        "premiumRate": "0.7%",
    },
]


# === 工人花名册 (ECO-06 积分商城) ===

WORKERS_SEED = [
    {"workerId": "E001-W01", "name": "孙物流", "role": "物流司机", "entId": "E001", "entName": "宏达精密制造有限公司", "deviceFp": "fp-sun-001"},
    {"workerId": "E001-W02", "name": "张仓库", "role": "仓库管理员", "entId": "E001", "entName": "宏达精密制造有限公司", "deviceFp": "fp-zhang-002"},
    {"workerId": "E001-W03", "name": "赵生产", "role": "生产负责人", "entId": "E001", "entName": "宏达精密制造有限公司", "deviceFp": "fp-zhao-003"},
    {"workerId": "E001-W04", "name": "周销售", "role": "销售", "entId": "E001", "entName": "宏达精密制造有限公司", "deviceFp": "fp-zhou-004"},
    {"workerId": "E002-W01", "name": "陈物流", "role": "物流司机", "entId": "E002", "entName": "智芯科技有限公司", "deviceFp": "fp-chen-101"},
    {"workerId": "E002-W02", "name": "林仓管", "role": "仓库管理员", "entId": "E002", "entName": "智芯科技有限公司", "deviceFp": "fp-lin-102"},
    {"workerId": "E002-W03", "name": "黄财务", "role": "财务人员", "entId": "E002", "entName": "智芯科技有限公司", "deviceFp": "fp-huang-103"},
    {"workerId": "E003-W01", "name": "吴司机", "role": "物流司机", "entId": "E003", "entName": "鑫达贸易有限公司", "deviceFp": "fp-wu-201"},
    {"workerId": "E004-W01", "name": "郑采购", "role": "采购", "entId": "E004", "entName": "绿源能源科技", "deviceFp": "fp-zheng-301"},
    {"workerId": "E004-W02", "name": "王生产", "role": "生产", "entId": "E004", "entName": "绿源能源科技", "deviceFp": "fp-wang-302"},
    {"workerId": "E004-W03", "name": "李质检", "role": "质检", "entId": "E004", "entName": "绿源能源科技", "deviceFp": "fp-li-303"},
]


# === 商品库 (ECO-06) ===

SHOP_ITEMS_SEED = [
    {"itemId": "shop-001", "name": "充电宝 10000mAh", "icon": "🔋", "creditCost": 30, "currencyCost": 35, "stock": 50, "category": "电子"},
    {"itemId": "shop-002", "name": "保温杯 316不锈钢", "icon": "☕", "creditCost": 20, "currencyCost": 25, "stock": 80, "category": "生活"},
    {"itemId": "shop-003", "name": "外卖券 30元", "icon": "🍱", "creditCost": 25, "currencyCost": 30, "stock": 100, "category": "餐饮"},
    {"itemId": "shop-004", "name": "话费充值 50元", "icon": "📱", "creditCost": 40, "currencyCost": 50, "stock": 200, "category": "通讯"},
    {"itemId": "shop-005", "name": "电影票 2D", "icon": "🎬", "creditCost": 35, "currencyCost": 40, "stock": 60, "category": "娱乐"},
]
