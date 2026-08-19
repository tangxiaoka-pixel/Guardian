<template>
  <div class="flow-page">
    <div class="page-head">
      <div>
        <h2>处理流监控</h2>
        <p>RV1126 多路初筛、RK3568 复核、云端告警的实时链路状态。</p>
      </div>
      <el-button :icon="Refresh" type="primary" @click="loadData">刷新</el-button>
    </div>

    <el-row :gutter="12" class="metric-row">
      <el-col :span="4"><div class="metric"><span>哨兵</span><strong>{{ summary.sentinels }}</strong></div></el-col>
      <el-col :span="4"><div class="metric"><span>通道</span><strong>{{ summary.channels }}</strong></div></el-col>
      <el-col :span="4"><div class="metric"><span>帧吞吐</span><strong>{{ summary.frames_per_sec }}/s</strong></div></el-col>
      <el-col :span="4"><div class="metric"><span>触发率</span><strong>{{ summary.trigger_rate_per_min }}/min</strong></div></el-col>
      <el-col :span="4"><div class="metric"><span>P95</span><strong>{{ summary.p95_latency_ms }}ms</strong></div></el-col>
      <el-col :span="4"><div class="metric"><span>大脑压力</span><strong>{{ summary.brain_pressure }}</strong></div></el-col>
    </el-row>

    <el-row :gutter="12">
      <el-col :span="15">
        <el-card shadow="never" class="panel">
          <template #header>
            <div class="panel-title">
              <span>帧流水</span>
              <el-tag type="info">{{ frames.length }} 条</el-tag>
            </div>
          </template>
          <el-table :data="frames" height="560" highlight-current-row @current-change="selectFrame">
            <el-table-column prop="trace_id" label="Trace ID" min-width="260" />
            <el-table-column prop="channel_name" label="通道" width="130" />
            <el-table-column prop="algorithm_label" label="算法" width="150" />
            <el-table-column label="阶段" width="150">
              <template #default="{ row }">
                <el-tag :type="stageType(row.stage)">{{ stageLabel(row.stage) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="结果" min-width="150">
              <template #default="{ row }">
                <span :class="{ alarmed: row.alarm_id }">{{ row.result }}</span>
              </template>
            </el-table-column>
            <el-table-column label="置信度" width="95">
              <template #default="{ row }">{{ row.confidence ? `${Math.round(row.confidence * 100)}%` : '-' }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="9">
        <el-card shadow="never" class="panel detail-panel">
          <template #header>
            <div class="panel-title">
              <span>帧详情</span>
              <el-tag v-if="selected" :type="selected.alarm_id ? 'danger' : 'success'">
                {{ selected.alarm_id ? '告警' : '未触发' }}
              </el-tag>
            </div>
          </template>

          <div v-if="selected" class="detail">
            <div class="detail-grid">
              <div><span>哨兵</span><strong>{{ selected.sentinel_sn }}</strong></div>
              <div><span>通道</span><strong>{{ selected.channel }}</strong></div>
              <div><span>等级</span><strong>{{ selected.level }}</strong></div>
              <div><span>算法</span><strong>{{ selected.algorithm_label }}</strong></div>
            </div>

            <el-divider />

            <el-timeline>
              <el-timeline-item
                v-for="item in selected.stages"
                :key="item.stage"
                :type="timelineType(item.status)"
                :timestamp="item.latency_ms === null ? '' : `${item.latency_ms} ms`"
              >
                <div class="stage-line">
                  <strong>{{ stageLabel(item.stage) }}</strong>
                  <span>{{ item.note }}</span>
                </div>
              </el-timeline-item>
            </el-timeline>

            <el-divider />

            <div class="reasoning">
              <span>最终结果</span>
              <p>{{ selected.reasoning || selected.result }}</p>
              <small v-if="selected.alarm_id">alarm_id: {{ selected.alarm_id }}</small>
            </div>
          </div>
          <el-empty v-else description="选择一条帧流水查看详情" />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import api from '../api'

const summary = ref({
  sentinels: 0,
  channels: 0,
  frames_per_sec: 0,
  trigger_rate_per_min: 0,
  p95_latency_ms: 0,
  brain_pressure: 0,
})
const frames = ref<any[]>([])
const selected = ref<any | null>(null)

const stageLabels: Record<string, string> = {
  rtsp_recv: 'RTSP 收流',
  vdec_done: 'VDEC 解码',
  rga_done: 'RGA 预处理',
  l1_infer_done: 'RV1126 初筛',
  trigger_decided: '触发决策',
  http_sent: 'HTTP 上报',
  brain_received: '大脑接收',
  review_done: 'RK3568 复核',
  rule_done: '规则判定',
  alarm_uploaded: '告警上云',
}

function stageLabel(stage: string) {
  return stageLabels[stage] || stage
}

function stageType(stage: string) {
  if (stage === 'alarm_uploaded') return 'danger'
  if (stage === 'rule_done' || stage === 'review_done') return 'warning'
  return 'primary'
}

function timelineType(status: string) {
  if (status === 'done') return 'success'
  if (status === 'failed') return 'danger'
  return 'info'
}

function selectFrame(row: any) {
  selected.value = row
}

async function loadData() {
  const [summaryResp, framesResp] = await Promise.all([
    api.get('/flow/summary'),
    api.get('/flow/frames', { params: { limit: 40 } }),
  ])
  summary.value = summaryResp.data
  frames.value = framesResp.data
  selected.value = frames.value[0] || null
}

onMounted(loadData)
</script>

<style scoped>
.flow-page {
  color: #1f2937;
}

.page-head {
  align-items: center;
  display: flex;
  justify-content: space-between;
  margin-bottom: 14px;
}

.page-head h2 {
  font-size: 22px;
  line-height: 1.2;
  margin: 0 0 6px;
}

.page-head p {
  color: #6b7280;
  margin: 0;
}

.metric-row {
  margin-bottom: 12px;
}

.metric {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 74px;
  padding: 14px;
}

.metric span {
  color: #6b7280;
  font-size: 13px;
}

.metric strong {
  font-size: 24px;
}

.panel {
  border-radius: 8px;
}

.panel-title {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.detail-panel {
  min-height: 624px;
}

.detail-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: 1fr 1fr;
}

.detail-grid div {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 10px;
}

.detail-grid span,
.reasoning span {
  color: #6b7280;
  display: block;
  font-size: 12px;
  margin-bottom: 6px;
}

.detail-grid strong {
  font-size: 14px;
  overflow-wrap: anywhere;
}

.stage-line {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stage-line span {
  color: #6b7280;
}

.reasoning p {
  line-height: 1.6;
  margin: 0 0 8px;
}

.reasoning small {
  color: #6b7280;
  overflow-wrap: anywhere;
}

.alarmed {
  color: #c2410c;
  font-weight: 600;
}
</style>
