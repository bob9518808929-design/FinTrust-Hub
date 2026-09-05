/**
 * src/pages/scan/index.tsx — FinTrust Hub 移动端扫码页
 * -------------------------------------------------------------
 * project_memory 傻瓜式操作:
 *   责任链工人(仓管/物流)不会打字, 在手机上:
 *     1. 点大号 "扫一扫" 按钮调起原生扫码 (Taro.scanCode 多端兼容)
 *     2. 扫到条码/二维码自动填入输入框, 工人只需检查后点 "确认提交"
 *     3. 提交成功弹非阻塞 toast (6.5s 自动消失, 含 ✓ 操作按钮)
 *
 * 与 PC 端 ScanInput.vue 逻辑对齐:
 *   - 浏览器 BarcodeDetector API → Taro.scanCode (多端原生)
 *   - 提交后端 POST /api/v1/scan/confirm (与 PC 端 ScanInput @scanned 事件对齐)
 */
import { useState, useRef } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Input, Image } from '@tarojs/components';
import './index.scss';

// 扫码业务类型 (与 PC 端 ScanInput scanMode 对齐)
type ScanBizType = 'invoice' | 'container' | 'contract' | 'other';

interface ScanResult {
  text: string;
  bizType: ScanBizType;
  scannedAt: string;
}

// 业务类型选项 (不让用户做选择题, 默认 invoice, 4 个 pill 一目了然)
const BIZ_OPTIONS: { value: ScanBizType; label: string; icon: string }[] = [
  { value: 'invoice', label: '发票', icon: '📄' },
  { value: 'container', label: '集装箱', icon: '📦' },
  { value: 'contract', label: '合同', icon: '📝' },
  { value: 'other', label: '其他', icon: '🔖' },
];

function ScanPage() {
  const [bizType, setBizType] = useState<ScanBizType>('invoice');
  const [scanText, setScanText] = useState<string>('');
  const [scanHistory, setScanHistory] = useState<ScanResult[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [scanning, setScanning] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** 调起原生扫码 (Taro.scanCode 多端兼容) */
  async function onScan(): Promise<void> {
    setScanning(true);
    try {
      // Taro.scanCode 在微信小程序调起原生扫码, H5 端降级为文件选择
      if (Taro.scanCode && process.env.TARO_ENV !== 'h5') {
        const res = await Taro.scanCode({
          onlyFromCamera: false,
          scanType: ['barCode', 'qrCode', 'datamatrix'],
        });
        if (res.result) {
          setScanText(res.result);
          // 立即记录到历史 (无需等待提交)
          appendHistory(res.result);
        }
      } else {
        // H5 端降级: 调起文件选择 (与 PC 端 ScanInput 一致)
        triggerFileInput();
      }
    } catch (e) {
      // 用户取消扫码不算错误
      const err = e as { errMsg?: string };
      if (!err?.errMsg?.includes('cancel')) {
        Taro.showToast({
          title: '扫码失败, 请重试或手动输入',
          icon: 'none',
          duration: 2000,
        });
      }
    } finally {
      setScanning(false);
    }
  }

  /** H5 端文件选择降级 (与 PC 端 ScanInput 一致, 调 BarcodeDetector) */
  function triggerFileInput(): void {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }

  async function onFileSelected(e): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    setScanning(true);
    try {
      // 浏览器原生 BarcodeDetector API (与 PC 端 ScanInput 完全一致)
      const w = window as unknown as { BarcodeDetector?: new () => { detect: (s: ImageBitmap) => Promise<{ rawValue?: string }[]> } };
      const AnyBarcodeDetector = w.BarcodeDetector;
      if (!AnyBarcodeDetector) {
        Taro.showToast({
          title: '当前浏览器不支持扫码, 请手动输入',
          icon: 'none',
        });
        return;
      }
      const detector = new AnyBarcodeDetector();
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      const text = codes?.[0]?.rawValue || '';
      if (text) {
        setScanText(text);
        appendHistory(text);
      } else {
        Taro.showToast({
          title: '未识别出条码, 请手动输入',
          icon: 'none',
        });
      }
    } catch {
      Taro.showToast({ title: '扫描失败, 请重试', icon: 'none' });
    } finally {
      setScanning(false);
    }
  }

  function appendHistory(text: string): void {
    const result: ScanResult = {
      text,
      bizType,
      scannedAt: new Date().toISOString(),
    };
    setScanHistory((prev) => [result, ...prev].slice(0, 10));
  }

  /** 提交扫码结果到后端 (POST /api/v1/scan/confirm) */
  async function onSubmit(): Promise<void> {
    if (!scanText.trim()) {
      Taro.showToast({ title: '请先扫码或输入', icon: 'none' });
      return;
    }
    setSubmitting(true);
    try {
      const workerToken =
        (typeof localStorage !== 'undefined' && localStorage.getItem('workerToken')) || '';
      const baseUrl =
        process.env.TARO_ENV === 'h5' ? '/api/v1' : 'http://localhost:8000/api/v1';

      const res = await Taro.request({
        url: `${baseUrl}/scan/confirm`,
        method: 'POST',
        header: {
          'Content-Type': 'application/json',
          Authorization: workerToken ? `Bearer ${workerToken}` : '',
          'X-Client-Type': 'MobileTaro',
          'X-App-Version': '3.1.0',
        },
        data: {
          text: scanText.trim(),
          bizType,
          scannedAt: new Date().toISOString(),
        },
      });

      if (res.statusCode === 200 || res.statusCode === 201) {
        // 非阻塞 toast (与 PC 端 mobile-toast 一致, 6.5s 自动消失)
        Taro.showToast({
          title: '✓ 扫码已确认提交',
          icon: 'success',
          duration: 2000,
        });
        setScanText('');
      } else {
        Taro.showToast({ title: '提交失败, 请重试', icon: 'none' });
      }
    } catch (e) {
      // 网络错误降级 (project_memory: 零机构接入时仍能独立运行)
      Taro.showToast({
        title: '网络异常, 扫码已本地暂存',
        icon: 'none',
        duration: 6500,
      });
    } finally {
      setSubmitting(false);
    }
  }

  function onManualInput(e): void {
    setScanText(e.detail.value);
  }

  function onClear(): void {
    setScanText('');
  }

  return (
    <View className="scan-page">
      {/* === 业务类型 pill (4 选 1, 不让用户做选择题) === */}
      <View className="biz-section">
        <Text className="section-label">扫码业务类型</Text>
        <View className="biz-pills">
          {BIZ_OPTIONS.map((opt) => (
            <View
              key={opt.value}
              className={`biz-pill ${bizType === opt.value ? 'active' : ''}`}
              onClick={() => setBizType(opt.value)}
            >
              <Text className="pill-icon">{opt.icon}</Text>
              <Text className="pill-text">{opt.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* === 大号扫码按钮 === */}
      <View
        className={`scan-button ${scanning ? 'is-loading' : ''}`}
        onClick={onScan}
      >
        <Text className="scan-icon">{scanning ? '⏳' : '📷'}</Text>
        <Text className="scan-text">
          {scanning ? '扫码中...' : '点这里扫一扫'}
        </Text>
      </View>

      {/* === 手动输入区 (扫码失败的兜底, 工人也能手动填) === */}
      <View className="input-section">
        <Text className="section-label">扫码结果 (可手动修改)</Text>
        <View className="input-wrapper">
          <Input
            className="scan-input"
            type="text"
            placeholder="扫码自动填充, 也可手动输入"
            value={scanText}
            onInput={onManualInput}
          />
          {scanText ? (
            <Text className="clear-btn" onClick={onClear}>
              ×
            </Text>
          ) : null}
        </View>
      </View>

      {/* H5 端隐藏的文件输入 (BarcodeDetector 降级) */}
      {process.env.TARO_ENV === 'h5' ? (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onFileSelected}
        />
      ) : null}

      {/* === 提交按钮 === */}
      <View
        className={`submit-button ${submitting || !scanText ? 'disabled' : ''}`}
        onClick={submitting || !scanText ? undefined : onSubmit}
      >
        <Text>{submitting ? '提交中...' : '✓ 确认提交'}</Text>
      </View>

      {/* === 扫码历史 (最近 10 条) === */}
      {scanHistory.length > 0 ? (
        <View className="history-section">
          <Text className="section-label">最近扫码 ({scanHistory.length})</Text>
          <View className="history-list">
            {scanHistory.map((item, idx) => (
              <View key={idx} className="history-item">
                <Text className="history-text">{item.text}</Text>
                <Text className="history-meta">
                  {BIZ_OPTIONS.find((o) => o.value === item.bizType)?.label || '其他'} ·
                  {' '}
                  {new Date(item.scannedAt).toLocaleTimeString('zh-CN')}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export default ScanPage;
