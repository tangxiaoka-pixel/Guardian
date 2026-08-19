<template>
  <section class="page">
    <header>
      <h2>KKOS 运维中心</h2>
      <p>平台内部视图：跨客户查看 RK3568 / KKOS、服务细节、链路状态和模型同步。客户 SaaS 不暴露这些底层细节。</p>
    </header>

    <div class="cards">
      <el-card v-for="item in snapshots" :key="item.customer_id" class="panel" shadow="never">
        <template #header>
          <div class="head-row">
            <strong>{{ item.customer_name }}</strong>
            <el-tag :type="item.summary.health_status === 'healthy' ? 'success' : 'warning'">{{ item.summary.health_status }}</el-tag>
          </div>
        </template>
        <div class="gateway">
          <span>{{ item.gateway?.name || '未绑定 RK3568' }}</span>
          <small>LAN {{ item.gateway?.lan_ip || '-' }} · TailScale {{ item.gateway?.tailscale_ip || '-' }}</small>
        </div>
        <div class="ops-grid">
          <div><b>{{ item.summary.child_devices }}</b><span>下挂节点</span></div>
          <div><b>{{ item.summary.ai_link_status }}</b><span>AI 链路</span></div>
          <div><b>{{ item.summary.model_consistency }}</b><span>模型一致率</span></div>
        </div>
        <el-table :data="item.services" size="small" class="mini-table">
          <el-table-column prop="service_name" label="service" min-width="180" />
          <el-table-column prop="status" label="status" width="100" />
          <el-table-column prop="last_log" label="last log" min-width="220" />
        </el-table>
      </el-card>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '../api'

const snapshots = ref<any[]>([])

onMounted(async () => {
  const customers = (await api.get('/customers')).data
  const rows = await Promise.all(customers.map(async (customer: any) => {
    const data = (await api.get('/edge-gateways/kkos', { params: { customer_id: customer.customer_id } })).data
    return { customer_id: customer.customer_id, customer_name: customer.customer_name, ...data, gateway: (data.gateways || [])[0] }
  }))
  snapshots.value = rows
})
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
.cards { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
.panel { border-radius:8px; border:1px solid #dbe4ef; }
.head-row { display:flex; justify-content:space-between; align-items:center; gap:12px; }
.gateway { display:flex; flex-direction:column; gap:4px; color:#0f172a; }
.gateway small { color:#64748b; }
.ops-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin:14px 0; }
.ops-grid div { padding:10px; border-radius:8px; background:#f8fafc; border:1px solid #e2e8f0; }
.ops-grid b { display:block; color:#0f172a; }
.ops-grid span { color:#64748b; font-size:12px; }
.mini-table { margin-top:10px; }
@media (max-width:1100px) { .cards { grid-template-columns:1fr; } }
</style>
