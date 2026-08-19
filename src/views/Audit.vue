<template>
  <div>
    <div class="title-row">
      <div>
        <h3>VLM 审计中心</h3>
        <p>所有经过公共 VLM 裁判服务的告警和样本都会在这里留痕，便于追踪 Mage/Forge 的审计、标注建议和人工入口。</p>
      </div>
      <el-tag type="info">审计只给结论和草稿，入训练集仍需人工确认</el-tag>
    </div>
    <el-row :gutter="12" style="margin-bottom:20px">
      <el-col v-for="item in providers" :key="item.provider" :span="8">
        <el-card shadow="never">
          <div class="provider-card">
            <div>
              <strong>{{ item.display_name || item.provider }}</strong>
              <small v-if="item.system_role">{{ item.system_role }}</small>
              <small v-if="item.deployment_mode">部署：{{ deploymentText(item.deployment_mode) }}</small>
              <small>{{ item.model || '未配置模型' }}</small>
              <small v-if="item.endpoint">{{ item.endpoint }}</small>
            </div>
            <div>
              <el-tag v-if="item.active" type="primary">当前使用</el-tag>
              <el-tag :type="providerTag(item)">{{ providerText(item) }}</el-tag>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>
    <el-row :gutter="20" style="margin-bottom:20px">
      <el-col :span="6"><el-statistic title="已审计" :value="stats.total_audited" /></el-col>
      <el-col :span="6"><el-statistic title="有效样本/告警" :value="stats.total_confirmed" /></el-col>
      <el-col :span="6"><el-statistic title="无效/背景" :value="stats.total_overturned" /></el-col>
      <el-col :span="6"><el-statistic title="待人工" :value="stats.total_uncertain" /></el-col>
    </el-row>
    <el-table :data="logs" stripe border>
      <el-table-column label="审计对象" width="260">
        <template #default="{ row }">
          <div class="object-id">{{ row.sample_id || row.alarm_id || row.audit_object_id }}</div>
          <small>{{ sourceText(row.source) }}</small>
        </template>
      </el-table-column>
      <el-table-column prop="provider" label="Provider" width="160" />
      <el-table-column label="场景 / 摄像头" width="220">
        <template #default="{ row }">
          <div>{{ row.scene_name || row.scene_code || '-' }}</div>
          <small>{{ row.camera_name || row.camera_id || '-' }}</small>
        </template>
      </el-table-column>
      <el-table-column label="审计结果" min-width="280">
        <template #default="{ row }">
          <div v-if="row.response">
            <el-tag :type="verdictType(row.response.verdict || row.response.sample_type)">{{ verdictText(row.response.verdict || row.response.sample_type) }}</el-tag>
            <span class="score">{{ formatScore(row.response.score) }}</span>
            <div class="reason">{{ row.response.reasoning || '-' }}</div>
          </div>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="标注状态" width="150">
        <template #default="{ row }"><el-tag :type="labelTag(row.response?.label_status)">{{ labelText(row.response?.label_status, row.response?.label_reject_reason) }}</el-tag></template>
      </el-table-column>
      <el-table-column label="后续动作" width="170">
        <template #default="{ row }"><el-tag type="warning">{{ decisionText(row.response?.business_decision) }}</el-tag></template>
      </el-table-column>
      <el-table-column prop="latency_ms" label="延迟(ms)" width="100" />
      <el-table-column prop="created_at" label="时间" />
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from '../api'

const stats = ref({ total_audited:0, total_confirmed:0, total_overturned:0, total_uncertain:0, total_cost_cents:0 })
const logs = ref<any[]>([])
const providers = ref<any[]>([])

onMounted(async () => {
  const [s, l, p] = await Promise.all([api.get('/audits/stats'), api.get('/audits/logs'), api.get('/audits/providers')])
  stats.value = s.data
  logs.value = l.data.map((item:any) => {
    try { return { ...item, response: JSON.parse(item.response_payload || '{}') } } catch (_) { return { ...item, response: null } }
  })
  providers.value = p.data
})

function formatScore(score:any) { return typeof score === 'number' ? `${Math.round(score * 100)}%` : '-' }
function verdictType(verdict:string) {
  if (['confirm', 'cap_missing', 'cap_present', 'reviewed'].includes(verdict)) return 'success'
  if (['overturn', 'invalid_sample'].includes(verdict)) return 'info'
  return 'warning'
}
function verdictText(verdict:string) {
  const map:any = { confirm:'确认有效', overturn:'推翻', uncertain:'不确定', cap_missing:'缺盖样本', cap_present:'正常瓶盖样本', invalid_sample:'无效/背景样本', need_human_box:'需人工画框', reviewed:'已审计' }
  return map[verdict] || verdict || '-'
}
function labelTag(status:string) {
  if (status === 'auto_label_draft') return 'warning'
  if (status === 'not_required') return 'info'
  if (status === 'approved') return 'success'
  return status ? 'warning' : 'info'
}
function labelText(status:string, reason:string) {
  if (status === 'not_required') return reason === 'no_bottle_visible' ? '无需标注' : '不需标注'
  if (status === 'auto_label_draft') return '草稿待审'
  if (status === 'need_human_box') return '需人工画框'
  if (status === 'need_human_review') return '需人工复核'
  if (status === 'approved') return '已入库'
  return '-'
}
function decisionText(decision:string) {
  const map:any = { keep_as_background:'保留背景样本', human_review_required:'人工审核草稿', human_box_required:'人工画框', human_review:'人工复核', waiting:'等待' }
  return map[decision] || decision || '-'
}
function sourceText(source:string) {
  if (source === 'guardian_forge') return 'Forge / Mage 样本审计'
  if (source === 'cloud_alarm') return 'Cloud 告警审计'
  return source || '-'
}
function providerTag(item:any) {
  if (item.status === 'offline' || item.status === 'missing_model') return 'danger'
  return item.configured ? 'success' : 'danger'
}
function providerText(item:any) {
  if (item.status === 'offline') return '服务不可达'
  if (item.status === 'missing_model') return '缺少模型'
  return item.configured ? '配置完整' : '缺少配置'
}
function deploymentText(mode:string) {
  if (mode === 'independent') return '独立推理服务'
  if (mode === 'forge') return 'Forge 内置'
  return mode || '-'
}
</script>

<style scoped>
.title-row,.provider-card{display:flex;align-items:center;justify-content:space-between}.title-row p{color:#64748b;font-size:13px}.provider-card>div{display:flex;gap:8px;align-items:center}.provider-card>div:first-child{flex-direction:column;align-items:flex-start}.provider-card small,.reason,small{color:#64748b;font-size:12px}.score{margin-left:8px;font-weight:700}.reason{margin-top:6px;line-height:1.5}.object-id{font-weight:700}
</style>
