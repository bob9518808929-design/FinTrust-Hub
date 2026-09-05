<template>
  <div class="eco-bot-view">
    <el-card header="🤖 ECO-09 微信/钉钉数字分身 AI Agent (APP-02 衍生, P2)">
      <el-alert
        type="success"
        :closable="false"
        show-icon
        title="企业专属数字员工"
        description="通过聊天交互完成操作: 查询改造进度 / 发起融资 / 提交责任链确权 / 异常上报 / 查看穿透报告. 傻瓜式操作设计哲学. "
      />

      <el-divider />

      <el-row :gutter="16">
        <el-col :span="16">
          <div class="chat-window">
            <div class="chat-messages" ref="messagesRef">
              <div
                v-for="msg in messages"
                :key="msg.id"
                class="chat-msg"
                :class="msg.role"
              >
                <div class="msg-bubble">
                  <div v-if="msg.replyCard" class="msg-card">
                    <strong>{{ msg.replyCard.title }}</strong>
                    <div v-for="field in msg.replyCard.fields" :key="field.label">
                      {{ field.label }}: <strong>{{ field.value }}</strong>
                    </div>
                  </div>
                  <div>{{ msg.text }}</div>
                </div>
              </div>
            </div>
            <div class="chat-input">
              <el-input
                v-model="inputText"
                placeholder="输入指令, 如: 查询改造进度 / 发起 500 万融资 / 异常上报: 物流断线"
                @keyup.enter="send"
              >
                <template #append>
                  <el-button type="primary" @click="send">发送</el-button>
                </template>
              </el-input>
              <el-radio-group v-model="channel" size="small">
                <el-radio-button value="web">Web</el-radio-button>
                <el-radio-button value="wechat">微信</el-radio-button>
                <el-radio-button value="dingtalk">钉钉</el-radio-button>
              </el-radio-group>
            </div>
          </div>
        </el-col>
        <el-col :span="8">
          <el-card header="💡 快捷指令" shadow="never">
            <el-button
              v-for="cmd in quickCommands"
              :key="cmd"
              class="quick-cmd"
              @click="sendQuick(cmd)"
            >
              {{ cmd }}
            </el-button>
          </el-card>
          <el-card header="⚙️ 数字分身配置" shadow="never">
            <el-descriptions :column="1" size="small">
              <el-descriptions-item label="渠道">{{ channel }}</el-descriptions-item>
              <el-descriptions-item label="LLM 模型">DeepSeek V3</el-descriptions-item>
              <el-descriptions-item label="限流">60 / 分钟</el-descriptions-item>
            </el-descriptions>
          </el-card>
        </el-col>
      </el-row>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import { useEcoStore } from '@/stores/eco';
import { useEnterpriseStore } from '@/stores/enterprise';
import type { BotChannel, BotReplyCard } from '@contracts/eco';

defineOptions({ name: 'EcoBotView' });

const ecoStore = useEcoStore();
const enterpriseStore = useEnterpriseStore();

const inputText = ref('');
const channel = ref<BotChannel>('web');
const messagesRef = ref<HTMLElement | null>(null);

const messages = ref<Array<{
  id: string;
  role: 'user' | 'bot';
  text: string;
  replyCard?: BotReplyCard;
}>>([
  {
    id: '1',
    role: 'bot',
    text: '您好, 我是企业专属数字分身, 可帮您: 查询改造进度 / 发起融资 / 提交责任链 / 异常上报 / 查看穿透报告. 输入指令或点击右侧快捷入口. ',
  },
]);

const quickCommands = [
  '查询改造进度',
  '当前信用分多少',
  '发起 500 万融资',
  '查看穿透报告',
  '异常上报: 物流断线',
];

async function send() {
  if (!inputText.value.trim()) return;
  await executeCommand(inputText.value);
  inputText.value = '';
}

async function sendQuick(cmd: string) {
  await executeCommand(cmd);
}

async function executeCommand(text: string) {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) {
    ElMessage.warning('请先选择企业');
    return;
  }

  // 用户消息
  messages.value.push({ id: Date.now().toString(), role: 'user', text });

  try {
    const result = await ecoStore.botExecute(text, channel.value, entId);
    messages.value.push({
      id: result.commandId,
      role: 'bot',
      text: result.replyText,
      replyCard: result.replyCard,
    });
  } catch (e) {
    messages.value.push({
      id: Date.now().toString() + '-err',
      role: 'bot',
      text: '指令执行失败: ' + (e instanceof Error ? e.message : String(e)),
    });
  }

  await nextTick();
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
  }
}
</script>

<style lang="scss" scoped>
.eco-bot-view {
  .chat-window {
    border: 1px solid $border-color;
    border-radius: $radius-base;
    overflow: hidden;

    .chat-messages {
      height: 400px;
      overflow-y: auto;
      padding: $spacing-base;
      background: $bg-base;

      .chat-msg {
        display: flex;
        margin-bottom: $spacing-base;

        &.user {
          justify-content: flex-end;
        }

        &.bot {
          justify-content: flex-start;
        }

        .msg-bubble {
          max-width: 70%;
          padding: $spacing-sm $spacing-base;
          border-radius: $radius-base;
          background: $bg-card;
          color: $text-primary;

          .msg-card {
            background: $bg-tertiary;
            padding: $spacing-sm;
            border-radius: $radius-sm;
            margin-bottom: $spacing-xs;
          }
        }
      }
    }

    .chat-input {
      padding: $spacing-sm;
      border-top: 1px solid $border-color;
      background: $bg-page;
      display: flex;
      flex-direction: column;
      gap: $spacing-sm;
    }
  }

  .quick-cmd {
    width: 100%;
    margin-bottom: $spacing-xs;
    text-align: left;
  }
}
</style>
