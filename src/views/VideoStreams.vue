<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>视频接入 Video Streams</h2>
        <p>摄像头实时预览走 KKOS 转码；云端只展示状态、快照、绑定关系和必要的播放入口。</p>
      </div>
      <el-button @click="load">刷新</el-button>
    </header>

    <el-alert
      type="info"
      :closable="false"
      title="实时播放边界：浏览器不直接播放 RTSP，也不让腾讯云直接拉现场内网摄像头；由 RK3568/KKOS 把 RTSP 转成可预览流，再经 Guardian Cloud 同源代理展示。"
    />

    <div class="cards">
      <el-card v-for="s in streams" :key="s.camera_id" class="stream-card" shadow="never">
        <template #header>
          <div class="card-head">
            <div>
              <strong>{{ s.name }}</strong>
              <small>{{ s.location || s.camera_id }}</small>
            </div>
            <el-tag :type="s.online_status === 'online' ? 'success' : 'info'">{{ statusText(s.online_status) }}</el-tag>
          </div>
        </template>

        <div class="live-box">
          <img v-if="liveEnabled(s)" class="live-stream" :src="liveUrl(s)" :alt="s.name" @error="markLiveFailed(s)" />
          <img v-else-if="s.snapshot_url" class="snapshot" :src="snapshotUrl(s)" :alt="s.name" @error="s.snapshot_failed = true" />
          <div v-if="!liveEnabled(s) || s.live_failed" class="live-mask">
            <strong>{{ liveTitle(s) }}</strong>
            <span>{{ liveNote(s) }}</span>
            <el-button v-if="s.snapshot_url" size="small" @click="refreshSnapshot(s)">刷新快照</el-button>
          </div>
          <div v-if="s.pipeline_enabled" class="roi" />
          <span class="scene">{{ s.algorithm }}</span>
        </div>

        <div class="kv"><span>RTSP</span><b>{{ s.rtsp_url || '-' }}</b></div>
        <div class="kv"><span>状态来源</span><b>{{ sourceText(s.status_source) }}</b></div>
        <div class="kv"><span>L1 哨兵</span><b>{{ s.l1_device }} · {{ statusText(s.l1_status) }}</b></div>
        <div class="kv"><span>L2 网关</span><b>{{ s.l2_device }} · {{ statusText(s.l2_status) }}</b></div>
        <div class="kv"><span>播放服务</span><b>{{ s.live?.gateway_name || s.live?.gateway_id || '等待 KKOS' }}</b></div>

        <div class="numbers">
          <span>抽帧 {{ metric(s.sample_fps, 'FPS') }}</span>
          <span>推理 {{ metric(s.effective_inferences, '次') }}</span>
          <span>延迟 {{ metric(s.latency_ms, 'ms') }}</span>
          <span>重连 {{ metric(s.reconnect_count, '次') }}</span>
        </div>

        <div v-if="s.latest_candidate" class="candidate">
          最近 candidate：{{ s.latest_candidate }} · {{ s.latest_candidate_class || '-' }} {{ s.latest_candidate_confidence || '' }}
        </div>
        <div v-else class="candidate muted">暂无 candidate</div>

        <div class="actions">
          <el-button size="small" :disabled="!s.live?.mjpeg_proxy_url" @click="openLive(s)">打开实时播放</el-button>
          <el-button size="small" :disabled="!s.snapshot_url" @click="refreshSnapshot(s)">刷新快照</el-button>
        </div>
      </el-card>
    </div>

    <el-empty v-if="!streams.length" description="当前项目还没有确认入库的摄像头" />
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import api, { apiPublicUrl } from '../api'

const customerId = localStorage.getItem('guardian_customer_id') || ''
const siteId = localStorage.getItem('guardian_site_id') || ''
const streams = ref<any[]>([])
let timer: number | undefined

async function load() {
  const { data } = await api.get('/streams', { params: { customer_id: customerId, site_id: siteId } })
  streams.value = data.map((item: any) => ({ ...item, preview_seq: Date.now(), live_failed: false, snapshot_failed: false }))
}

function liveEnabled(row: any) {
  return row.online_status === 'online' && row.live?.mjpeg_proxy_url && !row.live_failed
}

function liveUrl(row: any) {
  return apiPublicUrl(`${row.live.mjpeg_proxy_url}&t=${row.preview_seq || Date.now()}`)
}

function snapshotUrl(row: any) {
  return apiPublicUrl(`${row.snapshot_url}${row.snapshot_url.includes('?') ? '&' : '?'}t=${row.preview_seq || Date.now()}`)
}

function refreshSnapshot(row: any) {
  row.live_failed = true
  row.preview_seq = Date.now()
}

function markLiveFailed(row: any) {
  row.live_failed = true
}

function openLive(row: any) {
  window.open(liveUrl(row), '_blank')
}

function statusText(status = '') {
  const map: Record<string, string> = { online: '在线', offline: '离线', unknown: '未知', '-': '-' }
  return map[status] || status || '-'
}

function sourceText(source = '') {
  const map: Record<string, string> = {
    kkos_discovery: 'KKOS 发现/探测',
    kkos_discovery_stale: 'KKOS 状态过期',
    waiting_kkos_camera_report: '等待 KKOS 上报',
    cloud_rtsp_probe: '云端探测',
    cloud_rtsp_probe_failed: '云端探测失败',
  }
  return map[source] || source || '-'
}

function metric(value: any, unit: string) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? `${n}${unit}` : '-'
}

function liveTitle(row: any) {
  if (row.online_status !== 'online') return '摄像头离线'
  if (row.live_failed) return '实时播放暂不可用'
  return '等待实时播放'
}

function liveNote(row: any) {
  if (row.online_status !== 'online') return row.collect_error || 'KKOS 未确认该摄像头在线'
  if (row.live_failed) return '已回退到 KKOS 快照；需要确认 KKOS 是否已开启 MJPEG/HLS/WebRTC 转码服务'
  return row.live?.note || '等待 KKOS 提供实时播放流'
}

onMounted(() => {
  load()
  timer = window.setInterval(load, 5000)
})
onUnmounted(() => { if (timer) window.clearInterval(timer) })
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
.page-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
.cards { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:14px; }
.stream-card { border-radius:8px; border:1px solid #dbe4ef; }
.card-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
.card-head div { display:flex; flex-direction:column; gap:5px; }
.card-head small { color:#64748b; }
.live-box { height:260px; border-radius:8px; background:#0f172a; position:relative; overflow:hidden; color:#e2e8f0; display:grid; place-items:center; }
.live-stream,.snapshot { width:100%; height:100%; object-fit:cover; display:block; }
.live-mask { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:center; align-items:center; gap:10px; padding:24px; text-align:center; background:rgba(15,23,42,.62); }
.live-mask span { color:#cbd5e1; font-size:13px; line-height:1.6; }
.scene { position:absolute; left:12px; top:12px; background:#0f172acc; padding:4px 8px; border-radius:6px; font-size:12px; }
.roi { position:absolute; inset:32px 46px; border:2px solid #38bdf8; pointer-events:none; }
.kv { display:grid; grid-template-columns:80px 1fr; gap:8px; margin-top:10px; font-size:13px; }
.kv span { color:#64748b; } .kv b { color:#0f172a; overflow-wrap:anywhere; font-weight:600; }
.numbers { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin:12px 0; color:#334155; font-size:12px; }
.candidate { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; color:#334155; font-size:12px; padding:9px 10px; }
.candidate.muted { color:#94a3b8; }
.actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
@media (max-width: 1000px) { .cards { grid-template-columns:1fr; } .page-head { flex-direction:column; } }
</style>
