"""ECO-01 阅后即焚零信任诊断路由.

端点:
    POST   /eco-burn/load               加载原始数据 (结构化 JSON, 模拟 SGX enclave 内存)
    POST   /eco-burn/load-file          加载原始材料文件 (JSON/CSV/TXT/MD/DOCX/XLSX/PDF/PNG/JPG 全格式,
                                        后端统一分流解析: 文本零依赖 / docx/xlsx ZIP容器 / pdfplumber /
                                        图片与扫描件走 OCR 三引擎降级链)
    POST   /eco-burn/{eid}/diagnose      启动诊断 (R1 画像 + R2 差距)
    GET    /eco-burn/{eid}/progress      查诊断进度
    GET    /eco-burn/{eid}/result        查脱敏产物
    POST   /eco-burn/{eid}/destroy        物理销毁 (三重覆写 + 链上存证)
    GET    /eco-burn/{eid}/audit         查销毁审计报告
    GET    /eco-burn/status              全部状态
"""

from fastapi import APIRouter, File, Form, UploadFile, status

from app.api.deps import make_ok
from app.deps import CurrentUser
from app.schemas.common import ApiResult
from app.schemas.eco import (
    BurnAuditTrail,
    BurnDataType,
    BurnDiagnosisResult,
    BurnLoadResult,
    BurnProgress,
    BurnRawDataInput,
)
from app.services.eco_service import eco_burn_service
from app.services.raw_file_loader import parse_file_to_records

router = APIRouter(prefix="/eco-burn", tags=["ECO-01 阅后即焚"])


@router.post("/load", response_model=ApiResult[BurnLoadResult], status_code=status.HTTP_201_CREATED, summary="加载原始数据")
async def load_raw_data(payload: BurnRawDataInput, _user: CurrentUser):
    result = await eco_burn_service.loadRawData(payload)
    return make_ok(result)


@router.post("/load-file", response_model=ApiResult[BurnLoadResult], status_code=status.HTTP_201_CREATED, summary="加载原始材料文件 (全格式)")
async def load_raw_file(
    _user: CurrentUser,
    enterprise_id: str = Form(...),
    data_type: BurnDataType = Form(...),
    file: UploadFile = File(...),
):
    """企业上传原始材料文件的统一入口: 后端按扩展名分流解析为 records,
    与 /load 走同一 SGX 安全内存与诊断链路. 零信任边界不变 — 原始字节仅驻内存,
    诊断完成后由 destroy 物理销毁."""
    try:
        content = await file.read()
        records = await parse_file_to_records(file.filename or "upload.bin", content)
        payload = BurnRawDataInput(
            enterprise_id=enterprise_id,
            data_type=data_type,
            records=records,
            source="enterprise_upload",
        )
        result = await eco_burn_service.loadRawData(payload)
        return make_ok(result)
    except ValueError as e:
        return make_ok(None, code=-1, message=str(e))


@router.post("/{enterprise_id}/diagnose", response_model=ApiResult[dict], summary="启动诊断")
async def start_diagnosis(enterprise_id: str, _user: CurrentUser):
    try:
        await eco_burn_service.startDiagnosis(enterprise_id)
        return make_ok({"enterpriseId": enterprise_id, "diagnosing": True})
    except ValueError as e:
        return make_ok(None, code=-1, message=str(e))


@router.get("/{enterprise_id}/progress", response_model=ApiResult[BurnProgress], summary="查诊断进度")
async def get_progress(enterprise_id: str, _user: CurrentUser):
    result = await eco_burn_service.getProgress(enterprise_id)
    if not result:
        return make_ok(None, code=404, message=f"企业 {enterprise_id} 无进行中的诊断")
    return make_ok(result)


@router.get("/{enterprise_id}/result", response_model=ApiResult[BurnDiagnosisResult], summary="查脱敏产物")
async def get_result(enterprise_id: str, _user: CurrentUser):
    result = await eco_burn_service.getResult(enterprise_id)
    if not result:
        return make_ok(None, code=404, message=f"企业 {enterprise_id} 无诊断结果")
    return make_ok(result)


@router.post("/{enterprise_id}/destroy", response_model=ApiResult[BurnAuditTrail], summary="物理销毁")
async def secure_destroy(enterprise_id: str, _user: CurrentUser):
    """project_memory: 销毁前最后下载机会, 三重覆写 + WeakRef + 链上存证."""
    try:
        result = await eco_burn_service.secureDestroy(enterprise_id)
        # 可解释性: 诊断未走完即销毁 → 审计只有数据概况、无诊断结论摘要,
        # 必须明确告知用户 (禁止静默产出"没内容"的审计报告)
        if result.diagnosis_summary is None:
            return make_ok(result, message=(
                "⚠️ 诊断尚未完成即执行销毁, 审计报告仅含数据销毁概况、无诊断结论摘要。"
                "如需完整审计报告, 请重新上传材料并等待诊断 100% 后再销毁。"
            ))
        return make_ok(result)
    except ValueError as e:
        return make_ok(None, code=-1, message=str(e))


@router.get("/{enterprise_id}/audit", response_model=ApiResult[BurnAuditTrail], summary="查销毁审计")
async def get_audit(enterprise_id: str, _user: CurrentUser):
    result = await eco_burn_service.getAuditTrail(enterprise_id)
    if not result:
        return make_ok(None, code=404, message=f"企业 {enterprise_id} 无销毁审计")
    return make_ok(result)


@router.get("/status", response_model=ApiResult[list[dict]], summary="全部状态")
async def list_status(_user: CurrentUser):
    result = await eco_burn_service.getAllStatus()
    return make_ok(result)
