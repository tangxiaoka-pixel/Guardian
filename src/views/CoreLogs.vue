<template>
  <div class="core-page">
    <div class="page-head">
      <div>
        <h2>核心日志</h2>
        <p>按唯一对象 ID 追踪摄像头唤醒、L1 监测、L2 复核、Mage 审计、标注草稿和训练审核。</p>
      </div>
      <el-button :icon="Refresh" type="primary" :loading="loading" @click="loadData">刷新</el-button>
    </div>

    <el-alert
      class="gate-alert"
      type="warning"
      :closable="false"
      show-icon
      title="训练闸门：Mage-VL 只生成审计意见和标注草稿，进入训练素材、启动训练、模型下发必须人工确认。"
    />

    <el-row :gutter="12" class="metric-row">
      <el-col :span="4"><div class="metric"><span>追踪对象</span><strong>{{ summary.traces }}</strong></div></el-col>
      <el-col :span="4"><div class="metric"><span>重要事件</span><strong>{{ summary.events }}</strong></div></el-col>
      <el-col :span="4"><div class="metric"><span>疑似对象</span><strong>{{ summary.suspected_objects }}</strong></div></el-col>
      <el-col :span="4"><div class="metric"><span>定时抽帧</span><strong>{{ summary.periodic_samples }}</strong></div></el-col>
      <el-col :span="4"><div class="metric"><span>Mage 审计</span><strong>{{ summary.mage_audits }}</strong></div></el-col>
      <el-col :span="4"><div class="metric"><span>待人工审核</span><strong>{{ summary.pending_human_dataset_approval }}</strong></div></el-col>
    </el-row>

    <el-card shadow="never" class="panel">
      <template #header>
        <div class="panel-title">
          <span>对象追踪</span>
          <div class="tools">
            <el-input v-model="keyword" :prefix-icon="Search" clearable placeholder="搜索对象ID / Trace / 阶段 / 摄像头" />
            <el-select v-model="stageFilter" clearable placeholder="全部阶段">
              <el-option v-for="item in stageOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </div>
        </div>
      </template>

      <el-table v-loading="loading" :data="filteredTraces" height="560" highlight-current-row row-key="trace_id" @row-click="openTrace">
        <el-table-column type="expand" width="44">
          <template #default="{ row }">
            <div class="inline-steps">
              <div
                v-for="step in row.steps"
                :key="`${row.trace_id}-${step.stage}`"
                class="inline-step"
                :class="`state-${step.status || 'waiting'}`"
              >
                <div class="inline-step-head">
                  <strong>{{ stageLabel(step.stage) }}</strong>
                  <el-tag size="small" effect="plain" :type="statusType(step.status)">{{ statusLabel(step.status) }}</el-tag>
                </div>
                <p>{{ step.title }}</p>
                <small>{{ step.detail || '-' }}</small>
                <div v-if="step.evidence" class="evidence">证据：{{ step.evidence }}</div>
                <div class="source">来源：{{ step.source || '-' }} · {{ formatTime(step.at) }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="最近更新" min-width="170">
          <template #default="{ row }">{{ formatTime(row.updated_at) }}</template>
        </el-table-column>
        <el-table-column prop="object_id" label="对象ID" min-width="210" />
        <el-table-column prop="camera_name" label="摄像头" min-width="150" />
        <el-table-column label="场景" min-width="140">
          <template #default="{ row }">{{ row.scene_name || row.scene_code || '-' }}</template>
        </el-table-column>
        <el-table-column label="当前节点" min-width="180">
          <template #default="{ row }">
            <el-tag :type="statusType(currentNode(row).status)">{{ stageLabel(currentNode(row).stage) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="节点状态" width="120">
          <template #default="{ row }">
            <el-tag effect="plain" :type="statusType(currentNode(row).status)">{{ statusLabel(currentNode(row).status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="进度" min-width="260">
          <template #default="{ row }">
            <div class="stage-strip">
              <span
                v-for="step in row.steps"
                :key="`${row.trace_id}-dot-${step.stage}`"
                :class="['stage-dot', step.status || 'waiting']"
                :title="`${stageLabel(step.stage)}：${statusLabel(step.status)}`"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="当前说明" min-width="300" show-overflow-tooltip>
          <template #default="{ row }">{{ currentNode(row).detail || currentNode(row).title || '-' }}</template>
        </el-table-column>
      </el-table>

      <el-empty v-if="!loading && !traces.length" description="还没有真实核心日志。摄像头唤醒并产生 L1 抽帧/候选或 Forge 样本后会显示在这里。" />
    </el-card>

    <el-drawer v-model="drawerVisible" size="46%" title="对象全链路追踪">
      <div v-if="selectedTrace" class="trace-detail">
        <div class="trace-head">
          <div>
            <span>对象ID</span>
            <strong>{{ selectedTrace.object_id }}</strong>
          </div>
          <div>
            <span>Trace ID</span>
            <strong>{{ selectedTrace.trace_id }}</strong>
          </div>
          <div>
            <span>触发类型</span>
            <strong>{{ triggerLabel(selectedTrace.trigger_type) }}</strong>
          </div>
        </div>

        <el-descriptions :column="2" border>
          <el-descriptions-item label="摄像头">{{ selectedTrace.camera_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="场景">{{ selectedTrace.scene_name || selectedTrace.scene_code || '-' }}</el-descriptions-item>
          <el-descriptions-item label="开始时间">{{ formatTime(selectedTrace.started_at) }}</el-descriptions-item>
          <el-descriptions-item label="最近更新">{{ formatTime(selectedTrace.updated_at) }}</el-descriptions-item>
        </el-descriptions>

        <el-card v-if="annotationStep" class="annotation-card" shadow="never">
          <template #header>
            <div class="annotation-head">
              <strong>自动标注草稿可视化</strong>
              <el-tag type="warning">待人工确认</el-tag>
            </div>
          </template>
          <div class="annotation-grid">
            <div>
              <div class="image-stage" v-loading="annotationLoading">
                <img v-if="annotationImageUrl" :src="annotationImageUrl" alt="自动标注图片" />
                <el-empty v-else description="暂无可预览图片" />
                <div
                  v-for="(box, index) in annotationBoxes"
                  :key="`${box.classId}-${index}`"
                  class="label-box"
                  :style="boxStyle(box)"
                >
                  <span>{{ boxLabel(box) }}</span>
                </div>
              </div>
            </div>
            <div class="annotation-side">
              <div class="side-row">
                <span>样本 ID</span>
                <strong>{{ annotationStep.sample_id || selectedTrace.sample_id || '-' }}</strong>
              </div>
              <div class="side-row">
                <span>Label 文件</span>
                <small>{{ annotationStep.dataset_label_path || annotationStep.evidence || '-' }}</small>
              </div>
              <div class="side-row">
                <span>标注状态</span>
                <strong>{{ labelStatusText(annotationStep.label_status) }}</strong>
                <small v-if="annotationStep.label_reject_reason">原因：{{ labelRejectReasonText(annotationStep.label_reject_reason) }}</small>
              </div>
              <div class="side-row">
                <span>YOLO 标注内容</span>
                <pre>{{ annotationLabelText || '等待读取 label 文件' }}</pre>
              </div>
              <div class="side-row">
                <span>解析结果</span>
                <small v-if="annotationBoxes.length">{{ annotationBoxes.map(boxLabel).join('；') }}</small>
                <small v-else>暂无可解析标注框</small>
              </div>
            </div>
          </div>
        </el-card>

        <el-timeline class="trace-timeline">
          <el-timeline-item
            v-for="step in selectedTrace.steps"
            :key="`${selectedTrace.trace_id}-${step.stage}`"
            :type="timelineType(step.status)"
            :timestamp="formatTime(step.at)"
          >
            <div class="step-card">
              <div class="step-title">
                <strong>{{ stageLabel(step.stage) }}</strong>
                <el-tag size="small" :type="statusType(step.status)">{{ statusLabel(step.status) }}</el-tag>
              </div>
              <p>{{ step.title }}</p>
              <small>{{ step.detail || '-' }}</small>
              <div v-if="step.evidence" class="evidence">证据：{{ step.evidence }}</div>
              <div class="source">来源：{{ step.source || '-' }}</div>
            </div>
          </el-timeline-item>
        </el-timeline>
      </div>
      <el-empty v-else description="选择一条事件查看完整链路" />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Refresh, Search } from '@element-plus/icons-vue'
import api from '../api'

const loading = ref(false)
const keyword = ref('')
const stageFilter = ref('')
const events = ref<any[]>([])
const traces = ref<any[]>([])
const drawerVisible = ref(false)
const selectedTrace = ref<any | null>(null)
const annotationLoading = ref(false)
const annotationImageUrl = ref('')
const annotationLabelText = ref('')
const summary = ref({
  traces: 0,
  events: 0,
  suspected_objects: 0,
  periodic_samples: 0,
  mage_audits: 0,
  pending_human_dataset_approval: 0,
})

const stageNames: Record<string, string> = {
  camera_awake: '摄像头唤醒',
  l1_monitor_stats: 'L1 监测统计',
  l1_periodic_frame: 'L1 定时抽帧',
  l1_candidate: 'L1 疑似命中',
  l1_upload_l2: '上报 L2',
  l2_review: 'L2 本地复核',
  mage_audit: 'Mage 审计',
  auto_label_draft: '自动标注草稿',
  human_dataset_approval: '人工审核入库',
  miss_guard_upload_policy: '漏检送审策略',
  forge_sample_received: 'Forge 收样',
  manual_training: '人工训练任务',
}

const stageOptions = computed(() => Object.entries(stageNames).map(([value, label]) => ({ value, label })))
const annotationStep = computed(() => {
  const steps = Array.isArray(selectedTrace.value?.steps) ? selectedTrace.value.steps : []
  return steps.find((step: any) => step.stage === 'auto_label_draft' && (step.preview_image_url || step.dataset_image_preview_url || step.label_preview_url || step.evidence)) || null
})
const annotationBoxes = computed(() => parseYoloLabels(annotationLabelText.value))

const filteredTraces = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  return traces.value.filter((item) => {
    const matchStage = !stageFilter.value || item.steps?.some((step: any) => step.stage === stageFilter.value)
    const haystack = [
      item.object_id,
      item.trace_id,
      item.camera_name,
      item.scene_name,
      item.trigger_type,
      item.steps?.map((step: any) => `${step.stage} ${step.title} ${step.detail}`).join(' '),
    ].join(' ').toLowerCase()
    return matchStage && (!text || haystack.includes(text))
  })
})

function stageLabel(stage: string) {
  return stageNames[stage] || stage || '-'
}

function statusLabel(status: string) {
  if (status === 'done') return '完成'
  if (status === 'failed') return '失败'
  if (status === 'warning') return '待人工确认'
  return '等待'
}

function statusType(status: string) {
  if (status === 'done') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'warning') return 'warning'
  return 'info'
}

function timelineType(status: string) {
  return statusType(status)
}

function triggerLabel(value: string) {
  if (value === 'l1_suspected_object') return 'L1 疑似对象'
  if (value === 'periodic_miss_guard') return '漏检防护抽帧'
  if (value === 'manual_training') return '人工训练'
  return value || '-'
}

function currentNode(trace: any) {
  const steps = Array.isArray(trace?.steps) ? trace.steps : []
  return steps.find((step: any) => step.status !== 'done') || steps[steps.length - 1] || { stage: trace?.current_stage, status: trace?.status, title: '', detail: '' }
}

function formatTime(value: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function openTrace(row: any) {
  selectedTrace.value = traces.value.find((item) => item.trace_id === row.trace_id) || null
  drawerVisible.value = true
  loadAnnotationPreview()
}

function previewApiPath(path: string) {
  if (!path) return ''
  if (path.startsWith('/api/')) return path.slice(4)
  return path
}

async function loadAnnotationPreview() {
  if (annotationImageUrl.value) URL.revokeObjectURL(annotationImageUrl.value)
  annotationImageUrl.value = ''
  annotationLabelText.value = ''
  const step = annotationStep.value
  if (!step) return
  annotationLoading.value = true
  try {
    const imageUrl = previewApiPath(step.dataset_image_preview_url || step.preview_image_url || '')
    const labelUrl = previewApiPath(step.label_preview_url || '')
    const [imageResp, labelResp] = await Promise.all([
      imageUrl ? api.get(imageUrl, { responseType: 'blob' }).catch(() => null) : Promise.resolve(null),
      labelUrl ? api.get(labelUrl, { responseType: 'text' }).catch(() => null) : Promise.resolve(null),
    ])
    if (imageResp?.data) annotationImageUrl.value = URL.createObjectURL(imageResp.data)
    if (typeof labelResp?.data === 'string') annotationLabelText.value = labelResp.data.trim()
  } finally {
    annotationLoading.value = false
  }
}

function parseYoloLabels(text: string) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [classId, x, y, w, h, confidence] = line.split(/\s+/).map(Number)
      if (![classId, x, y, w, h].every(Number.isFinite)) return null
      const left = Math.max(0, (x - w / 2) * 100)
      const top = Math.max(0, (y - h / 2) * 100)
      const width = Math.min(100 - left, w * 100)
      const height = Math.min(100 - top, h * 100)
      return { classId, x, y, w, h, confidence, left, top, width, height }
    })
    .filter(Boolean) as any[]
}

function boxStyle(box: any) {
  return {
    left: `${box.left}%`,
    top: `${box.top}%`,
    width: `${box.width}%`,
    height: `${box.height}%`,
  }
}

function boxLabel(box: any) {
  const names: Record<number, string> = {
    0: 'bottle',
    1: 'cap_missing',
    39: 'bottle',
  }
  const suffix = Number.isFinite(box.confidence) ? ` ${Number(box.confidence).toFixed(2)}` : ''
  return `${names[box.classId] || `class_${box.classId}`}${suffix}`
}

function labelStatusText(status: string) {
  if (status === 'not_required') return '无需标注'
  if (status === 'need_human_box') return '待人工画框'
  if (status === 'need_human_review') return '待人工复核'
  if (status === 'auto_label_draft') return '自动标注草稿'
  return status || '待人工确认'
}

function labelRejectReasonText(reason: string) {
  if (reason === 'no_bottle_visible') return '画面内没有瓶子'
  if (reason === 'missing_target_bbox') return '没有可信目标框'
  if (reason === 'bottle_visibility_not_confirmed') return '未确认有瓶子'
  if (reason === 'vlm_uncertain') return 'VLM 判断不确定'
  if (reason === 'low_vlm_confidence') return 'VLM 置信度不足'
  return reason
}

async function loadData() {
  loading.value = true
  try {
    const resp = await api.get('/core-logs', { params: { limit: 80 } })
    events.value = resp.data.events || []
    traces.value = resp.data.traces || []
    summary.value = { ...summary.value, ...(resp.data.summary || {}) }
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
onBeforeUnmount(() => {
  if (annotationImageUrl.value) URL.revokeObjectURL(annotationImageUrl.value)
})
</script>

<style scoped>
.core-page {
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

.gate-alert {
  margin-bottom: 12px;
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
  gap: 16px;
  justify-content: space-between;
}

.tools {
  display: flex;
  gap: 10px;
  min-width: 520px;
}

.inline-steps {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 8px 16px 12px 52px;
}

.inline-step {
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-left: 4px solid #94a3b8;
  border-radius: 8px;
  padding: 10px 12px;
}

.inline-step.state-done {
  border-left-color: #22c55e;
}

.inline-step.state-warning {
  border-left-color: #f59e0b;
}

.inline-step.state-failed {
  border-left-color: #ef4444;
}

.inline-step p {
  margin: 8px 0 4px;
}

.inline-step small {
  color: #475569;
  line-height: 1.5;
}

.inline-step-head {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.stage-strip {
  align-items: center;
  display: flex;
  gap: 6px;
}

.stage-dot {
  border-radius: 999px;
  display: inline-block;
  height: 10px;
  width: 22px;
  background: #cbd5e1;
}

.stage-dot.done {
  background: #22c55e;
}

.stage-dot.warning {
  background: #f59e0b;
}

.stage-dot.failed {
  background: #ef4444;
}

.stage-dot.waiting {
  background: #cbd5e1;
}

.trace-head {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(3, 1fr);
  margin-bottom: 14px;
}

.trace-head div {
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px;
}

.trace-head span {
  color: #64748b;
  display: block;
  font-size: 12px;
  margin-bottom: 6px;
}

.trace-head strong {
  word-break: break-all;
}

.annotation-card {
  border-radius: 8px;
  margin: 14px 0;
}

.annotation-head {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.annotation-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: minmax(0, 1.35fr) minmax(260px, .65fr);
}

.image-stage {
  align-items: center;
  background: #0f172a;
  border-radius: 8px;
  display: flex;
  justify-content: center;
  min-height: 260px;
  overflow: hidden;
  position: relative;
}

.image-stage img {
  display: block;
  height: auto;
  max-height: 520px;
  max-width: 100%;
  width: 100%;
}

.label-box {
  border: 2px solid #38bdf8;
  box-shadow: 0 0 0 1px rgba(15, 23, 42, .35);
  color: #fff;
  min-height: 18px;
  min-width: 18px;
  pointer-events: none;
  position: absolute;
}

.label-box span {
  background: #0284c7;
  border-radius: 0 0 4px 0;
  display: inline-block;
  font-size: 12px;
  line-height: 1;
  padding: 4px 6px;
  transform: translateY(-1px);
}

.annotation-side {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.side-row {
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px;
}

.side-row span {
  color: #64748b;
  display: block;
  font-size: 12px;
  margin-bottom: 6px;
}

.side-row small,
.side-row strong {
  overflow-wrap: anywhere;
}

.side-row pre {
  background: #0f172a;
  border-radius: 6px;
  color: #e5e7eb;
  margin: 0;
  overflow: auto;
  padding: 8px;
  white-space: pre-wrap;
}

.trace-timeline {
  margin-top: 18px;
}

.step-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px;
}

.step-title {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.step-card p {
  margin: 8px 0 4px;
}

.step-card small,
.source,
.evidence {
  color: #64748b;
  display: block;
  line-height: 1.6;
  word-break: break-all;
}

.evidence {
  margin-top: 6px;
}
</style>
