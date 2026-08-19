<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>{{ customerName }} · 客户边缘网关 KKOS</h2>
        <p>一个客户现场绑定一个 RK3568 / KKOS 实例；平台只进入客户后管理该客户的现场 Edge OS。</p>
      </div>
      <el-tag :type="summary?.health_status === 'healthy' ? 'success' : 'warning'" effect="dark">
        {{ summary?.health_status || 'loading' }}
      </el-tag>
    </header>

    <div class="metric-grid">
      <el-card v-for="item in metrics" :key="item.label" class="metric-card" shadow="never">
        <div class="metric-label">{{ item.label }}</div>
        <div class="metric-value">{{ item.value }}</div>
        <div class="metric-hint">{{ item.hint }}</div>
      </el-card>
    </div>

    <el-card class="panel" shadow="never">
      <template #header>产品边界</template>
      <div class="planes">
        <div v-for="plane in planes" :key="plane.name" class="plane">
          <strong>{{ plane.name }}</strong>
          <span>{{ plane.owner }}</span>
          <p>{{ plane.scope }}</p>
        </div>
      </div>
    </el-card>

    <el-tabs v-model="activeTab" class="tabs">
      <el-tab-pane label="网关总览" name="overview">
        <el-card class="panel" shadow="never">
          <template #header>当前客户的 RK3568 KKOS Edge Gateway</template>
          <el-table :data="gateways" stripe>
            <el-table-column prop="name" label="gateway" min-width="190" />
            <el-table-column prop="lan_ip" label="LAN IP" width="130" />
            <el-table-column prop="tailscale_ip" label="Tailscale" width="140" />
            <el-table-column prop="kkos_version" label="KKOS" width="120" />
            <el-table-column prop="brain_version" label="Brain" width="150" />
            <el-table-column prop="last_seen_at" label="last seen" min-width="210" />
            <el-table-column label="资源" min-width="210">
              <template #default="{ row }">
                CPU {{ row.resources.cpu }}% · MEM {{ row.resources.memory }}% · {{ row.resources.temperature }}
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="三条主链路" name="links">
        <div class="link-grid">
          <el-card v-for="link in links" :key="link.link_type" class="panel" shadow="never">
            <template #header>
              <div class="card-head">
                <span>{{ link.name }}</span>
                <el-tag :type="link.status === 'healthy' ? 'success' : 'warning'">{{ link.status }}</el-tag>
              </div>
            </template>
            <div class="link-path">{{ link.path.join(' → ') }}</div>
            <div class="link-stats">
              <span>队列 {{ link.queue_size }}</span>
              <span>成功 {{ link.success_count }}</span>
              <span>失败 {{ link.failed_count }}</span>
            </div>
            <p class="error" v-if="link.last_error">{{ link.last_error }}</p>
          </el-card>
        </div>
      </el-tab-pane>

      <el-tab-pane label="模型单一真源" name="models">
        <el-alert
          title="云端模型仓库是唯一模型源：5090 只能上传到云，云分发到 L2，L2 再转发到 L1。"
          type="info"
          show-icon
          :closable="false"
        />
        <el-card class="panel top-gap" shadow="never">
          <template #header>模型版本与分发状态</template>
          <el-table :data="models" stripe>
            <el-table-column prop="model_name" label="model" min-width="190" />
            <el-table-column prop="target" label="target" width="100" />
            <el-table-column prop="cloud_version" label="cloud source" min-width="180" />
            <el-table-column prop="edge_version" label="edge running" min-width="180" />
            <el-table-column prop="distribution_status" label="status" width="130" />
            <el-table-column prop="updated_at" label="updated" min-width="210" />
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="现场拓扑图" name="topology">
        <el-card class="panel" shadow="never">
          <template #header>Edge Topology Map</template>
          <div class="topology">
            <div class="node cloud">{{ customerName }}<br /><small>Guardian Customer Space</small></div>
            <div class="edge-line" />
            <div class="node kkos">RK3568 KKOS<br /><small>唯一现场出口</small></div>
            <div class="children">
              <div v-for="node in topology" :key="node.id" class="node child" :class="node.type">
                {{ node.name }}<br />
                <small>{{ node.type }} · {{ node.ip || node.protocol }}</small>
              </div>
            </div>
          </div>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="服务与设备" name="services">
        <el-card class="panel" shadow="never">
          <template #header>KKOS 服务状态</template>
          <el-table :data="services" stripe>
            <el-table-column prop="service_name" label="service" min-width="210" />
            <el-table-column prop="status" label="status" width="110" />
            <el-table-column prop="role" label="role" min-width="180" />
            <el-table-column prop="last_log" label="last log" min-width="360" />
          </el-table>
        </el-card>
        <el-card class="panel top-gap" shadow="never">
          <template #header>L1 = 视频 + IoT 统一接入层</template>
          <el-table :data="children" stripe>
            <el-table-column prop="name" label="device" min-width="190" />
            <el-table-column prop="type" label="type" width="110" />
            <el-table-column prop="ip" label="ip/protocol" width="150" />
            <el-table-column prop="status" label="status" width="110" />
            <el-table-column prop="capabilities" label="capabilities" min-width="280" />
          </el-table>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '../api'

const activeTab = ref('overview')
const customerId = ref(localStorage.getItem('guardian_customer_id') || '')
const customerName = ref(localStorage.getItem('guardian_customer_name') || '未选择客户')
const summary = ref<any>(null)
const gateways = ref<any[]>([])
const links = ref<any[]>([])
const models = ref<any[]>([])
const topology = ref<any[]>([])
const services = ref<any[]>([])
const children = ref<any[]>([])

const metrics = computed(() => [
  { label: '本客户 KKOS 网关', value: summary.value?.online_gateways ?? 0, hint: '一个客户一个 RK3568 Edge OS' },
  { label: '本客户 L1 / IoT 节点', value: summary.value?.child_devices ?? 0, hint: '视频与传感器统一接入' },
  { label: '本客户 AI 链路', value: summary.value?.ai_link_status || '-', hint: 'L1 → 客户 KKOS → 云' },
  { label: '本客户模型一致率', value: summary.value?.model_consistency || '-', hint: '云模型仓库为唯一源' },
])

const planes = [
  { name: '控制面 Control Plane', owner: 'Guardian Cloud', scope: '设备管理、权限、模型版本、有限命令下发' },
  { name: '数据面 Data Plane', owner: 'Guardian Cloud', scope: '告警元数据、对象 URL、业务查询，不承载大文件' },
  { name: '存储面 Storage Plane', owner: 'OSS / COS / S3', scope: '图片、视频、模型包、训练素材的唯一对象仓库' },
  { name: '模型工厂 Model Factory', owner: '5090', scope: 'VLM 审计、自动标注、训练与评估，只向云模型仓库提交产物' },
]

onMounted(async () => {
  const { data } = await api.get('/edge-gateways/kkos', { params: { customer_id: customerId.value } })
  summary.value = data.summary
  gateways.value = data.gateways
  links.value = data.links
  models.value = data.models
  topology.value = data.topology
  services.value = data.services
  children.value = data.children
})
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
.page-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
h2 { margin:0; color:#111827; }
p { margin:6px 0 0; color:#64748b; }
.metric-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
.metric-card,.panel { border-radius:8px; border:1px solid #dbe4ef; }
.metric-label { color:#64748b; font-size:13px; }
.metric-value { margin-top:8px; font-size:25px; font-weight:760; color:#0f172a; overflow-wrap:anywhere; }
.metric-hint { margin-top:6px; color:#94a3b8; font-size:12px; }
.planes { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
.plane { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; }
.plane strong { display:block; color:#0f172a; }
.plane span { display:block; margin-top:6px; color:#2563eb; font-size:12px; font-weight:700; }
.plane p { font-size:12px; line-height:1.55; }
.tabs { background:#fff; border:1px solid #dbe4ef; border-radius:8px; padding:12px; }
.link-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
.card-head { display:flex; justify-content:space-between; align-items:center; }
.link-path { color:#0f172a; font-weight:700; line-height:1.8; }
.link-stats { display:flex; gap:12px; margin-top:16px; color:#64748b; font-size:13px; }
.error { color:#b45309; font-size:12px; }
.top-gap { margin-top:12px; }
.topology { display:grid; grid-template-columns:180px 60px 180px 1fr; align-items:center; gap:14px; min-height:260px; }
.edge-line { height:2px; background:#93c5fd; }
.children { display:grid; grid-template-columns:repeat(3,minmax(120px,1fr)); gap:12px; }
.node { border-radius:12px; padding:16px; text-align:center; font-weight:760; color:#0f172a; border:1px solid #dbe4ef; background:#fff; box-shadow:0 8px 24px #0f172a0a; }
.node small { color:#64748b; font-weight:500; }
.cloud { background:#eff6ff; border-color:#bfdbfe; }
.kkos { background:#ecfdf5; border-color:#a7f3d0; }
.child.rv1126,.child.rv1126b { background:#fff7ed; border-color:#fed7aa; }
.child.camera { background:#f8fafc; }
.child.iot_sensor { background:#f5f3ff; border-color:#ddd6fe; }
@media (max-width:1200px) {
  .metric-grid,.planes,.link-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .topology { grid-template-columns:1fr; }
  .edge-line { height:24px; width:2px; justify-self:center; }
}
</style>
