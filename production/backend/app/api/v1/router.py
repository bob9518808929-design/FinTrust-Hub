"""API v1 路由聚合.

挂载所有子路由到 /api/v1 前缀下:
    /api/v1/enterprises          企业 CRUD + 融资入口锁定
    /api/v1/banks                金融机构列表
    /api/v1/guarantors           担保公司
    /api/v1/insurers             保险公司
    /api/v1/bank/*               银行信任培育期 (CORE-01b)
    /api/v1/reform               改造引擎 R0-R10 + R10 混合架构
    /api/v1/approvals            人工审批 (Tab3)
    /api/v1/institutions/*       担保保险流程 (Tab5)
    /api/v1/cockpit/*            AI 驾驶舱 (Tab7)
    /api/v1/scf/*                供应链金融 SC1-SC10 引擎族 (SCF-05/06/08/09)
    /api/v1/eco-burn             ECO-01 阅后即焚
    /api/v1/eco-pricing          ECO-02 阶梯定价
    /api/v1/eco-adapter          ECO-03 无接口适配器
    /api/v1/eco-credential       ECO-04 联盟链凭证
    /api/v1/eco-bid              ECO-05 反向竞拍
    /api/v1/eco-pts              ECO-06 积分商城
    /api/v1/eco-index            ECO-07 行业指数
    /api/v1/eco-gov              ECO-08 政府背书
    /api/v1/eco-bot              ECO-09 数字分身
"""

from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.bank import bank_router
from app.api.v1.core.ai_orchestrator import ai_orch_router
from app.api.v1.core.opt_in_config import opt_in_router  # CORE-03 R2.10 企业可选配置引擎
from app.api.v1.data.bank import data_bank_router
from app.api.v1.data.external import external_data_router
from app.api.v1.data.ocr_parsers import parsers_router
from app.api.v1.eco_adapter import router as eco_adapter_router
from app.api.v1.eco_bid import router as eco_bid_router
from app.api.v1.eco_bot import router as eco_bot_router
from app.api.v1.eco_burn import router as eco_burn_router
from app.api.v1.eco_credential import router as eco_credential_router
from app.api.v1.eco_gov import router as eco_gov_router
from app.api.v1.eco_index import router as eco_index_router
from app.api.v1.eco_pricing import router as eco_pricing_router
from app.api.v1.eco_pts import router as eco_pts_router
from app.api.v1.enterprises import (
    banks_router,
    guarantors_router,
    insurers_router,
)
from app.api.v1.enterprises import (
    router as enterprises_router,
)
from app.api.v1.infra.api_adapters import api_adapters_router  # INFRA-01b R2.11 15 个 API 适配器
from app.api.v1.infra.reform_sandbox import reform_sandbox_router  # INFRA-04 R3.2 改造沙箱仿真
from app.api.v1.infra.rpa import router as rpa_router  # INFRA-05 R6.2 RPA 适配层
from app.api.v1.modules.cooperation import router as cooperation_router  # MOD-09
from app.api.v1.modules.credential import credential_router  # MOD-08b R3.1 W3C VC 信用凭证
from app.api.v1.modules.fallback_engine import router as fallback_router  # MOD-15 R6.3 兜底引擎
from app.api.v1.modules.five_flow import router as five_flow_router  # MOD-01 R4.6 五流合一
from app.api.v1.modules.insurance import router as insurance_router  # MOD-05 V3 应收款保险
from app.api.v1.modules.iot_gateway import iot_router  # DATA-04 R2.7 IoT MQTT 网关
from app.api.v1.modules.multilateral import router as multilateral_router  # MOD-13 R5.8 多方协作
from app.api.v1.modules.performance import router as performance_router  # MOD-06
from app.api.v1.modules.policy import router as policy_router  # MOD-10
from app.api.v1.modules.privacy import router as privacy_router  # MOD-07
from app.api.v1.modules.refinance import router as refinance_router  # MOD-11
from app.api.v1.modules.responsibility import router as responsibility_router  # MOD-14
from app.api.v1.modules.risk_rule import router as risk_rule_router  # MOD-02 R4.7 风控规则
from app.api.v1.operations import (
    approvals_router,
    cockpit_router,
    institutions_router,
)
from app.api.v1.reform import router as reform_router
from app.api.v1.scf import router as scf_router

api_router = APIRouter(prefix="/v1")

# APP-02 工人登录 (无鉴权前置, 登录端点本身)
api_router.include_router(auth_router)

# 企业 + 金融机构
api_router.include_router(enterprises_router)
api_router.include_router(banks_router)
api_router.include_router(guarantors_router)
api_router.include_router(insurers_router)

# CORE-01b 银行信任培育期渐进解锁 (单数 /bank/* 路径)
api_router.include_router(bank_router)

# 改造引擎 (R0-R10 + R10 V1 混合架构)
api_router.include_router(reform_router)

# 运营态: 审批 / 担保保险 / AI驾驶舱
api_router.include_router(approvals_router)
api_router.include_router(institutions_router)
api_router.include_router(cockpit_router)

# SCF 供应链金融引擎族 (SC6/SC7/SC8/SC9/SC10 + 场景预设 + reform 联动)
api_router.include_router(scf_router)

# ECO 9 模块
api_router.include_router(eco_burn_router)
api_router.include_router(eco_pricing_router)
api_router.include_router(eco_adapter_router)
api_router.include_router(eco_credential_router)
api_router.include_router(eco_bid_router)
api_router.include_router(eco_pts_router)
api_router.include_router(eco_index_router)
api_router.include_router(eco_gov_router)
api_router.include_router(eco_bot_router)

# DATA-03 OCR 解析 (R1.3)
api_router.include_router(parsers_router)

# DATA-02 第三方数据源接入
api_router.include_router(external_data_router)

# DATA-01 银企直连 (R1.1)
api_router.include_router(data_bank_router)

# CORE-01 AI 自主操作编排引擎 (R1.4)
api_router.include_router(ai_orch_router)

# MOD-06 AI 履约评分引擎
api_router.include_router(performance_router)

# MOD-07 数据安全与隐私计算
api_router.include_router(privacy_router)

# MOD-09 合作模式管理
api_router.include_router(cooperation_router)

# MOD-10 政策与行业因素
api_router.include_router(policy_router)

# MOD-11 再融资再贴现闭环
api_router.include_router(refinance_router)

# MOD-14 人流责任链
api_router.include_router(responsibility_router)

# MOD-01 R4.6 五流合一校验引擎 (资金监管)
api_router.include_router(five_flow_router)

# MOD-02 R4.7 风控规则 DSL + 热加载 + 流处理
api_router.include_router(risk_rule_router)

# DATA-04 R2.7 IoT MQTT 网关 (HTTP 长轮询降级 + 模拟设备)
api_router.include_router(iot_router)

# CORE-03 R2.10 企业可选配置引擎 (6 flow + 16 module)
api_router.include_router(opt_in_router)

# INFRA-01b R2.11 15 个外部 API 适配层 + 限流容错引擎 + 注册表
api_router.include_router(api_adapters_router)

# MOD-08b R3.1 W3C VC 信用凭证 + 联盟链跨行核验
api_router.include_router(credential_router)

# INFRA-04 R3.2 改造沙箱仿真 (快照 + 变更 + 提交 + 回滚 + 自动清理)
api_router.include_router(reform_sandbox_router)

# MOD-13 R5.8 多方协作 (电子签章 + SLA 协作任务)
api_router.include_router(multilateral_router)

# INFRA-05 R6.2 RPA 适配层 (银行流水/发票/合同 PDF)
api_router.include_router(rpa_router)

# MOD-15 R6.3 兜底引擎 (在线/离线/降级 + 队列重放 + 冲突检测)
api_router.include_router(fallback_router)

# MOD-05 V3 应收款保险 (投保流程 + 保单管理 + 理赔协同)
api_router.include_router(insurance_router)
