<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>{{ site?.site_name || '项目后台' }} · 首页总览</h2>
        <p>项目是当前阶段的授权、交付和现场运营单元；这里聚焦本项目设备、摄像头、告警和事件闭环。</p>
      </div>
      <div class="head-actions">
        <el-tag type="info">{{ customer?.customer_name || '未选择客户' }}</el-tag>
        <el-button @click="leaveProject">返回平台后台</el-button>
      </div>
    </header>

    <div class="metrics">
      <el-card v-for="item in valueMetrics" :key="item.label" class="metric" shadow="never">
        <strong>{{ item.value }}</strong><span>{{ item.label }}</span><small>{{ item.hint }}</small>
      </el-card>
    </div>

    <el-card class="panel" shadow="never">
      <template #header>项目价值指标</template>
      <div v-if="site" class="policy">
        <el-tag type="danger">高风险点位 Top 5：电梯厅、消防通道、危险区域</el-tag>
        <el-tag type="warning">连续异常设备：{{ abnormalDevices }}</el-tag>
        <el-tag type="success">设备在线率：{{ deviceOnlineRate }}%</el-tag>
        <el-tag type="info">摄像头在线率：{{ cameraOnlineRate }}%</el-tag>
      </div>
    </el-card>

    <el-tabs v-model="tab">
      <el-tab-pane label="最近告警" name="alarms">
        <el-table :data="alarms.slice(0, 6)" stripe>
          <el-table-column prop="alarm_type" label="类型" min-width="150" />
          <el-table-column prop="location" label="点位" min-width="150" />
          <el-table-column prop="alarm_status" label="告警状态" width="120" />
          <el-table-column prop="event_status" label="事件状态" width="120" />
          <el-table-column prop="timestamp" label="时间" min-width="210" />
        </el-table>
      </el-tab-pane>
      <el-tab-pane label="项目资料" name="sites">
        <el-table :data="site ? [site] : []" stripe>
          <el-table-column prop="site_name" label="项目" min-width="180" />
          <el-table-column prop="status" label="状态" width="120" />
          <el-table-column label="概况" min-width="320"><template #default="{ row }">摄像头 {{ row.online_camera_count }}/{{ row.camera_count }} · RV1126 {{ row.rv1126_count }} · RK3568 {{ row.rk3568_count }} · 负载 {{ row.capacity_load }}</template></el-table-column>
          <el-table-column prop="address" label="地址" min-width="220" />
        </el-table>
      </el-tab-pane>
      <el-tab-pane label="摄像头 Cameras" name="cameras">
        <el-table :data="cameras" stripe>
          <el-table-column prop="camera_name" label="摄像头" min-width="160" />
          <el-table-column prop="location" label="位置" width="140" />
          <el-table-column prop="rtsp_url" label="RTSP" min-width="260" />
          <el-table-column prop="assigned_l1_device_id" label="L1" width="120" />
          <el-table-column prop="assigned_l2_device_id" label="L2" width="120" />
          <el-table-column prop="status" label="状态" width="100" />
        </el-table>
      </el-tab-pane>
      <el-tab-pane label="运行配置 Runtime" name="runtime">
        <el-table :data="runtimeConfigs" stripe>
          <el-table-column prop="camera_name" label="摄像头" min-width="150" />
          <el-table-column prop="display_name" label="业务场景" min-width="150" />
          <el-table-column label="最终配置" min-width="320"><template #default="{ row }">{{ row.sample_fps }}fps · L1 {{ row.l1_threshold }} · 连续 {{ row.consecutive_frames }} · {{ row.min_duration_sec }}s · CD {{ row.cooldown_sec }}s</template></el-table-column>
          <el-table-column prop="capacity_cost" label="负载" width="100" />
          <el-table-column prop="status" label="状态" width="100" />
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

const router = useRouter()
const tab = ref('alarms')
const customerId = ref(localStorage.getItem('guardian_customer_id') || '')
const siteId = ref(localStorage.getItem('guardian_site_id') || '')
const customers = ref<any[]>([])
const allSites = ref<any[]>([])
const allCameras = ref<any[]>([])
const allDevices = ref<any[]>([])
const allRuntimeConfigs = ref<any[]>([])
const alarms = ref<any[]>([])
const customer = computed(() => customers.value.find((item) => item.customer_id === customerId.value))
const site = computed(() => allSites.value.find((item) => item.site_id === siteId.value))
const cameras = computed(() => allCameras.value.filter((item) => item.site_id === siteId.value))
const devices = computed(() => allDevices.value.filter((item) => item.site_id === siteId.value))
const runtimeConfigs = computed(() => allRuntimeConfigs.value.filter((item) => item.site_id === siteId.value))
const deviceOnlineRate = computed(() => rate(devices.value.filter((item) => item.status === 'online').length, devices.value.length))
const cameraOnlineRate = computed(() => rate(cameras.value.filter((item) => item.status === 'online').length, cameras.value.length))
const pendingEvents = computed(() => alarms.value.filter((item) => !['closed', 'false_alarm', 'ignored'].includes(item.event_status || item.alarm_status)).length)
const closedEvents = computed(() => alarms.value.filter((item) => item.event_status === 'closed').length)
const closureRate = computed(() => rate(closedEvents.value, alarms.value.length))
const abnormalDevices = computed(() => devices.value.filter((item) => item.status !== 'online').length)
const valueMetrics = computed(() => [
  { label: '今日风险发现数', value: alarms.value.length, hint: 'AI / IoT / 人工上报' },
  { label: '待处理事件数', value: pendingEvents.value, hint: '需要确认或处理' },
  { label: '平均响应时长', value: '8min', hint: '试点默认统计' },
  { label: '事件闭环率', value: `${closureRate.value}%`, hint: '已关闭 / 全部事件' },
  { label: '设备在线率', value: `${deviceOnlineRate.value}%`, hint: '网关 / 节点 / 传感器' },
  { label: '误报反馈数', value: alarms.value.filter((item) => item.alarm_status === 'false_alarm').length, hint: '客户反馈会用于持续优化' },
])

function rate(part: number, total: number) { return total ? Math.round((part / total) * 100) : 100 }
function leaveProject() {
  localStorage.setItem('guardian_console_mode', 'platform')
  localStorage.removeItem('guardian_customer_id')
  localStorage.removeItem('guardian_customer_name')
  localStorage.removeItem('guardian_site_id')
  localStorage.removeItem('guardian_site_name')
  window.dispatchEvent(new Event('guardian-session-change'))
  router.push('/dashboard')
}
async function load() {
  customers.value = (await api.get('/customers')).data
  allSites.value = (await api.get('/sites')).data
  allCameras.value = (await api.get('/cameras')).data
  allDevices.value = (await api.get('/managed-devices')).data
  allRuntimeConfigs.value = (await api.get('/runtime-configs')).data
  const rows = (await api.get('/alarms', { params: { customer_id: customerId.value, site_id: siteId.value } })).data
  alarms.value = rows.filter((item: any) => !item.site_id || item.site_id === siteId.value)
}
function onDataPolicyChange(event: Event) {
  const detail = (event as CustomEvent).detail || {}
  if (!detail.customer_id || detail.customer_id === customerId.value) load()
}
onMounted(() => {
  window.addEventListener('guardian-data-policy-change', onDataPolicyChange)
  load()
})
onBeforeUnmount(() => window.removeEventListener('guardian-data-policy-change', onDataPolicyChange))
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
.page-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
.head-actions { display:flex; align-items:center; gap:10px; }
.metrics { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:12px; }
.metric { border-radius:8px; border:1px solid #dbe4ef; }
.metric strong { display:block; font-size:24px; }
.metric span { color:#64748b; }
.metric small { display:block; color:#94a3b8; margin-top:6px; }
.panel { border-radius:8px; border:1px solid #dbe4ef; }
.policy { display:flex; gap:10px; flex-wrap:wrap; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
</style>
