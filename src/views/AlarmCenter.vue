<template>
  <section class="page">
    <header><h2>告警中心</h2><p>告警是 AI / IoT / 人工上报产生的原始风险信号；这里负责看见风险、确认风险。</p></header>
    <el-card class="panel" shadow="never">
      <el-table :data="alarms" stripe>
        <el-table-column prop="alarm_id" label="alarm" width="110" />
        <el-table-column prop="event_id" label="event" width="110" />
        <el-table-column prop="channel_id" label="channel" width="90" />
        <el-table-column prop="alarm_type" label="风险类型" width="150" />
        <el-table-column prop="location" label="点位" min-width="160" />
        <el-table-column prop="alarm_status" label="告警状态" width="120"><template #default="{ row }"><el-tag>{{ alarmStatusText(row.alarm_status) }}</el-tag></template></el-table-column>
        <el-table-column prop="timestamp" label="timestamp" min-width="220" />
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
    </el-card>
    <el-dialog v-model="visible" title="告警详情" width="820px">
      <div v-if="selected" class="detail">
        <div class="snapshot">
          <svg v-if="selected.snapshot || selected.snapshot_url" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet" aria-label="告警关键帧">
            <image :href="selected.snapshot || selected.snapshot_url" x="0" y="0" width="1280" height="720" preserveAspectRatio="none" />
            <rect v-for="(box, index) in targetBoxes(selected)" :key="index" :x="box[0]" :y="box[1]" :width="box[2] - box[0]" :height="box[3] - box[1]" class="bbox" />
          </svg>
          <span v-else>暂无可显示的告警图片</span>
        </div>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="L1 输出">{{ selected.l1_output.class_name }} {{ selected.l1_output.confidence }}</el-descriptions-item>
          <el-descriptions-item label="L2 输出">{{ l2DecisionText(selected) }}</el-descriptions-item>
          <el-descriptions-item label="当前风险目标">{{ targetSummary(selected) }}</el-descriptions-item>
          <el-descriptions-item label="规则判断">{{ JSON.stringify(selected.rule_result) }}</el-descriptions-item>
          <el-descriptions-item label="客户反馈">{{ selected.feedback_result || '未反馈' }}</el-descriptions-item>
          <el-descriptions-item label="处理记录">{{ selected.human_records.length }}</el-descriptions-item>
        </el-descriptions>
      </div>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '../api'

const alarms = ref<any[]>([])
const selected = ref<any>(null)
const visible = ref(false)
const customerId = localStorage.getItem('guardian_customer_id') || ''
const siteId = localStorage.getItem('guardian_site_id') || ''
async function load() {
  const rows = (await api.get('/alarms', { params: { customer_id: customerId, site_id: siteId } })).data
  alarms.value = rows.filter((item: any) => !item.site_id || item.site_id === siteId)
}
function open(row: any) { selected.value = row; visible.value = true }
function parseJsonish(value: any, fallback: any = null): any {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value
  if (typeof value === 'string' && value.trim()) {
    try { return JSON.parse(value) } catch (_) {}
  }
  return fallback
}
function normalizeBox(value: any): number[] {
  const parsed = parseJsonish(value, value)
  if (!Array.isArray(parsed) || parsed.length < 4) return []
  const box = parsed.slice(0, 4).map(Number)
  return box.every(Number.isFinite) && box[2] > box[0] && box[3] > box[1] ? box : []
}
function boxesFromDetections(value: any): number[][] {
  const parsed = parseJsonish(value, value)
  if (!Array.isArray(parsed)) return []
  return parsed.map((item: any) => normalizeBox(item?.bbox || item?.box || item?.xyxy || item)).filter((box: number[]) => box.length === 4)
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
  if (isResolved(row)) return []
  const boxes = [
    ...boxesFromDetections(row?.targets),
    ...boxesFromDetections(row?.current_targets),
    ...boxesFromDetections(row?.l2_detections || row?.l2Detections),
    ...boxesFromDetections(row?.l2_output?.detections || row?.l2_output?.targets),
    ...boxesFromDetections(row?.l1_detections || row?.l1Detections),
    ...boxesFromDetections(row?.l1_output?.detections || row?.l1_output?.targets),
    normalizeBox(row?.l2_bbox || row?.l2_output?.bbox),
    normalizeBox(row?.bbox || row?.bbox_json),
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
.detail { display:grid; grid-template-columns:300px 1fr; gap:16px; }
.snapshot { min-height:220px; border-radius:8px; background:#1e293b; color:#cbd5e1; display:grid; place-items:center; position:relative; overflow:hidden; }
.snapshot svg { width:100%; height:100%; display:block; }
.snapshot span { position:relative; background:#0f172acc; padding:4px 8px; border-radius:6px; }
.bbox { fill:none; stroke:#f59e0b; stroke-width:7; rx:3; }
</style>
