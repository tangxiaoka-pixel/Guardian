<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>L1 初筛监控 RV1126</h2>
        <p>观察 RV1126 多路抽帧、RKNN 初筛、候选事件生成和自动发送 L2 的状态。</p>
      </div>
      <div class="head-actions">
        <el-tag type="success" effect="light">实时刷新 · 1 秒</el-tag>
        <el-button @click="load">刷新</el-button>
      </div>
    </header>
    <div class="metrics">
      <el-card v-for="d in devices" :key="d.device_id" class="metric" shadow="never">
        <strong>{{ d.device_name || d.device_id }}</strong>
        <span>{{ d.ip }} · {{ d.current_model_version || d.model_version || '未上报模型版本' }}</span>
        <div>
          状态 {{ d.online_status || d.status }}
          · 来源 {{ sourceText(d.status_source) }}
          · 服务 {{ d.service_status || d.gateway_status || '-' }}
          · 内存 {{ fmtMetric(d.memory_usage, '%') }}
          · CMA {{ d.cma_usage || '-' }}
        </div>
        <small v-if="d.collect_error">{{ d.collect_error }}</small>
      </el-card>
      <el-empty v-if="!devices.length" description="当前项目没有已确认入库的 L1/RV1126 设备" />
    </div>
    <el-card class="panel" shadow="never">
      <template #header>L1 抽帧与推理统计</template>
      <el-table :data="channelStats" stripe empty-text="暂未收到 KKOS 同步的 L1 统计日志">
        <el-table-column prop="channel_name" label="通道" width="130" />
        <el-table-column label="时间" width="175"><template #default="{ row }">{{ formatTime(row.timestamp) }}</template></el-table-column>
        <el-table-column prop="algorithm" label="算法" width="170" />
        <el-table-column prop="frames" label="总抽帧" width="100" />
        <el-table-column prop="effective_inferences" label="有效推理" width="110" />
        <el-table-column prop="skipped_static" label="静态跳过" width="110" />
        <el-table-column prop="candidate_frames" label="隐患帧" width="100" />
        <el-table-column label="推理率" width="100">
          <template #default="{ row }">{{ rate(row.effective_inferences, row.frames) }}</template>
        </el-table-column>
        <el-table-column prop="loop_ms" label="循环耗时(ms)" width="110" />
        <el-table-column prop="reconnects" label="重连" width="80" />
        <el-table-column label="触发次数" min-width="180">
          <template #default="{ row }">{{ triggerText(row.triggers) }}</template>
        </el-table-column>
      </el-table>
    </el-card>
    <el-card class="panel" shadow="never">
      <template #header>真实 L1 有效推理明细</template>
      <el-table :data="pagedFrameResults" stripe empty-text="暂未收到 KKOS 同步的 L1 推理日志">
        <el-table-column label="推理时间" width="175"><template #default="{ row }">{{ formatTime(row.timestamp) }}</template></el-table-column>
        <el-table-column prop="channel_name" label="通道" width="130" />
        <el-table-column prop="algorithm" label="算法" width="170" />
        <el-table-column prop="class_name" label="类别" width="150" />
        <el-table-column label="记录类型" width="170"><template #default="{ row }">{{ sampleTypeText(row.sample_type) }}</template></el-table-column>
        <el-table-column label="合并推理帧" width="115"><template #default="{ row }">{{ row.inference_count || 1 }} 帧</template></el-table-column>
        <el-table-column label="置信度 / 阈值" width="150">
          <template #default="{ row }">{{ row.score.toFixed(3) }} / {{ row.threshold.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column prop="inference_ms" label="推理耗时(ms)" width="120" />
        <el-table-column prop="source" label="来源" width="110" />
        <el-table-column label="判定" width="120">
          <template #default="{ row }">
            <el-tag :type="row.decision === 'candidate' ? 'danger' : 'info'" size="small">{{ decisionText(row.decision) }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="frameResults.length" class="table-pagination">
        <span>共 {{ frameResults.length }} 条真实推理记录</span>
        <el-pagination v-model:current-page="framePage" :page-size="framePageSize" :total="frameResults.length" layout="prev, pager, next" small />
      </div>
    </el-card>
    <el-card class="panel" shadow="never">
      <template #header>
        <div class="panel-title"><span>真实候选事件列表</span><small>仅显示命中候选与定时审计样本，不等同于每次 L1 推理。</small></div>
      </template>
      <el-table :data="candidates" stripe empty-text="真实 candidate 当前为 0：L1 未命中 target_classes/threshold，或 KKOS 尚未同步 candidate 日志">
        <el-table-column prop="event_id" label="事件 ID" width="110" />
        <el-table-column label="时间" width="175"><template #default="{ row }">{{ formatTime(row.timestamp) }}</template></el-table-column>
        <el-table-column prop="channel_id" label="通道" width="90" />
        <el-table-column prop="algorithm" label="算法" width="150" />
        <el-table-column prop="class_name" label="类别" width="150" />
        <el-table-column prop="confidence" label="置信度" width="90" />
        <el-table-column label="bbox" width="160"><template #default="{ row }">{{ row.bbox.join(',') }}</template></el-table-column>
        <el-table-column label="图片" width="150">
          <template #default="{ row }">
            <button class="thumb-button" @click="view(row)">
              <img class="thumb" :src="frameUrl(row)" :alt="row.event_id" />
              <span v-if="hasBbox(row)" class="mini-bbox" :style="bboxStyle(row)" />
            </button>
          </template>
        </el-table-column>
        <el-table-column prop="frame_path" label="归档路径" min-width="220">
          <template #default="{ row }"><span class="path-text">{{ row.frame_path }}</span></template>
        </el-table-column>
        <el-table-column label="后续处理" width="180"><template #default="{ row }">{{ nextStepText(row.l2_status) }}</template></el-table-column>
        <el-table-column label="操作" width="140">
          <template #default="{ row }">
            <el-button size="small" @click="view(row)">查看大图</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    <el-dialog v-model="viewerOpen" title="L1 候选事件原图与检测框" width="96%" top="3vh">
      <div v-if="selected" class="viewer">
        <div class="image-wrap">
          <div class="image-canvas">
            <img :src="frameUrl(selected)" alt="" />
            <div v-if="hasBbox(selected)" class="bbox-overlay" :style="bboxStyle(selected)" />
          </div>
        </div>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="事件 ID">{{ selected.event_id }}</el-descriptions-item>
          <el-descriptions-item label="通道">{{ selected.channel_id }}</el-descriptions-item>
          <el-descriptions-item label="算法">{{ selected.algorithm }}</el-descriptions-item>
          <el-descriptions-item label="类别">{{ selected.class_name }} {{ Number(selected.confidence || 0).toFixed(3) }}</el-descriptions-item>
          <el-descriptions-item label="bbox">{{ selected.bbox?.join(', ') }}</el-descriptions-item>
          <el-descriptions-item label="L2">{{ selected.l2_status }}</el-descriptions-item>
          <el-descriptions-item label="frame_path" :span="2">{{ selected.frame_path }}</el-descriptions-item>
          <el-descriptions-item label="预览说明" :span="2">候选原图已归档时显示原图；归档不可读时回退显示当前摄像头画面。</el-descriptions-item>
        </el-descriptions>
      </div>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import api, { apiPublicUrl } from '../api'

const siteId = localStorage.getItem('guardian_site_id') || ''
const candidates = ref<any[]>([])
const devices = ref<any[]>([])
const frameResults = ref<any[]>([])
const channelStats = ref<any[]>([])
const framePage = ref(1)
const framePageSize = 20
const viewerOpen = ref(false)
const selected = ref<any>(null)
let timer: number | undefined
let loading = false
const pagedFrameResults = computed(() => {
  const start = (framePage.value - 1) * framePageSize
  return frameResults.value.slice(start, start + framePageSize)
})
async function load() {
  if (loading) return
  loading = true
  try {
    const [candidateRes, frameRes, statsRes, devicesRes] = await Promise.all([
      api.get('/l1/candidates'), api.get('/l1/frame-results'), api.get('/l1/channel-stats'), api.get('/managed-devices'),
    ])
    candidates.value = candidateRes.data
    frameResults.value = frameRes.data
    const lastPage = Math.max(1, Math.ceil(frameResults.value.length / framePageSize))
    if (framePage.value > lastPage) framePage.value = lastPage
    channelStats.value = statsRes.data
    devices.value = (devicesRes.data as any[]).filter((d) => {
      const isL1 = d.role === 'l1' || String(d.device_type || '').includes('rv1126') || String(d.device_type || '').includes('rv1106')
      return isL1 && (!siteId || d.site_id === siteId)
    })
  } finally { loading = false }
}
function view(row: any) { selected.value = row; viewerOpen.value = true }
function formatTime(value: any) { if (!value) return '-'; const numeric = Number(value); const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(value); return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false }) }
function decisionText(value: string) { return value === 'model_hit' ? '模型命中' : value === 'candidate' ? '候选事件' : value === 'no_trigger' ? '未触发' : value || '-' }
function sampleTypeText(value = '') { return value === 'periodic_miss_guard' ? '定时审计样本' : value === 'l1_model_hit' ? '模型命中确认帧' : value === 'l1_no_trigger' ? '未触发推理帧' : '-' }
function nextStepText(value = '') { return value === 'periodic_audit_sample' ? '审计 / 训练样本队列' : value === 'auto_sent_to_l2' ? '已发送 L2 复核' : value || '-' }
function rate(value: number, total: number) {
  return total ? `${Math.round((Number(value || 0) / Number(total || 1)) * 100)}%` : '-'
}
function triggerText(triggers: Record<string, number> = {}) {
  const pairs = Object.entries(triggers)
  return pairs.length ? pairs.map(([key, value]) => `${key}:${value}`).join(' / ') : '-'
}
function sourceText(source = '') {
  const map: Record<string, string> = {
    kkos_report: 'KKOS 上报',
    kkos_report_stale: 'KKOS 上报过期',
    waiting_kkos_report: '等待 KKOS 上报',
    kkos_l1_service_unverified: 'KKOS 未确认服务',
    kkos_direct: 'KKOS 直采',
    kkos_http: 'KKOS API',
  }
  return map[source] || source || '-'
}
function fmtMetric(value: any, suffix = '') {
  if (value === null || value === undefined || value === '') return '-'
  const n = Number(value)
  return Number.isFinite(n) ? `${Math.round(n)}${suffix}` : `${value}${suffix}`
}
function frameUrl(row: any) { return apiPublicUrl(`/api/l1/candidates/${row.event_id}/frame?t=${Date.now()}`) }
function bboxStyle(row: any) {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = row.bbox || []
  const frameW = Number(row.frame_width || 640)
  const frameH = Number(row.frame_height || 360)
  return {
    left: `${(x1 / frameW) * 100}%`,
    top: `${(y1 / frameH) * 100}%`,
    width: `${((x2 - x1) / frameW) * 100}%`,
    height: `${((y2 - y1) / frameH) * 100}%`,
  }
}
function hasBbox(row: any) { const [x1, y1, x2, y2] = row.bbox || []; return Number(x2) > Number(x1) && Number(y2) > Number(y1) }
onMounted(() => { load(); timer = window.setInterval(load, 1000) })
onUnmounted(() => { if (timer) window.clearInterval(timer) })
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
.page-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
.head-actions { display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
.metrics { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:12px; }
.metric { border-radius:8px; border:1px solid #dbe4ef; }
.metric strong,.metric span { display:block; margin-bottom:8px; }
.metric span { color:#64748b; }
.panel { border-radius:8px; border:1px solid #dbe4ef; }
.panel-title { display:flex; align-items:baseline; gap:12px; } .panel-title small { color:#64748b; font-weight:400; }
.table-pagination { display:flex; justify-content:space-between; align-items:center; margin-top:14px; color:#64748b; font-size:13px; }
.thumb { width:120px; height:72px; object-fit:fill; border-radius:6px; border:1px solid #dbe4ef; background:#0f172a; }
.thumb-button { position:relative; border:0; background:transparent; padding:0; cursor:pointer; width:120px; height:72px; display:block; }
.thumb-button .thumb { display:block; }
.mini-bbox { position:absolute; border:2px solid #f59e0b; border-radius:3px; pointer-events:none; box-sizing:border-box; }
.path-text { color:#64748b; font-size:12px; overflow-wrap:anywhere; }
.viewer { display:flex; flex-direction:column; gap:14px; }
.image-wrap { width:100%; height:calc(100vh - 260px); overflow:auto; background:#0f172a; border-radius:8px; display:flex; align-items:center; justify-content:center; }
.image-canvas { position:relative; display:inline-block; max-width:100%; max-height:100%; line-height:0; }
.image-canvas img { display:block; max-width:100%; max-height:calc(100vh - 260px); width:auto; height:auto; }
.bbox-overlay { position:absolute; border:3px solid #f59e0b; pointer-events:none; }
@media (max-width: 900px) { .page-head { flex-direction:column; } .metrics { grid-template-columns:1fr; } }
</style>
