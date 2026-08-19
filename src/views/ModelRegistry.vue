<template>
  <section class="page">
    <header><h2>模型管理 Model Registry</h2><p>管理线上模型、候选模型、历史模型、评估报告和灰度状态。</p></header>
    <el-card class="panel" shadow="never">
      <el-table :data="models" stripe>
        <el-table-column prop="model_id" label="model_id" width="120" />
        <el-table-column prop="model_type" label="type" width="80" />
        <el-table-column prop="version" label="version" min-width="230" />
        <el-table-column prop="target_device" label="device" width="110" />
        <el-table-column prop="dataset_version" label="dataset" width="140" />
        <el-table-column prop="train_run_id" label="train" width="120" />
        <el-table-column prop="status" label="status" width="110"><template #default="{ row }"><el-tag>{{ row.status }}</el-tag></template></el-table-column>
        <el-table-column prop="mAP50" label="mAP50" width="90" />
        <el-table-column prop="recall" label="recall" width="90" />
        <el-table-column prop="precision" label="precision" width="95" />
        <el-table-column prop="hard_negative_fp" label="hard FP" width="100" />
        <el-table-column prop="latency_ms" label="latency" width="95" />
        <el-table-column label="更新时间" min-width="180">
          <template #default="{ row }">{{ formatTime(row.updated_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="300">
          <template #default="{ row }">
            <el-button size="small">评估</el-button>
            <el-button size="small" @click="stage(row.model_id)">灰度</el-button>
            <el-button size="small" type="success" @click="approve(row.model_id)">上线</el-button>
            <el-button size="small" type="warning" @click="rollback(row.model_id)">回滚</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '../api'

const models = ref<any[]>([])
async function load() { models.value = (await api.get('/models')).data }
function formatTime(value: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}
async function stage(id: string) { await api.post(`/models/${id}/stage`); await load() }
async function approve(id: string) { await api.post(`/models/${id}/approve`); await load() }
async function rollback(id: string) { await api.post(`/models/${id}/rollback`); await load() }
onMounted(load)
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
.panel { border-radius:8px; border:1px solid #dbe4ef; }
</style>
