<template>
  <section class="page">
    <header>
      <h2>AI 优化状态</h2>
      <p>当前客户的数据授权、自学习样本、客户专属模型和优化进度。</p>
    </header>
    <el-card class="panel" shadow="never">
      <template #header>数据授权设置</template>
      <el-form v-if="policy" label-width="210px">
        <el-form-item label="允许本地保存"><el-switch v-model="policy.allow_local_storage" /></el-form-item>
        <el-form-item label="允许上传脱敏样本"><el-switch v-model="policy.allow_cloud_upload" /></el-form-item>
        <el-form-item label="允许自动标注"><el-switch v-model="policy.allow_auto_labeling" /></el-form-item>
        <el-form-item label="允许本客户模型优化"><el-switch v-model="policy.allow_customer_model_training" /></el-form-item>
        <el-form-item label="允许进入平台基线"><el-switch v-model="policy.allow_platform_baseline_training" /></el-form-item>
        <el-form-item label="要求人工审核"><el-switch v-model="policy.require_human_review" /></el-form-item>
        <el-button type="primary" @click="savePolicy">保存授权</el-button>
      </el-form>
    </el-card>
    <div class="metrics">
      <el-card class="metric" shadow="never"><strong>{{ samples.length }}</strong><span>本客户样本</span></el-card>
      <el-card class="metric" shadow="never"><strong>{{ privacyProcessed }}</strong><span>已脱敏</span></el-card>
      <el-card class="metric" shadow="never"><strong>{{ reviewed }}</strong><span>已审核</span></el-card>
      <el-card class="metric" shadow="never"><strong>{{ models.length }}</strong><span>客户模型</span></el-card>
    </div>
    <el-card class="panel" shadow="never">
      <template #header>客户模型</template>
      <el-table :data="models" stripe>
        <el-table-column prop="model_id" label="model_id" min-width="200" />
        <el-table-column prop="model_type" label="type" width="100" />
        <el-table-column prop="target_device" label="device" width="120" />
        <el-table-column prop="status" label="status" width="120" />
      </el-table>
    </el-card>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const customerId = localStorage.getItem('guardian_customer_id') || 'customer_a'
const policy = ref<any>(null)
const samples = ref<any[]>([])
const models = ref<any[]>([])
const privacyProcessed = computed(() => samples.value.filter((s) => s.privacy_status === 'privacy_processed').length)
const reviewed = computed(() => samples.value.filter((s) => s.label_status === 'human_reviewed').length)

async function load() {
  policy.value = (await api.get(`/customers/${customerId}/data-policy`)).data
  samples.value = (await api.get(`/samples?customer_id=${customerId}`)).data
  models.value = (await api.get(`/models?scope=customer&customer_id=${customerId}`)).data
}
async function savePolicy() {
  policy.value = (await api.put(`/customers/${customerId}/data-policy`, policy.value)).data
  window.dispatchEvent(new CustomEvent('guardian-data-policy-change', { detail: { customer_id: customerId, policy: policy.value } }))
  ElMessage.success('数据授权已保存')
  await load()
}
onMounted(load)
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
.panel,.metric { border-radius:8px; border:1px solid #dbe4ef; }
.metrics { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px; }
.metric strong { display:block; font-size:24px; }
.metric span { color:#64748b; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
</style>
