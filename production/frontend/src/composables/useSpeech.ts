/**
 * useSpeech.ts — APP-02 工人端语音播报 (Web Speech API)
 *
 * 职责:
 *   1. speak(text): 中文语音播报 (扫码确权后朗读结果, project_memory 傻瓜式操作)
 *   2. toggleVoice(): 开关语音 (偏好持久化到 localStorage)
 *
 * 兼容性:
 *   - 不支持 speechSynthesis 的环境 (Safari iOS 旧版) 静默降级, 不阻断业务
 *   - speechSupported 反映运行时能力, 组件可据此隐藏语音按钮
 *
 * 硬约束: async/await 风格, 无 callback.
 */

import { ref } from 'vue';

const VOICE_KEY = 'workerVoiceEnabled';

// === 模块级状态 (跨组件共享) ===
const voiceEnabled = ref<boolean>(localStorage.getItem(VOICE_KEY) !== 'false');
const speechSupported =
  typeof window !== 'undefined' && 'speechSynthesis' in window;

export function useSpeech() {
  /**
   * 语音播报中文文本. 关闭或不支持时静默返回 (不抛错, 业务无感降级).
   */
  function speak(text: string): void {
    if (!voiceEnabled.value || !speechSupported || !text) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = 1.2;
      u.pitch = 1;
      window.speechSynthesis.speak(u);
    } catch {
      // 降级: 静默忽略 (部分浏览器在无用户手势时抛 NotAllowed)
    }
  }

  /** 切换语音开关并持久化. */
  function toggleVoice(): void {
    voiceEnabled.value = !voiceEnabled.value;
    localStorage.setItem(VOICE_KEY, String(voiceEnabled.value));
  }

  return { speechSupported, voiceEnabled, speak, toggleVoice };
}
