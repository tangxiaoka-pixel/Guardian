<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>事件处理</h2>
        <p>告警是原始风险信号，事件是确认后进入派单、处理、复核、关闭的管理对象。</p>
      </div>
      <el-tag type="info">项目后台：{{ siteName }}</el-tag>
    </header>

    <el-card class="panel" shadow="never">
      <template #header>事件状态机</template>
      <div class="state-flow">
        <span>告警产生</span><b>→</b><span>待确认</span><b>→</b><span>有效事件 / 误报 / 忽略</span><b>→</b><span>派单</span><b>→</b><span>处理</span><b>→</b><span>复核</span><b>→</b><span>关闭</span>
      </div>
    </el-card>

    <div class="metrics">
      <el-card v-for="item in metrics" :key="item.label" class="metric" shadow="never">
        <strong>{{ item.value }}</strong><span>{{ item.label }}</span>
      </el-card>
    </div>

    <el-card class="panel" shadow="never">
      <template #header>待处理事件</template>
      <el-table :data="events" stripe>
        <el-table-column prop="event_id" label="event" width="140" />
        <el-table-column prop="alarm_type" label="风险类型" min-width="150" />
        <el-table-column prop="location" label="点位" min-width="160" />
        <el-table-column prop="event_status" label="事件状态" width="130">
          <template #default="{ row }"><el-tag>{{ eventStatusText(row.event_status) }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="assignee" label="处理人" width="120" />
        <el-table-column prop="timestamp" label="时间" min-width="210" />
        <el-table-column label="操作" width="360">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="act(row, 'dispatch')">派单</el-button>
            <el-button size="small" @click="act(row, 'start')">处理中</el-button>
            <el-button size="small" type="success" @click="act(row, 'resolve')">待复核</el-button>
            <el-button size="small" type="success" @click="act(row, 'close')">关闭</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const customerId = localStorage.getItem('guardian_customer_id') || ''
const siteId = localStorage.getItem('guardian_site_id') || ''
const siteName = localStorage.getItem('guardian_site_name') || '未选择项目'
const events = ref<any[]>([])

const metrics = computed(() => [
  { label: '待派单', value: count('pending_dispatch') },
  { label: '已派单', value: count('dispatched') },
  { label: '处理中', value: count('processing') },
  { label: '待复核', value: count('pending_review') },
  { label: '已关闭', value: count('closed') },
  { label: '超时', value: events.value.filter((item) => item.overdue).length },
])

function count(status: string) { return events.value.filter((item) => item.event_status === status).length }
function eventStatusText(status: string) {
  return ({ pending_dispatch: '待派单', dispatched: '已派单', processing: '处理中', pending_review: '待复核', closed: '已关闭', timeout: '超时' } as any)[status] || status || '-'
}
async function load() {
  const rows = (await api.get('/events', { params: { customer_id: customerId, site_id: siteId } })).data
  events.value = rows.filter((item: any) => !item.site_id || item.site_id === siteId)
}
async function act(row: any, action: string) {
  const { data } = await api.post(`/events/${row.event_id}/${action}`)
  ElMessage.success(data.message || '事件状态已更新')
  await load()
}
onMounted(load)
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
.page-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
.panel,.metric { border-radius:8px; border:1px solid #dbe4ef; }
.state-flow { display:flex; align-items:center; gap:10px; flex-wrap:wrap; color:#334155; }
.state-flow span { padding:8px 10px; border-radius:999px; background:#f8fafc; border:1px solid #dbe4ef; }
.state-flow b { color:#94a3b8; }
.metrics { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:12px; }
.metric strong { display:block; font-size:24px; }
.metric span { color:#64748b; }
@media (max-width:1100px) { .metrics { grid-template-columns:repeat(3,minmax(0,1fr)); } }
</style>
