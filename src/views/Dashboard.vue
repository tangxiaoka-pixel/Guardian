<template>
  <section class="console-page">
    <header class="page-head">
      <div>
        <h2>总览 Dashboard</h2>
        <p>视频接入、L1/L2、告警闭环和自学习状态的一屏总览。</p>
      </div>
      <el-tag type="success" effect="dark">Guardian Cloud API</el-tag>
    </header>

    <div class="metric-grid">
      <el-card v-for="item in metrics" :key="item.label" class="metric-card" shadow="never">
        <div class="metric-label">{{ item.label }}</div>
        <div class="metric-value">{{ item.value }}</div>
      </el-card>
    </div>

    <el-card class="panel" shadow="never">
      <template #header>
        <div class="panel-head">
          <span>主处理链路</span>
          <small>一行一个项目，一列一个链路节点；状态来自 Guardian Cloud API 当前业务数据。</small>
        </div>
      </template>
      <el-table :data="summary.pipeline_projects || []" border stripe class="pipeline-table" empty-text="暂无项目，请先创建客户和项目">
        <el-table-column label="项目" fixed min-width="180">
          <template #default="{ row }">
            <strong>{{ row.project_name }}</strong>
            <div class="subtext">{{ row.customer_name }}</div>
          </template>
        </el-table-column>
        <el-table-column v-for="node in pipelineNodes" :key="node.key" :label="node.label" min-width="150">
          <template #default="{ row }">
            <el-tag :type="nodeTag(row.nodes?.[node.key]?.status)" effect="light">
              {{ nodeText(row.nodes?.[node.key]?.status) }}
            </el-tag>
            <div class="node-detail">{{ row.nodes?.[node.key]?.detail || '-' }}</div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '../api'

const summary = ref<any>({ pipeline: [], pipeline_nodes: [], pipeline_projects: [] })

const metrics = computed(() => [
  { label: '客户数', value: summary.value.customer_count ?? 0 },
  { label: '项目数', value: summary.value.project_count ?? 0 },
  { label: '摄像头总数', value: summary.value.stream_count ?? 0 },
  { label: '在线摄像头', value: summary.value.online_cameras ?? 0 },
  { label: '设备总数', value: summary.value.device_count ?? 0 },
  { label: '在线设备', value: summary.value.online_devices ?? 0 },
  { label: '今日 L1 触发', value: summary.value.l1_triggers_today ?? 0 },
  { label: '今日 L2 告警', value: summary.value.l2_confirmed_today ?? 0 },
  { label: '今日误报驳回', value: summary.value.false_positive_today ?? 0 },
  { label: '待人工审核', value: summary.value.human_review_pending ?? 0 },
  { label: 'L1 模型', value: summary.value.current_l1_model ?? '-' },
  { label: 'L2 模型', value: summary.value.current_l2_model ?? '-' },
])

const pipelineNodes = computed(() => summary.value.pipeline_nodes || [])

onMounted(async () => {
  const { data } = await api.get('/dashboard/summary')
  summary.value = data
})

function nodeTag(status = '') {
  if (['running', 'done'].includes(status)) return 'success'
  if (status === 'active') return 'warning'
  if (status === 'offline' || status === 'blocked') return 'danger'
  return 'info'
}

function nodeText(status = '') {
  return ({
    running: '运行中',
    active: '待处理',
    done: '已完成',
    waiting: '待配置',
    offline: '离线',
    blocked: '未就绪',
  } as Record<string, string>)[status] || '未知'
}
</script>

<style scoped>
.console-page { display: flex; flex-direction: column; gap: 16px; }
.page-head { display: flex; justify-content: space-between; align-items: center; }
h2 { margin: 0; color: #111827; }
p { margin: 6px 0 0; color: #64748b; }
.metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.metric-card { border-radius: 8px; border: 1px solid #dbe4ef; }
.metric-label { color: #64748b; font-size: 13px; }
.metric-value { margin-top: 10px; font-size: 24px; font-weight: 750; color: #0f172a; overflow-wrap: anywhere; }
.panel { border-radius: 8px; border: 1px solid #dbe4ef; }
.panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.panel-head small { color: #64748b; font-weight: 400; }
.pipeline-table { width: 100%; }
.subtext,.node-detail { margin-top: 6px; color: #64748b; font-size: 12px; line-height: 1.45; }
.node-detail { overflow-wrap: anywhere; }
@media (max-width: 1100px) { .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
