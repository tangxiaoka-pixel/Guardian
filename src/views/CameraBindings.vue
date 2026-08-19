<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>摄像头场景绑定 Camera Bindings</h2>
        <p>实施人员按摄像头绑定业务场景和 L1/L2 设备；L1/L2 常驻运行，开关只负责唤醒或休眠这一路摄像头。</p>
      </div>
      <div class="head-actions">
        <el-button plain @click="load">刷新</el-button>
        <el-button type="primary" @click="openBinding()">新增绑定</el-button>
      </div>
    </header>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="后台只配置摄像头唤醒/休眠"
      description="L1/L2 服务是常驻运行的基础链路；这里不会直接启动或停止 L1/L2 服务。"
    />

    <el-card v-if="bindings.length" class="panel assignment-panel" shadow="never">
      <template #header>
        <div class="card-head">
          <span>按算法负载自动匹配哨兵</span>
          <div class="card-actions">
            <el-button size="small" plain @click="showAllocation = !showAllocation">{{ showAllocation ? '收起建议' : '展开建议' }}</el-button>
            <el-button size="small" plain @click="resetAllocationDraft">重新计算建议</el-button>
            <el-button size="small" type="primary" :loading="applyingSuggestions" @click="applySuggestedAssignments">确认应用草案</el-button>
          </div>
        </div>
      </template>
      <template v-if="showAllocation">
        <p class="hint">系统根据每路摄像头的算法、sample_fps、runtime 负载和设备容量生成建议。建议先进入草案，用户可手动调整后再确认生效。</p>
        <div class="assignment-summary">
          <div v-for="group in draftGroups" :key="group.device_id" class="sentinel-card">
            <div class="sentinel-title">{{ deviceLabel(group.device_id) }}</div>
            <el-progress :percentage="group.load_percent" :status="group.load_percent > 90 ? 'exception' : group.load_percent > 75 ? 'warning' : 'success'" />
            <div class="sentinel-load">预计负载 {{ group.total_cost.toFixed(1) }} / {{ group.capacity }} 单位</div>
            <div class="sentinel-cameras">
              <el-tag v-for="item in group.cameras" :key="item.binding_id" size="small" :type="item.current_l1_device_id === draftAssignments[item.binding_id] ? 'success' : 'warning'">
                {{ cameraIndex(item.camera_id) }}路 {{ item.camera_name }} · {{ item.scenario_name }} · {{ item.capacity_cost }}
              </el-tag>
            </div>
          </div>
        </div>
        <el-table :data="assignmentSuggestions" size="small" class="suggestion-table">
          <el-table-column label="摄像头" min-width="180">
            <template #default="{ row }">{{ cameraIndex(row.camera_id) }}路 · {{ row.camera_name }}</template>
          </el-table-column>
          <el-table-column label="当前哨兵" min-width="230">
            <template #default="{ row }">{{ deviceLabel(row.current_l1_device_id) }}</template>
          </el-table-column>
          <el-table-column label="算法/负载" min-width="210">
            <template #default="{ row }">{{ row.scenario_name }} · {{ row.sample_fps }}fps · 负载 {{ row.capacity_cost }}</template>
          </el-table-column>
          <el-table-column label="系统建议" min-width="230">
            <template #default="{ row }">{{ deviceLabel(row.suggested_l1_device_id) }}</template>
          </el-table-column>
          <el-table-column label="用户草案" min-width="260">
            <template #default="{ row }">
              <el-select v-model="draftAssignments[row.binding_id]" size="small">
                <el-option v-for="d in l1Devices" :key="d.device_id" :label="`${d.device_name} · ${d.ip}`" :value="d.device_id" />
              </el-select>
              <div class="reason">{{ row.reason }}</div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="row.current_l1_device_id === draftAssignments[row.binding_id] ? 'success' : 'warning'">
                {{ row.current_l1_device_id === draftAssignments[row.binding_id] ? '未变更' : '待生效' }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </template>
      <p v-else class="hint">自动匹配建议已折叠，避免页面进入时做额外计算。需要调整哨兵分配时再展开。</p>
    </el-card>

    <el-card class="panel" shadow="never" v-loading="loading">
      <el-table :data="bindings" stripe empty-text="暂无绑定，请点击右上角新增绑定">
        <el-table-column prop="camera_name" label="摄像头" min-width="150" />
        <el-table-column prop="site_name" label="项目" min-width="160" />
        <el-table-column prop="scenario_name" label="业务场景" min-width="150" />
        <el-table-column label="L1 哨兵" min-width="230">
          <template #default="{ row }">{{ deviceLabel(row.runtime_config.assigned_l1_device_id) }}</template>
        </el-table-column>
        <el-table-column label="L2 节点" min-width="190">
          <template #default="{ row }">{{ deviceLabel(row.runtime_config.assigned_l2_device_id) }}</template>
        </el-table-column>
        <el-table-column prop="sensitivity" label="灵敏度" width="110" />
        <el-table-column label="最终 L1" width="170"><template #default="{ row }">{{ row.runtime_config.sample_fps }}fps · {{ row.runtime_config.l1_threshold }}</template></el-table-column>
        <el-table-column label="YOLO 对象" min-width="240"><template #default="{ row }">{{ row.runtime_config.target_classes.join(', ') }}</template></el-table-column>
        <el-table-column label="规则" width="190"><template #default="{ row }">连续 {{ row.runtime_config.consecutive_frames }} · {{ row.runtime_config.min_duration_sec }}s · CD {{ row.runtime_config.cooldown_sec }}s</template></el-table-column>
        <el-table-column prop="runtime_config.capacity_cost" label="负载" width="90" />
        <el-table-column label="配置状态" width="110"><template #default="{ row }"><el-tag :type="row.enabled === false ? 'info' : 'success'">{{ row.enabled === false ? '已停用' : '已配置' }}</el-tag></template></el-table-column>
        <el-table-column label="摄像头运行" width="160">
          <template #default="{ row }">
            <el-switch
              :model-value="runtimeIsAwake(row)"
              :loading="controlLoading[row.binding_id]"
              active-text="已唤醒"
              inactive-text="未唤醒"
              inline-prompt
              @change="toggleRuntime(row, Boolean($event))"
            />
          </template>
        </el-table-column>
        <el-table-column label="摄像头状态" min-width="230">
          <template #default="{ row }">
            <el-tag :type="runtimeStatusTag(row.runtime_control?.status, row.enabled !== false)">{{ runtimeStatusText(row) }}</el-tag>
            <div class="reason">{{ runtimeStatusDetail(row) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110"><template #default="{ row }"><el-button size="small" @click="openBinding(row)">编辑</el-button></template></el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="editing" title="摄像头场景绑定" width="940px">
      <el-form v-if="form" label-width="150px">
        <el-form-item label="Step 1 客户"><el-select v-model="form.customer_id" style="width:100%" @change="onCustomerChange"><el-option v-for="c in customers" :key="c.customer_id" :label="c.customer_name" :value="c.customer_id" /></el-select></el-form-item>
        <el-form-item label="Step 2 项目"><el-select v-model="form.site_id" style="width:100%"><el-option v-for="s in filteredSites" :key="s.site_id" :label="s.site_name" :value="s.site_id" /></el-select></el-form-item>
        <el-form-item label="Step 3 摄像头"><el-select v-model="form.camera_id" style="width:100%" @change="onCameraChange"><el-option v-for="c in filteredCameras" :key="c.camera_id" :label="`${c.camera_name} · ${c.location}`" :value="c.camera_id" /></el-select></el-form-item>
        <el-form-item label="Step 4 业务场景"><el-select v-model="form.scenario" style="width:100%" @change="schedulePreview"><el-option v-for="t in templates" :key="t.scenario" :label="t.display_name" :value="t.scenario" /></el-select></el-form-item>
        <el-form-item label="Step 5 客户策略"><el-select v-model="form.policy_id" clearable style="width:100%" @change="schedulePreview"><el-option label="使用全局默认/标准" value="" /><el-option v-for="p in filteredPolicies" :key="p.policy_id" :label="`${p.policy_name} · ${p.policy_level}`" :value="p.policy_id" /></el-select></el-form-item>
        <el-form-item label="Step 6 ROI 绘制">
          <RoiEditor v-model="form.roi" :image-url="roiImageUrl" @update:model-value="schedulePreview" />
        </el-form-item>
        <el-form-item label="Step 7 灵敏度"><el-segmented v-model="form.sensitivity" :options="sensitivities" @change="schedulePreview" /></el-form-item>
        <el-form-item v-if="form.scenario === 'desk_drink_intrusion'" label="L2 定期守护">
          <div class="audit-interval">
            <el-input-number v-model="form.audit_interval_min" :min="1" :max="1440" :step="1" controls-position="right" @change="schedulePreview" />
            <span>分钟/张</span>
            <span class="field-tip">默认 1 分钟。每个周期发送三张原图到 L2（间隔约 4 秒）作稳定性复核；普通帧不归档。</span>
          </div>
        </el-form-item>
        <el-form-item label="点位覆盖">
          <div class="override-grid">
            <el-input-number v-model="form.overrides.default_sample_fps" :min="0.1" :step="0.1" placeholder="sample_fps" @change="schedulePreview" />
            <el-input-number v-model="form.overrides.l1_threshold" :min="0" :max="1" :step="0.01" placeholder="l1_threshold" @change="schedulePreview" />
            <el-input-number v-model="form.overrides.min_duration_sec" :min="0" placeholder="duration" @change="schedulePreview" />
            <el-input-number v-model="form.overrides.cooldown_sec" :min="0" placeholder="cooldown" @change="schedulePreview" />
          </div>
        </el-form-item>
        <el-form-item label="L1/L2 设备">
          <div class="device-grid">
            <el-select v-model="form.assigned_l1_device_id" placeholder="L1" @change="schedulePreview"><el-option v-for="d in l1Devices" :key="d.device_id" :label="d.device_name" :value="d.device_id" /></el-select>
            <el-select v-model="form.assigned_l2_device_id" placeholder="L2" @change="schedulePreview"><el-option v-for="d in l2Devices" :key="d.device_id" :label="d.device_name" :value="d.device_id" /></el-select>
          </div>
        </el-form-item>
      </el-form>
      <el-card v-if="runtime" class="preview" shadow="never">
        <template #header>Step 8 Runtime Config 预览</template>
        <div class="runtime-grid">
          <span>YOLO 对象：{{ runtime.target_classes.join(', ') }}</span>
          <span>sample_fps：{{ runtime.sample_fps }}</span>
          <span v-if="runtime.audit_interval_sec">L2 定期守护：每 {{ Math.round(runtime.audit_interval_sec / 60) }} 分钟一组（3 帧）</span>
          <span>L1 阈值：{{ runtime.l1_threshold }}</span>
          <span>L2 阈值：{{ runtime.l2_threshold }}</span>
          <span>duration：{{ runtime.min_duration_sec }}s</span>
          <span>cooldown：{{ runtime.cooldown_sec }}s</span>
          <span>priority：{{ runtime.priority }}</span>
          <span>capacity_cost：{{ runtime.capacity_cost }}</span>
          <span>生命周期：{{ runtime.cold_start_enabled ? '冷启动孵化' : '生产推理' }} · {{ runtime.lifecycle_stage }}</span>
          <span>L1 初始模式：{{ runtime.initial_l1_mode }}</span>
          <span>L2 本地模式：{{ runtime.l2_local_mode || 'local_yolo_review' }}</span>
          <span>远端增强：{{ runtime.remote_enhancement_mode || 'off_by_default' }}</span>
          <span>Forge 教师模型：{{ runtime.teacher_model || '-' }}</span>
          <span>未来目标类别：{{ (runtime.future_target_classes || []).join(', ') || '-' }}</span>
          <span>L1 抽帧：{{ runtime.edge_pipeline?.l1?.frame_policy || `${runtime.sample_fps}fps 场景抽帧` }}</span>
          <span>L1→L2：{{ runtime.reporting_policy?.l1_to_l2 || 'candidate_frame_with_metadata' }}</span>
          <span>L2→云：{{ runtime.reporting_policy?.l2_to_cloud || 'local_l2_alarm_only' }}</span>
          <span>样本→Forge：{{ runtime.reporting_policy?.sample_to_forge || 'off_by_default_customer_authorized' }}</span>
          <span>L1：{{ runtime.assigned_l1_device_id }}</span>
          <span>L2：{{ runtime.assigned_l2_device_id }}</span>
        </div>
        <div class="runtime-note">
          {{ runtime.edge_pipeline?.l2?.alarm_policy || 'L2 使用本地模型/规则完成基础复核，远端 Forge 不在实时告警主链路里。' }}
        </div>
      </el-card>
      <template #footer><el-button @click="editing=false">取消</el-button><el-button type="primary" @click="saveBinding">Step 9 保存并下发</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import api, { apiPublicUrl } from '../api'
import RoiEditor from '../components/RoiEditor.vue'

const bindings = ref<any[]>([])
const customers = ref<any[]>([])
const sites = ref<any[]>([])
const cameras = ref<any[]>([])
const devices = ref<any[]>([])
const policies = ref<any[]>([])
const templates = ref<any[]>([])
const editing = ref(false)
const form = ref<any>(null)
const runtime = ref<any>(null)
const loading = ref(false)
const showAllocation = ref(false)
const applyingSuggestions = ref(false)
const draftAssignments = ref<Record<string, string>>({})
const controlLoading = ref<Record<string, boolean>>({})
const sensitivities = ['conservative', 'standard', 'sensitive', 'custom']
let previewTimer: number | undefined
let previewSeq = 0
const filteredSites = computed(() => sites.value.filter((item) => item.customer_id === form.value?.customer_id))
const filteredCameras = computed(() => cameras.value.filter((item) => item.site_id === form.value?.site_id))
const filteredPolicies = computed(() => policies.value.filter((item) => item.customer_id === form.value?.customer_id && item.scenario === form.value?.scenario))
const l1Devices = computed(() => devices.value.filter((item) => ['l1', 'mixed'].includes(item.role)))
const l2Devices = computed(() => devices.value.filter((item) => ['l2', 'mixed'].includes(item.role)))
const deviceMap = computed(() => new Map(devices.value.map((item) => [item.device_id, item])))
const automaticAllocation = computed(() => allocateByAlgorithmLoad())
const assignmentSuggestions = computed(() => bindings.value.map((binding) => {
  const runtimeConfig = binding.runtime_config || {}
  const current = runtimeConfig.assigned_l1_device_id || binding.assigned_l1_device_id
  const suggestion = automaticAllocation.value.assignments[binding.binding_id] || current || l1Devices.value[0]?.device_id || ''
  return {
    binding_id: binding.binding_id,
    camera_id: binding.camera_id,
    camera_name: binding.camera_name,
    scenario_name: binding.scenario_name || runtimeConfig.display_name || binding.scenario,
    sample_fps: runtimeConfig.sample_fps || 0,
    capacity_cost: Number(runtimeConfig.capacity_cost || 0),
    current_l1_device_id: current,
    suggested_l1_device_id: suggestion,
    reason: allocationReason(binding, suggestion),
  }
}))
const draftGroups = computed(() => {
  const groups = new Map<string, any[]>()
  for (const item of assignmentSuggestions.value) {
    const deviceId = draftAssignments.value[item.binding_id] || item.suggested_l1_device_id
    const list = groups.get(deviceId) || []
    list.push(item)
    groups.set(deviceId, list)
  }
  return l1Devices.value.map((device) => {
    const camerasForDevice = groups.get(device.device_id) || []
    const totalCost = camerasForDevice.reduce((sum, item) => sum + Number(item.capacity_cost || 0), 0)
    const capacity = deviceCapacity(device)
    return {
      device_id: device.device_id,
      cameras: camerasForDevice,
      total_cost: totalCost,
      capacity,
      load_percent: Math.min(100, Math.round((totalCost / Math.max(capacity, 1)) * 100)),
    }
  })
})
const roiImageUrl = computed(() => {
  const camera = cameras.value.find((item) => item.camera_id === form.value?.camera_id)
  if (!camera?.camera_id) return ''
  return `${apiPublicUrl(`/api/camera-snapshot?camera_id=${encodeURIComponent(camera.camera_id)}`)}&t=${Date.now()}`
})

function cameraIndex(cameraId: string) {
  return Math.max(1, Number(String(cameraId || '').replace(/\D/g, '')) || 1)
}
function deviceLabel(deviceId: string) {
  const device = deviceMap.value.get(deviceId)
  if (!device) return deviceId || '-'
  return `${device.device_name} · ${device.ip}`
}
function deviceCapacity(device: any) {
  return Number(device?.l1_capacity_units || (String(device?.device_type || '').includes('rv1126b') ? 90 : 100))
}
function allocateByAlgorithmLoad() {
  const devicesForL1 = l1Devices.value
  const loads = Object.fromEntries(devicesForL1.map((device) => [device.device_id, 0]))
  const capacities = Object.fromEntries(devicesForL1.map((device) => [device.device_id, deviceCapacity(device)]))
  const assignments: Record<string, string> = {}
  const sorted = [...bindings.value].sort((a, b) => Number(b.runtime_config?.capacity_cost || 0) - Number(a.runtime_config?.capacity_cost || 0))
  for (const binding of sorted) {
    const cost = Number(binding.runtime_config?.capacity_cost || 0)
    const best = devicesForL1
      .map((device) => ({
        device_id: device.device_id,
        projected_ratio: (loads[device.device_id] + cost) / Math.max(capacities[device.device_id], 1),
        current_ratio: loads[device.device_id] / Math.max(capacities[device.device_id], 1),
      }))
      .sort((a, b) => a.projected_ratio - b.projected_ratio || a.current_ratio - b.current_ratio)[0]
    if (!best) continue
    assignments[binding.binding_id] = best.device_id
    loads[best.device_id] += cost
  }
  return { assignments, loads, capacities }
}
function allocationReason(binding: any, deviceId: string) {
  const runtimeConfig = binding.runtime_config || {}
  const device = deviceMap.value.get(deviceId)
  const capacity = deviceCapacity(device)
  return `按 ${binding.scenario_name || binding.scenario}，${runtimeConfig.sample_fps || 0}fps，负载 ${runtimeConfig.capacity_cost || 0}，分配到预计负载最低的可用 L1。设备容量 ${capacity}。`
}
function runtimeStatusText(row: any) {
  const status = row.runtime_control?.status
  if (status === 'camera_awake' || status === 'running') return '已唤醒'
  if (status === 'camera_sleeping' || status === 'stopped') return '已休眠'
  if (status === 'pending_kkos') return '等待 KKOS 执行'
  if (status === 'pending_device_apply') return 'KKOS 已接收，待设备生效'
  if (status === 'waking' || status === 'starting') return '唤醒中'
  if (status === 'sleeping_pending' || status === 'stopping') return '休眠中'
  if (status === 'failed') return '下发失败'
  return row.enabled === false ? '已休眠' : '未唤醒'
}
function runtimeIsAwake(row: any) {
  return ['camera_awake', 'running', 'waking', 'starting', 'pending_device_apply'].includes(row.runtime_control?.status)
}
function runtimeStatusTag(status: string, enabled: boolean) {
  if (status === 'camera_awake' || status === 'running') return 'success'
  if (status === 'pending_kkos' || status === 'pending_device_apply' || status === 'waking' || status === 'sleeping_pending' || status === 'starting' || status === 'stopping') return 'warning'
  if (status === 'failed') return 'danger'
  return enabled ? 'info' : 'info'
}
function runtimeStatusDetail(row: any) {
  const control = row.runtime_control || {}
  if (control.last_error) return control.last_error
  if (control.config_sync_error) return `参数下发待重试：${control.config_sync_error}`
  if (control.config_synced_at) return `参数最近下发：${control.config_synced_at}`
  if (control.endpoint) return control.endpoint
  if (control.applied_at) return `最近生效：${control.applied_at}`
  if (control.requested_at) return `最近操作：${control.requested_at}`
  return row.enabled === false ? '摄像头休眠：L1/L2 服务仍常驻运行，只是不处理这一路画面' : '算法配置已保存，尚未向 KKOS 下发摄像头唤醒命令'
}
function resetAllocationDraft() {
  draftAssignments.value = Object.fromEntries(assignmentSuggestions.value.map((item) => [item.binding_id, item.suggested_l1_device_id]))
}

async function load() {
  loading.value = true
  try {
    const [customerRes, siteRes, cameraRes, deviceRes, policyRes, templateRes, bindingRes] = await Promise.all([
      api.get('/customers'),
      api.get('/sites'),
      api.get('/cameras'),
      api.get('/managed-devices'),
      api.get('/scenario-policies'),
      api.get('/scenario-templates'),
      api.get('/camera-bindings'),
    ])
    customers.value = customerRes.data
    sites.value = siteRes.data
    cameras.value = cameraRes.data
    devices.value = deviceRes.data
    policies.value = policyRes.data
    templates.value = templateRes.data
    bindings.value = bindingRes.data
    resetAllocationDraft()
  } finally {
    loading.value = false
  }
}
function blankBinding() {
  const customer = customers.value[0]
  const site = sites.value.find((item) => item.customer_id === customer?.customer_id)
  const camera = cameras.value.find((item) => item.site_id === site?.site_id)
  const defaultL1 = l1Devices.value.find((item) => item.site_id === site?.site_id && item.status === 'online') || l1Devices.value.find((item) => item.site_id === site?.site_id) || l1Devices.value[0]
  const defaultL2 = l2Devices.value.find((item) => item.site_id === site?.site_id && item.status === 'online') || l2Devices.value.find((item) => item.site_id === site?.site_id) || l2Devices.value[0]
  return {
    customer_id: customer?.customer_id || '',
    site_id: site?.site_id || '',
    camera_id: camera?.camera_id || '',
    scenario: 'ev_intrusion',
    policy_id: '',
    sensitivity: 'standard',
    roi: { roi_id: `roi-${Date.now()}`, type: 'polygon', coordinate_space: 'normalized', points: [[0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]], hit_test: { mode: 'bbox_intersection_ratio', min_ratio: 0.3 } },
    overrides: {},
    enabled: true,
    assigned_l1_device_id: camera?.assigned_l1_device_id || defaultL1?.device_id || '',
    assigned_l2_device_id: camera?.assigned_l2_device_id || defaultL2?.device_id || '',
  }
}
async function openBinding(row?: any) {
  form.value = row ? JSON.parse(JSON.stringify(row)) : blankBinding()
  delete form.value.runtime_config
  const template = templates.value.find((item) => item.scenario === form.value.scenario)
  const auditSec = Number(form.value.overrides?.audit_interval_sec || template?.audit_interval_sec || template?.sampling_strategy?.time_interval_sec || 1800)
  form.value.audit_interval_min = Math.max(1, Math.round(auditSec / 60))
  editing.value = true
  await preview()
}
function onCustomerChange() {
  form.value.site_id = filteredSites.value[0]?.site_id || ''
  form.value.camera_id = filteredCameras.value[0]?.camera_id || ''
  schedulePreview()
}
function onCameraChange() {
  const camera = cameras.value.find((item) => item.camera_id === form.value.camera_id)
  if (camera) {
    form.value.assigned_l1_device_id = camera.assigned_l1_device_id
    form.value.assigned_l2_device_id = camera.assigned_l2_device_id
  }
  schedulePreview()
}
function schedulePreview() {
  window.clearTimeout(previewTimer)
  previewTimer = window.setTimeout(() => preview(), 260)
}
async function preview() {
  if (!form.value?.camera_id || !form.value?.scenario) return
  const seq = ++previewSeq
  const payload = bindingPayload()
  try {
    const response = await api.post('/config-resolver/preview', { binding: payload })
    if (seq === previewSeq) runtime.value = response.data
  } catch (error: any) {
    if (seq === previewSeq) {
      runtime.value = null
      ElMessage.warning(error?.response?.data?.detail || error?.message || 'runtime_config 预览失败')
    }
  }
}
async function saveBinding() {
  const payload = bindingPayload()
  const response = form.value.binding_id
    ? await api.put(`/camera-bindings/${form.value.binding_id}`, payload)
    : await api.post('/camera-bindings', payload)
  if (response.data?.runtime_sync && !response.data.runtime_sync.ok) {
    ElMessage.warning(response.data.runtime_sync.message || '绑定已保存，但边缘设备尚未确认新配置')
  } else {
    ElMessage.success('绑定已保存并下发到边缘设备')
  }
  editing.value = false
  await load()
}
function bindingPayload() {
  const payload = JSON.parse(JSON.stringify(form.value))
  payload.overrides = payload.overrides || {}
  if (payload.scenario === 'desk_drink_intrusion' && Number(payload.audit_interval_min)) {
    payload.overrides.audit_interval_sec = Math.round(Number(payload.audit_interval_min) * 60)
  }
  delete payload.audit_interval_min
  return payload
}
async function toggleRuntime(row: any, enabled: boolean) {
  controlLoading.value = { ...controlLoading.value, [row.binding_id]: true }
  try {
    const res = await api.post(`/camera-bindings/${row.binding_id}/runtime-control`, { action: enabled ? 'wake' : 'sleep', enabled })
    if (res.data?.applied) {
      ElMessage.success(enabled ? '已唤醒摄像头，纳入常驻 L1/L2 管道' : '已休眠摄像头，L1/L2 服务保持运行')
    } else if (res.data?.accepted) {
      ElMessage.info('KKOS 已接收配置，等待 L1/L2 回报实际生效版本')
    } else {
      ElMessage.warning(res.data?.kkos_deploy?.message || res.data?.binding?.runtime_control?.last_error || '已保存开关状态，等待 KKOS 执行')
    }
    await load()
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.detail || error?.response?.data?.binding?.runtime_control?.last_error || '摄像头开关操作失败')
    await load()
  } finally {
    controlLoading.value = { ...controlLoading.value, [row.binding_id]: false }
  }
}
async function applySuggestedAssignments() {
  const targets = bindings.value.filter((binding) => {
    const current = binding.runtime_config?.assigned_l1_device_id || binding.assigned_l1_device_id
    const drafted = draftAssignments.value[binding.binding_id] || current
    return current !== drafted
  })
  if (!targets.length) {
    ElMessage.success('当前草案没有需要生效的变更')
    return
  }
  applyingSuggestions.value = true
  try {
    for (const binding of targets) {
      const next = {
        ...binding,
        assigned_l1_device_id: draftAssignments.value[binding.binding_id],
        assigned_l2_device_id: binding.runtime_config?.assigned_l2_device_id || binding.assigned_l2_device_id || 'rk3568_01',
      }
      delete next.runtime_config
      await api.put(`/camera-bindings/${binding.binding_id}`, next)
    }
    ElMessage.success(`已确认 ${targets.length} 条绑定关系，并重新生成 runtime_config`)
    await load()
  } finally {
    applyingSuggestions.value = false
  }
}
onMounted(load)
onBeforeUnmount(() => window.clearTimeout(previewTimer))
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
.audit-interval { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
.field-tip { color:#64748b; font-size:12px; }
.page-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
.panel,.preview { border-radius:8px; border:1px solid #dbe4ef; }
.card-head { display:flex; align-items:center; justify-content:space-between; gap:12px; font-weight:700; }
.card-actions { display:flex; gap:8px; }
.hint { margin:0; color:#64748b; line-height:1.6; }
.assignment-panel :deep(.el-card__body) { display:flex; flex-direction:column; gap:12px; }
.assignment-summary { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:12px; }
.sentinel-card { padding:12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; }
.sentinel-title { font-weight:700; color:#0f172a; margin-bottom:8px; }
.sentinel-load { margin:6px 0 10px; color:#64748b; font-size:12px; }
.sentinel-cameras { display:flex; flex-wrap:wrap; gap:8px; }
.suggestion-table { margin-top:2px; }
.reason { margin-top:4px; color:#64748b; font-size:12px; line-height:1.4; }
.override-grid,.device-grid,.runtime-grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:10px; width:100%; }
.runtime-grid span { padding:8px 10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; }
.runtime-note { margin-top:12px; padding:10px 12px; border-radius:8px; background:#eff6ff; color:#1e3a8a; font-size:13px; line-height:1.55; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
</style>
