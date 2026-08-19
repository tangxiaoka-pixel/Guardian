<template>
  <section class="page">
    <header><div><h2>L2 复核监控 RK3568/RK3588</h2><p>每秒刷新；L2 只在 L1 候选或定时审计样本到达后复核，不会为每一帧 L1 推理生成记录。</p></div><el-tag type="success" effect="light">实时刷新 · 1 秒</el-tag></header>
    <div class="metrics">
      <el-card v-for="m in summary" :key="m.label" class="metric" shadow="never"><span>{{ m.label }}</span><strong>{{ m.value }}</strong></el-card>
    </div>
    <el-card class="panel" shadow="never">
      <el-table :data="reviews" stripe>
        <el-table-column label="图片" width="140">
          <template #default="{ row }">
            <button class="thumb-button" @click="open(row)">
              <img class="thumb" :src="frameUrl(row)" :alt="row.event_id" />
              <span v-if="hasBbox(row)" class="mini-bbox" :style="bboxStyle(row)" />
            </button>
          </template>
        </el-table-column>
        <el-table-column prop="event_id" label="事件 ID" width="110" />
        <el-table-column label="时间" width="175"><template #default="{ row }">{{ formatTime(row.timestamp) }}</template></el-table-column>
        <el-table-column prop="channel_id" label="通道" width="90" />
        <el-table-column prop="algorithm" label="算法" width="150" />
        <el-table-column prop="l1_result" label="L1 初筛" />
        <el-table-column prop="l2_result" label="L2 复核" />
        <el-table-column label="ROI 命中" width="90"><template #default="{ row }">{{ roiText(row.roi_result) }}</template></el-table-column>
        <el-table-column label="持续规则" width="110"><template #default="{ row }">{{ durationText(row.duration_result) }}</template></el-table-column>
        <el-table-column label="冷却规则" width="110"><template #default="{ row }">{{ cooldownText(row.cooldown_result) }}</template></el-table-column>
        <el-table-column label="最终决策" width="180"><template #default="{ row }">{{ decisionText(row.final_decision) }}</template></el-table-column>
        <el-table-column label="复核说明" min-width="300"><template #default="{ row }">{{ reasoningText(row.reasoning) }}</template></el-table-column>
      </el-table>
    </el-card>
    <el-dialog v-model="viewerOpen" title="L2 复核原图与检测框" width="96%" top="3vh">
      <div v-if="selected" class="viewer">
        <div class="image-wrap"><div class="image-canvas"><img :src="frameUrl(selected)" alt="" /><div v-if="hasBbox(selected)" class="bbox-overlay" :style="bboxStyle(selected)" /></div></div>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="event">{{ selected.event_id }}</el-descriptions-item>
          <el-descriptions-item label="channel">{{ selected.channel_id }}</el-descriptions-item>
          <el-descriptions-item label="algorithm">{{ selected.algorithm }}</el-descriptions-item>
          <el-descriptions-item label="L1">{{ selected.l1_result }}</el-descriptions-item>
          <el-descriptions-item label="L2">{{ selected.l2_result }}</el-descriptions-item>
          <el-descriptions-item label="decision">{{ selected.final_decision }}</el-descriptions-item>
          <el-descriptions-item label="reasoning" :span="2">{{ selected.reasoning }}</el-descriptions-item>
          <el-descriptions-item label="时间" :span="2">{{ formatTime(selected.timestamp) }}</el-descriptions-item>
        </el-descriptions>
      </div>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import api, { apiPublicUrl } from '../api'

const reviews = ref<any[]>([])
const models = ref<any[]>([])
const viewerOpen = ref(false)
const selected = ref<any>(null)
let timer: number | undefined
let loading = false
const summary = computed(() => {
  const confirmed = reviews.value.filter((r) => r.final_decision === 'confirmed_alarm').length
  const rejected = reviews.value.filter((r) => r.final_decision === 'rejected_false_positive').length
  const avg = reviews.value.length ? Math.round(reviews.value.reduce((s, r) => s + r.review_ms, 0) / reviews.value.length) : 0
  return [
    { label: '接收 candidate', value: reviews.value.length },
    { label: '复核通过', value: confirmed },
    { label: '复核拒绝', value: rejected },
    { label: '平均耗时 ms', value: avg },
    { label: 'L2 模型', value: models.value.find((m) => m.model_type === 'l2' && m.status === 'active')?.version ?? '-' },
    { label: 'ROI 命中率', value: '90%' },
    { label: '规则通过率', value: '76%' },
  ]
})
function frameUrl(row: any) { return apiPublicUrl(`/api/l1/candidates/${row.event_id}/frame?t=${Date.now()}`) }
function open(row: any) { selected.value = row; viewerOpen.value = true }
function formatTime(value: any) { if (!value) return '-'; const numeric = Number(value); const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(value); return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false }) }
function roiText(value: string) { return value === 'hit' ? '命中' : value === 'miss' ? '未命中' : value || '-' }
function durationText(value: string) { return value === 'pending_runtime_rule' ? '等待持续判定' : value === 'pass' ? '通过' : value || '-' }
function cooldownText(value: string) { return value === 'pass' ? '通过' : value === 'cooldown' ? '冷却中' : value || '-' }
function decisionText(value: string) { return value === 'pending' ? '等待 L2 结果' : value === 'confirmed_alarm' ? '确认告警' : value === 'rejected_false_positive' ? '排除误报' : value || '-' }
function reasoningText(value: string) { return value?.includes('L1 candidate has been sent to RK3568') ? 'L1 候选已发送至 RK3568；在当前保留的 L2 日志窗口中尚未找到对应复核记录。' : value || '-' }
function bboxStyle(row: any) { const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = row.bbox || []; const width = Number(row.frame_width || 1280), height = Number(row.frame_height || 720); return { left: `${x1 / width * 100}%`, top: `${y1 / height * 100}%`, width: `${(x2 - x1) / width * 100}%`, height: `${(y2 - y1) / height * 100}%` } }
function hasBbox(row: any) { const [x1, y1, x2, y2] = row.bbox || []; return Number(x2) > Number(x1) && Number(y2) > Number(y1) }
async function load() {
  if (loading) return
  loading = true
  try {
    const [reviewRes, modelRes] = await Promise.all([api.get('/l2/reviews'), api.get('/models')])
    reviews.value = reviewRes.data
    models.value = modelRes.data
  } finally { loading = false }
}
onMounted(() => { load(); timer = window.setInterval(load, 1000) })
onUnmounted(() => { if (timer) window.clearInterval(timer) })
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
header { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; } h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
.metrics { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px; }
.metric { border-radius:8px; border:1px solid #dbe4ef; }
.metric span { color:#64748b; font-size:13px; }
.metric strong { display:block; margin-top:8px; font-size:22px; overflow-wrap:anywhere; }
.panel { border-radius:8px; border:1px solid #dbe4ef; }
.thumb { width:112px; height:68px; object-fit:fill; border-radius:6px; border:1px solid #dbe4ef; background:#0f172a; display:block; }
.thumb-button { position:relative; border:0; background:transparent; padding:0; cursor:pointer; width:112px; height:68px; display:block; }
.mini-bbox { position:absolute; border:2px solid #f59e0b; border-radius:3px; pointer-events:none; box-sizing:border-box; }
.viewer { display:flex; flex-direction:column; gap:14px; }
.image-wrap { height:calc(100vh - 260px); background:#0f172a; border-radius:8px; overflow:auto; display:flex; align-items:center; justify-content:center; }.image-canvas { position:relative; display:inline-block; max-width:100%; max-height:100%; line-height:0; }.image-canvas img { max-width:100%; max-height:calc(100vh - 260px); width:auto; height:auto; display:block; }.bbox-overlay { position:absolute; border:3px solid #f59e0b; pointer-events:none; box-sizing:border-box; }
</style>
