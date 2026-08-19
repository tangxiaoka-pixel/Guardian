<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>大屏展示</h2>
        <p>大屏采用行业模板 + 项目配置，不为每个客户重新开发。</p>
      </div>
      <el-button type="primary" @click="openDashboard">打开项目大屏</el-button>
    </header>

    <div class="templates">
      <el-card v-for="tpl in templates" :key="tpl.type" class="panel" shadow="never">
        <template #header>{{ tpl.name }}</template>
        <p>{{ tpl.desc }}</p>
        <el-tag :type="tpl.enabled ? 'success' : 'info'">{{ tpl.enabled ? '当前可用' : '预留模板' }}</el-tag>
      </el-card>
    </div>

    <el-card class="panel" shadow="never">
      <template #header>项目大屏配置项</template>
      <div class="config-grid">
        <div v-for="item in configItems" :key="item"><span>{{ item }}</span><el-tag size="small">可配置</el-tag></div>
      </div>
    </el-card>
  </section>
</template>

<script setup lang="ts">
const templates = [
  { type: 'community', name: '社区版大屏', desc: '适合物业社区：电梯、电瓶车、消防通道、垃圾点、危险区域。', enabled: true },
  { type: 'site', name: '工地版大屏', desc: '适合智慧工地：塔吊、扬尘、噪音、人员违规、车辆通道。', enabled: false },
  { type: 'park', name: '园区版大屏', desc: '适合产业园区：周界、消防、车辆、访客和 IoT 设备。', enabled: false },
]
const configItems = ['项目名称', '项目封面 / 地图 / 平面图', '展示指标开关', '告警类型开关', '点位分布', '设备在线率', '今日事件', '趋势图周期']
function openDashboard() {
  window.open('/dashboard/', '_blank')
}
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
.page-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
.templates { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
.panel { border-radius:8px; border:1px solid #dbe4ef; }
.config-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
.config-grid div { display:flex; justify-content:space-between; gap:8px; align-items:center; padding:10px; border:1px solid #e2e8f0; border-radius:8px; background:#f8fafc; }
@media (max-width:1100px) { .templates,.config-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
</style>
