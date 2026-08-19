<template>
  <section class="page">
    <header>
      <h2>容量规划 Capacity Planner</h2>
      <p>估算一个小区需要多少 RV1126 / RK3568，并给出 L1 通道分配、风险、降级建议和商业回本周期。</p>
    </header>

    <div class="layout">
      <el-card class="panel" shadow="never">
        <template #header>Site Input</template>
        <el-form label-width="180px">
          <el-form-item label="site_name"><el-input v-model="form.site.name" /></el-form-item>
          <el-form-item label="resolution">
            <el-select v-model="form.site.resolution" style="width: 100%">
              <el-option label="720p" value="720p" />
              <el-option label="1080p" value="1080p" />
              <el-option label="2k" value="2k" />
              <el-option label="4k" value="4k" />
            </el-select>
          </el-form-item>
          <el-form-item label="elevators">
            <el-input-number v-model="form.channels.ev_intrusion" :min="0" />
          </el-form-item>
          <el-form-item label="trash_points">
            <el-input-number v-model="form.channels.trash_overflow" :min="0" />
          </el-form-item>
          <el-form-item label="fire_lanes">
            <el-input-number v-model="form.channels.fire_lane" :min="0" />
          </el-form-item>
          <el-form-item label="danger_zones">
            <el-input-number v-model="form.channels.person_intrusion" :min="0" />
          </el-form-item>
          <el-form-item label="monthly_service_price">
            <el-input-number v-model="form.commercial.monthly_service_price" :min="1" />
          </el-form-item>
          <el-form-item label="installation_cost">
            <el-input-number v-model="form.commercial.installation_cost" :min="0" />
          </el-form-item>
          <el-form-item label="maintenance_cost_per_month">
            <el-input-number v-model="form.commercial.maintenance_cost_per_month" :min="0" />
          </el-form-item>
          <el-button type="primary" @click="runPlan">生成容量规划</el-button>
        </el-form>
      </el-card>

      <div class="right">
        <div class="cards">
          <el-card v-for="card in comboCards" :key="card.label" class="metric" shadow="never">
            <span>{{ card.label }}</span>
            <strong>{{ card.value }}</strong>
          </el-card>
        </div>

        <el-card class="panel" shadow="never">
          <template #header>Device Allocation</template>
          <div v-for="(device, id) in plan.rv1126_allocation" :key="id" class="device">
            <div class="device-row">
              <strong>{{ id }}</strong>
              <span>{{ device.load_score }}/{{ device.max_capacity }} · {{ device.status }}</span>
            </div>
            <el-progress :percentage="Math.min(100, device.load_score)" :status="device.status === 'healthy' ? 'success' : device.status === 'warning' ? 'warning' : 'exception'" />
            <div class="chips">
              <el-tag v-for="ch in device.channels" :key="ch.channel_id" effect="plain">
                {{ ch.channel_id }} · {{ ch.algorithm }} · cost {{ ch.cost_score }}
              </el-tag>
            </div>
          </div>
        </el-card>
      </div>
    </div>

    <div class="bottom">
      <el-card class="panel" shadow="never">
        <template #header>Risk & Suggestions</template>
        <el-alert v-if="!plan.risks.length" title="当前没有 high risk" type="success" :closable="false" />
        <el-alert v-for="risk in plan.risks" :key="risk.message" :title="risk.message" :type="risk.level === 'high' ? 'error' : 'warning'" :closable="false" class="alert" />
        <ul>
          <li v-for="item in plan.suggestions" :key="item.message">{{ item.message }}</li>
        </ul>
      </el-card>

      <el-card class="panel" shadow="never">
        <template #header>Export</template>
        <div class="actions">
          <el-button @click="downloadJson">Download JSON</el-button>
          <el-button @click="downloadYaml">Download YAML</el-button>
        </div>
        <pre>{{ JSON.stringify(plan.recommended_devices, null, 2) }}</pre>
      </el-card>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '../api'

const form = ref<any>({
  site: { name: 'medium_community', resolution: '1080p' },
  channels: { ev_intrusion: 8, trash_overflow: 2, fire_lane: 4, person_intrusion: 2 },
  commercial: { monthly_service_price: 1999, installation_cost: 1000, maintenance_cost_per_month: 200 },
})
const plan = ref<any>({
  recommended_devices: { rv1126: 0, rk3568: 0 },
  rv1126_allocation: {},
  l2_estimate: {},
  commercial_estimate: {},
  risks: [],
  suggestions: [],
})

const comboCards = computed(() => [
  { label: 'RV1126 count', value: plan.value.recommended_devices?.rv1126 ?? '-' },
  { label: 'RK3568 count', value: plan.value.recommended_devices?.rk3568 ?? '-' },
  { label: 'hardware cost', value: plan.value.commercial_estimate?.hardware_cost ?? '-' },
  { label: 'gross margin', value: `${Math.round((plan.value.commercial_estimate?.estimated_gross_margin ?? 0) * 100)}%` },
  { label: 'payback months', value: plan.value.commercial_estimate?.payback_months ?? '-' },
  { label: 'L2 candidate/min', value: plan.value.l2_estimate?.total_candidate_per_min ?? '-' },
])

async function runPlan() {
  const { data } = await api.post('/capacity/plan', form.value)
  plan.value = data
}

function saveBlob(name: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function downloadJson() {
  saveBlob(`${plan.value.site_name || 'capacity_plan'}.json`, JSON.stringify(plan.value, null, 2), 'application/json')
}

function downloadYaml() {
  saveBlob(`${plan.value.site_name || 'capacity_plan'}.yaml`, toYaml(plan.value), 'text/yaml')
}

function toYaml(value: any, indent = 0): string {
  const pad = ' '.repeat(indent)
  if (Array.isArray(value)) {
    return value.map((item) => `${pad}- ${typeof item === 'object' ? `\n${toYaml(item, indent + 2)}` : item}`).join('\n')
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([k, v]) => `${pad}${k}:${typeof v === 'object' && v !== null ? `\n${toYaml(v, indent + 2)}` : ` ${v}`}`).join('\n')
  }
  return `${pad}${value}`
}

onMounted(runPlan)
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 14px; }
h2 { margin: 0; color: #111827; }
p { margin: 6px 0 0; color: #64748b; }
.layout { display: grid; grid-template-columns: 420px 1fr; gap: 14px; }
.right { display: flex; flex-direction: column; gap: 14px; }
.cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.metric, .panel { border-radius: 8px; border: 1px solid #dbe4ef; }
.metric span { color: #64748b; font-size: 13px; }
.metric strong { display: block; margin-top: 8px; font-size: 24px; color: #0f172a; }
.device { padding: 10px 0 16px; border-bottom: 1px solid #e2e8f0; }
.device:last-child { border-bottom: 0; }
.device-row { display: flex; justify-content: space-between; margin-bottom: 8px; color: #334155; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.bottom { display: grid; grid-template-columns: 1.2fr .8fr; gap: 14px; }
.alert { margin-top: 8px; }
.actions { display: flex; gap: 10px; margin-bottom: 12px; }
pre { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; overflow: auto; }
@media (max-width: 1100px) { .layout, .bottom { grid-template-columns: 1fr; } .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
