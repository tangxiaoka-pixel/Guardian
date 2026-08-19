<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>设备状态</h2>
        <p>客户只看设备是否健康、是否在线、最后同步时间和绑定关系；底层运维细节保留在平台后台。</p>
      </div>
      <el-tag :type="gatewayHealth === 'normal' ? 'success' : 'warning'">系统健康：{{ gatewayHealthText }}</el-tag>
    </header>

    <div class="health-grid">
      <el-card class="panel" shadow="never">
        <template #header>边缘网关状态</template>
        <div class="gateway-card">
          <strong>{{ gateway?.name || 'RK3568 / KKOS 网关' }}</strong>
          <el-tag :type="gateway?.online_status === 'online' ? 'success' : 'danger'">{{ gateway?.online_status || 'unknown' }}</el-tag>
          <p>下挂设备 {{ kkosSummary?.child_devices || 0 }} · 今日上传告警 {{ todayAlarms.length }} · 最近同步 {{ gateway?.last_seen_at || '-' }}</p>
          <p>服务健康：{{ gatewayHealthText }} · 模型版本：{{ gateway?.kkos_version || '-' }}</p>
        </div>
      </el-card>
      <el-card class="panel" shadow="never">
        <template #header>在线率</template>
        <div class="rates">
          <div><strong>{{ deviceOnlineRate }}%</strong><span>设备在线率</span></div>
          <div><strong>{{ cameraOnlineRate }}%</strong><span>摄像头在线率</span></div>
        </div>
      </el-card>
    </div>

    <el-card class="panel" shadow="never">
      <template #header>客户设备</template>
      <el-table :data="devices" stripe>
        <el-table-column prop="device_name" label="设备" min-width="220" />
        <el-table-column prop="device_type" label="类型" width="120" />
        <el-table-column prop="role" label="角色" width="100" />
        <el-table-column prop="ip" label="IP" width="140" />
        <el-table-column label="状态" width="180">
          <template #default="{ row }">
            <el-tag :type="deviceStatusTag(row.status)">{{ deviceStatusText(row.status) }}</el-tag>
            <div class="device-sub">{{ row.collect_error || statusSourceText(row.status_source) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="性能" min-width="240">
          <template #default="{ row }">
            <div>{{ perfText(row) }}</div>
            <div class="device-sub">采集：{{ row.health_checked_at || row.last_heartbeat || '未采集' }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="firmware_version" label="版本" min-width="180" />
        <el-table-column prop="last_heartbeat" label="最后心跳" min-width="210" />
      </el-table>
    </el-card>

    <el-card class="panel" shadow="never">
      <template #header>摄像头与点位</template>
      <el-table :data="cameras" stripe>
        <el-table-column prop="camera_name" label="摄像头" min-width="170" />
        <el-table-column prop="location" label="位置" min-width="150" />
        <el-table-column prop="assigned_l1_device_id" label="L1 节点" width="130" />
        <el-table-column prop="assigned_l2_device_id" label="L2 网关" width="130" />
        <el-table-column prop="status" label="状态" width="100" />
      </el-table>
    </el-card>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '../api'

const customerId = localStorage.getItem('guardian_customer_id') || ''
const siteId = localStorage.getItem('guardian_site_id') || ''
const devices = ref<any[]>([])
const cameras = ref<any[]>([])
const todayAlarms = ref<any[]>([])
const kkos = ref<any>({ summary: {}, gateways: [] })

const kkosSummary = computed(() => kkos.value.summary || {})
const gateway = computed(() => (kkos.value.gateways || [])[0])
const gatewayHealth = computed(() => gateway.value?.online_status === 'online' ? 'normal' : 'abnormal')
const gatewayHealthText = computed(() => gatewayHealth.value === 'normal' ? '正常' : '异常')
const deviceOnlineRate = computed(() => rate(devices.value.filter((item) => item.status === 'online').length, devices.value.length))
const cameraOnlineRate = computed(() => rate(cameras.value.filter((item) => item.status === 'online').length, cameras.value.length))

function rate(part: number, total: number) { return total ? Math.round((part / total) * 100) : 100 }
function hasValue(value: any) { return value !== null && value !== undefined && value !== '' }
function deviceStatusText(status: string) {
  return ({ online: '在线', offline: '离线', unknown: '未知', maintenance: '维护', disabled: '禁用' } as any)[status] || status || '未知'
}
function deviceStatusTag(status: string) {
  return status === 'online' ? 'success' : status === 'offline' ? 'danger' : status === 'maintenance' ? 'warning' : 'info'
}
function statusSourceText(source: string) {
  return ({
    kkos_report: 'KKOS 上报',
    kkos_direct: 'KKOS 网关心跳',
    kkos_http: 'KKOS 主动刷新',
    waiting_kkos_report: '等待 KKOS 上报',
    manual: '手工录入',
  } as any)[source] || source || '等待 KKOS 上报'
}
function perfText(row: any) {
  const memory = hasValue(row.memory_usage) ? `Memory ${row.memory_usage}%` : 'Memory 未采集'
  const cma = row.cma_usage ? `CMA ${row.cma_usage}` : 'CMA 未采集'
  const npu = hasValue(row.npu_latency_ms) ? `NPU ${row.npu_latency_ms}ms` : 'NPU 未采集'
  const temp = row.temperature ? `温度 ${row.temperature}` : '温度 未采集'
  return `${memory} · ${cma} · ${npu} · ${temp}`
}
async function load() {
  devices.value = ((await api.get('/managed-devices')).data).filter((item: any) => item.site_id === siteId)
  cameras.value = ((await api.get('/cameras')).data).filter((item: any) => item.site_id === siteId)
  const rows = (await api.get('/alarms', { params: { customer_id: customerId, site_id: siteId } })).data
  todayAlarms.value = rows.filter((item: any) => !item.site_id || item.site_id === siteId)
  kkos.value = (await api.get('/edge-gateways/kkos', { params: { customer_id: customerId } })).data
}
onMounted(load)
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
.page-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
.panel { border-radius:8px; border:1px solid #dbe4ef; }
.health-grid { display:grid; grid-template-columns:1.4fr 1fr; gap:14px; }
.gateway-card { display:flex; flex-direction:column; gap:8px; }
.gateway-card strong { font-size:18px; color:#0f172a; }
.rates { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.rates div { padding:14px; border-radius:8px; background:#f8fafc; border:1px solid #e2e8f0; }
.rates strong { display:block; font-size:28px; color:#0f172a; }
.rates span { color:#64748b; }
.device-sub { margin-top:4px; font-size:12px; color:#94a3b8; line-height:1.3; }
@media (max-width:1000px) { .health-grid { grid-template-columns:1fr; } }
</style>
