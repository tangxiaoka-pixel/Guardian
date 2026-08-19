<template>
  <section class="page">
    <header>
      <h2>运行配置 Runtime Configs</h2>
      <p>全局模板 + 客户策略 + 点位覆盖 + 灵敏度合并后的最终运行配置。</p>
    </header>
    <el-card class="panel" shadow="never">
      <el-table :data="configs" stripe>
        <el-table-column prop="camera_name" label="摄像头" min-width="150" />
        <el-table-column prop="display_name" label="业务场景" min-width="150" />
        <el-table-column prop="version" label="版本" width="80" />
        <el-table-column label="YOLO 对象" min-width="260"><template #default="{ row }">{{ row.target_classes.join(', ') }}</template></el-table-column>
        <el-table-column label="最终配置" min-width="260">
          <template #default="{ row }">
            {{ row.sample_fps }}fps · L1 {{ row.l1_threshold }} · L2 {{ row.l2_threshold }} · 连续 {{ row.consecutive_frames }} · {{ row.min_duration_sec }}s · CD {{ row.cooldown_sec }}s
          </template>
        </el-table-column>
        <el-table-column prop="priority" label="优先级" width="100" />
        <el-table-column prop="capacity_cost" label="负载" width="90" />
        <el-table-column prop="status" label="状态" width="90" />
        <el-table-column label="操作" width="100"><template #default="{ row }"><el-button size="small" @click="open(row)">查看</el-button></template></el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="viewerOpen" title="Runtime Config 对比" width="900px">
      <div v-if="selected" class="detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="camera">{{ selected.camera_name }}</el-descriptions-item>
          <el-descriptions-item label="scenario">{{ selected.display_name }}</el-descriptions-item>
          <el-descriptions-item label="runtime_config_id">{{ selected.runtime_config_id }}</el-descriptions-item>
          <el-descriptions-item label="version">{{ selected.version }}</el-descriptions-item>
          <el-descriptions-item label="generated_from" :span="2">{{ selected.generated_from.global_template_version }} / {{ selected.generated_from.customer_policy_id || '-' }} / {{ selected.generated_from.binding_id }}</el-descriptions-item>
        </el-descriptions>
        <el-table :data="compareRows" stripe>
          <el-table-column prop="field" label="字段" width="180" />
          <el-table-column prop="global" label="全局模板" min-width="180" />
          <el-table-column prop="policy" label="客户策略覆盖" min-width="180" />
          <el-table-column prop="binding" label="点位覆盖" min-width="180" />
          <el-table-column prop="final" label="最终运行值" min-width="180" />
        </el-table>
      </div>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '../api'

const configs = ref<any[]>([])
const selected = ref<any>(null)
const viewerOpen = ref(false)
const fields = ['target_classes', 'default_sample_fps', 'l1_threshold', 'l2_threshold', 'consecutive_frames', 'min_duration_sec', 'cooldown_sec', 'priority', 'capacity_base_cost']

async function load() { configs.value = (await api.get('/runtime-configs')).data }
function valueOf(item: any) { return Array.isArray(item) ? item.join(', ') : item ?? '-' }
function open(row: any) { selected.value = row; viewerOpen.value = true }
const compareRows = computed(() => {
  if (!selected.value) return []
  const global = selected.value.compare.global_template
  const policy = selected.value.compare.customer_policy_overrides
  const binding = selected.value.compare.binding_overrides
  const finalMap: Record<string, any> = {
    target_classes: selected.value.target_classes,
    default_sample_fps: selected.value.sample_fps,
    l1_threshold: selected.value.l1_threshold,
    l2_threshold: selected.value.l2_threshold,
    consecutive_frames: selected.value.consecutive_frames,
    min_duration_sec: selected.value.min_duration_sec,
    cooldown_sec: selected.value.cooldown_sec,
    priority: selected.value.priority,
    capacity_base_cost: selected.value.capacity_cost,
  }
  return fields.map((field) => ({ field, global: valueOf(global[field]), policy: valueOf(policy[field]), binding: valueOf(binding[field]), final: valueOf(finalMap[field]) }))
})
onMounted(load)
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
.panel { border-radius:8px; border:1px solid #dbe4ef; }
.detail { display:flex; flex-direction:column; gap:14px; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
</style>
