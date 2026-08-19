<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>场景策略 Scenario Policies</h2>
        <p>守界 Guardian 全局模板与客户级标准/严格/宽松/自定义策略。</p>
      </div>
      <el-button type="primary" @click="openPolicy()">新增客户策略</el-button>
    </header>

    <el-card class="panel" shadow="never">
      <template #header>守界 Guardian 全局默认场景模板</template>
      <div class="module-note">
        <b>冷启动最小配置：</b>
        每个场景必须先定义 L1 抽帧、L1→L2 候选上报、L2 本地复核、L2→云端告警、样本→Forge 的规则。
        本地 L1+L2 是基础闭环，Forge/Qwen 只作为客户授权后的训练增强。
      </div>
      <el-table :data="templates" stripe>
        <el-table-column prop="display_name" label="场景" min-width="160" />
        <el-table-column prop="scenario" label="scenario" width="150" />
        <el-table-column label="生命周期" width="150">
          <template #default="{ row }">
            <el-tag :type="row.cold_start_enabled ? 'warning' : 'success'">{{ row.cold_start_enabled ? '冷启动孵化' : '生产模板' }}</el-tag>
            <div class="mini">{{ row.lifecycle_stage }}</div>
          </template>
        </el-table-column>
        <el-table-column label="YOLO 检测对象" min-width="260"><template #default="{ row }">{{ row.target_classes.join(', ') }}</template></el-table-column>
        <el-table-column label="L1" width="170"><template #default="{ row }">{{ row.default_sample_fps }}fps · {{ row.l1_threshold }}</template></el-table-column>
        <el-table-column label="端边上报规则" min-width="300">
          <template #default="{ row }">
            <div class="pipeline">
              <span>L1→L2：{{ row.reporting_policy?.l1_to_l2 || 'candidate_frame_with_metadata' }}</span>
              <span>L2→云：{{ row.reporting_policy?.l2_to_cloud || 'local_l2_alarm_only' }}</span>
              <span>样本→Forge：{{ row.reporting_policy?.sample_to_forge || 'off_by_default_customer_authorized' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="冷启动策略" min-width="320">
          <template #default="{ row }">
            <div v-if="row.cold_start_enabled" class="coldstart">
              <b>{{ row.initial_l1_mode }}</b>
              <span>L2：{{ row.l2_local_mode || 'local_yolo_review' }}</span>
              <span>远端增强：{{ row.remote_enhancement_mode || 'off_by_default' }}</span>
              <span>Forge 教师：{{ row.teacher_model }}</span>
              <span>种子集：{{ seedTargetText(row.seed_dataset_target) }}</span>
              <span>采样：{{ samplingText(row.sampling_strategy) }}</span>
            </div>
            <span v-else class="muted">已有模型直接推理</span>
          </template>
        </el-table-column>
        <el-table-column label="规则" width="190"><template #default="{ row }">连续 {{ row.consecutive_frames }} · {{ row.min_duration_sec }}s · CD {{ row.cooldown_sec }}s</template></el-table-column>
        <el-table-column prop="priority" label="优先级" width="110" />
        <el-table-column prop="capacity_base_cost" label="基础负载" width="110" />
        <el-table-column label="操作" width="100"><template #default="{ row }"><el-button size="small" @click="showDetail(row)">详情</el-button></template></el-table-column>
      </el-table>
    </el-card>

    <el-card class="panel" shadow="never">
      <template #header>客户级场景策略</template>
      <el-table :data="policies" stripe>
        <el-table-column prop="customer_name" label="客户" min-width="160" />
        <el-table-column prop="policy_name" label="策略名" min-width="180" />
        <el-table-column prop="scenario" label="场景" width="150" />
        <el-table-column prop="policy_level" label="级别" width="110" />
        <el-table-column label="覆盖项" min-width="260"><template #default="{ row }">{{ overridesText(row.overrides) }}</template></el-table-column>
        <el-table-column prop="enabled" label="启用" width="90" />
        <el-table-column label="操作" width="100"><template #default="{ row }"><el-button size="small" @click="openPolicy(row)">编辑</el-button></template></el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="editing" title="客户级场景策略" width="760px">
      <el-form v-if="form" label-width="150px">
        <el-form-item label="客户"><el-select v-model="form.customer_id" style="width:100%"><el-option v-for="c in customers" :key="c.customer_id" :label="c.customer_name" :value="c.customer_id" /></el-select></el-form-item>
        <el-form-item label="业务场景"><el-select v-model="form.scenario" style="width:100%"><el-option v-for="t in templates" :key="t.scenario" :label="t.display_name" :value="t.scenario" /></el-select></el-form-item>
        <el-form-item label="策略名"><el-input v-model="form.policy_name" /></el-form-item>
        <el-form-item label="策略级别"><el-select v-model="form.policy_level" style="width:100%"><el-option v-for="level in levels" :key="level" :label="level" :value="level" /></el-select></el-form-item>
        <el-form-item label="sample_fps">
          <el-input-number v-model="form.overrides.default_sample_fps" :min="0.00001" :step="0.01" :precision="6" />
          <span class="field-tip">支持低频周期抽帧；30 分钟一帧填写 0.000556</span>
        </el-form-item>
        <el-form-item label="l1_threshold"><el-input-number v-model="form.overrides.l1_threshold" :min="0" :max="1" :step="0.01" /></el-form-item>
        <el-form-item label="l2_threshold"><el-input-number v-model="form.overrides.l2_threshold" :min="0" :max="1" :step="0.01" /></el-form-item>
        <el-form-item label="duration_sec"><el-input-number v-model="form.overrides.min_duration_sec" :min="0" /></el-form-item>
        <el-form-item label="consecutive"><el-input-number v-model="form.overrides.consecutive_frames" :min="1" /></el-form-item>
        <el-form-item label="cooldown_sec"><el-input-number v-model="form.overrides.cooldown_sec" :min="0" /></el-form-item>
        <el-form-item label="priority"><el-select v-model="form.overrides.priority" clearable style="width:100%"><el-option v-for="p in priorities" :key="p" :label="p" :value="p" /></el-select></el-form-item>
        <el-form-item label="enabled"><el-switch v-model="form.enabled" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="editing=false">取消</el-button><el-button type="primary" @click="savePolicy">保存策略</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '../api'

const templates = ref<any[]>([])
const policies = ref<any[]>([])
const customers = ref<any[]>([])
const editing = ref(false)
const form = ref<any>(null)
const levels = ['standard', 'strict', 'relaxed', 'custom']
const priorities = ['critical', 'high', 'medium', 'low']
const router = useRouter()
function showDetail(row: any) { router.push({ path: '/algorithm-details', query: { scenario: row.scenario } }) }

function overridesText(overrides: Record<string, any> = {}) {
  return Object.entries(overrides).filter(([, value]) => value !== '' && value !== undefined && value !== null).map(([key, value]) => `${key}:${value}`).join(' / ') || '-'
}
function seedTargetText(target: Record<string, any> = {}) {
  return Object.entries(target).filter(([, value]) => typeof value !== 'object').map(([key, value]) => `${key}:${value}`).join(' / ') || '-'
}
function samplingText(strategy: Record<string, any> = {}) {
  const modes = Array.isArray(strategy.modes) ? strategy.modes.join('+') : '-'
  return `${modes} / ${strategy.time_interval_sec || 0}s`
}
async function load() {
  templates.value = (await api.get('/scenario-templates')).data
  policies.value = (await api.get('/scenario-policies')).data
  customers.value = (await api.get('/customers')).data
}
function openPolicy(row?: any) {
  form.value = row ? JSON.parse(JSON.stringify(row)) : {
    customer_id: customers.value[0]?.customer_id || '',
    scenario: templates.value[0]?.scenario || 'ev_intrusion',
    policy_name: '',
    policy_level: 'standard',
    overrides: {},
    enabled: true,
  }
  editing.value = true
}
async function savePolicy() {
  const payload = form.value
  if (payload.policy_id) await api.put(`/scenario-policies/${payload.policy_id}`, payload)
  else await api.post('/scenario-policies', payload)
  ElMessage.success('客户级策略已保存')
  editing.value = false
  await load()
}
onMounted(load)
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
.page-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
.panel { border-radius:8px; border:1px solid #dbe4ef; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
.field-tip { margin-left:12px; color:#64748b; font-size:12px; }
.mini { margin-top:4px; color:#64748b; font-size:12px; }
.muted { color:#94a3b8; }
.module-note { margin: 0 0 12px; padding: 10px 12px; border: 1px solid #bfdbfe; border-radius: 8px; background: #eff6ff; color: #1e3a8a; font-size: 13px; line-height: 1.6; }
.pipeline { display:flex; flex-direction:column; gap:3px; color:#334155; font-size:12px; line-height:1.45; }
.coldstart { display:flex; flex-direction:column; gap:3px; color:#334155; font-size:12px; line-height:1.45; }
.coldstart b { color:#0f172a; }
</style>
