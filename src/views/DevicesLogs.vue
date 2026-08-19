<template>
  <section class="page">
    <header class="title-row">
      <div>
        <h2>平台日志 Platform Logs</h2>
        <p>汇总 Guardian Cloud、核心链路、VLM 审计、Forge、L1/L2 运行日志。设备详情回到项目设备页查看。</p>
      </div>
      <el-button @click="loadLogs">刷新</el-button>
    </header>
    <el-row :gutter="12">
      <el-col :span="6"><el-card shadow="never"><el-statistic title="全部日志" :value="logs.length" /></el-card></el-col>
      <el-col :span="6"><el-card shadow="never"><el-statistic title="异常/失败" :value="errorCount" /></el-card></el-col>
      <el-col :span="6"><el-card shadow="never"><el-statistic title="VLM 审计" :value="vlmCount" /></el-card></el-col>
      <el-col :span="6"><el-card shadow="never"><el-statistic title="核心链路" :value="coreCount" /></el-card></el-col>
    </el-row>
    <el-card class="panel" shadow="never">
      <template #header>
        <div class="head-row">
          <span>全平台事件记录</span>
          <div class="filters">
            <el-select v-model="logType" clearable placeholder="类型" style="width:220px" @change="loadLogs">
              <el-option v-for="t in types" :key="t" :label="t" :value="t" />
            </el-select>
            <el-input v-model="keyword" clearable placeholder="搜索对象、设备、内容" style="width:260px" />
          </div>
        </div>
      </template>
      <el-table :data="filteredLogs" stripe height="620">
        <el-table-column prop="timestamp" label="时间" width="210" />
        <el-table-column prop="type" label="类型" width="180" />
        <el-table-column label="级别" width="90">
          <template #default="{ row }"><el-tag :type="levelTag(row.level)">{{ row.level || 'info' }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="device_id" label="来源/设备" width="170" />
        <el-table-column prop="object_id" label="对象ID" width="220" />
        <el-table-column prop="message" label="内容" min-width="460" show-overflow-tooltip />
      </el-table>
    </el-card>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '../api'

const logs = ref<any[]>([])
const logType = ref('')
const keyword = ref('')
const types = ['vlm_audit','core_mage_audit','core_auto_label_draft','core_l1_candidate','core_l2_review','core_human_dataset_approval','l1_inference','l1_candidate','l2_review','rtsp','edge_runtime']
async function loadLogs() { logs.value = (await api.get('/logs', { params: { type: logType.value || undefined } })).data }
const filteredLogs = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return logs.value
  return logs.value.filter((item) => [item.message, item.device_id, item.object_id, item.trace_id, item.type]
    .filter(Boolean).some((value) => String(value).toLowerCase().includes(text)))
})
const errorCount = computed(() => logs.value.filter((item) => ['error', 'warning'].includes(item.level)).length)
const vlmCount = computed(() => logs.value.filter((item) => item.type === 'vlm_audit' || item.type === 'core_mage_audit').length)
const coreCount = computed(() => logs.value.filter((item) => String(item.type || '').startsWith('core_')).length)
function levelTag(level:string) {
  if (level === 'error') return 'danger'
  if (level === 'warning') return 'warning'
  return 'info'
}
onMounted(loadLogs)
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
.panel { border-radius:8px; border:1px solid #dbe4ef; }
.title-row,.head-row,.filters { display:flex; justify-content:space-between; align-items:center; gap:12px; }
</style>
