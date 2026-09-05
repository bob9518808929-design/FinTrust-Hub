<template>
  <div class="eco-credential-view">
    <el-card header="🔑 ECO-04 信用凭证联盟链 (MOD-08b, P1)">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="W3C Verifiable Credentials 标准"
        description="企业信用信息跨行便携确权, 合规版 NFT。改造完成 / 信用提升 / 合规绿灯 / 担保生效时签发, 联盟链锚定不可篡改。"
      />

      <el-divider />

      <el-form inline>
        <el-form-item label="凭证类型">
          <el-select v-model="type" style="width: 200px">
            <el-option label="改造完成凭证" value="reform_completion" />
            <el-option label="信用跨行便携" value="credit_portability" />
            <el-option label="五流合一验证" value="five_streams_verified" />
            <el-option label="担保生效凭证" value="guarantee_active" />
            <el-option label="合规绿灯凭证" value="compliance_green" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="issue">签发凭证</el-button>
        </el-form-item>
      </el-form>

      <el-divider />

      <el-table v-if="creds.length" :data="creds" stripe>
        <el-table-column prop="credentialId" label="ID" width="160" />
        <el-table-column prop="type" label="类型" width="160" />
        <el-table-column prop="status" label="状态" width="100" />
        <el-table-column prop="issuanceDate" label="签发时间" />
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button size="small" @click="verify(row.credentialId)">核验</el-button>
            <el-button size="small" type="danger" @click="revoke(row.credentialId)">吊销</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { useEcoStore } from '@/stores/eco';
import { useEnterpriseStore } from '@/stores/enterprise';
import * as ecoApi from '@/api/eco';
import type { CredentialType, VerifiableCredential } from '@contracts/eco';

defineOptions({ name: 'EcoCredentialView' });

const ecoStore = useEcoStore();
const enterpriseStore = useEnterpriseStore();

const type = ref<CredentialType>('reform_completion');

const creds = computed<VerifiableCredential[]>(() => {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) return [];
  return ecoStore.credentials[entId] ?? [];
});

async function issue() {
  const entId = enterpriseStore.currentEnterpriseId;
  if (!entId) {
    ElMessage.warning('请先选择企业');
    return;
  }
  try {
    await ecoStore.credentialIssue({ enterpriseId: entId, type: type.value });
    ElMessage.success('凭证已签发, 联盟链已锚定');
  } catch (e) {
    ElMessage.error('签发失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}

async function verify(credentialId: string) {
  try {
    const r = await ecoApi.credentialVerify(credentialId);
    if (r.valid) {
      ElMessage.success('核验通过, 签名+链上锚定均有效');
    } else {
      ElMessage.error('核验失败: ' + (r.reason || '未知'));
    }
  } catch (e) {
    ElMessage.error('核验异常: ' + (e instanceof Error ? e.message : String(e)));
  }
}

async function revoke(credentialId: string) {
  try {
    await ecoApi.credentialRevoke(credentialId, '企业失信');
    ElMessage.success('凭证已吊销');
  } catch (e) {
    ElMessage.error('吊销失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}
</script>
