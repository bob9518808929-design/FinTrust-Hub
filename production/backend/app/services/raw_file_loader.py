"""原始材料文件统一加载器 (ECO-01 阅后即焚全格式支持).

用户上传的原始材料不再是"只认 JSON" — 按项目 A→B→C 降级链哲学分流解析:

    JSON / CSV / TXT   → 直接结构化解析 (零依赖)
    DOCX / XLSX / XLSM → zipfile + xml.etree 标准库提取 (docx/xlsx 本质是 ZIP 容器)
    PDF                → pdfplumber 文本层 (A 档) → 文本过少判定扫描件 → OCR (B 档)
    PNG / JPG / JPEG   → OCR 三引擎链 PADDLE→BAIDU→ALI→MOCK (C 档始终可用)
    其它               → 尝试 utf-8 文本解码; 失败则明确报错

产物统一为 list[dict] records, 直接进入 EcoBurnService.loadRawData 安全内存,
与既有诊断链路 (R1 画像 + R2 差距) 完全兼容 — 零侵入既有诊断流程。
"""

from __future__ import annotations

import csv
import io
import json
import xml.etree.ElementTree as ET
import zipfile
from pathlib import PurePosixPath

from app.schemas.parsers import OcrEngine, OcrRequest
from app.services.ocr_service import OcrService

# 解析上限防御: 超大文件不至于拖垮 "安全内存"
MAX_RECORDS = 5000
MAX_TEXT_CHARS = 2_000_000

_ocr_svc = OcrService()

_TEXT_EXTS = {".json", ".csv", ".txt", ".md"}
_DOCX_EXTS = {".docx", ".doc"}
_XLSX_EXTS = {".xlsx", ".xlsm", ".xls"}
_PDF_EXTS = {".pdf"}
_IMAGE_EXTS = {".png", ".jpg", ".jpeg"}


def _ext(filename: str) -> str:
    return PurePosixPath(filename.replace("\\", "/")).suffix.lower()


def _trim(records: list[dict]) -> list[dict]:
    """截断防御 + 保证返回 list[dict]."""
    if len(records) > MAX_RECORDS:
        records = records[:MAX_RECORDS]
    return records


def _parse_json(content: bytes) -> list[dict]:
    data = json.loads(content.decode("utf-8-sig"))
    if isinstance(data, list):
        items: list = data
    elif isinstance(data, dict):
        # 常见包装: {records: [...]} / {data: [...]} / {items: [...]}
        for key in ("records", "data", "items", "list", "rows"):
            if isinstance(data.get(key), list):
                items = data[key]
                break
        else:
            items = [data]
    else:
        items = [{"value": data}]
    return _trim([x if isinstance(x, dict) else {"value": x} for x in items])


def _parse_csv(content: bytes) -> list[dict]:
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    rows: list[dict] = []
    for r in reader:
        d = dict(r)
        # CSV 行字段数多于表头时, DictReader 把多余值挂在 None key (restkey);
        # None key 会让下游 json.dumps(records, sort_keys=True) 抛 TypeError
        # ('<' not supported between NoneType and str) → 销毁审计 500. 并入 _extra 保留数据.
        extra = d.pop(None, None)
        if extra and any(x for x in extra):
            d["_extra"] = ",".join(str(x) for x in extra if x)
        rows.append(d)
    if not rows:
        # 非表格文本 (TXT/MD): 按行拆为段落记录, 供诊断文本分析
        rows = [
            {"type": "line", "text": line.strip()}
            for line in text.splitlines()
            if line.strip()
        ]
    return _trim(rows)


def _parse_docx(content: bytes) -> list[dict]:
    """docx = ZIP{word/document.xml}: 提取段落 + 表格行文本 (零依赖)."""
    ns_w = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    records: list[dict] = []
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        xml_bytes = zf.read("word/document.xml")
    root = ET.fromstring(xml_bytes)
    for para in root.iter(f"{ns_w}p"):
        text = "".join(t.text or "" for t in para.iter(f"{ns_w}t")).strip()
        if text:
            records.append({"type": "paragraph", "text": text})
    return _trim(records)


def _parse_xlsx(content: bytes) -> list[dict]:
    """xlsx = ZIP{xl/sharedStrings.xml + xl/worksheets/sheet1.xml}: 零依赖行解析."""
    ns_main = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            sroot = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in sroot.iter(f"{ns_main}si"):
                shared.append("".join(t.text or "" for t in si.iter(f"{ns_main}t")))
        sheet_name = next(
            (n for n in zf.namelist() if n.startswith("xl/worksheets/sheet")),
            None,
        )
        if sheet_name is None:
            raise ValueError("XLSX 中未找到工作表 sheet")
        srow = ET.fromstring(zf.read(sheet_name))

    records: list[dict] = []
    header: list[str] = []
    for row in srow.iter(f"{ns_main}row"):
        cells: list[str] = []
        for c in row.iter(f"{ns_main}c"):
            t = c.get("t", "n")
            v = c.find(f"{ns_main}v")
            is_node = c.find(f"{ns_main}is")
            if t == "s" and v is not None and v.text is not None:
                cells.append(shared[int(v.text)])
            elif t == "inlineStr" and is_node is not None:
                cells.append("".join(x.text or "" for x in is_node.iter(f"{ns_main}t")))
            elif v is not None and v.text is not None:
                cells.append(v.text)
            else:
                cells.append("")
        if not any(c.strip() for c in cells):
            continue
        if not header:
            header = cells  # 首个非空行作表头
            continue
        records.append({"type": "row", **dict(zip(header, cells, strict=False))})
    return _trim(records)


async def _ocr_to_records(source_type: str, base64_content: str) -> list[dict]:
    req = OcrRequest(source_type=source_type, base64_content=base64_content,
                     engine_preference=OcrEngine.PADDLE)
    result = await _ocr_svc.ocr(req)
    return _trim([{"type": "ocr_block", "page": b.page_no, "text": b.text}
                  for b in result.blocks if b.text.strip()]) or \
        [{"type": "ocr_text", "text": "", "engine": result.engine_used}]


def _parse_pdf_sync(content: bytes) -> tuple[list[dict], int]:
    """pdfplumber 文本层提取. 返回 (records, 总文本字符数)."""
    import pdfplumber  # 已在 requirements (requirements.txt pdfplumber>=0.10.2)

    records: list[dict] = []
    total = 0
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page_no, page in enumerate(pdf.pages, start=1):
            text = (page.extract_text() or "").strip()
            total += len(text)
            if text:
                records.append({"type": "page", "page": page_no, "text": text})
    return records, total


def _b64(content: bytes) -> str:
    import base64
    return base64.b64encode(content).decode("ascii")


async def parse_file_to_records(filename: str, content: bytes) -> list[dict]:
    """任意格式原始材料文件 → list[dict] records (进 SGX 安全内存前的统一入口)."""
    if not content:
        raise ValueError("文件内容为空")
    ext = _ext(filename)

    # 文本类: JSON 结构化 / CSV 表格 / TXT-MD 段落
    if ext == ".json":
        try:
            return _parse_json(content)
        except json.JSONDecodeError as e:
            raise ValueError(f"JSON 解析失败: {e}") from e
    if ext in {".csv", ".txt", ".md"}:
        return _parse_csv(content)

    # Office 文档 (ZIP 容器, 零依赖解析)
    if ext in _DOCX_EXTS:
        try:
            return _parse_docx(content)
        except (zipfile.BadZipFile, KeyError) as e:
            raise ValueError(f"DOCX 解析失败 (旧版 .doc 二进制格式请先转存 .docx): {e}") from e
    if ext in _XLSX_EXTS:
        try:
            return _parse_xlsx(content)
        except (zipfile.BadZipFile, KeyError) as e:
            raise ValueError(f"XLSX 解析失败 (旧版 .xls 二进制格式请先转存 .xlsx): {e}") from e

    # PDF: A 档文本层 → 文本过少判定扫描件 → B/C 档 OCR
    if ext in _PDF_EXTS:
        try:
            records, total = _parse_pdf_sync(content)
        except Exception as e:  # pdfplumber 损坏/加密 PDF
            records, total = [], 0
            if "password" in str(e).lower() or "encrypt" in str(e).lower():
                raise ValueError(f"PDF 已加密, 请先解密后上传: {e}") from e
        if total >= 50:
            return records
        # 扫描件 → OCR (三引擎链 + MOCK 始终可用)
        return await _ocr_to_records("pdf", _b64(content))

    # 图片: OCR
    if ext in _IMAGE_EXTS:
        source_type = "image_png" if ext == ".png" else "image_jpg"
        return await _ocr_to_records(source_type, _b64(content))

    # 兜底: 当作纯文本尝试
    try:
        content.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise ValueError(
            f"暂不支持的文件格式: {ext or filename} "
            f"(支持: JSON/CSV/TXT/MD/DOCX/XLSX/PDF/PNG/JPG)"
        ) from e
    return _parse_csv(content.encode("utf-8"))
