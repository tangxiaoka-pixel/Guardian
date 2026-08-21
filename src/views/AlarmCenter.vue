<template>
  <section class="page">
    <header><h2>告警中心</h2><p>告警是 AI / IoT / 人工上报产生的原始风险信号；这里负责看见风险、确认风险。</p></header>
    <el-card class="panel" shadow="never">
      <el-table v-loading="loading" :data="alarms" stripe>
        <el-table-column prop="alarm_id" label="alarm" width="110" />
        <el-table-column prop="event_id" label="event" width="110" />
        <el-table-column prop="channel_id" label="channel" width="90" />
        <el-table-column prop="alarm_type" label="风险类型" width="150" />
        <el-table-column prop="location" label="点位" min-width="160" />
        <el-table-column prop="alarm_status" label="告警状态" width="120"><template #default="{ row }"><el-tag>{{ alarmStatusText(row.alarm_status) }}</el-tag></template></el-table-column>
        <el-table-column label="告警时间" min-width="190"><template #default="{ row }">{{ formatTime(row.timestamp) }}</template></el-table-column>
        <el-table-column prop="feedback_result" label="反馈结果" width="120" />
        <el-table-column label="操作" width="330">
          <template #default="{ row }">
            <el-button size="small" @click="open(row)">详情</el-button>
            <el-button size="small" type="success" :disabled="isResolved(row)" @click="confirm(row.alarm_id)">有效</el-button>
            <el-button size="small" type="warning" :disabled="isResolved(row)" @click="reject(row.alarm_id)">误报</el-button>
            <el-button size="small" :disabled="isResolved(row)" @click="ignore(row.alarm_id)">忽略</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination">
        <el-pagination background layout="total, prev, pager, next" :current-page="page" :page-size="pageSize" :total="total" @current-change="changePage" />
      </div>
    </el-card>
    <el-dialog v-model="visible" title="告警详情" width="1260px" class="alarm-detail-dialog">
      <div v-loading="detailLoading" class="detail-wrap">
      <div v-if="selected" class="detail">
        <section class="evidence-panel">
          <div class="evidence-title"><strong>双帧证据</strong><span>告警产生与消除分别留存，避免混用同一张快照。</span></div>
          <div class="evidence-grid">
            <figure class="frame-card">
              <figcaption><strong>告警产生帧</strong><span>{{ formatTime(selected.timestamp) }}</span></figcaption>
              <div class="snapshot">
                <svg v-if="alarmFrame(selected)" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet" aria-label="告警产生关键帧">
                  <image :href="alarmFrame(selected)" x="0" y="0" width="1280" height="720" preserveAspectRatio="none" />
                  <rect v-for="(box, index) in targetBoxes(selected)" :key="index" :x="box[0]" :y="box[1]" :width="box[2] - box[0]" :height="box[3] - box[1]" class="bbox" />
                </svg>
                <span v-else>未收到告警产生帧</span>
              </div>
            </figure>
            <figure class="frame-card">
              <figcaption><strong>告警消除帧</strong><span>{{ formatTime(selected.resolved_at || selected.updated_at) }}</span></figcaption>
              <div class="snapshot">
                <svg v-if="resolvedFrame(selected)" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet" aria-label="告警消除验证帧">
                  <image :href="resolvedFrame(selected)" x="0" y="0" width="1280" height="720" preserveAspectRatio="none" />
                </svg>
                <span v-else>{{ isResolved(selected) ? '消除事件未上报独立图片' : '告警尚未消除' }}</span>
              </div>
            </figure>
          </div>
        </section>
        <aside class="detail-side">
          <h3>告警信息</h3>
          <el-descriptions :column="1" border label-width="100">
          <el-descriptions-item label="告警 ID">{{ selected.alarm_id }}</el-descriptions-item>
          <el-descriptions-item label="L1 输出">{{ selected.l1_output?.class_name || '-' }} {{ selected.l1_output?.confidence ?? '' }}</el-descriptions-item>
          <el-descriptions-item label="L2 输出">{{ l2DecisionText(selected) }}</el-descriptions-item>
          <el-descriptions-item label="风险目标">{{ targetSummary(selected) }}</el-descriptions-item>
          <el-descriptions-item label="规则判断">{{ ruleText(selected) }}</el-descriptions-item>
          <el-descriptions-item label="客户反馈">{{ selected.feedback_result || '未反馈' }}</el-descriptions-item>
          <el-descriptions-item label="处理记录">{{ selected.human_records?.length || 0 }}</el-descriptions-item>
          <el-descriptions-item label="Forge 素材">
            <template v-if="selected.forge_samples?.length"><el-button link type="primary" @click="openForge(selected)">查看 {{ selected.forge_samples.length }} 条关联素材</el-button><span class="hint">仅带合规证据图的告警/消除验证帧才会进入训练闭环。</span></template>
            <span v-else class="hint">该告警尚无可追溯 Forge 素材（无合规图像或未成功入库）。</span>
          </el-descriptions-item>
          </el-descriptions>
        </aside>
      </div>
      <el-empty v-else-if="!detailLoading" description="告警详情不存在或已被删除" />
      </div>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const alarms = ref<any[]>([])
const router = useRouter()
const selected = ref<any>(null)
const visible = ref(false)
const loading = ref(false)
const detailLoading = ref(false)
const page = ref(1)
const pageSize = 20
const total = ref(0)
const customerId = localStorage.getItem('guardian_customer_id') || ''
const siteId = localStorage.getItem('guardian_site_id') || ''
async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/alarms', {
      params: { customer_id: customerId, site_id: siteId, summary: 1, page: page.value, page_size: pageSize },
    })
    // Compatibility with an old API during a rolling deployment.
    if (Array.isArray(data)) {
      alarms.value = data.filter((item: any) => !item.site_id || item.site_id === siteId)
      total.value = alarms.value.length
    } else {
      alarms.value = data.items || []
      total.value = Number(data.total || 0)
      page.value = Number(data.page || page.value)
    }
  } finally {
    loading.value = false
  }
}
function changePage(nextPage: number) {
  page.value = nextPage
  load()
}
function formatTime(value: any) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const fields = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])) as Record<string, string>
  return `${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute}:${fields.second}`
}
function alarmFrame(row: any) {
  return row?.alarm_snapshot || row?.proof_snapshot || row?.snapshot || row?.snapshot_url || ''
}
function resolvedFrame(row: any) {
  const frame = row?.resolved_snapshot || row?.resolved_snapshot_url || ''
  return frame && frame !== alarmFrame(row) ? frame : ''
}
function ruleText(row: any) {
  const rule = parseJsonish(row?.rule_result, row?.rule_result)
  if (typeof rule === 'string') return rule || '-'
  return rule?.reasoning || rule?.decision || '-'
}
function openForge(row: any) { router.push({ path: '/forge/materials', query: { source_event_id: row.alarm_id } }) }
async function open(row: any) {
  selected.value = null
  visible.value = true
  detailLoading.value = true
  try {
    const { data } = await api.get('/alarms/' + encodeURIComponent(row.alarm_id), {
      params: { customer_id: customerId, site_id: siteId },
    })
    selected.value = data
  } finally {
    detailLoading.value = false
  }
}
function parseJsonish(value: any, fallback: any = null): any {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value
  if (typeof value === 'string' && value.trim()) {
    try { return JSON.parse(value) } catch (_) {}
  }
  return fallback
}
function normalizeBox(value: any): number[] {
  const parsed = parseJsonish(value, value)
  const rawBox = Array.isArray(parsed)
    ? parsed
    : parsed?.bbox || parsed?.box || parsed?.xyxy || parsed?.bbox_xyxy || parsed?.bbox_norm || parsed?.bbox_xyxy_norm || parsed?.xywh
  if (!Array.isArray(rawBox) || rawBox.length < 4) return []
  const box = rawBox.slice(0, 4).map(Number)
  return box.every(Number.isFinite) && box[2] > box[0] && box[3] > box[1] ? box : []
}
function boxesFromDetections(value: any): number[][] {
  const parsed = parseJsonish(value, value)
  if (parsed == null || parsed === '') return []
  if (Array.isArray(parsed)) {
    if (parsed.length >= 4 && parsed.slice(0, 4).every((item: any) => Number.isFinite(Number(item))) && typeof parsed[0] !== 'object') {
      const box = normalizeBox(parsed)
      return box.length === 4 ? [box] : []
    }
    return parsed.flatMap((item: any) => boxesFromDetections(item)).filter((box: number[]) => box.length === 4)
  }
  if (parsed && typeof parsed === 'object') {
    const grouped = parsed.detections || parsed.targets || parsed.boxes || parsed.bboxes || parsed.items
    if (grouped) return boxesFromDetections(grouped)
    const box = normalizeBox(parsed)
    return box.length === 4 ? [box] : []
  }
  return []
}
function boxIou(a: number[], b: number[]) {
  const x1 = Math.max(a[0], b[0])
  const y1 = Math.max(a[1], b[1])
  const x2 = Math.min(a[2], b[2])
  const y2 = Math.min(a[3], b[3])
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1])
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
  const union = areaA + areaB - inter
  return union > 0 ? inter / union : 0
}
function dedupeBoxes(boxes: number[][]) {
  return boxes.reduce((acc: number[][], box: number[]) => {
    if (!acc.some((existing) => boxIou(existing, box) >= 0.75)) acc.push(box)
    return acc
  }, [])
}
function bbox(row: any): number[] {
  return normalizeBox(row?.l2_bbox || row?.l2_output?.bbox || row?.bbox || row?.bbox_json || row?.l1_bbox)
}
function hasBbox(row: any) { const [x1, y1, x2, y2] = bbox(row); return x2 > x1 && y2 > y1 }
function isResolved(row: any) {
  const reasoning = `${row?.reasoning || ''} ${row?.rule_result?.reasoning || ''}`
  return row?.alarm_status === 'resolved'
    || row?.event_status === 'closed'
    || row?.l2_output?.final_decision === 'resolved'
    || reasoning.includes('报警已消除')
    || reasoning.includes('未发现饮品容器')
}
function targetBoxes(row: any): number[][] {
  const boxes = [
    ...boxesFromDetections(row?.current_targets),
    ...boxesFromDetections(row?.targets),
    ...boxesFromDetections(row?.historical_targets),
    ...boxesFromDetections(row?.l2_detections || row?.l2Detections),
    ...boxesFromDetections(row?.historical_l2_detections),
    ...boxesFromDetections(row?.l2_output?.detections || row?.l2_output?.targets),
    ...boxesFromDetections(row?.l1_detections || row?.l1Detections),
    ...boxesFromDetections(row?.historical_l1_detections),
    ...boxesFromDetections(row?.l1_output?.detections || row?.l1_output?.targets),
    normalizeBox(row?.l2_bbox || row?.l2_output?.bbox),
    normalizeBox(row?.bbox || row?.bbox_json),
    normalizeBox(row?.historical_bbox),
    normalizeBox(row?.l1_bbox || row?.l1_output?.bbox),
  ].filter((box) => box.length === 4)
  const unique = dedupeBoxes(boxes)
  return unique.length ? unique : (hasBbox(row) ? [bbox(row)] : [])
}
function targetSummary(row: any) {
  if (isResolved(row)) return '无当前风险目标（报警已消除）'
  const rawTargets = [
    ...(parseJsonish(row?.targets, []) || []),
    ...(parseJsonish(row?.current_targets, []) || []),
    ...(parseJsonish(row?.l2_detections || row?.l2Detections, []) || []),
    ...(parseJsonish(row?.l2_output?.detections || row?.l2_output?.targets, []) || []),
  ].filter((item: any) => item && typeof item === 'object')
  const targets = rawTargets.reduce((acc: any[], target: any) => {
    const box = normalizeBox(target?.bbox || target?.box || target?.xyxy)
    if (box.length && acc.some((item) => boxIou(normalizeBox(item?.bbox || item?.box || item?.xyxy), box) >= 0.75)) return acc
    acc.push(target)
    return acc
  }, [])
  if (!targets.length) return row?.target_count ? `${row.target_count} 个饮品容器` : '1 个饮品容器'
  const counts: Record<string, number> = {}
  targets.forEach((target: any) => { const name = target?.class_name || 'drink_container'; counts[name] = (counts[name] || 0) + 1 })
  return Object.entries(counts).map(([name, count]) => `${name} × ${count}`).join('，')
}
function l2DecisionText(row: any) {
  if (isResolved(row)) return '报警已消除'
  return row?.l2_output?.final_decision || '-'
}
async function confirm(id: string) { await api.post(`/alarms/${id}/confirm`); await load() }
async function reject(id: string) { await api.post(`/alarms/${id}/reject`); await load() }
async function ignore(id: string) { await api.post(`/alarms/${id}/ignore`); await load() }
function alarmStatusText(status: string) {
  return ({ unconfirmed: '未确认', effective: '有效', handled: '已处理', false_alarm: '误报', ignored: '忽略', resolved: '报警已消除' } as any)[status] || status || '-'
}
onMounted(load)
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
.panel { border-radius:8px; border:1px solid #dbe4ef; }
.pagination { display:flex; justify-content:flex-end; padding-top:16px; }
.detail-wrap { min-height:260px; }
.detail { display:grid; grid-template-columns:minmax(0, 1fr) 390px; gap:20px; align-items:start; }
.evidence-panel { min-width:0; }
.evidence-title { display:flex; align-items:baseline; gap:10px; margin:0 0 10px; color:#475569; }
.evidence-title strong { color:#1e293b; font-size:16px; }
.evidence-title span { font-size:12px; }
.evidence-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:14px; }
.frame-card { min-width:0; margin:0; border:1px solid #dbe4ef; border-radius:10px; overflow:hidden; background:#fff; }
.frame-card figcaption { display:flex; justify-content:space-between; gap:8px; padding:10px 12px; color:#334155; font-size:13px; }
.frame-card figcaption span { color:#64748b; font-size:12px; white-space:nowrap; }
.snapshot { aspect-ratio:16 / 9; min-height:260px; border-radius:0; background:#1e293b; color:#cbd5e1; display:grid; place-items:center; position:relative; overflow:hidden; }
.snapshot svg { width:100%; height:100%; display:block; }
.snapshot span { position:relative; background:#0f172acc; padding:4px 8px; border-radius:6px; }
.bbox { fill:none; stroke:#f59e0b; stroke-width:7; rx:3; }
.detail-side { min-width:0; border:1px solid #dbe4ef; border-radius:10px; overflow:hidden; background:#fff; }
.detail-side h3 { margin:0; padding:13px 16px; font-size:16px; color:#1e293b; border-bottom:1px solid #e2e8f0; }
.hint { margin-left:8px; color:#64748b; font-size:12px; line-height:1.5; }
@media (max-width: 1000px) {
  .detail { grid-template-columns:1fr; }
  .snapshot { min-height:200px; }
}
@media (max-width: 680px) {
  .evidence-grid { grid-template-columns:1fr; }
  .evidence-title { align-items:flex-start; flex-direction:column; gap:2px; }
}
</style>
