<!--
  BotChatView.vue — APP-02 数字分身 AI 问答页 (PWA MVP)
  -------------------------------------------------------------
  设计依据: APP02_MOBILE_PLAN.md §4.2 Task 5 + spec.md L2746-L2750
  消息列表: { role: 'user' | 'bot', text }
  发送流程:
    push 用户消息 → botParseCommand({ text, channel: 'web', enterpriseId, workerId })
    → 若 confidence ≥ 0.5 调 botExecuteCommand(parse) → 渲染 replyText 为 bot 气泡
    → confidence < 0.5 → bot 气泡兜底提示 + 3 个快捷短语按钮
  样式:
    - 用户气泡靠右 (var(--el-color-primary))
    - bot 气泡靠左 (var(--el-fill-color-light))
    - 自动滚动到底部 (watch messages + nextTick + ref.scrollTop)

  关键签名 (Read eco.ts 确认):
    - botParseCommand(input: { text, channel, enterpriseId, workerId? }) → Promise<BotCommandParse>
      (spec 写的 botParse/botExecute 是笔误, 真实函数名带 Command 后缀)
    - botExecuteCommand(parse: BotCommandParse, conversationId?) → Promise<BotCommandResult>

  project_memory 硬约束:
    - async/await, 禁止 callback
    - 拇指热区: 输入区位于屏幕底部 1/3
    - toast z-index=9500 (customClass + 全局 style)
-->
<template>
  <div class="bot-chat-view">
    <!-- 消息列表 -->
    <main ref="listRef" class="msg-list">
      <div v-if="messages.length === 0" class="empty-state">
        <p class="empty-title">您好, 我是您的数字分身</p>
        <p class="empty-hint">可询问: 查询融资进度 / 我的积分 / 兑换商品</p>
      </div>
      <div
        v-for="(msg, idx) in messages"
        :key="idx"
        class="msg-row"
        :class="msg.role === 'user' ? 'msg-user' : 'msg-bot'"
      >
        <div class="msg-bubble" :class="msg.role">
          <span class="msg-text">{{ msg.text }}</span>
          <div
            v-if="msg.role === 'bot' && msg.quickPhrases?.length"
            class="quick-phrases"
          >
            <button
              v-for="phrase in msg.quickPhrases"
              :key="phrase"
              class="quick-btn"
              type="button"
              @click="fillInput(phrase)"
            >
              {{ phrase }}
            </button>
          </div>
        </div>
      </div>
      <div v-if="thinking" class="msg-row msg-bot">
        <div class="msg-bubble bot thinking">
          <span class="dots"><i></i><i></i><i></i></span>
        </div>
      </div>
    </main>

    <!-- 底部输入区 (拇指热区) -->
    <footer class="input-bar">
      <input
        ref="inputRef"
        v-model="inputText"
        type="text"
        class="msg-input"
        placeholder="请输入您的问题..."
        :disabled="thinking"
        enterkeyhint="send"
        @keydown.enter.prevent="onSend"
      />
      <button
        class="send-btn"
        type="button"
        :disabled="thinking || !inputText.trim()"
        @click="onSend"
      >
        发送
      </button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useWorkerAuth } from '@/composables/useWorkerAuth';
import { botParseCommand, botExecuteCommand } from '@/api/eco';
import type { BotCommandParse } from '@contracts/eco';

defineOptions({ name: 'BotChatView' });

interface ChatMessage {
  role: 'user' | 'bot';
  text: string;
  quickPhrases?: string[];
}

const { workerId, enterpriseId } = useWorkerAuth();

const messages = ref<ChatMessage[]>([]);
const inputText = ref('');
const thinking = ref(false);

const listRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);

const QUICK_PHRASES = ['查询融资进度', '我的积分', '兑换商品'];
const FALLBACK_TEXT = '未理解您的意思，请尝试：查询融资进度 / 我的积分 / 兑换商品';
const CONFIDENCE_THRESHOLD = 0.5;

function toast(message: string, type: 'error' | 'info' = 'info'): void {
  const opts: Parameters<typeof ElMessage>[0] = {
    message,
    duration: 6500,
    showClose: true,
    customClass: 'mobile-toast',
  };
  if (type === 'error') ElMessage.error(opts);
  else ElMessage.info(opts);
}

async function onSend(): Promise<void> {
  const text = inputText.value.trim();
  if (!text || thinking.value) return;

  if (!workerId.value || !enterpriseId.value) {
    toast('请先登录后再使用', 'error');
    return;
  }

  // push 用户消息
  messages.value.push({ role: 'user', text });
  inputText.value = '';
  thinking.value = true;
  await scrollToBottom();

  try {
    // 1. 解析命令 (真实签名: botParseCommand 完整对象)
    const parse: BotCommandParse = await botParseCommand({
      text,
      channel: 'web',
      enterpriseId: enterpriseId.value,
      workerId: workerId.value,
    });

    // 2. confidence 判断
    if (parse.confidence >= CONFIDENCE_THRESHOLD) {
      // 3. 执行命令 (真实签名: botExecuteCommand(parse, conversationId?))
      const result = await botExecuteCommand(parse);
      if (result.success) {
        messages.value.push({
          role: 'bot',
          text: result.replyText || '操作完成',
        });
      } else {
        messages.value.push({
          role: 'bot',
          text: result.replyText || '操作未成功, 请稍后重试',
        });
      }
    } else {
      // 兜底: 显示提示 + 3 个快捷短语按钮
      messages.value.push({
        role: 'bot',
        text: FALLBACK_TEXT,
        quickPhrases: QUICK_PHRASES,
      });
    }
  } catch (err) {
    console.warn('[BotChat] send failed:', err);
    messages.value.push({
      role: 'bot',
      text: '服务暂时不可用, 请稍后重试',
    });
  } finally {
    thinking.value = false;
    await scrollToBottom();
  }
}

function fillInput(phrase: string): void {
  inputText.value = phrase;
  inputRef.value?.focus();
}

async function scrollToBottom(): Promise<void> {
  await nextTick();
  if (listRef.value) {
    listRef.value.scrollTop = listRef.value.scrollHeight;
  }
}

// 监听消息变化自动滚动
watch(
  () => messages.value.length,
  () => {
    void scrollToBottom();
  },
);

onMounted(() => {
  void scrollToBottom();
});
</script>

<style>
/* ElMessage 全局 z-index=9500 (BotChatView 共用) */
.mobile-toast {
  z-index: 9500 !important;
}
.mobile-toast .el-message__closeBtn {
  pointer-events: auto;
}
</style>

<style scoped>
.bot-chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #f5f7fa;
  box-sizing: border-box;
}

/* === 消息列表 === */
.msg-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  -webkit-overflow-scrolling: touch;
}

.empty-state {
  margin: auto;
  text-align: center;
  padding: 40px 16px;
  color: #909399;
}
.empty-title {
  margin: 0 0 8px;
  font-size: 16px;
  color: #303133;
}
.empty-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
}

.msg-row {
  display: flex;
  width: 100%;
}
.msg-user {
  justify-content: flex-end;
}
.msg-bot {
  justify-content: flex-start;
}

.msg-bubble {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.5;
  word-break: break-word;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.msg-bubble.user {
  background: var(--el-color-primary, #409eff);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.msg-bubble.bot {
  background: var(--el-fill-color-light, #f0f2f5);
  color: #303133;
  border-bottom-left-radius: 4px;
}
.msg-bubble.bot.thinking {
  padding: 12px 16px;
}

.msg-text {
  white-space: pre-wrap;
}

/* 兜底快捷短语按钮 */
.quick-phrases {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.quick-btn {
  background: #fff;
  color: var(--el-color-primary, #409eff);
  border: 1px solid var(--el-color-primary, #409eff);
  border-radius: 14px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  min-height: 28px;
}
.quick-btn:active {
  background: var(--el-color-primary, #409eff);
  color: #fff;
}

/* "正在输入" 动画 */
.dots {
  display: inline-flex;
  gap: 4px;
}
.dots i {
  width: 6px;
  height: 6px;
  background: #909399;
  border-radius: 50%;
  animation: blink 1.4s infinite both;
}
.dots i:nth-child(2) {
  animation-delay: 0.2s;
}
.dots i:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes blink {
  0%, 80%, 100% {
    opacity: 0.3;
  }
  40% {
    opacity: 1;
  }
}

/* === 底部输入区 (位于屏幕底部, 拇指热区) === */
.input-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #fff;
  border-top: 1px solid #ebeef5;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.04);
}
.msg-input {
  flex: 1;
  height: 40px;
  padding: 0 12px;
  border: 1px solid #dcdfe6;
  border-radius: 20px;
  font-size: 14px;
  outline: none;
  background: #f5f7fa;
  color: #303133;
}
.msg-input:focus {
  border-color: var(--el-color-primary, #409eff);
  background: #fff;
}
.msg-input:disabled {
  opacity: 0.6;
}
.send-btn {
  height: 40px;
  min-width: 64px;
  padding: 0 16px;
  background: var(--el-color-primary, #409eff);
  color: #fff;
  border: none;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.send-btn:disabled {
  background: #c0c4cc;
  cursor: not-allowed;
}
</style>
