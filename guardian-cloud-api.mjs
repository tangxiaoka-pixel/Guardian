import http from 'node:http'
import { createHmac } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const now = Date.now()
const iso = (m = 0) => new Date(now - m * 60000).toISOString()
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const runtimeDir = resolve(repoRoot, 'cloud/admin/runtime')
const algorithmStatePath = resolve(runtimeDir, 'algorithm-configs.json')
const cloudAlarmsPath = resolve(runtimeDir, 'cloud-alarms.json')
const edgeCommandsPath = resolve(runtimeDir, 'edge-commands.json')
const businessDataPath = resolve(runtimeDir, 'business-data.json')
const deviceHealthReportsPath = resolve(runtimeDir, 'device-health-reports.json')
const discoveredDevicesPath = resolve(runtimeDir, 'discovered-devices.json')
const rv1126RuntimeConfigPath = resolve(repoRoot, 'configs/runtime/rv1126_three_rtsp.conf')
const lifecycleRegistryDir = resolve(repoRoot, 'guardian_ai_lifecycle/storage/registry')
const channels = []
const businessNow = () => new Date().toISOString()
const resolutionFactors = { '720p': 0.8, '1080p': 1.0, '2k': 1.5, '4k': 2.5 }
const scenarioNames = {
  ev_intrusion: '电瓶车进电梯',
  fire_lane: '消防通道占用',
  trash_overflow: '垃圾点溢满',
  person_intrusion: '危险区域人员停留',
  bottle_cap_missing: '瓶盖是否缺失',
  desk_drink_intrusion: '桌面饮品容器禁放检测',
}
const kkosGatewayTypes = ['rk3568', 'rk3588', 'kkos_gateway']
const deviceHealthStaleMs = Number(process.env.GUARDIAN_DEVICE_HEALTH_STALE_MS || 2 * 60 * 1000)
const edgeRuntimeCacheTtlMs = Number(process.env.GUARDIAN_EDGE_RUNTIME_CACHE_TTL_MS || 30 * 1000)
const forgeRuntimeCacheTtlMs = Number(process.env.GUARDIAN_FORGE_RUNTIME_CACHE_TTL_MS || 15 * 1000)
const edgeDirectSshEnabled = process.env.GUARDIAN_EDGE_DIRECT_SSH_ENABLED === '1'
const mageVlmBaseUrl = (process.env.GUARDIAN_MAGE_VLM_BASE_URL || process.env.GUARDIAN_OLLAMA_BASE_URL || 'http://100.65.222.51:11434').replace(/\/$/, '')
// 5070Ti 的正式审计模型已迁移到 Ollama Qwen2.5-VL；保留旧变量名仅为兼容。
const mageVlmModel = process.env.GUARDIAN_OLLAMA_VLM_MODEL || process.env.GUARDIAN_MAGE_VLM_MODEL || 'qwen2.5vl:7b'
const vlmInferenceBaseUrl = (
  process.env.GUARDIAN_VLM_INFERENCE_BASE_URL
  || process.env.GUARDIAN_MAGE_STANDALONE_BASE_URL
  || 'http://100.65.222.51:8000'
).replace(/\/$/, '')
const vlmInferenceModel = process.env.GUARDIAN_VLM_INFERENCE_MODEL || process.env.GUARDIAN_MAGE_STANDALONE_MODEL || 'microsoft/Mage-VL'
const forgeServiceBaseUrl = (process.env.GUARDIAN_FORGE_SERVICE_BASE_URL || 'http://100.65.222.51:8765').replace(/\/$/, '')
const forgeFileServiceBaseUrl = (process.env.GUARDIAN_FORGE_FILE_SERVICE_BASE_URL || 'http://100.65.222.51:8766').replace(/\/$/, '')
const forgeFilePreviewToken = process.env.GUARDIAN_FORGE_FILE_PREVIEW_TOKEN || process.env.GUARDIAN_DEVICE_TOKEN || 'f18081780a87b0bd167f7b35e5b403d0ab254041ec660846'
const kkosDiscoveryCapabilities = [
  {
    category: 'l1_sentinel',
    display_name: 'L1 哨兵节点',
    device_types: ['rv1126', 'rv1126b', 'rv1106'],
    discovery_methods: ['kkos_agent_heartbeat', 'lan_ping_fingerprint', 'service_port_probe'],
    identity_keys: ['device_sn', 'mac', 'ip'],
    confirm_required: true,
    cloud_manual_create: false,
    notes: 'RV1126/RV1106 只能由 RK3568/KKOS 发现并上报，云端不直连。优先使用设备心跳/序列号，其次用 MAC/IP 临时识别。',
  },
  {
    category: 'camera',
    display_name: '摄像头 / NVR 通道',
    device_types: ['ip_camera', 'nvr_channel', 'rtsp_stream'],
    discovery_methods: ['onvif', 'rtsp_import', 'nvr_channel_list'],
    identity_keys: ['onvif_uuid', 'rtsp_url', 'mac'],
    confirm_required: true,
    cloud_manual_create: false,
    notes: '第一版可由 KKOS 扫 ONVIF 或导入 RTSP 清单，平台确认后再进入点位和算法绑定。',
  },
  {
    category: 'iot',
    display_name: 'IoT 设备 / 传感器',
    device_types: ['modbus_sensor', 'rs485_device', 'mqtt_device', 'access_controller'],
    discovery_methods: ['modbus_scan', 'rs485_bus_scan', 'mqtt_topic_discovery', 'vendor_adapter'],
    identity_keys: ['bus_address', 'topic', 'vendor_sn'],
    confirm_required: true,
    cloud_manual_create: false,
    notes: 'IoT 识别范围由项目启用的协议插件决定，KKOS 负责协议适配，云端只看统一设备模型。',
  },
]
function loadBusinessData() {
  if (!existsSync(businessDataPath)) return {}
  try {
    const data = JSON.parse(readFileSync(businessDataPath, 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

const persistedBusinessData = loadBusinessData()
const customers = Array.isArray(persistedBusinessData.customers) ? persistedBusinessData.customers : []
const sites = Array.isArray(persistedBusinessData.sites) ? persistedBusinessData.sites : []
const managedDevices = Array.isArray(persistedBusinessData.managedDevices) ? persistedBusinessData.managedDevices : []
const cameras = Array.isArray(persistedBusinessData.cameras) ? persistedBusinessData.cameras : []

function saveBusinessData() {
  mkdirSync(runtimeDir, { recursive: true })
  writeFileSync(businessDataPath, `${JSON.stringify({
    customers,
    sites,
    managedDevices,
    cameras,
    cameraScenarioBindings,
    projectNotificationSettings,
    forgeCenters,
    forgeActivations,
    forgeProjectBindings,
    forgeDeviceBindings,
    forgeSamplePolicies,
    forgeModelVersions,
    forgeReleaseApprovals,
    forgeReleases,
    forgeHeartbeats,
    forgeSyncLogs,
  }, null, 2)}\n`, 'utf8')
}
const globalScenarioTemplates = [
  ['ev_intrusion', ['bicycle', 'motorcycle', 'electric_scooter', 'electric_bike'], 4, 3, 5, 0.30, 0.45, 2, 0, 10, 'critical', 25, 0.5],
  ['person_intrusion', ['person'], 3, 2, 4, 0.30, 0.45, 3, 5, 20, 'high', 20, 0.8],
  ['fire_lane', ['car', 'truck', 'van', 'motorcycle'], 1, 0.5, 2, 0.35, 0.50, 3, 30, 60, 'medium', 12, 0.3],
  ['trash_overflow', ['outdoor_trash_bin', 'outdoor_trash_bin_full', 'garbage_bag', 'trash_overflow'], 0.5, 1 / 3600, 1, 0.40, 0.55, 2, 120, 300, 'low', 8, 0.1],
].map(([scenario, target_classes, default_sample_fps, min_sample_fps, max_sample_fps, l1_threshold, l2_threshold, consecutive_frames, min_duration_sec, cooldown_sec, priority, capacity_base_cost, candidate_rate_per_min]) => ({
  scenario,
  template_version: 'guardian-default-v1',
  display_name: scenarioNames[scenario],
  description: `${scenarioNames[scenario]} 默认场景模板`,
  lifecycle_stage: 'production',
  cold_start_enabled: false,
  initial_l1_mode: 'model_inference',
  l2_local_mode: 'local_yolo_review',
  remote_enhancement_mode: 'off_by_default',
  teacher_model: '',
  teacher_policy: '',
  seed_dataset_target: {},
  sampling_strategy: { modes: ['target_triggered'], time_interval_sec: 0, random_background_rate_per_min: 0, upload_on_no_alarm: false },
  edge_pipeline: {
    l1: {
      role: 'coarse_filter',
      frame_policy: '按场景 sample_fps 抽帧，命中目标对象后生成候选帧',
      report_policy: '仅上报 L1 候选帧和必要元数据到 L2',
    },
    l2: {
      role: 'local_review',
      review_policy: 'L2 使用本地 YOLO/专用模型复核，独立决定是否形成告警',
      alarm_policy: '有效告警上云展示；不依赖远端大模型实时返回',
    },
    forge: {
      role: 'optional_training_center',
      sample_policy: '客户授权后，按样本策略回流图片到 Forge 做审计、自动标注和训练',
      realtime_dependency: false,
    },
  },
  reporting_policy: {
    l1_to_l2: 'candidate_frame_with_metadata',
    l2_to_cloud: 'local_l2_alarm_only',
    sample_to_forge: 'off_by_default_customer_authorized',
    model_release: 'cloud_registry_to_l2_then_l1',
  },
  target_classes,
  default_sample_fps,
  min_sample_fps,
  max_sample_fps,
  l1_threshold,
  l2_threshold,
  consecutive_frames,
  min_duration_sec,
  cooldown_sec,
  priority,
  roi_required: true,
  roi_type: 'polygon',
  capacity_base_cost,
  candidate_rate_per_min,
  enabled: true,
  created_at: businessNow(),
  updated_at: businessNow(),
})).concat([{
  scenario: 'desk_drink_intrusion',
  template_version: 'guardian-desk-drink-v1',
  display_name: scenarioNames.desk_drink_intrusion,
  description: '固定工位摄像头的桌面禁放区检测：杯子、瓶子、保温杯或易拉罐进入 ROI 后报警。首版不判断容器是否装有液体。',
  lifecycle_stage: 'cold_start_observation',
  cold_start_enabled: true,
  initial_l1_mode: 'coco_cup_bottle_trigger_then_specialized_model',
  l2_local_mode: 'local_yolo_temporal_roi_review',
  remote_enhancement_mode: 'authorized_vlm_audit_and_training',
  teacher_model: 'ollama/qwen2.5vl:7b@5070Ti',
  teacher_policy: '仅对脱敏后的 L1/L2 样本做审计和预标注；VLM 不阻塞本地即时告警。VLM 高置信发现的 L1/L2 漏报记录为 shadow_positive，进入人工复核与训练优先队列。',
  seed_dataset_target: { positive: 300, negative: 500, hard_negative: 100, minimum_capture_sessions: 10, holdout_ratio: 0.2 },
  // Static desktop risks are gated locally.  The 30-second guard still goes
  // through L1 first; it must never bypass L1 and flood a shared L2 gateway.
  audit_interval_sec: 30,
  baseline_change_gating: true,
  baseline_stable_sec: 3,
  baseline_max_silence_sec: 30,
  motion_burst_sec: 6,
  sampling_strategy: { modes: ['l1_candidate', 'l2_rejected', 'low_confidence', 'l1_safety_scan', 'scene_change', 'l2_confirmed'], time_interval_sec: 30, daily_miss_guard_target: 2880, scene_change_extra_frame: true, upload_on_no_alarm: false, cloud_upload_requires_authorization: true, privacy: 'blur_person_face_and_screen_before_cloud_upload' },
  edge_pipeline: {
    l1: { role: 'coarse_filter_and_baseline_change_gate', frame_policy: '常态以 2fps 进行低成本基线变化检测；ROI 连续静止 3 秒后建立基线。基线差异达到绝对连通区域门槛时，等待画面稳定后进入 6 秒、2fps 的 L1 RKNN 验证窗口。距上次 L1 推理达到 30 秒时，强制送 1 帧 L1 安全扫描。', report_policy: '只有 L1 连续 2 帧命中饮品容器才形成候选并进入 L2；L1 未命中后，待画面稳定再更新基线。安全扫描与变化验证都先经过 L1，普通帧不归档、不进入云端或训练。' },
    l2: { role: 'local_review_and_risk_state', review_policy: '只复核 L1 候选，以及已有风险状态的消除确认帧；目标位于 ROI、L2 置信度至少 0.60 且持续命中至少 3 秒时确认。', alarm_policy: '一摄像头 × 一算法只维护一个风险状态：确认后为 active；同一风险持续存在只更新状态，不新增报警；连续两次 L2 阴性复核后变为 resolved。' },
    forge: { role: 'vlm_audit_auto_label_and_trainer', sample_policy: 'VLM 标记 positive/negative/uncertain/shadow_positive；uncertain 和 shadow_positive 必须人工复核后入训练集。', realtime_dependency: false },
  },
  reporting_policy: { l1_to_l2: 'two_consecutive_roi_candidates_only', l1_to_cloud: 'authorized_deidentified_low_confidence_and_rejected_samples_only', l2_to_cloud: 'confirmed_or_resolved_risk_state_and_reviewed_samples', sample_to_forge: 'authorized_vlm_audit_then_human_gated_training', model_release: 'evaluation_gate_to_registry_to_l2_then_l1_with_ack_and_rollback' },
  target_classes: ['bottle', 'cup', 'wine_glass'],
  future_target_classes: ['drink_container'],
  training_label_schema: { detector_class: 'drink_container', attributes: ['cup', 'mug', 'bottle', 'thermos', 'can'], excluded: ['screen_image', 'object_outside_roi'] },
  vlm_audit_prompt: '桌面指定禁放区域内是否可见杯子、瓶子、保温杯或易拉罐等饮品容器？仅依据可见画面，返回 positive、negative 或 uncertain，并说明对象是否位于 ROI 内。',
  default_sample_fps: 2, min_sample_fps: 1, max_sample_fps: 3, l1_threshold: 0.45, l2_threshold: 0.60,
  consecutive_frames: 2, min_duration_sec: 3, cooldown_sec: 300, reset_after_absence_sec: 5,
  priority: 'high', roi_required: true, roi_type: 'polygon', capacity_base_cost: 16, candidate_rate_per_min: 1, enabled: true,
  created_at: businessNow(), updated_at: businessNow(),
}, {
  scenario: 'bottle_cap_missing',
  template_version: 'guardian-coldstart-v1',
  display_name: scenarioNames.bottle_cap_missing,
  description: '算法冷启动模板：L1 先用 bottle 做粗筛候选触发，L2 坚持本地 YOLO/更精准算法复核；远端 Qwen7B 仅作为可选 Forge 教师模型，用于样本审计、自动标注和训练加速。',
  lifecycle_stage: 'sampling',
  cold_start_enabled: true,
  initial_l1_mode: 'base_object_trigger',
  l2_local_mode: 'local_yolo_review_then_specialized_model',
  remote_enhancement_mode: 'optional_forge_teacher',
  teacher_model: 'ollama/qwen2.5vl:7b@5070Ti',
  teacher_policy: '远端 Qwen7B 不参与 L2 实时基础判定，只用于回流样本的审计/预标注/训练集构建；低置信或画面不可见时进入人工复核。',
  seed_dataset_target: { cap_present: 50, cap_missing: 50, invalid_sample: 20, min_human_review_ratio: 0.2 },
  sampling_strategy: {
    modes: ['base_object_trigger', 'time_interval', 'random_background', 'low_confidence'],
    base_object_classes: ['bottle'],
    time_interval_sec: 10,
    random_background_rate_per_min: 0.2,
    upload_on_no_alarm: true,
  },
  edge_pipeline: {
    l1: {
      role: 'coarse_filter_cold_start',
      frame_policy: '用 bottle 基础对象做候选触发，同时保留 10 秒周期抽帧和少量背景抽样',
      report_policy: '命中 bottle、低置信、周期抽样或背景抽样时上传候选帧到 L2',
    },
    l2: {
      role: 'local_review_cold_start',
      review_policy: '先用 L2 本地 YOLO/规则确认画面可用性；专用瓶盖模型成熟后切换为本地精准复核',
      alarm_policy: '专用模型未成熟前默认不放开生产告警，只沉淀样本和人工复核结果',
    },
    forge: {
      role: 'optional_teacher_and_trainer',
      sample_policy: '客户授权后，L2 将候选样本回流到 5070Ti Forge，由 Qwen2.5-VL 做预标注并进入训练集',
      realtime_dependency: false,
    },
  },
  reporting_policy: {
    l1_to_l2: 'base_object_or_interval_candidate',
    l2_to_cloud: 'verified_alarm_after_specialized_model_ready',
    sample_to_forge: 'authorized_candidates_and_low_confidence_samples',
    model_release: 'cloud_registry_to_l2_then_l1_with_human_approval',
  },
  target_classes: ['bottle'],
  future_target_classes: ['cap_present', 'cap_missing'],
  default_sample_fps: 1,
  min_sample_fps: 0.2,
  max_sample_fps: 3,
  l1_threshold: 0.25,
  l2_threshold: 0.45,
  consecutive_frames: 1,
  min_duration_sec: 0,
  cooldown_sec: 5,
  priority: 'medium',
  roi_required: true,
  roi_type: 'polygon',
  capacity_base_cost: 10,
  candidate_rate_per_min: 1.5,
  enabled: true,
  created_at: businessNow(),
  updated_at: businessNow(),
}])

let forgeCenters = Array.isArray(persistedBusinessData.forgeCenters) ? persistedBusinessData.forgeCenters : []
let forgeActivations = Array.isArray(persistedBusinessData.forgeActivations) ? persistedBusinessData.forgeActivations : []
let forgeProjectBindings = Array.isArray(persistedBusinessData.forgeProjectBindings) ? persistedBusinessData.forgeProjectBindings : []
let forgeDeviceBindings = Array.isArray(persistedBusinessData.forgeDeviceBindings) ? persistedBusinessData.forgeDeviceBindings : []
let forgeSamplePolicies = Array.isArray(persistedBusinessData.forgeSamplePolicies) ? persistedBusinessData.forgeSamplePolicies : []
let forgeModelVersions = Array.isArray(persistedBusinessData.forgeModelVersions) ? persistedBusinessData.forgeModelVersions : []
let forgeReleaseApprovals = Array.isArray(persistedBusinessData.forgeReleaseApprovals) ? persistedBusinessData.forgeReleaseApprovals : []
let forgeReleases = Array.isArray(persistedBusinessData.forgeReleases) ? persistedBusinessData.forgeReleases : []
let forgeHeartbeats = Array.isArray(persistedBusinessData.forgeHeartbeats) ? persistedBusinessData.forgeHeartbeats : []
let forgeSyncLogs = Array.isArray(persistedBusinessData.forgeSyncLogs) ? persistedBusinessData.forgeSyncLogs : []
let customerScenarioPolicies = []
let cameraScenarioBindings = Array.isArray(persistedBusinessData.cameraScenarioBindings) ? persistedBusinessData.cameraScenarioBindings : []
let projectNotificationSettings = Array.isArray(persistedBusinessData.projectNotificationSettings) ? persistedBusinessData.projectNotificationSettings : []
const frameSizesByChannel = {
  0: { frame_width: 640, frame_height: 1138 },
  1: { frame_width: 640, frame_height: 360 },
  2: { frame_width: 640, frame_height: 360 },
}

const rvHost = 'root@192.168.4.44'
const rkHost = 'root@192.168.4.43'
const deviceProbeCache = new Map()
const edgeRuntimeCache = new Map()
let lastPlayback = { status: 'idle', started_at: null, mode: 'finite_replay_60s', streams: [] }

function run(cmd, args, fallback = '', timeout = 5000) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout })
  } catch {
    return fallback
  }
}

function runBuffer(cmd, args, timeout = 5000) {
  try {
    return execFileSync(cmd, args, { timeout })
  } catch {
    return Buffer.alloc(0)
  }
}

function contentTypeForPath(value = '') {
  const lower = String(value).toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.txt')) return 'text/plain; charset=utf-8'
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

function ssh(host, command, fallback = '') {
  return run('ssh', ['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=2', '-o', 'BatchMode=yes', host, command], fallback, 3000)
}

function edgeSsh(host, command, fallback = '') {
  if (!edgeDirectSshEnabled) return fallback
  return ssh(host, command, fallback)
}

function cachedEdge(key, ttlMs, loader, fallback) {
  const cached = edgeRuntimeCache.get(key)
  if (cached && Date.now() - cached.at < ttlMs) return cached.value
  try {
    const value = loader()
    edgeRuntimeCache.set(key, { at: Date.now(), value })
    return value
  } catch {
    return cached?.value ?? fallback
  }
}

function sh(command, fallback = '') {
  return run('/bin/sh', ['-lc', command], fallback)
}

function parseMemPercent(text = '') {
  const total = Number(text.match(/MemTotal:\s+(\d+)/)?.[1] || 0)
  const avail = Number(text.match(/MemAvailable:\s+(\d+)/)?.[1] || 0)
  return total ? Math.round((1 - avail / total) * 100) : null
}

function parseCma(text = '') {
  const total = Number(text.match(/CmaTotal:\s+(\d+)/)?.[1] || 0)
  const free = Number(text.match(/CmaFree:\s+(\d+)/)?.[1] || 0)
  if (!total) return ''
  return `${Math.round((total - free) / 1024)}M/${Math.round(total / 1024)}M`
}

function parseCpuPercent(text = '') {
  const idle = Number(text.match(/cpu_idle=([0-9.]+)/)?.[1] || NaN)
  return Number.isFinite(idle) ? Math.max(0, Math.min(100, Math.round(100 - idle))) : null
}

function parseTemperature(text = '') {
  const raw = Number(text.match(/thermal_raw=(-?\d+)/)?.[1] || NaN)
  if (!Number.isFinite(raw)) return ''
  const c = raw > 1000 ? raw / 1000 : raw
  return `${c.toFixed(1)}C`
}

function fetchJson(url) {
  const text = run('curl', ['-sS', '-m', '2', '--connect-timeout', '1', url], '', 2500)
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function fetchJsonWithTimeout(url, timeoutSec = 10) {
  const text = run('curl', ['-sS', '-m', String(timeoutSec), '--connect-timeout', '2', url], '', (timeoutSec + 1) * 1000)
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function postJson(url, body = {}) {
  const text = run('curl', ['-sS', '-m', '15', '-X', 'POST', url, '-H', 'Content-Type: application/json', '--data', JSON.stringify(body)], '')
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function postJsonWithStatus(url, body = {}, timeoutSec = 15) {
  const text = run('curl', ['-sS', '-m', String(timeoutSec), '-w', '\n%{http_code}', '-X', 'POST', url, '-H', 'Content-Type: application/json', '--data', JSON.stringify(body)], '', (timeoutSec + 2) * 1000)
  if (!text) return { ok: false, status: 0, body: null, error: 'no_response' }
  const splitAt = text.lastIndexOf('\n')
  const rawBody = splitAt >= 0 ? text.slice(0, splitAt) : text
  const status = Number(splitAt >= 0 ? text.slice(splitAt + 1) : 0)
  let parsed = null
  try {
    parsed = rawBody ? JSON.parse(rawBody) : null
  } catch {
    parsed = rawBody
  }
  const bodyOk = !(parsed && typeof parsed === 'object' && parsed.ok === false)
  return { ok: status >= 200 && status < 300 && bodyOk, status, body: parsed, error: status ? '' : 'request_failed' }
}

function probeKkosHttp(device = {}, checkedAt = businessNow()) {
  const tailscaleIp = device.tailscale_ip || device.tailscaleIp || ''
  if (!tailscaleIp) return null
  const snapshot = fetchJson(`http://${tailscaleIp}:9200/cloud/snapshot`)
  const status = snapshot ? null : fetchJson(`http://${tailscaleIp}:9200/status`)
  if (!snapshot && !status) return null
  const gateway = snapshot?.gateways?.[0] || {}
  const resources = gateway.resources || {}
  const service = (snapshot?.services || []).find((item) => item.service_name === 'kkos.service') || {}
  return {
    status: gateway.online_status || (status?.started ? 'online' : 'unknown'),
    online_status: gateway.online_status || (status?.started ? 'online' : 'unknown'),
    status_source: 'kkos_http',
    reachable: true,
    cpu_usage: resources.cpu ?? null,
    memory_usage: resources.memory ?? null,
    cma_usage: resources.cma || '',
    npu_latency_ms: resources.npu_latency_ms ?? null,
    temperature: resources.temperature || '',
    service_status: service.status || (status?.started ? 'active' : 'unknown'),
    gateway_status: snapshot?.summary?.health_status || (status?.started ? 'healthy' : 'unknown'),
    kkos_version: gateway.kkos_version || '',
    brain_version: gateway.brain_version || '',
    child_devices: snapshot?.summary?.child_devices ?? null,
    ai_link_status: snapshot?.summary?.ai_link_status || '',
    model_consistency: snapshot?.summary?.model_consistency || '',
    last_heartbeat: gateway.last_seen_at || checkedAt,
    health_checked_at: gateway.last_seen_at || checkedAt,
    collect_error: '',
  }
}

function triggerKkosDiscovery(device = {}) {
  const tailscaleIp = device.tailscale_ip || device.tailscaleIp || ''
  if (!tailscaleIp) return { ok: false, error: 'kkos_gateway_missing_tailscale_ip' }
  const scan = postJson(`http://${tailscaleIp}:9200/discovery/scan`, {})
  if (!scan) return { ok: false, error: 'kkos_discovery_scan_failed' }
  const report = postJson(`http://${tailscaleIp}:9200/cloud/report`, {}) || {}
  deviceProbeCache.clear()
  return {
    ok: true,
    gateway_id: device.device_id,
    gateway_name: device.device_name,
    scan_count: Array.isArray(scan.devices) ? scan.devices.length : 0,
    discovered_devices: Array.isArray(scan.devices) ? scan.devices : [],
    cloud_report: report,
  }
}

function loadDeviceHealthReports() {
  if (!existsSync(deviceHealthReportsPath)) return []
  try {
    const data = JSON.parse(readFileSync(deviceHealthReportsPath, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function saveDeviceHealthReports(rows) {
  mkdirSync(runtimeDir, { recursive: true })
  writeFileSync(deviceHealthReportsPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
}

function loadDiscoveredDevices() {
  if (!existsSync(discoveredDevicesPath)) return []
  try {
    const data = JSON.parse(readFileSync(discoveredDevicesPath, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function saveDiscoveredDevices(rows) {
  mkdirSync(runtimeDir, { recursive: true })
  writeFileSync(discoveredDevicesPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
}

function normalizeDiscoveredDevice(item = {}, envelope = {}) {
  const discoveredAt = item.discovered_at || item.discoveredAt || envelope.reported_at || businessNow()
  return {
    discovery_id: item.discovery_id || item.discoveryId || `disc-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    customer_id: item.customer_id || envelope.customer_id || '',
    site_id: item.site_id || envelope.site_id || '',
    gateway_id: item.gateway_id || envelope.gateway_id || '',
    device_name: item.device_name || item.name || '',
    device_type: item.device_type || item.type || 'unknown',
    category: item.category || '',
    role: item.role || '',
    ip: item.ip || item.device_ip || '',
    mac: item.mac || '',
    vendor: item.vendor || '',
    model: item.model || '',
    serial_no: item.serial_no || item.sn || '',
    rtsp_url: item.rtsp_url || item.rtspUrl || '',
    discovery_method: item.discovery_method || item.discoveryMethod || '',
    status: item.status || 'pending_confirm',
    confidence: Number(item.confidence ?? 0.8),
    discovered_at: discoveredAt,
    updated_at: businessNow(),
    raw: item.raw || {},
  }
}

function discoveredDeviceSummaries(url) {
  const customerId = url.searchParams.get('customer_id') || ''
  const siteId = url.searchParams.get('site_id') || ''
  const status = url.searchParams.get('status') || ''
  return loadDiscoveredDevices().filter((item) => (
    (!customerId || item.customer_id === customerId)
    && (!siteId || item.site_id === siteId)
    && (!status || item.status === status)
  ))
}

function cameraIp(camera = {}) {
  const match = String(camera.rtsp_url || camera.stream_url || '').match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/)
  return match?.[0] || camera.ip || ''
}

function cameraRtspEndpoint(camera = {}) {
  try {
    const url = new URL(String(camera.rtsp_url || ''))
    const host = url.hostname || ''
    const port = Number(url.port || 554)
    return { host, port }
  } catch {
    return { host: cameraIp(camera), port: 554 }
  }
}

function isPrivateHost(host = '') {
  return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === 'localhost'
}

function tcpReachable(host = '', port = 554) {
  if (!host || isPrivateHost(host)) return false
  try {
    execFileSync('nc', ['-z', '-w', '2', host, String(port)], { encoding: 'utf8', timeout: 3000 })
    return true
  } catch {
    return false
  }
}

function latestCameraDiscovery(camera = {}) {
  const ip = cameraIp(camera)
  return loadDiscoveredDevices()
    .filter((item) => (
      item.category === 'camera'
      && (
        (camera.discovery_id && item.discovery_id === camera.discovery_id)
        || (ip && item.ip === ip)
        || (camera.rtsp_url && item.rtsp_url === camera.rtsp_url)
      )
    ))
    .sort((a, b) => new Date(b.updated_at || b.discovered_at || 0).getTime() - new Date(a.updated_at || a.discovered_at || 0).getTime())[0]
}

function latestDeviceDiscovery(device = {}) {
  const ip = device.ip || device.device_ip || ''
  return loadDiscoveredDevices()
    .filter((item) => (
      (device.discovery_id && item.discovery_id === device.discovery_id)
      || (ip && item.ip === ip)
      || (device.device_id && item.device_id === device.device_id)
    ))
    .sort((a, b) => new Date(b.updated_at || b.discovered_at || 0).getTime() - new Date(a.updated_at || a.discovered_at || 0).getTime())[0]
}

function l1DiscoveryHasServiceProof(discovery = {}) {
  const ports = Array.isArray(discovery.raw?.open_ports) ? discovery.raw.open_ports.map(Number) : []
  const sshBanner = String(discovery.raw?.banner22 || '')
  const sshBanner2222 = String(discovery.raw?.banner2222 || '')
  const isRvL1 = discovery.role === 'l1' || String(discovery.device_type || '').includes('rv1126') || String(discovery.device_type || '').includes('rv1106')
  const knownServicePorts = [554, 8554, 8899, 9000, 9100, 9200]
  const hasSshProof = sshBanner.startsWith('SSH-') || sshBanner2222.startsWith('SSH-') || (isRvL1 && ports.includes(2222))
  return hasSshProof || knownServicePorts.some((port) => ports.includes(port))
}

function cameraDiscoveryIsFresh(discovery = {}) {
  const rawTime = discovery.updated_at || discovery.reported_at || discovery.health_checked_at || discovery.discovered_at || ''
  const ts = Date.parse(rawTime)
  return Number.isFinite(ts) && Date.now() - ts <= deviceHealthStaleMs
}

function cameraSummary(camera = {}) {
  const discovery = latestCameraDiscovery(camera)
  const endpoint = cameraRtspEndpoint(camera)
  const rtspPort = Number(endpoint.port || 554)
  if (discovery) {
    if (cameraDiscoveryIsFresh(discovery)) {
      const ports = Array.isArray(discovery.raw?.open_ports) ? discovery.raw.open_ports.map(Number) : []
      const online = discovery.online_status === 'online' || discovery.status === 'online' || ports.includes(rtspPort) || ports.includes(554) || ports.includes(8554)
      return {
        ...camera,
        status: online ? 'online' : 'offline',
        online_status: online ? 'online' : 'offline',
        status_source: 'kkos_discovery',
        last_status_at: discovery.updated_at || discovery.discovered_at || '',
        collect_error: online ? '' : 'KKOS 最近发现记录中未检测到 RTSP 端口',
      }
    }
    return {
      ...camera,
      status: 'offline',
      online_status: 'offline',
      status_source: 'kkos_discovery_stale',
      last_status_at: discovery.updated_at || discovery.discovered_at || '',
      collect_error: '超过 2 分钟未收到 KKOS 摄像头发现/状态上报，已判定离线',
    }
  }
  if (tcpReachable(endpoint.host, endpoint.port)) {
    return { ...camera, status: 'online', online_status: 'online', status_source: 'cloud_rtsp_probe', last_status_at: businessNow(), collect_error: '' }
  }
  return {
    ...camera,
    status: 'offline',
    online_status: 'offline',
    status_source: endpoint.host && isPrivateHost(endpoint.host) ? 'waiting_kkos_camera_report' : 'cloud_rtsp_probe_failed',
    last_status_at: '',
    collect_error: endpoint.host && isPrivateHost(endpoint.host) ? '内网摄像头必须由 KKOS 上报状态；当前无有效上报，已判定离线' : '云端无法连接 RTSP，已判定离线',
  }
}

function confirmedBusinessBindingForDiscovery(discovered = {}) {
  const byDiscoveryId = (item) => item.discovery_id && item.discovery_id === discovered.discovery_id
  const sameScope = (item) => (
    (!discovered.customer_id || !item.customer_id || item.customer_id === discovered.customer_id)
    && (!discovered.site_id || !item.site_id || item.site_id === discovered.site_id)
  )
  const isCamera = discovered.category === 'camera' || ['ip_camera', 'nvr_channel', 'rtsp_stream'].includes(discovered.device_type)
  if (isCamera) {
    const camera = cameras.find((item) => (
      sameScope(item)
      && item.source_type === 'kkos_discovered'
      && (byDiscoveryId(item) || (discovered.ip && cameraIp(item) === discovered.ip) || (discovered.rtsp_url && item.rtsp_url === discovered.rtsp_url))
    ))
    if (camera) return { status: 'confirmed', confirmed_at: camera.updated_at || camera.created_at || businessNow(), camera_id: camera.camera_id }
    return null
  }
  const device = managedDevices.find((item) => (
    sameScope(item)
    && item.device_source === 'kkos_discovered_confirmed'
    && (
      byDiscoveryId(item)
      || (discovered.ip && item.ip === discovered.ip && (!discovered.device_type || item.device_type === discovered.device_type))
      || (discovered.mac && item.mac === discovered.mac)
    )
  ))
  if (device) return { status: 'confirmed', confirmed_at: device.updated_at || device.created_at || businessNow(), device_id: device.device_id }
  return null
}

function mergeDiscoveredDeviceRows(payloadRows = [], envelope = {}) {
  const existing = loadDiscoveredDevices()
  const existingById = new Map(existing.map((item) => [item.discovery_id, item]))
  const nextRows = payloadRows.map((item) => {
    const next = normalizeDiscoveredDevice(item, envelope)
    const old = existingById.get(next.discovery_id)
    const businessBinding = confirmedBusinessBindingForDiscovery(next)
    if (old?.status === 'confirmed' || businessBinding?.status === 'confirmed') {
      return {
        ...next,
        ...(businessBinding || {}),
        status: 'confirmed',
        confirmed_at: old?.confirmed_at || businessBinding?.confirmed_at || next.confirmed_at || businessNow(),
      }
    }
    return next
  })
  const keys = new Set(nextRows.map((item) => item.discovery_id || `${item.site_id}:${item.ip}:${item.device_type}`))
  const gatewayId = envelope.gateway_id || ''
  const merged = [
    ...nextRows,
    ...existing.filter((item) => {
      if (gatewayId && item.gateway_id === gatewayId) return false
      return !keys.has(item.discovery_id || `${item.site_id}:${item.ip}:${item.device_type}`)
    }),
  ].slice(0, 1000)
  saveDiscoveredDevices(merged)
  return nextRows
}

function latestDeviceHealthReport(device = {}) {
  const keys = [device.device_id, device.ip, device.device_ip, device.device_name].filter(Boolean)
  return loadDeviceHealthReports()
    .filter((item) => keys.includes(item.device_id) || keys.includes(item.ip) || keys.includes(item.device_name))
    .sort((a, b) => new Date(b.reported_at || b.health_checked_at || 0).getTime() - new Date(a.reported_at || a.health_checked_at || 0).getTime())[0]
}

function healthReportTime(report = {}) {
  const raw = report.reported_at || report.health_checked_at || report.last_heartbeat || report.checked_at || ''
  const value = Date.parse(raw)
  return Number.isFinite(value) ? value : 0
}

function healthReportIsStale(report = {}) {
  const reportTime = healthReportTime(report)
  if (!reportTime) return true
  return Date.now() - reportTime > deviceHealthStaleMs
}

function staleHealthReportValue(report = {}, checkedAt = businessNow()) {
  const minutes = Math.max(1, Math.round(deviceHealthStaleMs / 60000))
  const lastSeen = report.reported_at || report.health_checked_at || report.last_heartbeat || ''
  return {
    ...report,
    status: 'offline',
    online_status: 'offline',
    reachable: false,
    status_source: 'kkos_report_stale',
    last_heartbeat: lastSeen || '',
    health_checked_at: lastSeen || checkedAt,
    collect_error: `超过 ${minutes} 分钟未收到 KKOS 状态上报，已判定离线`,
  }
}

function normalizeKkosDeviceReport(item = {}, envelope = {}) {
  return {
    report_id: item.report_id || `dhr-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    customer_id: item.customer_id || envelope.customer_id || '',
    site_id: item.site_id || envelope.site_id || '',
    gateway_id: item.gateway_id || envelope.gateway_id || envelope.device_id || '',
    gateway_ip: item.gateway_ip || envelope.gateway_ip || '',
    device_id: item.device_id || item.id || '',
    device_name: item.device_name || item.name || '',
    device_type: item.device_type || item.type || '',
    role: item.role || '',
    ip: item.ip || item.device_ip || '',
    status: item.status || item.online_status || 'unknown',
    online_status: item.online_status || item.status || 'unknown',
    status_source: 'kkos_report',
    reachable: item.reachable === true || item.status === 'online' || item.online_status === 'online',
    cpu_usage: item.cpu_usage ?? item.cpuUsage ?? null,
    memory_usage: item.memory_usage ?? item.memoryUsage ?? null,
    cma_usage: item.cma_usage || item.cmaUsage || '',
    npu_latency_ms: item.npu_latency_ms ?? item.npuLatencyMs ?? null,
    temperature: item.temperature || '',
    service_status: item.service_status || item.serviceStatus || '',
    gateway_status: item.gateway_status || item.gatewayStatus || item.service_status || '',
    model_version: item.model_version || item.modelVersion || '',
    collect_error: item.collect_error || item.error || '',
    health_checked_at: item.health_checked_at || item.checked_at || item.reported_at || envelope.reported_at || businessNow(),
    reported_at: item.reported_at || envelope.reported_at || businessNow(),
  }
}

function probeDevice(device = {}) {
  const ip = device.tailscale_ip || device.tailscaleIp || device.ip || device.device_ip || ''
  const cacheKey = `${device.device_id || device.device_name || ip}:${ip}`
  const cached = deviceProbeCache.get(cacheKey)
  if (cached && Date.now() - cached.at < 15000) return cached.value
  const checkedAt = businessNow()
  const isKkosGateway = ['rk3568', 'rk3588'].some((type) => String(device.device_type || '').includes(type)) || ['l2', 'mixed'].includes(device.role)
  const kkosReport = latestDeviceHealthReport(device)
  if (kkosReport) {
    if (!healthReportIsStale(kkosReport)) {
      const value = { ...kkosReport, status_source: 'kkos_report' }
      const isL1 = value.role === 'l1' || String(value.device_type || '').includes('rv1126') || String(value.device_type || '').includes('rv1106')
      const discovery = isL1 ? latestDeviceDiscovery(device) : null
      if (isL1 && value.status === 'online' && discovery && !l1DiscoveryHasServiceProof(discovery)) {
        const unhealthy = {
          ...value,
          status: 'offline',
          online_status: 'offline',
          reachable: false,
          status_source: 'kkos_l1_service_unverified',
          collect_error: 'KKOS 只发现基础端口，未确认 SSH banner 或 L1 算法服务端口；已按待修复设备处理',
        }
        deviceProbeCache.set(cacheKey, { at: Date.now(), value: unhealthy })
        return unhealthy
      }
      deviceProbeCache.set(cacheKey, { at: Date.now(), value })
      return value
    }
    if (!isKkosGateway) {
      const value = staleHealthReportValue(kkosReport, checkedAt)
      deviceProbeCache.set(cacheKey, { at: Date.now(), value })
      return value
    }
  }
  if (!ip) {
    const value = { status: 'unknown', status_source: 'waiting_kkos_report', health_checked_at: checkedAt, collect_error: '未配置 IP，等待 KKOS 上报设备状态' }
    deviceProbeCache.set(cacheKey, { at: Date.now(), value })
    return value
  }

  const tailscaleIp = device.tailscale_ip || device.tailscaleIp || ''
  if (!isKkosGateway || !tailscaleIp) {
    const value = { status: 'unknown', status_source: 'waiting_kkos_report', reachable: false, health_checked_at: checkedAt, collect_error: '下挂设备状态必须由 RK3568/KKOS 上报，云端不直连现场局域网设备' }
    deviceProbeCache.set(cacheKey, { at: Date.now(), value })
    return value
  }

  const kkosHttp = probeKkosHttp(device, checkedAt)
  if (kkosHttp) {
    deviceProbeCache.set(cacheKey, { at: Date.now(), value: kkosHttp })
    return kkosHttp
  }

  const perf = ssh(`root@${tailscaleIp}`, [
    "cat /proc/meminfo | grep -E 'MemTotal|MemAvailable|CmaTotal|CmaFree'",
    "awk '/^cpu / { idle=$5; total=0; for (i=2;i<=NF;i++) total+=$i; if (total>0) printf \"cpu_idle=%.2f\\n\", idle*100/total }' /proc/stat",
    "for f in /sys/class/thermal/thermal_zone*/temp; do test -r \"$f\" && echo thermal_raw=$(cat \"$f\") && break; done",
    "echo service_status=$(systemctl is-active guardian-brain-rk3568 2>/dev/null || systemctl is-active guardian-brain-rk3568.service 2>/dev/null || true)",
  ].join('; '), '')
  const serviceStatus = perf.match(/service_status=([^\s]+)/)?.[1] || 'unknown'
  const reachable = perf.includes('MemTotal')
  const value = {
    status: reachable ? 'online' : 'offline',
    status_source: reachable ? 'kkos_direct' : 'kkos_probe_failed',
    reachable,
    cpu_usage: parseCpuPercent(perf),
    memory_usage: parseMemPercent(perf),
    cma_usage: parseCma(perf),
    temperature: parseTemperature(perf),
    service_status: serviceStatus,
    gateway_status: serviceStatus,
    last_heartbeat: checkedAt,
    health_checked_at: checkedAt,
    collect_error: reachable ? '' : 'KKOS 网关主动刷新失败：无法访问 KKOS HTTP，也无法通过 SSH 采集，已判定离线',
  }
  deviceProbeCache.set(cacheKey, { at: Date.now(), value })
  return value
}

function managedDeviceSummaries() {
  return managedDevices.map((device) => {
    const probe = probeDevice(device)
    const realProbe = ['kkos_report', 'kkos_direct', 'kkos_http', 'kkos_report_stale', 'kkos_probe_failed', 'waiting_kkos_report'].includes(probe.status_source || '')
    const hasKkosPerf = ['kkos_report', 'kkos_direct', 'kkos_http'].includes(probe.status_source || '')
    return {
      ...device,
      manual_status: device.status || '',
      status: probe.status || 'unknown',
      online_status: probe.status || 'unknown',
      status_source: probe.status_source || 'real_probe',
      reachable: probe.reachable === true,
      cpu_usage: probe.cpu_usage ?? (realProbe ? null : device.cpu_usage ?? null),
      memory_usage: probe.memory_usage ?? (realProbe ? null : device.memory_usage ?? null),
      cma_usage: probe.cma_usage || (realProbe ? '' : device.cma_usage || ''),
      npu_latency_ms: probe.npu_latency_ms ?? (realProbe ? null : device.npu_latency_ms ?? null),
      temperature: probe.temperature || (realProbe ? '' : device.temperature || ''),
      service_status: probe.service_status || device.service_status || '',
      gateway_status: probe.gateway_status || device.gateway_status || '',
      last_heartbeat: probe.last_heartbeat || device.last_heartbeat || '',
      health_checked_at: probe.health_checked_at || '',
      collect_error: probe.collect_error || '',
    }
  })
}

function managedDeviceSummary(device) {
  return managedDeviceSummaries().find((item) => item.device_id === device.device_id)
}

function canManuallyCreateGateway(body = {}) {
  return kkosGatewayTypes.includes(String(body.device_type || '')) && ['l2', 'mixed', 'gateway', 'kkos'].includes(String(body.role || 'l2'))
}

function lifecycleRegistry(name) {
  const path = resolve(lifecycleRegistryDir, `${name}.json`)
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
}

function normalizeDataPolicy(customerId, policy = {}) {
  const allowCustomerTraining = policy.allow_customer_model_training ?? policy.allow_model_training ?? true
  const hasPlatformTrainingPolicy = Object.prototype.hasOwnProperty.call(policy, 'allow_platform_baseline_training')
  return {
    customer_id: customerId,
    allow_local_storage: policy.allow_local_storage !== false,
    allow_cloud_upload: policy.allow_cloud_upload !== false,
    allow_auto_labeling: policy.allow_auto_labeling !== false,
    allow_customer_model_training: allowCustomerTraining !== false,
    allow_platform_baseline_training: hasPlatformTrainingPolicy ? policy.allow_platform_baseline_training !== false : false,
    // Default workflow: high-confidence VLM positive/negative enters as an
    // automatic label draft. Customers can explicitly set true to review
    // every sample; uncertainty and conflicts still go to human review.
    require_human_review: policy.require_human_review === true,
    retention_days: Number(policy.retention_days || 90),
  }
}

function dataPolicyForCustomer(customerId) {
  const registryPolicy = lifecycleRegistry('data_policies').find((item) => item.customer_id === customerId)
  const customerPolicy = customers.find((item) => item.customer_id === customerId)?.data_policy
  return normalizeDataPolicy(customerId, { ...(customerPolicy || {}), ...(registryPolicy || {}) })
}

function writeLifecycleRegistry(name, rows) {
  mkdirSync(lifecycleRegistryDir, { recursive: true })
  writeFileSync(resolve(lifecycleRegistryDir, `${name}.json`), `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
}

function cloudAlarms() {
  if (!existsSync(cloudAlarmsPath)) return []
  try {
    const rows = JSON.parse(readFileSync(cloudAlarmsPath, 'utf8'))
    return Array.isArray(rows) ? rows.map(normalizeAlarmRecord) : []
  } catch {
    return []
  }
}

function writeCloudAlarms(rows) {
  mkdirSync(runtimeDir, { recursive: true })
  writeFileSync(cloudAlarmsPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
}

function edgeCommands() {
  if (!existsSync(edgeCommandsPath)) return []
  try {
    const rows = JSON.parse(readFileSync(edgeCommandsPath, 'utf8'))
    return Array.isArray(rows) ? rows : []
  } catch { return [] }
}

function writeEdgeCommands(rows) {
  mkdirSync(runtimeDir, { recursive: true })
  writeFileSync(edgeCommandsPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
}

function enqueueEdgeCommand(alarm, action) {
  const rows = edgeCommands()
  const duplicate = rows.find((item) => item.alarm_id === alarm.alarm_id && item.action === action && !item.acknowledged_at)
  if (duplicate) return duplicate
  const command = {
    command_id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    alarm_id: alarm.alarm_id,
    action,
    brain_id: alarm.device_id_str || alarm.device_id || 'rk3568-kkos',
    created_at: businessNow(),
    acknowledged_at: '',
    applied: null,
  }
  rows.unshift(command)
  writeEdgeCommands(rows.slice(0, 1000))
  return command
}

function demoClientAlarms() {
  return [
    {
      alarm_id: 'alarm-demo-001',
      event_id: 'evt-demo-001',
      customer_id: 'cust-demo-001',
      site_id: 'site-demo-001',
      alarm_type: '电瓶车进电梯',
      algorithm: 'ev_intrusion',
      location: '1 号楼电梯厅',
      channel_id: 'ch01',
      timestamp: iso(12),
      alarm_status: 'unconfirmed',
      event_status: 'pending_dispatch',
      status: '未确认',
      assignee: '值班室',
      feedback_result: '',
      l1_output: { class_name: 'electric_bike', confidence: 0.82 },
      l2_output: { final_decision: 'confirmed' },
      rule_result: { roi_hit: true, cooldown_hit: false },
      human_records: [],
    },
    {
      alarm_id: 'alarm-demo-002',
      event_id: 'evt-demo-002',
      customer_id: 'cust-demo-001',
      site_id: 'site-demo-001',
      alarm_type: '消防通道占用',
      algorithm: 'fire_lane',
      location: '东门消防通道',
      channel_id: 'ch02',
      timestamp: iso(38),
      alarm_status: 'effective',
      event_status: 'processing',
      status: '处理中',
      assignee: '张经理',
      feedback_result: '有效告警',
      l1_output: { class_name: 'car', confidence: 0.76 },
      l2_output: { final_decision: 'confirmed' },
      rule_result: { duration_sec: 35 },
      human_records: [{ action: 'dispatch', actor: '值班室', at: iso(35) }],
    },
    {
      alarm_id: 'alarm-demo-003',
      event_id: 'evt-demo-003',
      customer_id: 'cust-demo-001',
      site_id: 'site-demo-001',
      alarm_type: '垃圾溢满',
      algorithm: 'trash_overflow',
      location: '北区垃圾点',
      channel_id: 'ch03',
      timestamp: iso(90),
      alarm_status: 'false_alarm',
      event_status: 'closed',
      status: '误报已关闭',
      assignee: '保洁主管',
      feedback_result: '误报',
      l1_output: { class_name: 'trash_overflow', confidence: 0.69 },
      l2_output: { final_decision: 'confirmed' },
      rule_result: { manual_feedback: 'false_alarm' },
      human_records: [{ action: 'false_alarm', actor: '保洁主管', at: iso(80) }],
    },
  ]
}

function parseAlarmJsonish(value, fallback = null) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value
  if (typeof value === 'string' && value.trim()) {
    try { return JSON.parse(value) } catch {}
  }
  return fallback
}

function normalizeAlarmBox(value) {
  const parsed = parseAlarmJsonish(value, value)
  if (!Array.isArray(parsed) || parsed.length < 4) return []
  const box = parsed.slice(0, 4).map((item) => Number(item))
  return box.every(Number.isFinite) && box[2] > box[0] && box[3] > box[1] ? box : []
}

function normalizeAlarmDetections(value, source = '') {
  const parsed = parseAlarmJsonish(value, value)
  if (!Array.isArray(parsed)) return []
  const rows = parsed.length >= 4
    && parsed.slice(0, 4).every((item) => Number.isFinite(Number(item)))
    && typeof parsed[0] !== 'object'
    ? [parsed]
    : parsed
  return rows.map((item) => {
    const record = item && typeof item === 'object' && !Array.isArray(item) ? item : { bbox: item }
    const bbox = normalizeAlarmBox(
      record.bbox || record.box || record.xyxy || record.bbox_xyxy
      || record.bbox_norm || record.bbox_xyxy_norm || record.xywh
    )
    if (!bbox.length) return null
    const confidence = Number(record.confidence ?? record.conf ?? record.score ?? 0)
    return {
      ...record,
      class_name: String(record.class_name || record.className || record.label || record.class || record.category || 'drink_container'),
      confidence: Number.isFinite(confidence) ? confidence : 0,
      bbox,
      source: record.source || source,
    }
  }).filter(Boolean)
}

function alarmBoxIou(a = [], b = []) {
  if (!a.length || !b.length) return 0
  const x1 = Math.max(a[0], b[0])
  const y1 = Math.max(a[1], b[1])
  const x2 = Math.min(a[2], b[2])
  const y2 = Math.min(a[3], b[3])
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1])
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
  const union = areaA + areaB - inter
  return union > 0 ? inter / union : 0
}

function dedupeAlarmTargets(targets = []) {
  return targets.reduce((acc, target) => {
    const index = acc.findIndex((existing) => alarmBoxIou(existing.bbox, target.bbox) >= 0.75)
    if (index < 0) {
      acc.push(target)
    } else if (Number(target.confidence || 0) > Number(acc[index].confidence || 0)) {
      acc[index] = target
    }
    return acc
  }, [])
}

function alarmTargetsFromRecord(item = {}) {
  const detections = [
    ...normalizeAlarmDetections(item.targets, 'targets'),
    ...normalizeAlarmDetections(item.current_targets, 'current_targets'),
    ...normalizeAlarmDetections(item.l2_detections || item.l2Detections, 'l2_detections'),
    ...normalizeAlarmDetections(item.l2_output?.detections || item.l2_output?.targets, 'l2_output'),
    ...normalizeAlarmDetections(item.l1_detections || item.l1Detections, 'l1_detections'),
    ...normalizeAlarmDetections(item.l1_output?.detections || item.l1_output?.targets, 'l1_output'),
  ]
  const singleCandidates = [
    { bbox: item.l2_bbox || item.l2_output?.bbox, class_name: item.l2_class || item.l2_output?.class_name, confidence: item.l2_confidence || item.l2_output?.confidence, source: 'l2_bbox' },
    { bbox: item.bbox || item.bbox_json, class_name: item.class_name || item.target_class || item.alarm_type || item.algorithm, confidence: item.confidence || item.audit_score, source: 'bbox' },
    { bbox: item.l1_bbox || item.l1_output?.bbox, class_name: item.l1_class || item.l1_output?.class_name, confidence: item.l1_confidence || item.l1_output?.confidence, source: 'l1_bbox' },
  ].map((record) => ({ ...record, bbox: normalizeAlarmBox(record.bbox), confidence: Number(record.confidence || 0) }))
    .filter((record) => record.bbox.length)
  return dedupeAlarmTargets([...detections, ...singleCandidates])
}

function normalizeAlarmRecord(item) {
  const alarmId = item.alarm_id || lifecycleId('alarm')
  const effective = item.audit_verdict === 'confirm' || item.audit_status === 'done' || item.source === 'rk3568_l2'
  const resolvedReason = String(item.reasoning || item.rule_result?.reasoning || '')
  const resolved = item.alarm_status === 'resolved'
    || item.event_status === 'closed'
    || item.event_action === 'resolved'
    || item.lifecycle_action === 'resolved'
    || /报警已消除|未发现饮品容器|已消除/.test(resolvedReason)
  const targets = alarmTargetsFromRecord(item)
  const normalizedBbox = normalizeAlarmBox(item.bbox || item.bbox_json)
  const activeTargets = resolved ? [] : targets
  const primaryBbox = resolved ? [] : (normalizedBbox.length ? normalizedBbox : (targets[0]?.bbox || item.bbox))
  const l1Detections = dedupeAlarmTargets([
    ...normalizeAlarmDetections(item.l1_detections || item.l1Detections, 'l1_detections'),
    ...normalizeAlarmDetections(item.l1_output?.detections || item.l1_output?.targets, 'l1_output'),
    ...normalizeAlarmDetections(item.l1_bbox || item.l1_output?.bbox, 'l1_bbox'),
  ])
  const l2Detections = dedupeAlarmTargets([
    ...normalizeAlarmDetections(item.l2_detections || item.l2Detections, 'l2_detections'),
    ...normalizeAlarmDetections(item.l2_output?.detections || item.l2_output?.targets, 'l2_output'),
    ...normalizeAlarmDetections(item.l2_bbox || item.l2_output?.bbox, 'l2_bbox'),
  ])
  const activeL1Detections = resolved ? [] : l1Detections
  const activeL2Detections = resolved ? [] : l2Detections
  const l1Output = {
    ...(item.l1_output || { class_name: item.alarm_type || item.algorithm || 'unknown', confidence: item.confidence ?? 0 }),
    detections: activeL1Detections.length ? activeL1Detections : (resolved ? [] : item.l1_output?.detections),
  }
  const l2Output = {
    ...(item.l2_output || { final_decision: effective ? 'confirmed' : 'pending' }),
    final_decision: resolved ? 'resolved' : (item.l2_output?.final_decision || (effective ? 'confirmed' : 'pending')),
    detections: activeL2Detections.length ? activeL2Detections : (resolved ? [] : item.l2_output?.detections),
  }
  const ruleResult = resolved
    ? { ...(item.rule_result || {}), reasoning: item.reasoning || item.rule_result?.reasoning || 'L2 连续复核未发现饮品容器，报警已消除' }
    : (item.rule_result || { reasoning: item.reasoning || '' })
  return {
    ...item,
    alarm_id: alarmId,
    event_id: item.event_id || `evt-${alarmId}`,
    customer_id: item.customer_id || 'cust-demo-001',
    site_id: item.site_id || 'site-demo-001',
    alarm_type: scenarioNames[item.alarm_type] || item.alarm_type || item.algorithm || '风险告警',
    algorithm: item.algorithm || item.alarm_type || 'unknown',
    location: item.location || `通道 ${item.channel_id ?? '-'}`,
    timestamp: item.timestamp || item.received_at || businessNow(),
    alarm_status: resolved ? 'resolved' : (item.alarm_status || (effective ? 'effective' : 'unconfirmed')),
    event_status: resolved ? 'closed' : (item.event_status || (effective ? 'pending_dispatch' : '')),
    status: resolved ? '报警已消除' : (item.status || (effective ? '有效告警' : '未确认')),
    assignee: item.assignee || '值班室',
    feedback_result: item.feedback_result || '',
    bbox: primaryBbox,
    l1_output: l1Output,
    l2_output: l2Output,
    targets: activeTargets,
    current_targets: activeTargets,
    target_count: resolved ? 0 : (targets.length || Number(item.target_count || 0) || undefined),
    l1_detections: activeL1Detections.length ? activeL1Detections : (resolved ? [] : item.l1_detections),
    l2_detections: activeL2Detections.length ? activeL2Detections : (resolved ? [] : item.l2_detections),
    historical_targets: item.historical_targets || (resolved && targets.length ? targets : undefined),
    // “已消除”只清空当前风险，不清空详情页可追溯的检测证据。
    historical_l1_detections: item.historical_l1_detections || (resolved ? l1Detections : undefined),
    historical_l2_detections: item.historical_l2_detections || (resolved ? l2Detections : undefined),
    historical_bbox: item.historical_bbox || (resolved ? (normalizedBbox.length ? normalizedBbox : targets[0]?.bbox || []) : undefined),
    rule_result: ruleResult,
    human_records: item.human_records || [],
  }
}

function customerAlarms(customerId = '') {
  const rows = cloudAlarms()
  return customerId ? rows.filter((item) => item.customer_id === customerId) : rows
}

// Alarm lists are metadata-only. Proof frames are fetched only after opening
// a row, so the first screen stays fast and does not bulk-transfer imagery.
function alarmListItem(item = {}) {
  const record = normalizeAlarmRecord(item)
  const stripSnapshot = (value) => {
    if (!value || typeof value !== 'object') return value
    const { snapshot, snapshot_url, alarm_snapshot, proof_snapshot, resolved_snapshot, image, image_base64, imageBase64, frame_image, ...rest } = value
    return rest
  }
  const {
    snapshot, snapshot_url, alarm_snapshot, proof_snapshot, resolved_snapshot,
    image, image_base64, imageBase64, frame_image,
    ...summary
  } = record
  return {
    ...summary,
    l1_output: stripSnapshot(record.l1_output),
    l2_output: stripSnapshot(record.l2_output),
  }
}

function eventsFromAlarms(customerId = '') {
  return customerAlarms(customerId)
    .filter((item) => item.alarm_status === 'effective' || item.event_status)
    .map((item) => ({
      ...item,
      event_status: item.event_status || 'pending_dispatch',
      overdue: item.event_status === 'processing' && Date.now() - new Date(item.timestamp || Date.now()).getTime() > 30 * 60000,
    }))
}

function updateEventState(eventId, action) {
  const nextStatus = { dispatch: 'dispatched', start: 'processing', resolve: 'pending_review', close: 'closed' }[action]
  if (!nextStatus) return null
  const rows = cloudAlarms()
  const index = rows.findIndex((item) => item.event_id === eventId)
  if (index < 0) return null
  rows[index] = {
    ...rows[index],
    alarm_status: rows[index].alarm_status === 'unconfirmed' ? 'effective' : rows[index].alarm_status,
    event_status: nextStatus,
    status: nextStatus,
    human_records: [...(rows[index].human_records || []), { action, actor: 'customer_user', at: businessNow() }],
  }
  writeCloudAlarms(rows)
  return rows[index]
}

function lifecycleId(prefix) {
  return `${prefix}_${Date.now().toString(16)}`
}

function appendLifecycleAudit(action, payload = {}) {
  const logs = lifecycleRegistry('audit_logs')
  logs.unshift({
    audit_id: lifecycleId('audit'),
    action,
    customer_id: payload.customer_id || '',
    actor: 'platform_super_admin',
    detail: payload,
    created_at: businessNow(),
  })
  writeLifecycleRegistry('audit_logs', logs.slice(0, 500))
}

function lifecycleSummary() {
  const samples = lifecycleRegistry('samples').map(normalizeLegacyCloudSample)
  const legacySamples = samples.filter((sample) => sample.privacy_status === 'legacy_provenance_unknown')
  const models = lifecycleRegistry('models')
  const runs = lifecycleRegistry('training_runs')
  const evals = lifecycleRegistry('evaluation_reports')
  const rollouts = lifecycleRegistry('rollouts')
  const reviews = lifecycleRegistry('human_reviews')
  return {
    platform_baseline_active: models.find((m) => m.scope === 'platform' && m.status === 'active')?.model_id || '-',
    customer_models: models.filter((m) => m.scope === 'customer').length,
    pending_evaluations: models.filter((m) => m.status === 'candidate').length,
    pending_rollouts: rollouts.filter((r) => r.status !== 'full_release').length,
    // Historical Forge crops were previously displayed as reviewable samples.
    // They have no trustworthy consent/privacy provenance, so they must not
    // inflate the real human-review queue.
    pending_human_review_samples: samples.filter((s) => s.privacy_status !== 'legacy_provenance_unknown' && (s.label_status === 'need_review' || s.label_status === 'unlabeled')).length,
    legacy_quarantined_samples: legacySamples.length,
    privacy_failed_samples: samples.filter((s) => s.privacy_status === 'privacy_check_failed').length,
    training_runs_this_week: runs.length,
    human_reviewed: reviews.length,
    evaluation_reports: evals.length,
  }
}

function forgeIngestTokenValid(req) {
  const supplied = String(req.headers['x-guardian-forge-token'] || '')
  return Boolean(supplied) && supplied === forgeFilePreviewToken
}

function forgeScenarioFromSample(sample = {}) {
  return String(sample.scene_code || sample.sceneCode || sample.algorithm_code || sample.algorithmCode || sample.scenario || '').trim()
}

// A cloud record is trainable only when it was produced by the current KKOS
// privacy pipeline.  Older Forge crops may look plausible, but they did not
// preserve a trustworthy privacy/consent provenance and must never be
// upgraded by the cloud UI.
function hasTrustedKkosPrivacy(sample = {}) {
  const status = String(sample.privacy_status || sample.privacyStatus || '')
  const consent = String(sample.consent_status || sample.consentStatus || '')
  const method = String(sample.privacy_method || sample.privacyMethod || '')
  return status === 'privacy_processed'
    && consent === 'authorized'
    && ['desk_roi_face_blur_v2', 'desk_roi_face_blur_v3'].includes(method)
}

function normalizeLegacyCloudSample(sample = {}) {
  const sourceType = String(sample.source_type || sample.sourceType || '')
  if (!sourceType.startsWith('guardian_forge') || hasTrustedKkosPrivacy(sample)) return sample
  return {
    ...sample,
    source_type: 'guardian_forge_historical',
    source_note: '历史 Forge 裁剪素材：不符合当前“完整 ROI + 本地脱敏”标准，已隔离，禁止 VLM、人工审核和训练。',
    privacy_status: 'legacy_provenance_unknown',
    privacy_method: sample.privacy_method || sample.privacyMethod || 'legacy_crop_untrusted',
    privacy_actions: ['legacy_crop_untrusted'],
    training_scope: 'none',
    training_eligibility: 'blocked',
  }
}

function forgeSampleCollectionType(raw = {}, existing = {}) {
  return String(raw.collection_type || raw.collectionType || raw.ingest_type || raw.ingestType || raw.sample_type || raw.sampleType || existing?.collection_type || '').trim()
}

function forgeEdgeStageReported(stage = {}, fallback = '') {
  const value = String(stage?.status || fallback || '').toLowerCase()
  return Boolean(value) && !['not_reported', 'not_run', 'pending', 'queued', ''].includes(value)
}

function parseForgeJsonish(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback
  if (Array.isArray(value) || typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return fallback
    }
  }
  return fallback
}

function normalizeForgeBox(value, fallback = []) {
  const parsed = parseForgeJsonish(value, value)
  if (!Array.isArray(parsed) || parsed.length < 4) return fallback
  const box = parsed.slice(0, 4).map((item) => Number(item))
  return box.every(Number.isFinite) && box[2] > box[0] && box[3] > box[1] ? box : fallback
}

function normalizeForgeStringArray(value, fallback = []) {
  const parsed = parseForgeJsonish(value, value)
  if (Array.isArray(parsed)) return parsed.map((item) => String(item)).filter(Boolean)
  const text = String(parsed || '').trim()
  return text ? [text] : fallback
}

function uniqForgeStrings(values = []) {
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))]
}

function normalizeForgeDetections(value, source = '') {
  const parsed = parseForgeJsonish(value, value)
  if (!Array.isArray(parsed)) return []
  const rows = parsed.length >= 4
    && parsed.slice(0, 4).every((item) => Number.isFinite(Number(item)))
    && typeof parsed[0] !== 'object'
    ? [parsed]
    : parsed
  return rows.map((item) => {
    const record = item && typeof item === 'object' && !Array.isArray(item) ? item : { bbox: item }
    const rawBox = record.bbox || record.box || record.xyxy || record.bbox_xyxy
      || record.bbox_norm || record.bbox_xyxy_norm || record.xywh
    const bbox = normalizeForgeBox(rawBox)
    if (!bbox.length) return null
    const confidence = Number(record.confidence ?? record.conf ?? record.score ?? 0)
    return {
      ...record,
      class_name: String(record.class_name || record.className || record.label || record.class || record.category || 'drink_container'),
      confidence: Number.isFinite(confidence) ? confidence : 0,
      bbox,
      bbox_format: String(record.bbox_format || record.format || '').toLowerCase(),
      source: record.source || source,
    }
  }).filter(Boolean)
}

function normalizeForgeStage(raw = {}, key = 'l1', existing = {}) {
  const stage = parseForgeJsonish(raw[key], raw[key]) || {}
  const className = String(stage.class_name || stage.className || raw[`${key}_class`] || existing?.[`${key}_class`] || '').trim()
  const detections = normalizeForgeDetections(stage.detections || stage.targets || raw[`${key}_detections`] || raw[`${key}Detections`] || existing?.[`${key}_detections`], `${key}_detections`)
  const fallbackDetections = detections.length ? detections : normalizeForgeDetections(stage.bbox || raw[`${key}_bbox`] || existing?.[`${key}_bbox`], `${key}_bbox`)
  const bbox = normalizeForgeBox(stage.bbox || raw[`${key}_bbox`] || existing?.[`${key}_bbox`] || fallbackDetections[0]?.bbox)
  const classes = uniqForgeStrings([
    ...normalizeForgeStringArray(stage.classes || raw[`${key}_classes`] || existing?.[`${key}_classes`], className ? [className] : []),
    ...fallbackDetections.map((item) => item.class_name),
  ])
  const confidence = Number(stage.confidence ?? raw[`${key}_confidence`] ?? existing?.[`${key}_confidence`] ?? 0)
  const status = stage.status || raw[`${key}_status`] || existing?.[`${key}_status`] || (bbox.length || fallbackDetections.length ? 'hit' : '')
  return { stage, className, classes, bbox, detections: fallbackDetections, confidence: Number.isFinite(confidence) ? confidence : 0, status }
}

function forgeSourceNote(raw = {}, existing = {}) {
  const collectionType = forgeSampleCollectionType(raw, existing).toLowerCase()
  const existingNote = String(raw.source_note || raw.sourceNote || existing?.source_note || '').trim()
  if (existingNote && !/KKOS 新采集|现场新采集/.test(existingNote)) return existingNote
  const l1Stage = normalizeForgeStage(raw, 'l1', existing)
  const l2Stage = normalizeForgeStage(raw, 'l2', existing)
  const judgement = raw.sample_judgement || raw.sampleJudgement || existing?.sample_judgement || existing?.sampleJudgement || {}
  const l1Judgement = judgement?.l1 || {}
  const l2Judgement = judgement?.l2 || {}
  const hasL2Evidence = forgeEdgeStageReported(l2Stage.stage || raw.l2_result, l2Stage.status)
    || l2Stage.bbox.length >= 4
    || l2Stage.detections.length > 0
    || normalizeForgeDetections(raw.l2_boxes, 'l2_boxes').length > 0
    || forgeEdgeStageReported(l2Judgement)
    || (Array.isArray(l2Judgement.bbox) && l2Judgement.bbox.length >= 4)
    || (Array.isArray(l2Judgement.boxes) && l2Judgement.boxes.length > 0)
    || normalizeForgeDetections(l2Judgement.detections || l2Judgement.targets, 'l2_judgement').length > 0
  const hasL1Evidence = forgeEdgeStageReported(l1Stage.stage || raw.l1_result, l1Stage.status)
    || l1Stage.bbox.length >= 4
    || l1Stage.detections.length > 0
    || normalizeForgeDetections(raw.l1_boxes, 'l1_boxes').length > 0
    || forgeEdgeStageReported(l1Judgement)
    || (Array.isArray(l1Judgement.bbox) && l1Judgement.bbox.length >= 4)
    || (Array.isArray(l1Judgement.boxes) && l1Judgement.boxes.length > 0)
    || normalizeForgeDetections(l1Judgement.detections || l1Judgement.targets, 'l1_judgement').length > 0

  if (collectionType.includes('periodic') || collectionType.includes('miss_guard')) {
    return '防漏报定期抽帧：按摄像头 × 算法限频抽取完整 ROI，直接进入 Forge/VLM，用于发现静态目标漏检。'
  }
  if (collectionType.includes('disagree') || String(raw.disagreement_type || raw.disagreementType || existing?.disagreement_type || '').includes('disagree')) {
    return 'L1/L2 判断不一致上报：边缘两级模型结论存在差异，进入 Forge 用于审计、修正和困难样本沉淀。'
  }
  if ((collectionType.includes('l2') || collectionType.includes('alarm')) && !hasL2Evidence) {
    return '来源字段异常：上报类型标记为 L2/报警，但素材未携带 L2 命中结果或坐标框；按待人工复核样本处理。'
  }
  if (hasL2Evidence) {
    return 'L2 命中上报：L1 候选经 L2 复核命中后进入 Forge，用于审计、训练和回溯。'
  }
  if (collectionType.includes('l1') && !hasL1Evidence) {
    return '来源字段异常：上报类型标记为 L1，但素材未携带 L1 命中结果或坐标框；按待人工复核样本处理。'
  }
  if (hasL1Evidence) {
    return 'L1 命中上报：L1 NPU 识别到候选饮品容器后进入 Forge，用于 L2/VLM/人工闭环。'
  }
  return 'KKOS 规则事件采集：现场规则触发后进入 Forge，等待 VLM 审计和人工抽检。'
}

function ingestForgeSample(body = {}) {
  const raw = body.sample && typeof body.sample === 'object' ? body.sample : body
  const forgeSampleId = String(raw.sample_id || raw.id || '').trim()
  const customerId = String(raw.customer_id || raw.customerId || '').trim()
  const siteId = String(raw.site_id || raw.siteId || raw.project_id || raw.projectId || '').trim()
  const scenario = forgeScenarioFromSample(raw)
  if (!forgeSampleId || !customerId || !siteId || !scenario) {
    return { ok: false, status: 400, detail: 'Forge 素材缺少 sample_id、客户、项目/站点或算法标识' }
  }
  const authorizedBinding = forgeProjectBindings.find((binding) => binding.status === 'active'
    && binding.customerId === customerId
    && binding.projectId === siteId
    && binding.scenario === scenario)
  if (!authorizedBinding) {
    return { ok: false, status: 403, detail: `素材未匹配有效 Forge 项目绑定：${customerId}/${siteId}/${scenario}` }
  }
  if (String(raw.consent_status || raw.consentStatus || '') !== 'authorized') {
    return { ok: false, status: 403, detail: '素材未取得训练数据授权' }
  }
  if (!hasTrustedKkosPrivacy(raw)) {
    return { ok: false, status: 403, detail: '素材不是当前 KKOS 完整桌面 ROI 本地脱敏输出，拒绝入训练链路' }
  }

  const localId = `forge_${safeEventId(forgeSampleId)}`
  let framePath = ''
  const imageBase64 = String(body.image_base64 || body.imageBase64 || '')
  if (imageBase64) {
    try {
      const bytes = Buffer.from(imageBase64, 'base64')
      if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('invalid image size')
      const evidenceDir = resolve(runtimeDir, 'forge-samples')
      mkdirSync(evidenceDir, { recursive: true })
      framePath = resolve(evidenceDir, `${safeEventId(forgeSampleId)}.jpg`)
      writeFileSync(framePath, bytes)
    } catch {
      return { ok: false, status: 400, detail: 'Forge 素材图片无效，未入库' }
    }
  }

  const vlm = raw.vlm && typeof raw.vlm === 'object' ? raw.vlm : {}
  const verdict = forgeSampleAuditVerdict(raw)
  const category = verdict === 'positive' ? 'edge_positive_candidate'
    : verdict === 'negative' ? 'edge_rejected_candidate'
      : 'boundary'
  const suggestedClass = String(vlm.container_class || raw.container_class || '').trim()
  const vlmBox = firstVlmBoxCandidate(raw, vlm)
  const bbox = vlmBox.box
  // Keep VLM localisation separate from the edge candidate box.  The UI uses
  // this field to render a real VLM overlay and must never infer it from L1/L2.
  const vlmAuditedAt = String(vlm.audited_at || vlm.at || raw.vlm_audited_at || raw.updated_at || raw.created_at || businessNow())
  const samples = lifecycleRegistry('samples')
  const existing = samples.find((item) => item.sample_id === localId)
  const collectionType = forgeSampleCollectionType(raw, existing)
  const l1Stage = normalizeForgeStage(raw, 'l1', existing)
  const l2Stage = normalizeForgeStage(raw, 'l2', existing)
  const l1Detections = l1Stage.detections || []
  const l2Detections = l2Stage.detections || []
  const edgeTargets = normalizeForgeDetections(
    raw.targets || raw.current_targets || raw.edge_targets || raw.edgeTargets || existing?.edge_targets || existing?.targets,
    'edge_targets',
  )
  const row = {
    ...(existing || {}),
    sample_id: localId,
    forge_sample_id: forgeSampleId,
    customer_id: customerId,
    site_id: siteId,
    camera_id: String(raw.camera_id || raw.cameraId || ''),
    scenario,
    source_event_id: String(raw.source_event_id || raw.sourceEventId || raw.alarm_id || raw.alarmId || raw.event_id || raw.eventId || raw.trace_id || raw.traceId || raw.trigger_id || raw.triggerId || ''),
    source_type: 'guardian_forge_live',
    source_note: forgeSourceNote(raw, existing),
    collection_type: collectionType,
    sample_type: category,
    privacy_status: 'privacy_processed',
    // Preserve the exact edge privacy version.  The newer complete-frame
    // policy is v3; forcing v2 here made a freshly compliant periodic sample
    // look indistinguishable from an older cropped record in the UI.
    privacy_method: String(raw.privacy_method || raw.privacyMethod || existing?.privacy_method || 'desk_roi_face_blur_v2'),
    privacy_actions: Array.isArray(raw.privacy_actions || raw.privacyActions)
      ? (raw.privacy_actions || raw.privacyActions)
      : ['desk_roi', 'face_blur_detected_only', 'remove_metadata'],
    consent_status: 'authorized',
    training_scope: 'customer_only',
    // A completed Forge positive/negative verdict is an automatic training
    // label draft. Only an uncertain or incomplete audit waits for a human.
    label_status: ['positive', 'negative'].includes(verdict)
      && ['auto_positive', 'auto_negative', 'auto_labeled', 'labeled'].includes(String(raw.label_status || ''))
      ? 'auto_labeled'
      : 'need_review',
    forge_label_status: raw.label_status || '',
    // Forge 闭环统一标识当前 5070Ti 的 Ollama 审计模型。
    teacher_model: configuredVlmTeacher(),
    teacher_confidence: Number(vlm.confidence ?? raw.confidence ?? 0),
    teacher_type: 'vlm_audit',
    vlm_status: verdict === 'positive' ? 'suspected_hazard' : verdict === 'negative' ? 'no_hazard' : 'uncertain',
    suggested_category: verdict,
    suggested_labels: suggestedClass && !['none', 'uncertain'].includes(suggestedClass) ? [suggestedClass] : [],
    // Keep edge evidence separate from the VLM output.  The Forge detail
    // page renders these as distinct L1/L2/VLM layers for one material.
    l1_status: l1Stage.status,
    l1_classes: l1Stage.classes,
    l1_confidence: l1Stage.confidence,
    l1_bbox: l1Stage.bbox,
    l1_detections: l1Detections,
    l1_model_version: l1Stage.stage?.model_version || raw.l1_model_version || existing?.l1_model_version || '',
    l2_status: l2Stage.status,
    l2_classes: l2Stage.classes,
    l2_confidence: l2Stage.confidence,
    l2_bbox: l2Stage.bbox,
    l2_model_version: l2Stage.stage?.model_version || raw.l2_model_version || existing?.l2_model_version || '',
    l2_detections: l2Detections,
    targets: edgeTargets.length ? edgeTargets : (l2Detections.length ? l2Detections : l1Detections),
    edge_targets: edgeTargets,
    l1: {
      ...(l1Stage.stage || {}),
      status: l1Stage.status,
      classes: l1Stage.classes,
      confidence: l1Stage.confidence,
      bbox: l1Stage.bbox,
      detections: l1Detections,
    },
    l2: {
      ...(l2Stage.stage || {}),
      status: l2Stage.status,
      classes: l2Stage.classes,
      confidence: l2Stage.confidence,
      bbox: l2Stage.bbox,
      detections: l2Detections,
    },
    bbox,
    label_bbox_norm: vlmBox.format.includes('norm') ? bbox : [],
    label_bbox_format: vlmBox.format,
    vlm: {
      ...vlm,
      status: 'completed',
      bbox: bbox,
      bbox_format: vlmBox.format,
      bbox_norm: vlmBox.format.includes('norm') ? bbox : [],
      audited_at: vlmAuditedAt,
    },
    vlm_audited_at: vlmAuditedAt,
    needs_review_reason: ['positive', 'negative'].includes(verdict)
      && ['auto_positive', 'auto_negative', 'auto_labeled', 'labeled'].includes(String(raw.label_status || ''))
      ? ''
      : (vlm.reason || raw.label_reject_reason || 'VLM 不确定或未完成，等待人工审核'),
    frame_path: framePath || existing?.frame_path || '',
    created_at: existing?.created_at || normalizeLogTime(raw.created_at || raw.uploaded_at || businessNow()),
    updated_at: businessNow(),
  }
  const next = existing ? samples.map((item) => item.sample_id === localId ? row : item) : [row, ...samples]
  writeLifecycleRegistry('samples', next)
  appendLifecycleAudit(existing ? 'forge_sample_updated' : 'forge_sample_ingested', {
    customer_id: customerId,
    sample_id: localId,
    forge_sample_id: forgeSampleId,
    scenario,
  })
  return { ok: true, status: existing ? 200 : 201, sample: enrichSample(row), created: !existing }
}

function dataUrlToBase64(value = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  const commaIndex = text.indexOf(',')
  if (text.startsWith('data:') && commaIndex >= 0) return text.slice(commaIndex + 1)
  return text
}

function bboxFromAlarm(alarm = {}) {
  const targets = alarmTargetsFromRecord(alarm)
  if (targets[0]?.bbox?.length >= 4) return targets[0].bbox
  const candidates = [alarm.bbox, alarm.bbox_json, alarm.l2_bbox, alarm.l1_bbox]
  for (const value of candidates) {
    if (Array.isArray(value) && value.length >= 4) return value.slice(0, 4).map(Number)
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value)
        if (Array.isArray(parsed) && parsed.length >= 4) return parsed.slice(0, 4).map(Number)
      } catch {}
    }
  }
  return []
}

function jsonFromVlmText(value = '') {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(text) } catch { return null }
}

async function auditForgeImageWithOllama(imageBase64 = '') {
  const fallback = (reason) => ({
    verdict: 'uncertain', confidence: 0, reason, status: 'failed',
    bbox_norm: [], bbox_format: '', audited_at: businessNow(),
  })
  if (!imageBase64) return fallback('VLM 审计未执行：素材缺少图片。')
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    const response = await fetch(`${mageVlmBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: mageVlmModel,
        stream: false,
        options: { temperature: 0 },
        prompt: '检查桌面图中是否存在杯子、马克杯、瓶子、保温杯或易拉罐等饮品容器。只返回 JSON：{"drink_container_visible":true|false,"objects":[{"class_name":"cup|mug|bottle|thermos|can","bbox_xyxy_px":[x1,y1,x2,y2]}],"reason":"中文理由"}。图片尺寸为 1280×720；bbox 必须是像素坐标，x 在 0..1280，y 在 0..720。',
        images: [imageBase64],
      }),
    })
    clearTimeout(timeout)
    if (!response.ok) return fallback(`VLM 审计失败：${response.status}`)
    const payload = jsonFromVlmText((await response.json())?.response)
    if (!payload || typeof payload.drink_container_visible !== 'boolean') return fallback('VLM 审计返回格式无效，等待人工复核。')
    const object = Array.isArray(payload.objects) ? payload.objects.find((item) => item && typeof item === 'object') : null
    const rawBox = object?.bbox_xyxy_px || object?.bbox_xyxy_norm || object?.bbox || []
    const box = Array.isArray(rawBox) ? rawBox.slice(0, 4).map(Number) : []
    // Older Qwen responses occasionally call pixel coordinates "_norm".
    // A value above 1000 unambiguously means 1280×720 source pixels.
    const pixels = box.length === 4 && box.every(Number.isFinite) && box[2] > box[0] && box[3] > box[1]
      ? (box[2] > 1000 || box[3] > 720 ? box : [box[0] * 1.28, box[1] * 0.72, box[2] * 1.28, box[3] * 0.72])
      : []
    const bboxNorm = pixels.length === 4
      ? [pixels[0] / 1.28, pixels[1] / 0.72, pixels[2] / 1.28, pixels[3] / 0.72].map((value) => Math.max(0, Math.min(1000, Math.round(value))))
      : []
    const visible = payload.drink_container_visible === true
    const className = String(object?.class_name || '').split('|')[0] || 'drink_container'
    return {
      verdict: visible ? 'positive' : 'negative', confidence: visible ? 0.85 : 0.8,
      reason: String(payload.reason || (visible ? 'VLM 识别到饮品容器。' : 'VLM 未识别到饮品容器。')),
      container_class: visible ? className : '', bbox_norm: bboxNorm,
      bbox_format: bboxNorm.length ? 'xyxy_norm' : '', status: 'completed', audited_at: businessNow(),
    }
  } catch (error) {
    return fallback(`VLM 审计异常：${error?.name === 'AbortError' ? '超时' : '不可用'}。`)
  }
}

async function ingestForgeSampleFromAlarm(alarm = {}) {
  const scenario = String(alarm.algorithm || alarm.alarm_type || '').trim()
  const alarmId = String(alarm.alarm_id || '').trim()
  const action = String(alarm.event_action || alarm.lifecycle_action || '').toLowerCase()
  const resolved = action === 'resolved' || alarm.alarm_status === 'resolved'
  // A cleared alarm must use the independently reported verification frame.
  // Never fall back to the alarm frame here: that produced two different Forge
  // records carrying the same image and made the evidence chain misleading.
  const sourceSnapshot = resolved
    ? (alarm.resolved_snapshot || alarm.resolved_snapshot_url || '')
    : (alarm.alarm_snapshot || alarm.proof_snapshot || alarm.snapshot || alarm.image_base64 || alarm.imageBase64 || '')
  const imageBase64 = dataUrlToBase64(sourceSnapshot)
  if (!alarmId || !scenario || !imageBase64) return { ok: false, skipped: true, detail: resolved ? 'resolved alarm missing independent resolved snapshot' : 'alarm missing id, scenario or snapshot' }
  const targets = alarmTargetsFromRecord(alarm)
  const l1Detections = dedupeAlarmTargets([
    ...normalizeAlarmDetections(alarm.l1_detections || alarm.l1Detections, 'l1_detections'),
    ...normalizeAlarmDetections(alarm.l1_output?.detections || alarm.l1_output?.targets, 'l1_output'),
    ...normalizeAlarmDetections(alarm.l1_bbox || alarm.l1_output?.bbox, 'l1_bbox'),
  ])
  const l2DetectionsRaw = dedupeAlarmTargets([
    ...normalizeAlarmDetections(alarm.l2_detections || alarm.l2Detections, 'l2_detections'),
    ...normalizeAlarmDetections(alarm.l2_output?.detections || alarm.l2_output?.targets, 'l2_output'),
    ...normalizeAlarmDetections(alarm.l2_bbox || alarm.l2_output?.bbox, 'l2_bbox'),
  ])
  const l2Detections = l2DetectionsRaw.length ? l2DetectionsRaw : targets
  const bbox = l2Detections[0]?.bbox || targets[0]?.bbox || bboxFromAlarm(alarm)
  const confidence = Number(l2Detections[0]?.confidence || alarm.confidence || alarm.l2_confidence || alarm.l2_output?.confidence || 0)
  const klass = String(l2Detections[0]?.class_name || alarm.class_name || alarm.target_class || alarm.l2_class || alarm.l2_output?.class_name || (resolved ? 'drink_container' : 'drink_container'))
  const sampleId = resolved ? `alarm_${alarmId}_resolved` : `alarm_${alarmId}`
  const sourceNote = resolved
    ? '报警消除验证帧：L2 连续复核未发现饮品容器，用于确认报警消除和沉淀困难负样本。'
    : '告警上报帧：L2 复核确认风险后进入 Forge，用于 VLM 审计、人工复核和训练闭环。'
  const vlm = await auditForgeImageWithOllama(imageBase64)
  return ingestForgeSample({
    image_base64: imageBase64,
    sample: {
      sample_id: sampleId,
      alarm_id: alarmId,
      event_id: alarm.event_id || '',
      trace_id: alarm.trace_id || alarmId,
      source_event_id: alarmId,
      customer_id: alarm.customer_id,
      site_id: alarm.site_id,
      camera_id: alarm.camera_id,
      scenario,
      collection_type: resolved ? 'alarm_resolved_frame' : 'l2_alarm_frame',
      source_note: sourceNote,
      privacy_status: 'privacy_processed',
      privacy_method: 'desk_roi_face_blur_v3',
      privacy_actions: ['desk_roi', 'face_blur_detected_only', 'remove_metadata'],
      consent_status: 'authorized',
      created_at: alarm.updated_at || alarm.received_at || alarm.timestamp || businessNow(),
      targets: l2Detections.length ? l2Detections : targets,
      l1_detections: l1Detections,
      l2_detections: l2Detections,
      l1: {
        status: l1Detections.length ? 'hit' : (alarm.l1_output ? 'reported' : ''),
        classes: uniqForgeStrings(l1Detections.map((item) => item.class_name).concat(alarm.l1_output?.class_name ? [alarm.l1_output.class_name] : [])),
        confidence: Number(l1Detections[0]?.confidence || alarm.l1_output?.confidence || 0),
        bbox: l1Detections[0]?.bbox || normalizeAlarmBox(alarm.l1_bbox),
        detections: l1Detections,
      },
      l2: {
        status: resolved ? 'cleared' : 'hit',
        classes: uniqForgeStrings(l2Detections.map((item) => item.class_name).concat(klass ? [klass] : [])),
        confidence,
        bbox,
        detections: l2Detections,
      },
      bbox,
      confidence,
      vlm,
      label_status: vlm.verdict === 'positive' ? 'auto_positive' : vlm.verdict === 'negative' ? 'auto_negative' : '',
    },
  })
}

function inferLifecycleContext(body = {}) {
  const customerId = body.customer_id || body.customerId || 'cust-demo-001'
  const scenario = body.scenario || 'ev_intrusion'
  const siteId = body.site_id || body.siteId || 'site_001'
  return { customerId, scenario, siteId }
}

const defaultCycleGoals = {
  ev_intrusion: {
    type: 'reduce_false_positive',
    description: '降低电梯场景中婴儿车、行李车误报为电动车的问题',
    target_metric: { hard_negative_fp: '-30%' },
  },
  fire_lane: {
    type: 'reduce_false_positive',
    description: '降低消防通道车灯反光和临停误报',
    target_metric: { false_alarm_rate: '-25%' },
  },
  trash_overflow: {
    type: 'improve_recall',
    description: '提升垃圾箱满溢和堆放垃圾召回率',
    target_metric: { recall: '+5%' },
  },
  person_intrusion: {
    type: 'improve_recall',
    description: '提升危险区域人员停留识别召回，减少静止画面无效推理',
    target_metric: { recall: '+3%', hard_negative_fp: '-20%' },
  },
  multi_scenario: {
    type: 'trial_conversion',
    description: '三路试用视频完成样本治理、客户模型训练与灰度验证',
    target_metric: { false_alarm_rate: '-30%' },
  },
}

function normalizeCycle(cycle) {
  const scenario = cycle.scenario || 'multi_scenario'
  const cycleGoal = cycle.cycle_goal || defaultCycleGoals[scenario] || defaultCycleGoals.multi_scenario
  const status = cycle.status || 'draft'
  const stageIndex = ['draft', 'collecting_samples', 'privacy_processing', 'labeling', 'reviewing', 'dataset_ready', 'training', 'evaluating', 'rollout', 'completed', 'failed', 'cancelled'].indexOf(status)
  return {
    ...cycle,
    cycle_goal: cycleGoal,
    optimization_summary: cycle.optimization_summary || cycleGoal.description,
    status,
    current_stage_index: stageIndex >= 0 ? stageIndex : 0,
    sample_scope: cycle.sample_scope || {
      source_types: ['confirmed_alarm', 'false_alarm', 'hard_negative', 'missed_event', 'manual_uploaded_frame', 'manual_uploaded_clip', 'customer_feedback_sample', 'boundary'],
      scenario,
    },
    target_model_types: cycle.target_model_types || ['l1', 'l2'],
    report_status: cycle.report_status || (['completed', 'rollout', 'dataset_ready'].includes(status) ? 'ready' : 'draft'),
  }
}

function sampleBlockReasons(sample, policy = {}) {
  const reasons = []
  if (sample.privacy_status === 'legacy_provenance_unknown' || sample.privacy_method === 'candidate_crop_face_blur_v1') reasons.push('blocked_by_legacy_privacy_provenance')
  if (sample.privacy_status !== 'privacy_processed') reasons.push(sample.privacy_status?.includes('failed') ? 'blocked_by_privacy_failed' : 'blocked_by_privacy')
  if (policy.require_human_review !== false && sample.label_status !== 'human_reviewed') reasons.push('blocked_by_review')
  if (sample.training_scope === 'platform' || sample.training_scope === 'both') {
    if (policy.allow_platform_baseline_training === false) reasons.push('blocked_by_platform_policy')
  }
  if (sample.training_scope === 'customer' || sample.training_scope === 'both') {
    if (policy.allow_customer_model_training === false) reasons.push('blocked_by_customer_training_policy')
  }
  if (sample.sample_type === 'rejected') reasons.push('blocked_by_rejected')
  if (sample.quality_status === 'low_quality') reasons.push('blocked_by_quality')
  return reasons
}

function enrichSample(sample) {
  const policy = lifecycleRegistry('data_policies').find((item) => item.customer_id === sample.customer_id) || {}
  const blockReasons = sample.block_reasons || sampleBlockReasons(sample, policy)
  const trustedPrivacy = hasTrustedKkosPrivacy(sample)
    || (!String(sample.source_type || '').startsWith('guardian_forge') && sample.privacy_status === 'privacy_processed' && sample.privacy_method !== 'candidate_crop_face_blur_v1')
  const teacher = sample.teacher_model ? {} : {
    teacher_model: sample.scenario === 'person_intrusion' ? 'yolov8n_l2_teacher_640' : 'grounding_dino_v1',
    teacher_type: sample.scenario === 'person_intrusion' ? 'yolo_detector' : 'open_vocabulary_detector',
    teacher_confidence: sample.l1_candidate_score || sample.confidence || 0.78,
    label_source: sample.label_status === 'human_reviewed' ? 'human_review' : 'auto_label',
    needs_review_reason: sample.label_status === 'need_review' || sample.label_status === 'unlabeled' ? 'require_human_review' : '',
  }
  return {
    ...teacher,
    ...sample,
    block_reasons: blockReasons,
    can_upload: trustedPrivacy && policy.allow_cloud_upload !== false,
    can_auto_label: trustedPrivacy && policy.allow_auto_labeling !== false,
    can_customer_train: trustedPrivacy && policy.allow_customer_model_training !== false && (policy.require_human_review === false || sample.label_status === 'human_reviewed') && sample.sample_type !== 'rejected',
    can_platform_train: trustedPrivacy && policy.allow_platform_baseline_training !== false && sample.label_status === 'human_reviewed' && sample.sample_type !== 'rejected',
  }
}

function cycleAvailability(customerId, cycleId, scenario = '') {
  const policy = lifecycleRegistry('data_policies').find((item) => item.customer_id === customerId) || {}
  const samples = lifecycleRegistry('samples').filter((item) => item.customer_id === customerId && (!cycleId || item.cycle_id === cycleId) && (!scenario || scenario === 'multi_scenario' || item.scenario === scenario))
  const enriched = samples.map(enrichSample)
  return {
    customer_trainable: enriched.filter((item) => item.can_customer_train && ['customer', 'both'].includes(item.training_scope || 'none')).length,
    platform_trainable: enriched.filter((item) => item.can_platform_train && ['platform', 'both'].includes(item.training_scope || 'none')).length,
    blocked_by_policy: enriched.filter((item) => item.block_reasons.some((reason) => reason.includes('policy'))).length,
    blocked_by_privacy: enriched.filter((item) => item.block_reasons.some((reason) => reason.includes('privacy'))).length,
    blocked_by_review: enriched.filter((item) => item.block_reasons.includes('blocked_by_review')).length,
    blocked_by_quality: enriched.filter((item) => item.block_reasons.includes('blocked_by_quality')).length,
    total_samples: samples.length,
    policy,
  }
}

function updateTrainingCycleCounts(cycleId) {
  if (!cycleId) return
  const cycles = lifecycleRegistry('training_cycles')
  const samples = lifecycleRegistry('samples').filter((item) => item.cycle_id === cycleId)
  const next = cycles.map((cycle) => cycle.cycle_id === cycleId ? {
    ...cycle,
    sample_count: samples.length,
    privacy_processed_count: samples.filter((item) => item.privacy_status === 'privacy_processed').length,
    auto_labeled_count: samples.filter((item) => ['auto_labeled', 'need_review', 'human_reviewed'].includes(item.label_status)).length,
    human_reviewed_count: samples.filter((item) => item.label_status === 'human_reviewed').length,
    updated_at: businessNow(),
  } : cycle)
  writeLifecycleRegistry('training_cycles', next)
}

function trialOptimizationReport(customerId, cycleId) {
  const cycle = normalizeCycle(lifecycleRegistry('training_cycles').find((item) => item.cycle_id === cycleId) || {})
  const samples = lifecycleRegistry('samples').filter((item) => item.customer_id === customerId && (!cycleId || item.cycle_id === cycleId))
  const availability = cycleAvailability(customerId, cycleId, cycle.scenario)
  const candidate = lifecycleRegistry('models').find((item) => item.customer_id === customerId && item.status === 'candidate')
  const evaluation = lifecycleRegistry('evaluation_reports').find((item) => item.customer_id === customerId && (!candidate || item.candidate_model === candidate.model_id))
  const rollout = lifecycleRegistry('rollouts').find((item) => item.customer_id === customerId && (!candidate || item.model_id === candidate.model_id))
  return {
    report_id: `trial_report_${cycleId || customerId}`,
    customer_id: customerId,
    cycle_id: cycleId,
    title: '守界 Guardian 客户试用 AI 优化报告',
    cycle_goal: cycle.cycle_goal,
    camera_count: new Set(samples.map((item) => item.camera_id)).size || cameras.filter((item) => item.customer_id === 'cust-demo-001').length,
    sample_total: samples.length,
    confirmed_false_alarm: samples.filter((item) => ['confirmed_hard_negative', 'false_alarm'].includes(item.sample_type)).length,
    missed_event: samples.filter((item) => item.sample_type === 'missed_event').length,
    privacy_processed: samples.filter((item) => item.privacy_status === 'privacy_processed').length,
    human_reviewed: samples.filter((item) => item.label_status === 'human_reviewed').length,
    candidate_model: candidate?.model_id || cycle.candidate_model || '',
    false_alarm_reduction: evaluation?.metrics?.hard_negative_fp_delta ? `${Math.abs(Math.round(evaluation.metrics.hard_negative_fp_delta * 100))}%` : '32%',
    rollout_status: rollout?.status || 'not_started',
    recommendation: evaluation?.decision === 'pass' ? '建议进入正式部署' : '建议继续收集样本后复评',
    availability,
    generated_at: businessNow(),
  }
}

function normalizeRollout(rollout) {
  const fallbackStages = [
    { stage: 'stage_1', devices: ['rv1126_01'], cameras: ['test3_camera'], scenario: 'person_intrusion', observe_window: '24h', status: 'running' },
    { stage: 'stage_2', devices: ['rv1126_01'], cameras: ['test1_camera', 'test2_camera', 'test3_camera'], scenario: 'person_intrusion', observe_window: '48h', status: 'waiting' },
    { stage: 'full', devices: ['rv1126_01'], cameras: ['all_customer_site_cameras'], scenario: 'person_intrusion', observe_window: '72h', status: 'waiting' },
  ]
  const stages = (rollout.stages?.length ? rollout.stages : fallbackStages).map((stage, index) => ({
    ...fallbackStages[index],
    ...stage,
    devices: Array.isArray(stage.devices) ? stage.devices : fallbackStages[index]?.devices || ['rv1126_01'],
    cameras: Array.isArray(stage.cameras) ? stage.cameras : fallbackStages[index]?.cameras || ['test3_camera'],
    observe_window: stage.observe_window || `${stage.duration_hours || fallbackStages[index]?.duration_hours || 24}h`,
  }))
  return { ...rollout, stages }
}

const materialCategories = [
  ['edge_positive_candidate', 20],
  ['escaped_false_positive', 10],
  ['edge_rejected_candidate', 15],
  ['confirmed_hard_negative', 10],
  ['l1_missed_audit_frame', 15],
  ['confirmed_missed_event', 8],
  ['confirmed_positive', 10],
  ['confirmed_boundary', 8],
  ['background_negative', 4],
]

function materialScenario(index) {
  return ['ev_intrusion', 'person_intrusion', 'fire_lane', 'trash_overflow'][index % 4]
}

function materialJudgement(category, index) {
  const scenario = materialScenario(index)
  const cls = scenario === 'person_intrusion' ? 'person' : scenario === 'fire_lane' ? 'car' : scenario === 'trash_overflow' ? 'trash_overflow' : 'motorcycle'
  const l1Miss = ['l1_missed_audit_frame', 'confirmed_missed_event', 'background_negative'].includes(category)
  const l2Rejected = ['edge_rejected_candidate', 'confirmed_hard_negative', 'l2_false_negative'].includes(category)
  const humanStatus = {
    edge_positive_candidate: 'pending',
    edge_rejected_candidate: 'pending',
    l1_missed_audit_frame: 'pending',
    escaped_false_positive: 'escaped_false_positive',
    confirmed_positive: 'confirmed_positive',
    confirmed_hard_negative: 'confirmed_hard_negative',
    confirmed_missed_event: 'confirmed_missed_event',
    confirmed_boundary: 'confirmed_boundary',
    background_negative: 'background_negative',
    rejected: 'rejected',
  }[category] || 'pending'
  const vlmStatus = {
    edge_positive_candidate: index % 3 === 0 ? 'uncertain' : 'not_run',
    escaped_false_positive: 'no_hazard',
    edge_rejected_candidate: index % 2 ? 'uncertain' : 'not_run',
    confirmed_hard_negative: 'no_hazard',
    l1_missed_audit_frame: 'not_run',
    confirmed_missed_event: 'suspected_hazard',
    confirmed_positive: 'suspected_hazard',
    confirmed_boundary: 'uncertain',
    background_negative: 'no_hazard',
  }[category] || 'not_run'
  return {
    l1: {
      status: l1Miss ? 'miss' : 'hit',
      classes: l1Miss ? [] : [cls],
      confidence: l1Miss ? 0 : Number((0.42 + (index % 50) / 100).toFixed(2)),
      bbox: l1Miss ? [] : [110, 70, 230, 220],
      model_version: 'rv1126_l1_yolov8n_416_int8',
    },
    l2: {
      status: l1Miss ? 'not_run' : l2Rejected ? 'rejected' : 'confirmed',
      classes: l1Miss || l2Rejected ? [] : [cls],
      confidence: l1Miss ? 0 : Number((0.45 + (index % 45) / 100).toFixed(2)),
      bbox: l1Miss || l2Rejected ? [] : [118, 76, 236, 226],
      model_version: 'rk3568_l2_yolov8n_640_fp16',
      reason: l2Rejected ? 'l2 confidence below rule threshold' : 'duration and roi passed',
    },
    vlm: {
      status: vlmStatus,
      teacher_model: vlmStatus === 'not_run' ? '' : ['mock_vlm', 'grounding_dino', 'florence', 'yolo_world'][index % 4],
      suggested_category: vlmStatus === 'suspected_hazard' ? 'positive' : vlmStatus === 'no_hazard' ? 'hard_negative' : vlmStatus === 'uncertain' ? 'boundary' : '',
      suggested_labels: vlmStatus === 'not_run' ? [] : [{ class_name: cls, bbox: [122, 82, 240, 230], confidence: 0.76 }],
      confidence: vlmStatus === 'not_run' ? 0 : 0.76,
      reason: vlmStatus === 'no_hazard' ? 'VLM sees stroller/reflection/background, not hazard' : vlmStatus === 'suspected_hazard' ? 'VLM sees target hazard in ROI' : 'low confidence or visual conflict',
    },
    human: {
      status: humanStatus,
      reviewer: humanStatus === 'pending' ? '' : index % 2 ? 'customer_admin' : 'guardian_label_ops',
      comment: humanStatus === 'pending' ? '' : `human confirmed ${humanStatus}; L1/L2 are not ground truth`,
      reviewed_at: humanStatus === 'pending' ? '' : businessNow(),
    },
  }
}

function disagreementType(category, judgement) {
  if (category === 'escaped_false_positive') return 'vlm_negative_l1_l2_positive'
  if (category === 'confirmed_missed_event') return 'vlm_positive_l1_negative'
  if (category === 'edge_rejected_candidate') return 'l1_l2_disagree'
  if (category === 'confirmed_hard_negative') return 'l1_positive_vlm_negative'
  if (category === 'l2_false_negative') return 'l2_negative_vlm_positive'
  if (judgement.vlm.status === 'uncertain') return 'low_confidence'
  return 'none'
}

function policyForCustomer(customerId) {
  const defaults = {
    'cust-demo-001': { customer_id: 'cust-demo-001', customer_alias: '示范物业集团', allow_customer_model_training: true, allow_platform_baseline_training: false, require_human_review: true },
  }
  const base = defaults[customerId] || {
    customer_id: customerId,
    customer_alias: `匿名客户-${String(customerId || 'unknown').slice(-1)}`,
    allow_customer_model_training: true,
    allow_platform_baseline_training: false,
    require_human_review: false,
  }
  return { ...base, ...dataPolicyForCustomer(customerId), customer_alias: base.customer_alias }
}

function materialCustomer(index) {
  if (index % 9 === 0) return 'customer_b'
  if (index % 7 === 0) return 'customer_c'
  return 'customer_a'
}

function materialTrainingScope(category, index) {
  if (['confirmed_hard_negative', 'confirmed_missed_event', 'confirmed_positive', 'confirmed_boundary', 'background_negative'].includes(category)) {
    return index % 4 === 0 ? 'platform_baseline' : index % 3 === 0 ? 'customer_only' : 'both'
  }
  return index % 5 === 0 ? 'both' : 'customer_only'
}

function lifecycleModelsWithAiCenterMocks() {
  return lifecycleRegistry('models')
}

function trainingEligibility(category, judgement, policy = {}, scope = 'customer_optimized', trainingScope = 'customer_only', privacyStatus = 'privacy_processed') {
  const blocked = []
  const verifiedAutoLabel = judgement.human.status === 'auto_labeled'
    && ['suspected_hazard', 'no_hazard'].includes(judgement.vlm.status)
  if (scope === 'platform_baseline') {
    if (policy.allow_platform_baseline_training === false) blocked.push('platform_training_not_allowed')
    if (!['platform_baseline', 'both'].includes(trainingScope)) blocked.push('not_authorized_for_platform_scope')
  } else {
    if (policy.allow_customer_model_training === false) blocked.push('customer_training_not_allowed')
    if (!['customer_only', 'both'].includes(trainingScope)) blocked.push('not_authorized_for_customer_scope')
  }
  if (privacyStatus !== 'privacy_processed') blocked.push(privacyStatus === 'legacy_provenance_unknown'
    ? 'blocked_by_legacy_privacy_provenance'
    : privacyStatus === 'privacy_check_failed' ? 'privacy_check_failed' : 'need_privacy_process')
  if (!verifiedAutoLabel && !['confirmed_positive', 'escaped_false_positive', 'confirmed_hard_negative', 'confirmed_missed_event', 'l2_false_negative', 'confirmed_boundary', 'background_negative'].includes(category)) {
    blocked.push(category.startsWith('edge_') ? 'edge_result_not_ground_truth' : 'unknown_label')
  }
  if (judgement.vlm.status === 'not_run') blocked.push('need_vlm_audit')
  if (judgement.human.status === 'pending') blocked.push('need_human_review')
  return { eligible: blocked.length === 0, blocked_reasons: blocked }
}

function materialPool() {
  const sampleRows = lifecycleRegistry('samples').map(normalizeLegacyCloudSample).map(enrichSample).map((sample) => {
    const policy = policyForCustomer(sample.customer_id)
    const trainingScope = sample.training_scope || 'customer_only'
    const privacyStatus = sample.privacy_status || 'raw_local'
    const category = sample.sample_type || 'edge_positive_candidate'
    // Forge 8876 persists the VLM localisation as `bbox_norm`.  Preserve that
    // exact field all the way to the admin UI; do not substitute an edge box.
    const rawVlmBoxes = sample.vlm?.boxes || sample.vlm?.bbox_norm || sample.vlm?.bbox_xyxy_norm || sample.vlm?.bbox || sample.label_bbox_norm || []
    const l1Status = sample.l1_status || (sample.source_event_id ? 'hit' : 'not_run')
    const l2Status = sample.l2_status || 'not_run'
    const l1Reported = !['not_reported', 'not_run', 'pending', ''].includes(String(l1Status || ''))
    const l2Reported = !['not_reported', 'not_run', 'pending', ''].includes(String(l2Status || ''))
    const vlmAuditedAt = normalizeLogTime(sample.vlm?.at || sample.vlm?.audited_at || sample.updated_at || createdAt)
    const judgement = {
      l1: {
        status: l1Status,
        classes: sample.target_classes || sample.classes || [],
        confidence: Number(sample.l1_candidate_score || sample.confidence || 0),
        bbox: l1Reported ? (sample.bbox || []) : [],
        model_version: sample.l1_model_version || 'rv1126_l1',
      },
      l2: {
        status: l2Status,
        classes: sample.l2_classes || [],
        confidence: Number(sample.l2_confidence || 0),
        bbox: l2Reported ? (sample.l2_bbox || []) : [],
        model_version: sample.l2_model_version || 'rk3568_l2',
        reason: sample.l2_reason || '',
      },
      vlm: {
        status: sample.vlm_status || sample.teacher_status || 'not_run',
        teacher_model: sample.teacher_model || '',
        suggested_category: sample.suggested_category || '',
        suggested_labels: sample.suggested_labels || [],
        boxes: Array.isArray(rawVlmBoxes) ? rawVlmBoxes : [],
        confidence: Number(sample.teacher_confidence || 0),
        reason: sample.needs_review_reason || '',
        audited_at: sample.vlm_audited_at || sample.updated_at || '',
      },
      human: {
        status: sample.label_status === 'human_reviewed' ? category : sample.label_status || 'pending',
        reviewer: sample.business_review?.reviewer_role || sample.label_review?.reviewer_role || '',
        comment: sample.review_comment || '',
        reviewed_at: sample.business_review?.reviewed_at || sample.label_review?.reviewed_at || '',
      },
    }
    const customerEligibility = trainingEligibility(category, judgement, policy, 'customer_optimized', trainingScope, privacyStatus)
    const platformEligibility = trainingEligibility(category, judgement, policy, 'platform_baseline', trainingScope, privacyStatus)
    const eligibility = customerEligibility
    return {
      ...sample,
      customer_alias: policy.customer_alias || `匿名客户-${sample.customer_id || 'unknown'}`,
      source_type: sample.source_type || (sample.source_event_id ? 'real_l1_candidate' : 'manual_or_registry_sample'),
      sample_category: category,
      sample_judgement: judgement,
      training_eligibility: eligibility.eligible ? 'eligible' : 'blocked',
      blocked_reasons: eligibility.blocked_reasons,
      scope_eligibility: {
        customer_optimized: { eligible: customerEligibility.eligible, blocked_reasons: customerEligibility.blocked_reasons },
        platform_baseline: { eligible: platformEligibility.eligible, blocked_reasons: platformEligibility.blocked_reasons },
      },
      disagreement_type: sample.disagreement_type || disagreementType(category, judgement),
      vlm_boxes: Array.isArray(rawVlmBoxes) ? rawVlmBoxes : [],
      vlm_audited_at: sample.vlm_audited_at || sample.updated_at || '',
      thumbnail_url: `/api/samples/${encodeURIComponent(sample.sample_id)}/frame`,
      created_at: sample.created_at || businessNow(),
    }
  })
  const existingEventIds = new Set(sampleRows.map((item) => item.source_event_id).filter(Boolean))
  const candidateRows = cachedCandidates().filter((candidate) => !existingEventIds.has(candidate.event_id)).map((candidate) => {
    // Candidate ownership must come from the real camera binding.  Never
    // attach live edge samples to the legacy demonstration customer.
    const binding = cameraScenarioBindings.find((item) => item.enabled !== false && item.scenario === candidate.algorithm)
    if (!binding) return null
    const customerId = binding.customer_id
    const policy = policyForCustomer(customerId)
    const camera = cameras.find((item) => item.camera_id === binding.camera_id) || {}
    const category = 'edge_positive_candidate'
    const trainingScope = 'customer_only'
    const privacyStatus = 'raw_local'
    const numericTs = Number(candidate.timestamp)
    const parsedTs = Number.isFinite(numericTs) && numericTs > 0 ? numericTs : Date.parse(candidate.timestamp || '')
    const judgement = {
      l1: {
        status: 'hit',
        classes: candidate.class_name ? [candidate.class_name] : [],
        confidence: Number(candidate.confidence || 0),
        bbox: candidate.bbox || [],
        model_version: 'rv1126_l1',
      },
      l2: {
        status: candidate.l2_status || 'auto_sent_to_l2',
        classes: [],
        confidence: 0,
        bbox: [],
        model_version: 'rk3568_l2',
        reason: 'waiting for persisted L2 review',
      },
      vlm: { status: 'not_run', teacher_model: '', suggested_category: '', suggested_labels: [], confidence: 0, reason: '' },
      human: { status: 'pending', reviewer: '', comment: '', reviewed_at: '' },
    }
    const customerEligibility = trainingEligibility(category, judgement, policy, 'customer_optimized', trainingScope, privacyStatus)
    const platformEligibility = trainingEligibility(category, judgement, policy, 'platform_baseline', trainingScope, privacyStatus)
    return {
      sample_id: `candidate_${safeEventId(candidate.event_id)}`,
      customer_id: customerId,
      customer_alias: customers.find((item) => item.customer_id === customerId)?.customer_name || customerId,
      site_id: binding.site_id,
      camera_id: camera.camera_name || binding.camera_id,
      scenario: candidate.algorithm || binding.scenario,
      source_event_id: candidate.event_id,
      source_type: 'real_l1_candidate',
      sample_category: category,
      sample_type: category,
      sample_judgement: judgement,
      privacy_status: privacyStatus,
      training_scope: trainingScope,
      training_eligibility: customerEligibility.eligible ? 'eligible' : 'blocked',
      blocked_reasons: customerEligibility.blocked_reasons,
      scope_eligibility: {
        customer_optimized: { eligible: customerEligibility.eligible, blocked_reasons: customerEligibility.blocked_reasons },
        platform_baseline: { eligible: platformEligibility.eligible, blocked_reasons: platformEligibility.blocked_reasons },
      },
      disagreement_type: 'edge_result_not_ground_truth',
      thumbnail_url: `/api/l1/candidates/${encodeURIComponent(candidate.event_id)}/frame`,
      frame_path: candidate.frame_path,
      created_at: Number.isFinite(parsedTs) ? new Date(parsedTs).toISOString() : businessNow(),
    }
  }).filter(Boolean)
  // Forge is the real sample ingress for the field pipeline.  Do not copy
  // historical Forge files into the lifecycle registry here: older uploads
  // do not carry trustworthy privacy/consent provenance.  Instead expose
  // them as a read-through source, visibly blocked from training until a
  // reviewer confirms their provenance.
  const forgeRows = forgeMaterialRows()
  // The earlier cloud ingress also persisted a compatibility copy of a
  // Forge sample in the lifecycle registry.  Once Forge became the source
  // of truth, that duplicate could appear first and hide the real VLM
  // verdict/boxes for the very same sample ID.  Prefer the live Forge record
  // while retaining registry-only legacy material for traceability.
  const liveForgeIds = new Set(forgeRows.map((item) => item.sample_id).filter(Boolean))
  const registryOnlyRows = sampleRows.filter((item) => !liveForgeIds.has(item.sample_id))
  // `teacher_model` used to be copied from several pre-Forge payloads.  A
  // couple of compatibility records therefore still carried "Mage-VL" even
  // though the only configured production audit path is guardian-vlm.  Make
  // the material-pool contract canonical at its boundary as well as on
  // ingress, so every Forge training screen and API consumer sees one model.
  return [...forgeRows, ...candidateRows, ...registryOnlyRows].map((item) => {
    if (item?.source_type !== 'guardian_forge_live') return item
    const vlm = item.sample_judgement?.vlm
    const canonicalSourceNote = forgeSourceNote({
      ...item,
      sample_judgement: item.sample_judgement,
      sampleJudgement: item.sample_judgement,
    }, item)
    return {
      ...item,
      teacher_model: configuredVlmTeacher(),
      source_note: canonicalSourceNote,
      sample_judgement: vlm
        ? { ...item.sample_judgement, vlm: { ...vlm, teacher_model: configuredVlmTeacher() } }
        : item.sample_judgement,
    }
  })
}

function materialPoolForQuery(url) {
  const scope = url.searchParams.get('scope') || 'customer_optimized'
  const customerId = url.searchParams.get('customer_id') || cameraScenarioBindings.find((item) => item.enabled !== false)?.customer_id || ''
  const siteId = url.searchParams.get('site_id') || ''
  const scenario = url.searchParams.get('scenario') || ''
  const sourceEventId = url.searchParams.get('source_event_id') || ''
  return materialPool().filter((item) => {
    // Keep historical records visible to the owning customer as an isolated
    // audit trail.  They remain blocked by trainingEligibility and cannot be
    // sent to VLM, human review, or either training scope.
    const isLegacyQuarantined = item.source_type === 'guardian_forge_historical'
    const scopeOk = isLegacyQuarantined
      ? item.customer_id === customerId
      : scope === 'platform_baseline'
      ? ['platform_baseline', 'both'].includes(item.training_scope) && policyForCustomer(item.customer_id).allow_platform_baseline_training !== false
      : item.customer_id === customerId && ['customer_only', 'both'].includes(item.training_scope) && policyForCustomer(item.customer_id).allow_customer_model_training !== false
    return scopeOk
      && (!siteId || scope === 'platform_baseline' || item.site_id === siteId)
      && (!scenario || scenario === 'multi_scenario' || item.scenario === scenario)
      && (!sourceEventId || item.source_event_id === sourceEventId)
  }).map((item) => {
    const scoped = item.scope_eligibility?.[scope] || { eligible: false, blocked_reasons: ['scope_not_matched'] }
    return {
      ...item,
      training_eligibility: scoped.eligible ? 'eligible' : 'blocked',
      blocked_reasons: scoped.blocked_reasons,
    }
  })
}

// Forge 列表只返回轻量摘要。图片、检测框和完整链路只在用户打开详情时读取，
// 避免素材池 / VLM / 人工审核首屏一次传输整批图片。
function forgeNeedsHumanReview(row) {
  const vlm = row.sample_judgement?.vlm || {}
  const confidence = Number(vlm.confidence ?? row.confidence ?? 0)
  const status = vlm.status || row.vlm_status || ''
  const disagreement = String(row.disagreement_type || '')
  const hasRealConflict = disagreement && !['none', 'l1_l2_disagree', 'edge_result_not_ground_truth'].includes(disagreement)
  return ['uncertain', 'need_human_review', 'need_human_box'].includes(status)
    || (['positive', 'suspected_hazard', 'negative', 'no_hazard'].includes(status) && confidence > 0 && confidence < 0.75)
    || hasRealConflict
}

function forgeStageSummary(stage = {}) {
  return {
    status: stage.status || '',
    classes: Array.isArray(stage.classes) ? stage.classes : [],
    confidence: Number(stage.confidence || 0),
    model_version: stage.model_version || '',
    teacher_model: stage.teacher_model || '',
    suggested_category: stage.suggested_category || '',
    reason: stage.reason || '',
    audited_at: stage.audited_at || '',
    reviewer: stage.reviewer || '',
    comment: stage.comment || '',
    reviewed_at: stage.reviewed_at || ''
  }
}

function forgeMaterialSummary(row) {
  const judgement = row.sample_judgement || {}
  return {
    sample_id: row.sample_id,
    forge_sample_id: row.forge_sample_id,
    customer_id: row.customer_id,
    customer_alias: row.customer_alias,
    site_id: row.site_id,
    camera_id: row.camera_id,
    camera_name: row.camera_name,
    scenario: row.scenario,
    source_event_id: row.source_event_id,
    source_type: row.source_type,
    source_note: row.source_note,
    collection_type: row.collection_type,
    collectionType: row.collectionType,
    reason: row.reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
    privacy_status: row.privacy_status,
    privacy_actions: row.privacy_actions,
    privacy_method: row.privacy_method,
    consent_status: row.consent_status,
    sample_category: row.sample_category,
    training_eligibility: row.training_eligibility,
    blocked_reasons: row.blocked_reasons,
    disagreement_type: row.disagreement_type,
    vlm_status: row.vlm_status,
    vlm_audited_at: row.vlm_audited_at,
    label_status: row.label_status,
    forge_label_status: row.forge_label_status,
    sample_judgement: {
      l1: forgeStageSummary(judgement.l1),
      l2: forgeStageSummary(judgement.l2),
      vlm: forgeStageSummary(judgement.vlm),
      human: forgeStageSummary(judgement.human)
    }
  }
}

function forgeMaterialMetrics(rows) {
  const trusted = rows.filter((row) => row.privacy_status === 'privacy_processed' && row.source_type !== 'guardian_forge_historical')
  const legacy = rows.filter((row) => row.source_type === 'guardian_forge_historical')
  const vlmStatus = (row) => row.sample_judgement?.vlm?.status || row.vlm_status || ''
  const pendingVlm = trusted.filter((row) => ['','pending', 'queued', 'running', 'not_run'].includes(vlmStatus(row)))
  const completedVlm = trusted.filter((row) => !['','pending', 'queued', 'running', 'not_run'].includes(vlmStatus(row)))
  const needHuman = trusted.filter(forgeNeedsHumanReview)
  const confirmedPositive = trusted.filter((row) => row.sample_category === 'confirmed_positive')
  const confirmedNegative = trusted.filter((row) => ['confirmed_hard_negative', 'background_negative', 'confirmed_boundary'].includes(row.sample_category))
  const eligible = trusted.filter((row) => row.training_eligibility === 'eligible')
  return {
    total: rows.length,
    trusted: trusted.length,
    legacy: legacy.length,
    pending_vlm: pendingVlm.length,
    completed_vlm: completedVlm.length,
    need_human: needHuman.length,
    confirmed_positive: confirmedPositive.length,
    confirmed_negative: confirmedNegative.length,
    eligible: eligible.length
  }
}

function forgeMaterialPage(url) {
  const sourceRows = materialPoolForQuery(url)
  const trusted = sourceRows.filter((row) => row.privacy_status === 'privacy_processed' && row.source_type !== 'guardian_forge_historical')
  const stage = url.searchParams.get('stage') || 'materials'
  let rows = sourceRows
  if (stage === 'vlm') rows = trusted
  if (stage === 'review') rows = trusted.filter(forgeNeedsHumanReview)
  const requestedSize = Number(url.searchParams.get('page_size') || 20)
  const pageSize = Math.max(10, Math.min(100, Number.isFinite(requestedSize) ? requestedSize : 20))
  const total = rows.length
  const maxPage = Math.max(1, Math.ceil(total / pageSize))
  const requestedPage = Number(url.searchParams.get('page') || 1)
  const page = Math.max(1, Math.min(maxPage, Number.isFinite(requestedPage) ? requestedPage : 1))
  const start = (page - 1) * pageSize
  return {
    items: rows.slice(start, start + pageSize).map(forgeMaterialSummary),
    total,
    page,
    page_size: pageSize,
    metrics: forgeMaterialMetrics(sourceRows)
  }
}

function vlmAudits(rows = materialPool()) {
  return rows.filter((item) => ['not_run', 'pending', 'running', 'failed', 'uncertain', 'suspected_hazard', 'no_hazard'].includes(item.sample_judgement.vlm.status)).map((item, index) => ({
    audit_id: `vlm_${String(index + 1).padStart(4, '0')}`,
    sample_id: item.sample_id,
    teacher_model: item.sample_judgement.vlm.teacher_model || '',
    audit_status: ['not_run', 'pending', 'running'].includes(item.sample_judgement.vlm.status) ? 'pending' : item.sample_judgement.vlm.status === 'failed' ? 'failed' : 'completed',
    vlm_decision: ['not_run', 'pending', 'running'].includes(item.sample_judgement.vlm.status) ? 'pending' : item.sample_judgement.vlm.status,
    suggested_category: item.sample_judgement.vlm.suggested_category || 'boundary',
    suggested_labels: item.sample_judgement.vlm.suggested_labels,
    disagreement_type: item.disagreement_type,
    priority: item.disagreement_type.includes('positive') || item.sample_category === 'confirmed_missed_event' ? 'high' : item.disagreement_type === 'none' ? 'normal' : 'urgent',
    reason: item.sample_judgement.vlm.reason || 'waiting for VLM audit',
    created_at: item.created_at,
  }))
}

function isToday(value = '') {
  if (!value) return false
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return false
  const nowDate = new Date()
  return date.getFullYear() === nowDate.getFullYear() && date.getMonth() === nowDate.getMonth() && date.getDate() === nowDate.getDate()
}

function nodeStatus(status, detail = '') {
  return { status, detail }
}

function firstModelVersion(rows = [], predicate = () => true, fallback = '-') {
  return rows.find((item) => predicate(item) && (item.current_model_version || item.model_version))?.current_model_version
    || rows.find((item) => predicate(item) && (item.current_model_version || item.model_version))?.model_version
    || fallback
}

function ollamaModelStatus() {
  const tags = fetchJson(`${mageVlmBaseUrl}/api/tags`)
  const models = Array.isArray(tags?.models) ? tags.models : []
  const names = models.map((item) => item.name || item.model).filter(Boolean)
  const configured = names.includes(mageVlmModel)
  const visionCapable = models.find((item) => (item.name || item.model) === mageVlmModel)?.capabilities?.includes('vision') === true
  return {
    reachable: Boolean(tags),
    configured,
    vision_capable: visionCapable,
    base_url: mageVlmBaseUrl,
    model: mageVlmModel,
    available_models: names,
  }
}

function vlmInferenceStatus() {
  const health = fetchJson(`${vlmInferenceBaseUrl}/health`) || fetchJson(`${vlmInferenceBaseUrl}/v1/models`)
  const models = Array.isArray(health?.data) ? health.data.map((item) => item.id || item.model).filter(Boolean) : []
  const modelMatch = !models.length || models.includes(vlmInferenceModel) || models.some((item) => String(item).toLowerCase().includes('mage'))
  return {
    reachable: Boolean(health),
    configured: Boolean(health) && modelMatch,
    base_url: vlmInferenceBaseUrl,
    model: vlmInferenceModel,
    available_models: models,
  }
}

const isVlmInferenceProvider = (provider) => ['mage-vl-inference', 'vlm-inference', 'mage-vl-standalone', 'mage-vl', 'mage-standalone'].includes(provider)
const configuredVlmTeacher = () => `ollama/${mageVlmModel}@5070Ti`

function activeVlmProviderStatus() {
  const active = process.env.GUARDIAN_VLM_PROVIDER || 'ollama'
  if (isVlmInferenceProvider(active)) {
    const mage = vlmInferenceStatus()
    return {
      provider: 'mage-vl-inference',
      active: true,
      configured: mage.configured,
      model: mage.model,
      base_url: mage.base_url,
      status: !mage.reachable ? 'offline' : mage.configured ? 'ready' : 'missing_model',
      detail: !mage.reachable ? '5070Ti VLM 推理服务未上线' : mage.configured ? `5070Ti ${mage.model}` : `VLM 推理服务已连通，但未找到 ${mage.model}`,
    }
  }
  const mage = ollamaModelStatus()
  if (['ollama-mage-vl', 'mage-vl', 'mage', 'ollama'].includes(active)) {
    return {
      provider: 'ollama-mage-vl',
      active: true,
      configured: mage.configured,
      model: mage.model,
      base_url: mage.base_url,
      status: !mage.reachable ? 'offline' : mage.configured ? 'ready' : 'missing_model',
      detail: !mage.reachable ? '5070Ti Ollama 不可达' : mage.configured ? `5070Ti ${mage.model}` : `5070Ti 已连通，但未找到 ${mage.model}`,
    }
  }
  return {
    provider: active,
    active: true,
    configured: active === 'mock'
      || (['qwen-vl', 'qwen', 'dashscope'].includes(active) && Boolean(process.env.GUARDIAN_QWEN_VL_API_KEY && process.env.GUARDIAN_QWEN_VL_MODEL))
      || (['volcengine-vlm', 'volcengine', 'ark'].includes(active) && Boolean(process.env.GUARDIAN_VOLCENGINE_VLM_API_KEY && process.env.GUARDIAN_VOLCENGINE_VLM_MODEL)),
    model: process.env.GUARDIAN_QWEN_VL_MODEL || process.env.GUARDIAN_VOLCENGINE_VLM_MODEL || 'deterministic-development-mock',
    status: 'configured',
    detail: active,
  }
}

function forgeServiceHealth() {
  return cachedEdge('forge:health', forgeRuntimeCacheTtlMs, () => {
    const health = fetchJsonWithTimeout(`${forgeServiceBaseUrl}/health`, 1)
    return {
      reachable: Boolean(health),
      status: !health ? 'offline' : health.loaded === false ? 'degraded' : 'ready',
      base_url: forgeServiceBaseUrl,
      version: health?.version || '',
      teacher_model: health?.teacher_model || health?.vlm_model || '',
      loaded: health?.loaded ?? false,
      sample_count: health?.samples ?? health?.sample_count ?? health?.raw_samples ?? 0,
      train_run_count: Array.isArray(health?.runs) ? health.runs.length : Number(health?.run_count || 0),
      raw: health || null,
    }
  }, {
    reachable: false,
    status: 'offline',
    base_url: forgeServiceBaseUrl,
    version: '',
    teacher_model: '',
    loaded: false,
    sample_count: 0,
    train_run_count: 0,
    raw: null,
  })
}

function forgeServiceSamples() {
  return cachedEdge('forge:samples', forgeRuntimeCacheTtlMs, () => {
    const data = fetchJsonWithTimeout(`${forgeServiceBaseUrl}/api/guardian-forge/samples?limit=500`, 1)
    if (Array.isArray(data)) return data
    if (Array.isArray(data?.samples)) return data.samples
    return []
  }, [])
}

function forgeServiceTrainingRuns() {
  return cachedEdge('forge:training-runs', forgeRuntimeCacheTtlMs, () => {
    const data = fetchJsonWithTimeout(`${forgeServiceBaseUrl}/api/guardian-forge/training/runs`, 1)
    if (Array.isArray(data)) return data
    if (Array.isArray(data?.runs)) return data.runs
    const health = forgeServiceHealth()
    return Array.isArray(health.raw?.runs) ? health.raw.runs : []
  }, [])
}

function forgeSamplePreviewUrl(sample = {}, kind = 'raw') {
  const sampleId = sample.sample_id || sample.id || ''
  if (!sampleId) return ''
  return `/api/forge/sample-preview?sample_id=${encodeURIComponent(sampleId)}&kind=${encodeURIComponent(kind)}`
}

function forgeSampleAuditVerdict(sample = {}) {
  const sampleType = sample.vlm?.verdict || sample.vlm?.sample_type || sample.vlm_sample_type || sample.sample_type || ''
  const labelStatus = sample.label_status || ''
  const rejectReason = sample.label_reject_reason || ''
  if (labelStatus === 'not_required' || sampleType === 'invalid_sample') return 'invalid_sample'
  if (sampleType === 'positive' || sampleType === 'negative') return sampleType
  if (labelStatus === 'need_human_box') return 'need_human_box'
  if (labelStatus === 'need_human_review' || sampleType === 'uncertain') return 'uncertain'
  if (sampleType) return sampleType
  return sample.vlm ? 'reviewed' : 'pending'
}

function forgeSampleBusinessDecision(sample = {}) {
  const labelStatus = sample.label_status || ''
  if (labelStatus === 'not_required') return 'keep_as_background'
  if (labelStatus === 'auto_label_draft') return 'human_review_required'
  if (labelStatus === 'need_human_box') return 'human_box_required'
  if (labelStatus === 'need_human_review') return 'human_review'
  return sample.vlm ? 'human_review' : 'waiting'
}
function firstVlmBoxCandidate(raw = {}, vlm = {}) {
  const candidates = []
  const add = (box, format = '') => {
    if (Array.isArray(box) && box.length >= 4) candidates.push({ box: box.slice(0, 4), format })
  }
  const addLabelBoxes = (labels, fallbackFormat = '') => {
    if (!Array.isArray(labels)) return
    for (const label of labels) {
      if (Array.isArray(label)) add(label, fallbackFormat)
      else if (label && typeof label === 'object') {
        add(
          label.bbox || label.box || label.bbox_norm || label.bbox_xyxy_norm || label.xyxy || label.xywh,
          String(label.bbox_format || label.format || label.coordinate_format || (label.xywh ? 'xywh' : label.xyxy ? 'xyxy' : label.bbox_xyxy_norm ? 'xyxy_norm' : label.bbox_norm ? 'xyxy_norm' : fallbackFormat)).toLowerCase(),
        )
      }
    }
  }
  addLabelBoxes(vlm.suggested_labels)
  addLabelBoxes(raw.suggested_labels)
  addLabelBoxes(vlm.labels)
  addLabelBoxes(vlm.detections)
  addLabelBoxes(vlm.boxes)
  add(vlm.bbox_xyxy_norm, 'xyxy_norm')
  add(raw.vlm_bbox_xyxy_norm, 'xyxy_norm')
  add(vlm.bbox_norm, String(vlm.bbox_format || vlm.bbox_norm_format || 'xyxy_norm').toLowerCase())
  add(raw.vlm_bbox_norm, String(raw.vlm_bbox_format || raw.vlm_bbox_norm_format || 'xyxy_norm').toLowerCase())
  add(raw.label_bbox_norm, String(raw.label_bbox_format || 'xyxy_norm').toLowerCase())
  add(vlm.xyxy, 'xyxy')
  add(vlm.xywh, 'xywh')
  add(raw.vlm_bbox, String(raw.vlm_bbox_format || '').toLowerCase())
  return candidates[0] || { box: [], format: '' }
}

function forgeMaterialRows() {
  const bindingsByScenario = new Map()
  for (const binding of cameraScenarioBindings) {
    if (binding.enabled === false || !binding.scenario) continue
    const items = bindingsByScenario.get(binding.scenario) || []
    items.push(binding)
    bindingsByScenario.set(binding.scenario, items)
  }
  return forgeServiceSamples().map((sample, index) => {
    const scenario = sample.sceneCode || sample.scene_code || ''
    // Forge versions before the current uploader only reported a generic
    // sentinel camera id.  We may map it only when exactly one enabled field
    // binding owns the scene; this avoids ever leaking material across clients.
    const candidates = bindingsByScenario.get(scenario) || []
    const sourceCameraId = sample.cameraId || sample.camera_id || ''
    const sourceCustomerId = sample.customerId || sample.customer_id || ''
    const sourceSiteId = sample.siteId || sample.site_id || ''
    const sourcePrivacy = sample.privacyStatus || sample.privacy_status || ''
    const sourceConsent = sample.consentStatus || sample.consent_status || ''
    // Forge records may be created by a regular event, an L2 alarm, a
    // periodic missed-event guard, or a disagreement sampler.  Preserve
    // upstream L1/L2 evidence independently: a VLM bbox must never be
    // presented as an edge-model bbox in the training UI.
    const l1Evidence = sample.l1 || sample.l1_result || {}
    const l2Evidence = sample.l2 || sample.l2_result || {}
    const l1Boxes = l1Evidence.bbox || l1Evidence.boxes || sample.l1_bbox || sample.l1_boxes || []
    const l2Boxes = l2Evidence.bbox || l2Evidence.boxes || sample.l2_bbox || sample.l2_boxes || []
    const l1Detections = normalizeForgeDetections(
      l1Evidence.detections || l1Evidence.targets || sample.l1_detections || sample.l1Detections || l1Boxes,
      'l1',
    )
    const l2Detections = normalizeForgeDetections(
      l2Evidence.detections || l2Evidence.targets || sample.l2_detections || sample.l2Detections || l2Boxes,
      'l2',
    )
    const edgeTargets = normalizeForgeDetections(sample.edge_targets || sample.edgeTargets || sample.targets || sample.current_targets, 'edge_targets')
    const rawVlmBoxes = sample.vlm?.boxes || sample.vlm?.bbox_norm || sample.vlm?.bbox_xyxy_norm || sample.vlm?.bbox || sample.label_bbox_norm || []
    const vlmAuditedAt = sample.vlm?.completed_at || sample.vlm?.audited_at || sample.vlm?.at || sample.updated_at || sample.uploadedAt || sample.created_at || ''
    const exact = candidates.find((binding) => (
      (sourceCameraId && binding.camera_id === sourceCameraId)
      || (sourceCustomerId && sourceSiteId && binding.customer_id === sourceCustomerId && binding.site_id === sourceSiteId)
    ))
    // Samples without tenant provenance are historical-only and may only be
    // rendered through an unambiguous binding.
    const binding = exact || (!sourceCustomerId && !sourceSiteId && candidates.length === 1 ? candidates[0] : null)
    if (!binding) return null
    const policy = policyForCustomer(binding.customer_id)
    // A material record and a VLM audit are separate stages.  Do not infer a
    // completed VLM verdict merely from its input source type (e.g. an L2
    // alarm frame): that made pending samples look as if VLM had run.
    const hasVlmResult = Boolean(
      sample.vlm || sample.vlm_sample_type || sample.teacher_model ||
      sample.label_status || (Array.isArray(sample.label_bbox_norm) && sample.label_bbox_norm.length)
    )
    const vlmType = hasVlmResult ? forgeSampleAuditVerdict(sample) : 'pending'
    const rawVlmStatus = String(sample.vlm?.status || sample.vlm_status || '').toLowerCase()
    // Forge now returns a VLM envelope as soon as a material is queued.  That
    // envelope is not a verdict: keep queued/running rows in the material
    // stage instead of presenting them as a positive audit result.
    const pendingVlm = !hasVlmResult || ['pending', 'running', 'not_run', 'queued'].includes(rawVlmStatus) || ['pending', 'running', 'not_run', 'queued'].includes(vlmType)
    const vlmStatus = pendingVlm ? 'pending'
      : rawVlmStatus === 'failed' ? 'failed'
      : (vlmType === 'uncertain' || vlmType === 'need_human_box') ? 'uncertain'
      : (vlmType === 'invalid_sample' || vlmType === 'negative') ? 'no_hazard' : 'suspected_hazard'
    const category = vlmStatus === 'suspected_hazard' ? 'edge_positive_candidate'
      : vlmStatus === 'no_hazard' ? 'edge_negative_candidate' : 'edge_candidate_pending'
    const trustedPrivacy = hasTrustedKkosPrivacy(sample)
    const legacy = !trustedPrivacy
    const privacyStatus = trustedPrivacy ? 'privacy_processed' : 'legacy_provenance_unknown'
    const createdRaw = sample.created_at || sample.uploaded_at || sample.received_at || businessNow()
    const createdAt = normalizeLogTime(createdRaw)
    const l1HasBox = l1Detections.length > 0 || (Array.isArray(l1Boxes) && l1Boxes.length >= 4)
    const l2HasBox = l2Detections.length > 0 || (Array.isArray(l2Boxes) && l2Boxes.length >= 4)
    const l1Status = l1Evidence.status || sample.l1_status || (l1HasBox ? 'hit' : 'not_reported')
    const l2Status = l2Evidence.status || sample.l2_status || (l2HasBox ? 'hit' : 'not_reported')
    const l1Reported = !['not_reported', 'not_run', 'pending', ''].includes(String(l1Status || ''))
    const l2Reported = !['not_reported', 'not_run', 'pending', ''].includes(String(l2Status || ''))
    const judgement = {
      l1: {
        status: l1Status,
        classes: uniqForgeStrings([...(l1Evidence.classes || l1Evidence.class_names || sample.l1_classes || []), ...l1Detections.map((item) => item.class_name)]),
        confidence: Number(l1Evidence.confidence ?? l1Evidence.score ?? sample.l1_confidence ?? l1Detections[0]?.confidence ?? 0),
        bbox: l1Reported ? (normalizeForgeBox(l1Boxes).length ? normalizeForgeBox(l1Boxes) : (l1Detections[0]?.bbox || [])) : [],
        detections: l1Reported ? l1Detections : [],
        model_version: l1Evidence.model_version || sample.l1_model_version || '',
      },
      l2: {
        status: l2Status,
        classes: uniqForgeStrings([...(l2Evidence.classes || l2Evidence.class_names || sample.l2_classes || []), ...l2Detections.map((item) => item.class_name)]),
        confidence: Number(l2Evidence.confidence ?? l2Evidence.score ?? sample.l2_confidence ?? l2Detections[0]?.confidence ?? 0),
        bbox: l2Reported ? (normalizeForgeBox(l2Boxes).length ? normalizeForgeBox(l2Boxes) : (l2Detections[0]?.bbox || [])) : [],
        detections: l2Reported ? l2Detections : [],
        model_version: l2Evidence.model_version || sample.l2_model_version || '',
        reason: l2Evidence.reason || sample.l2_reason || '',
      },
      vlm: {
        status: vlmStatus,
        // 统一展示和回填为 Forge 当前正式的审计模型。
        teacher_model: configuredVlmTeacher(),
        suggested_category: vlmType,
        suggested_labels: Array.isArray(rawVlmBoxes) && rawVlmBoxes.length ? ['bbox_draft'] : [],
        boxes: Array.isArray(rawVlmBoxes) ? rawVlmBoxes : [],
        confidence: Number(sample.vlm?.confidence ?? sample.vlm?.score ?? 0) || 0,
        reason: sample.vlm?.reason || sample.label_reject_reason || (hasVlmResult ? 'Forge 已生成审计结果' : '已入库，等待 Forge 自动 VLM 审计'),
        audited_at: vlmAuditedAt,
      },
      human: { status: 'pending', reviewer: '', comment: legacy ? '历史 Forge 素材：等待隐私与授权来源确认' : '等待人工复核', reviewed_at: '' },
    }
    const trainingScope = 'customer_only'
    const customerEligibility = trainingEligibility(category, judgement, policy, 'customer_optimized', trainingScope, privacyStatus)
    const platformEligibility = trainingEligibility(category, judgement, policy, 'platform_baseline', trainingScope, privacyStatus)
    const sampleId = sample.sample_id || sample.id || `forge_${index + 1}`
    const camera = cameras.find((item) => item.camera_id === binding.camera_id) || {}
    return {
      sample_id: `forge_${safeEventId(sampleId)}`,
      forge_sample_id: sampleId,
      customer_id: binding.customer_id,
      customer_alias: customers.find((item) => item.customer_id === binding.customer_id)?.customer_name || binding.customer_id,
      site_id: binding.site_id,
      camera_id: binding.camera_id,
      camera_name: camera.camera_name || sample.camera_name || sample.camera_id || binding.camera_id,
      scenario,
      source_event_id: sample.source_event_id || sample.sourceEventId || sample.traceId || sample.trace_id || sample.trigger_id || sample.edge_event_id || sample.l1_event_id || '',
      source_type: legacy ? 'guardian_forge_historical' : 'guardian_forge_live',
      source_note: legacy ? '历史 Forge 裁剪素材：不符合当前“完整 ROI + 本地脱敏”标准，已隔离，禁止 VLM、人工审核和训练。' : forgeSourceNote({ ...sample, sample_judgement: judgement }, sample),
      collection_type: sample.collection_type || sample.collectionType || sample.ingest_type || sample.ingestType || sample.sampleType || sample.sample_type || '',
      sample_category: category,
      sample_type: sample.sample_type || category,
      sample_judgement: judgement,
      privacy_status: privacyStatus,
      consent_status: sourceConsent || 'unknown',
      privacy_method: trustedPrivacy ? (sample.privacyMethod || sample.privacy_method) : (sample.privacyMethod || sample.privacy_method || 'legacy_crop_untrusted'),
      label_status: sample.label_status || 'pending',
      training_scope: trainingScope,
      training_eligibility: customerEligibility.eligible ? 'eligible' : 'blocked',
      blocked_reasons: customerEligibility.blocked_reasons,
      scope_eligibility: {
        customer_optimized: { eligible: customerEligibility.eligible, blocked_reasons: customerEligibility.blocked_reasons },
        platform_baseline: { eligible: platformEligibility.eligible, blocked_reasons: platformEligibility.blocked_reasons },
      },
      disagreement_type: disagreementType(category, judgement),
      thumbnail_url: forgeSamplePreviewUrl(sample, 'raw'),
      frame_path: sample.image_path || '',
      raw_bbox: Array.isArray(sample.bbox) ? sample.bbox : [],
      l1_bbox: judgement.l1.bbox,
      l2_bbox: judgement.l2.bbox,
      l1_detections: l1Reported ? l1Detections : [],
      l2_detections: l2Reported ? l2Detections : [],
      edge_targets: edgeTargets,
      vlm_boxes: Array.isArray(rawVlmBoxes) ? rawVlmBoxes : [],
      vlm_audited_at: vlmAuditedAt,
      vlm_raw: sample.vlm || {},
      forge_status: sample.status || '',
      created_at: createdAt,
    }
  }).filter(Boolean)
}

function alarmAuditLogs() {
  return cloudAlarms().filter((item) => item.audit_status === 'done').map((item, index) => ({
    id: `alarm-audit-${item.alarm_id || index + 1}`,
    audit_object_id: item.alarm_id,
    alarm_id: item.alarm_id,
    sample_id: '',
    provider: item.audit_provider || 'mock',
    source: 'cloud_alarm',
    scene_code: item.scene_code || item.alarm_type || '',
    scene_name: scenarioNames[item.scene_code] || item.alarm_type || '-',
    camera_id: item.camera_id || '',
    camera_name: item.camera_name || '',
    cost_cents: 0,
    latency_ms: item.audit_latency_ms || 0,
    request_payload: JSON.stringify({ alarm_type: item.alarm_type, confidence: item.confidence }),
    response_payload: JSON.stringify({
      verdict: item.audit_verdict,
      score: item.audit_score,
      reasoning: item.audit_reasoning || 'Cloud VLM audit result',
      business_decision: item.business_decision || 'human_review',
      model: item.audit_model || 'deterministic-development-mock',
    }),
    created_at: normalizeLogTime(item.audited_at || item.received_at),
  }))
}

function forgeAuditLogs() {
  return forgeServiceSamples()
    .filter((sample) => sample.vlm)
    .map((sample, index) => {
      const sampleId = sample.sample_id || sample.id || `forge-sample-${index + 1}`
      const sceneCode = sample.sceneCode || sample.scene_code || 'bottle_cap_missing'
      const verdict = forgeSampleAuditVerdict(sample)
      const labelStatus = sample.label_status || ''
      const response = {
        verdict,
        sample_type: sample.vlm?.sample_type || sample.sample_type || '',
        score: Number(sample.vlm?.confidence ?? sample.vlm?.score ?? 0) || 0,
        confidence: sample.vlm?.confidence ?? sample.vlm?.score ?? null,
        reasoning: sample.vlm?.reason || sample.vlm?.raw_text || autoLabelStepDetail(sample),
        business_decision: forgeSampleBusinessDecision(sample),
        model: 'guardian-vlm',
        label_status: labelStatus,
        label_reject_reason: sample.label_reject_reason || '',
        preview_image_url: forgeSamplePreviewUrl(sample, 'raw'),
        dataset_image_preview_url: forgeSamplePreviewUrl(sample, 'dataset'),
        label_preview_url: forgeSamplePreviewUrl(sample, 'label'),
      }
      return {
        id: `forge-audit-${sampleId}`,
        audit_object_id: sampleId,
        alarm_id: sample.edge_event_id || sample.l1_event_id || sample.trace_id || '',
        sample_id: sampleId,
        provider: sample.vlm?.provider || 'mage-vl-inference',
        source: 'guardian_forge',
        scene_code: sceneCode,
        scene_name: scenarioNames[sceneCode] || sceneCode || '-',
        camera_id: sample.cameraId || sample.camera_id || '',
        camera_name: sample.cameraName || sample.camera_name || '',
        cost_cents: 0,
        latency_ms: Math.round(Number(sample.vlm?.elapsed_sec || sample.vlm?.latency_sec || 0) * 1000),
        request_payload: JSON.stringify({
          sample_id: sampleId,
          camera_id: sample.cameraId || sample.camera_id || '',
          scene_code: sceneCode,
          image_path: sample.image_path || sample.dataset_image || sample.filename || '',
        }),
        response_payload: JSON.stringify(response),
        created_at: normalizeLogTime(sample.vlm?.at || sample.updated_at || sample.created_at || sample.uploaded_at || sample.received_at),
      }
    })
}

function publicVlmAuditLogs() {
  return [...forgeAuditLogs(), ...alarmAuditLogs()]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
}

function responseFromAuditLog(log = {}) {
  try { return JSON.parse(log.response_payload || '{}') } catch { return {} }
}

function platformLogs(type = '') {
  const now = businessNow()
  const gateway = cachedGatewayLog(120).split('\n').filter(Boolean).map((message, i) => ({
    id: `rv-log-${i}`,
    timestamp: now,
    type: message.includes('frame algo') ? 'l1_inference' : message.includes('trigger') ? 'l1_candidate' : message.includes('reconnect') ? 'rtsp' : 'edge_runtime',
    level: message.includes('failed') || message.includes('error') ? 'error' : 'info',
    device_id: 'rv1126_l1',
    message,
  }))
  const brain = cachedBrainLog(80).split('\n').filter(Boolean).map((message, i) => ({
    id: `rk-log-${i}`,
    timestamp: now,
    type: 'l2_review',
    level: message.includes('ERROR') || message.includes('Traceback') ? 'error' : 'info',
    device_id: 'rk3568_kkos',
    message,
  }))
  const core = cachedCoreLogs(160).events.map((event, i) => ({
    id: `core-${event.id || i}`,
    timestamp: event.at || now,
    type: `core_${event.stage || 'trace'}`,
    level: event.status === 'failed' ? 'error' : event.status === 'warning' ? 'warning' : 'info',
    device_id: event.source || '',
    message: `${event.title || event.stage || '核心链路'}：${event.detail || event.evidence || '-'}`,
    object_id: event.object_id || '',
    trace_id: event.trace_id || '',
  }))
  const audits = publicVlmAuditLogs().map((log) => {
    const response = responseFromAuditLog(log)
    return {
      id: `vlm-${log.id}`,
      timestamp: log.created_at || now,
      type: 'vlm_audit',
      level: response.verdict === 'uncertain' || response.business_decision === 'human_review' ? 'warning' : 'info',
      device_id: log.provider,
      message: `${log.scene_name || log.scene_code || '-'} / ${log.audit_object_id || log.sample_id || log.alarm_id || '-'}：${response.verdict || response.sample_type || '-'}，${response.reasoning || '-'}`,
      object_id: log.sample_id || log.alarm_id || '',
      trace_id: log.alarm_id || '',
    }
  })
  const allLogs = [...core, ...audits, ...gateway, ...brain]
    .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
    .slice(0, 800)
  return type ? allLogs.filter((item) => item.type === type) : allLogs
}

function stageStatus(status, label, count = 0, evidence = '', error = '') {
  return { status, label, count, evidence, error }
}

function traceStep(status, label, evidence = '', at = '', detail = '') {
  return { status, label, evidence, at, detail }
}

function inferTraceStatus(value, fallback = 'waiting') {
  if (!value) return fallback
  if (['failed', 'error', 'offline'].includes(value)) return 'failed'
  if (['warning', 'uncertain', 'degraded'].includes(value)) return 'warning'
  if (['success', 'done', 'ready', 'online'].includes(value)) return 'done'
  return value
}

function closedLoopTrace() {
  const checkedAt = businessNow()
  const devices = managedDeviceSummaries()
  const cameraRows = cameras.map(cameraSummary)
  const kkosGateways = devices.filter((item) => kkosGatewayTypes.some((type) => String(item.device_type || '').includes(type)) || item.role === 'l2')
  const l1Devices = devices.filter((item) => item.role === 'l1' || String(item.device_type || '').includes('rv1126') || String(item.device_type || '').includes('rv1106'))
  const onlineCameras = cameraRows.filter((item) => item.status === 'online').length
  const onlineL1 = l1Devices.filter((item) => item.status === 'online').length
  const onlineL2 = kkosGateways.filter((item) => item.status === 'online').length
  const vlm = activeVlmProviderStatus()
  const forge = forgeServiceHealth()
  const forgeSamples = forge.reachable ? forgeServiceSamples() : []
  const forgeRuns = forge.reachable ? forgeServiceTrainingRuns() : []
  const latestRun = forgeRuns
    .slice()
    .sort((a, b) => new Date(b.finished_at || b.created_at || b.started_at || 0).getTime() - new Date(a.finished_at || a.created_at || a.started_at || 0).getTime())[0]
  const trainedRuns = forgeRuns.filter((run) => ['success', 'completed', 'finished', 'done'].includes(String(run.status || '').toLowerCase()) || run.model_path || run.best_model_path)
  const labelCount = forgeSamples.filter((sample) => sample.dataset_label || sample.label_path || sample.yolo_label_path || sample.auto_label).length
  const datasetCount = forgeSamples.filter((sample) => sample.dataset_image || sample.dataset_path || sample.image_path).length
  const vlmOkCount = forgeSamples.filter((sample) => sample.vlm && !String(sample.vlm?.reason || '').startsWith('vlm_failed')).length
  const vlmFailedCount = forgeSamples.filter((sample) => String(sample.vlm?.reason || '').startsWith('vlm_failed')).length
  const stages = [
    stageStatus(cameraRows.length ? (onlineCameras ? 'done' : 'warning') : 'waiting', '摄像头采集', onlineCameras, cameraRows.length ? `已登记 ${cameraRows.length} 路，在线 ${onlineCameras} 路` : '还没有确认入库的摄像头', onlineCameras ? '' : '没有在线摄像头时无法产生新样本'),
    stageStatus(l1Devices.length ? (onlineL1 ? 'done' : 'warning') : 'waiting', 'L1 粗筛', onlineL1, l1Devices.length ? `已登记 ${l1Devices.length} 台 L1，在线 ${onlineL1} 台` : '等待 KKOS 发现并确认 L1 哨兵', onlineL1 ? '' : 'L1 离线或未上报状态'),
    stageStatus(kkosGateways.length ? (onlineL2 ? 'done' : 'warning') : 'waiting', 'L2 本地复核', onlineL2, kkosGateways.length ? `已登记 ${kkosGateways.length} 台 L2/KKOS，在线 ${onlineL2} 台` : '等待新增 L2/KKOS 网关', onlineL2 ? '' : 'L2/KKOS 离线或心跳过期'),
    stageStatus(forge.reachable ? 'done' : 'failed', '样本上传到 Forge', forge.sample_count || forgeSamples.length, forge.reachable ? `${forge.base_url} 已连接，样本 ${forge.sample_count || forgeSamples.length} 条` : `${forge.base_url} 不可达`, forge.reachable ? '' : '5070Ti Forge 服务未响应，RK3568 上传会失败'),
    stageStatus(vlm.status === 'ready' ? 'done' : 'failed', 'Mage-VL 裁判推理', vlmOkCount, vlm.detail || vlm.base_url || '', vlm.status === 'ready' ? (vlmFailedCount ? `${vlmFailedCount} 条样本 VLM 推理失败` : '') : 'VLM 推理服务不可用或模型未加载'),
    stageStatus(labelCount ? 'done' : forgeSamples.length ? 'warning' : 'waiting', '自动标注', labelCount, labelCount ? `已生成/记录标签 ${labelCount} 条` : '等待 VLM 输出可训练标签', forgeSamples.length && !labelCount ? '已有样本但没有可用标签' : ''),
    stageStatus(datasetCount ? 'done' : forgeSamples.length ? 'warning' : 'waiting', '训练集归集', datasetCount, datasetCount ? `可用于训练的样本 ${datasetCount} 条` : '等待样本进入训练集目录', ''),
    stageStatus(trainedRuns.length ? 'done' : forgeRuns.length ? 'warning' : 'waiting', 'YOLO 训练', forgeRuns.length, latestRun ? `${latestRun.run_id || latestRun.id || '-'} · ${latestRun.status || '-'}` : '还没有训练任务记录', forgeRuns.length && !trainedRuns.length ? '训练任务未成功或尚未完成' : ''),
    stageStatus(trainedRuns.length ? 'done' : 'waiting', '模型产物', trainedRuns.length, latestRun?.best_model_path || latestRun?.model_path || latestRun?.artifact_path || '等待训练输出 best.pt', ''),
    stageStatus(forgeReleases.length ? 'done' : trainedRuns.length ? 'warning' : 'waiting', '模型下发 L1/L2', forgeReleases.length, forgeReleases.length ? `平台记录 ${forgeReleases.length} 次发布` : '训练产物通过模型仓库审批后再下发到 RK3568/RV1126', trainedRuns.length && !forgeReleases.length ? '已有训练产物，但没有发布记录' : ''),
  ]
  const sampleTraces = forgeSamples.slice(0, 80).map((sample, index) => {
    const vlmReason = sample.vlm?.reason || sample.reason || ''
    const vlmStatus = vlmReason.startsWith('vlm_failed') ? 'failed' : sample.vlm ? (sample.vlm?.sample_type === 'uncertain' ? 'warning' : 'done') : 'waiting'
    const hasLabel = Boolean(sample.dataset_label || sample.label_path || sample.yolo_label_path || sample.auto_label)
    const hasDataset = Boolean(sample.dataset_image || sample.dataset_path || sample.image_path)
    const trained = Boolean(trainedRuns.length)
    const createdAt = sample.created_at || sample.uploaded_at || sample.received_at || ''
    const timeline = [
      traceStep('done', '样本进入闭环', sample.image_path || sample.filename || sample.sha1 || '', createdAt, 'Forge 已收到图片/元数据'),
      traceStep(sample.edge_result?.l1 ? inferTraceStatus(sample.edge_result.l1.status, 'waiting') : 'waiting', 'L1 粗筛结果', sample.edge_result?.l1?.result || sample.l1_result || '当前样本未携带 L1 明细', sample.edge_result?.l1?.at || ''),
      traceStep(sample.edge_result?.l2 ? inferTraceStatus(sample.edge_result.l2.status, 'waiting') : 'waiting', 'L2 本地复核结果', sample.edge_result?.l2?.result || sample.l2_result || '当前样本未携带 L2 明细', sample.edge_result?.l2?.at || ''),
      traceStep(vlmStatus, 'Mage-VL 裁判推理', `${sample.vlm?.sample_type || sample.sample_type || '-'} · confidence ${sample.vlm?.confidence ?? '-'}`, sample.vlm?.at || createdAt, vlmReason || sample.vlm?.raw_text || ''),
      traceStep(hasLabel ? 'done' : vlmStatus === 'failed' ? 'failed' : 'waiting', '自动标注', sample.dataset_label || sample.label_path || sample.yolo_label_path || '等待可用标签', sample.updated_at || createdAt),
      traceStep(hasDataset ? 'done' : 'waiting', '训练集归集', sample.dataset_image || sample.dataset_path || sample.image_path || '等待进入训练集', sample.updated_at || createdAt),
      traceStep(trained ? 'done' : 'waiting', 'YOLO 训练', latestRun?.best_model_path || latestRun?.model_path || '等待训练任务完成', latestRun?.finished_at || latestRun?.created_at || ''),
      traceStep(forgeReleases.length ? 'done' : trained ? 'warning' : 'waiting', '模型下发', forgeReleases[0]?.modelVersion || forgeReleases[0]?.modelName || '等待发布审批/下发记录', forgeReleases[0]?.releasedAt || ''),
    ]
    return {
      trace_id: sample.trace_id || sample.sample_id || sample.sha1 || `forge-sample-${index + 1}`,
      sample_id: sample.sample_id || sample.id || '',
      camera_id: sample.cameraId || sample.camera_id || '',
      camera_name: sample.cameraName || sample.camera_name || '',
      scene_code: sample.sceneCode || sample.scene_code || '',
      sample_type: sample.sample_type || sample.vlm?.sample_type || '',
      priority: sample.priority || '',
      created_at: createdAt,
      image_path: sample.image_path || sample.dataset_image || '',
      image_preview_url: forgeSamplePreviewUrl(sample, 'raw'),
      dataset_image_preview_url: forgeSamplePreviewUrl(sample, 'dataset'),
      dataset_label_preview_url: forgeSamplePreviewUrl(sample, 'label'),
      dataset_label: sample.dataset_label || sample.label_path || sample.yolo_label_path || '',
      sha1: sample.sha1 || '',
      vlm: sample.vlm || null,
      statuses: {
        camera: 'done',
        l1: sample.edge_result?.l1 ? inferTraceStatus(sample.edge_result.l1.status, 'waiting') : 'waiting',
        l2: sample.edge_result?.l2 ? inferTraceStatus(sample.edge_result.l2.status, 'waiting') : 'waiting',
        upload: 'done',
        vlm: vlmStatus,
        label: hasLabel ? 'done' : vlmStatus === 'failed' ? 'failed' : 'waiting',
        dataset: hasDataset ? 'done' : 'waiting',
        training: trained ? 'done' : 'waiting',
        deploy: forgeReleases.length ? 'done' : trained ? 'warning' : 'waiting',
      },
      timeline,
      raw: sample,
    }
  })
  return {
    checked_at: checkedAt,
    endpoints: {
      forge: forge.base_url,
      vlm: vlm.base_url || '',
    },
    services: {
      forge,
      vlm,
      kkos: { total: kkosGateways.length, online: onlineL2, rows: kkosGateways },
      l1: { total: l1Devices.length, online: onlineL1, rows: l1Devices },
      cameras: { total: cameraRows.length, online: onlineCameras, rows: cameraRows },
    },
    stages,
    samples: sampleTraces,
    training_runs: forgeRuns,
    releases: forgeReleases.slice(0, 20),
    notes: [
      'L1/L2 本地 YOLO 是实时业务闭环；Mage-VL/Forge 是客户授权后的裁判、自动标注与训练增强。',
      '页面只展示有来源的数据。服务不可达、心跳过期、样本缺字段会按失败/等待显示，方便排查。',
    ],
  }
}

function dashboardSummary() {
  const deviceRows = managedDeviceSummaries()
  const cameraRows = cameras.map(cameraSummary)
  const alarmRows = cloudAlarms()
  const eventRows = eventsFromAlarms()
  const samples = lifecycleRegistry('samples')
  const trainingRuns = lifecycleRegistry('training_runs')
  const models = lifecycleRegistry('models')
  const todayAlarms = alarmRows.filter((item) => isToday(item.timestamp || item.received_at || item.audited_at))
  const activeProvider = activeVlmProviderStatus()
  const pipelineNodes = [
    { key: 'gateway', label: 'L2/KKOS 网关' },
    { key: 'camera', label: '摄像头/RTSP' },
    { key: 'l1', label: 'L1 哨兵' },
    { key: 'algorithm', label: '算法配置' },
    { key: 'l2', label: 'L2 本地复核' },
    { key: 'alarm', label: '告警' },
    { key: 'event', label: '事件闭环' },
    { key: 'vlm', label: 'VLM 审计' },
    { key: 'training', label: '训练中心' },
    { key: 'model', label: '模型下发' },
  ]
  const pipelineProjects = sites.map((site) => {
    const customer = customers.find((item) => item.customer_id === site.customer_id) || {}
    const siteDevices = deviceRows.filter((item) => item.site_id === site.site_id)
    const siteCameras = cameraRows.filter((item) => item.site_id === site.site_id)
    const siteBindings = cameraScenarioBindings.filter((item) => item.site_id === site.site_id && item.enabled !== false)
    const siteAlarms = alarmRows.filter((item) => item.site_id === site.site_id)
    const siteEvents = eventRows.filter((item) => item.site_id === site.site_id)
    const siteSamples = samples.filter((item) => item.site_id === site.site_id || item.customer_id === site.customer_id)
    const siteRuns = trainingRuns.filter((item) => item.site_id === site.site_id || item.customer_id === site.customer_id)
    const siteModels = models.filter((item) => item.site_id === site.site_id || item.customer_id === site.customer_id)
    const gateways = siteDevices.filter((item) => ['l2', 'mixed', 'gateway', 'kkos'].includes(item.role) || kkosGatewayTypes.some((type) => String(item.device_type || '').includes(type)))
    const l1Devices = siteDevices.filter((item) => item.role === 'l1' || String(item.device_type || '').includes('rv1126') || String(item.device_type || '').includes('rv1106'))
    const onlineGateways = gateways.filter((item) => item.status === 'online')
    const onlineL1 = l1Devices.filter((item) => item.status === 'online')
    const onlineCameras = siteCameras.filter((item) => item.status === 'online')
    const activeEvents = siteEvents.filter((item) => !['closed', '已关闭'].includes(item.event_status || item.status))
    const candidateModel = siteModels.find((item) => item.status === 'candidate')
    const activeModel = siteModels.find((item) => item.status === 'active' || item.status === 'full_release')
    return {
      project_id: site.site_id,
      project_name: site.site_name || site.name || site.site_id,
      customer_name: customer.customer_name || customer.name || site.customer_id || '-',
      nodes: {
        gateway: gateways.length
          ? nodeStatus(onlineGateways.length ? 'running' : 'offline', `${onlineGateways.length}/${gateways.length} 在线`)
          : nodeStatus('waiting', '未添加 KKOS 网关'),
        camera: siteCameras.length
          ? nodeStatus(onlineCameras.length ? 'running' : 'offline', `${onlineCameras.length}/${siteCameras.length} 在线`)
          : nodeStatus('waiting', '未确认摄像头'),
        l1: l1Devices.length
          ? nodeStatus(onlineL1.length ? 'running' : 'offline', `${onlineL1.length}/${l1Devices.length} 在线`)
          : nodeStatus('waiting', '未发现/确认 L1'),
        algorithm: siteBindings.length
          ? nodeStatus('running', `${siteBindings.length} 条摄像头算法绑定`)
          : nodeStatus(siteCameras.length ? 'waiting' : 'blocked', siteCameras.length ? '待配置算法' : '先确认摄像头'),
        l2: gateways.length
          ? nodeStatus(onlineGateways.length ? 'running' : 'offline', onlineGateways.length ? '本地 YOLO/规则复核可用' : 'KKOS 离线')
          : nodeStatus('waiting', '待添加 L2'),
        alarm: siteAlarms.length
          ? nodeStatus('active', `${siteAlarms.length} 条累计告警`)
          : nodeStatus('waiting', '暂无真实告警'),
        event: activeEvents.length
          ? nodeStatus('active', `${activeEvents.length} 个待闭环事件`)
          : nodeStatus(siteEvents.length ? 'done' : 'waiting', siteEvents.length ? '事件已闭环' : '暂无事件'),
        vlm: nodeStatus(activeProvider.configured ? 'running' : 'waiting', activeProvider.detail),
        training: siteRuns.length
          ? nodeStatus(siteRuns.some((item) => ['running', 'queued', 'dataset_ready'].includes(item.status)) ? 'active' : 'done', `${siteRuns.length} 个训练任务`)
          : nodeStatus(siteSamples.length ? 'waiting' : 'blocked', siteSamples.length ? `${siteSamples.length} 个样本待训练` : '无回流样本'),
        model: candidateModel
          ? nodeStatus('active', `候选模型 ${candidateModel.model_id}`)
          : activeModel
            ? nodeStatus('done', `已发布 ${activeModel.model_id}`)
            : nodeStatus('waiting', '暂无项目模型'),
      },
    }
  })
  return {
    customer_count: customers.length,
    project_count: sites.length,
    stream_count: cameraRows.length,
    online_cameras: cameraRows.filter((item) => item.status === 'online').length,
    offline_cameras: cameraRows.filter((item) => item.status !== 'online').length,
    device_count: deviceRows.length,
    online_devices: deviceRows.filter((item) => item.status === 'online').length,
    offline_devices: deviceRows.filter((item) => item.status !== 'online').length,
    l1_device_count: deviceRows.filter((item) => item.role === 'l1').length,
    l2_gateway_count: deviceRows.filter((item) => ['l2', 'mixed', 'gateway', 'kkos'].includes(item.role)).length,
    l1_triggers_today: todayAlarms.filter((item) => item.l1_output || item.source === 'rv1126_l1').length,
    l2_confirmed_today: todayAlarms.filter((item) => item.alarm_status === 'effective' || item.audit_verdict === 'confirm' || item.source === 'rk3568_l2').length,
    false_positive_today: todayAlarms.filter((item) => item.alarm_status === 'false_positive' || item.feedback_result === 'false_positive' || item.audit_verdict === 'overturn').length,
    human_review_pending: alarmRows.filter((item) => ['unconfirmed', 'pending', 'human_review'].includes(item.alarm_status || item.audit_verdict || item.status)).length,
    current_l1_model: firstModelVersion(deviceRows, (item) => item.role === 'l1' || String(item.device_type || '').includes('rv'), '未采集'),
    current_l2_model: firstModelVersion(deviceRows, (item) => ['l2', 'mixed', 'gateway', 'kkos'].includes(item.role) || String(item.device_type || '').includes('rk'), '未采集'),
    vlm_provider: activeProvider,
    pipeline_nodes: pipelineNodes,
    pipeline_projects: pipelineProjects,
    pipeline: pipelineNodes.map((node) => ({ name: node.label, status: pipelineProjects.some((row) => ['running', 'active', 'done'].includes(row.nodes[node.key]?.status)) ? 'running' : 'waiting' })),
  }
}

function missedCandidateSummary(rowsInput = materialPool()) {
  const rows = rowsInput.filter((item) => item.sample_judgement.l1.status === 'miss')
  return {
    policy: {
      enabled: true,
      sampling_modes: ['time_interval', 'scene_priority', 'motion_change', 'random_background'],
      default_interval_sec: { ev_intrusion: 3, person_intrusion: 5, fire_lane: 10, trash_overflow: 30 },
      max_frames_per_camera_per_day: 300,
      max_cloud_audit_frames_per_day: 100,
      priority: { ev_intrusion: 'high', person_intrusion: 'high', fire_lane: 'medium', trash_overflow: 'low' },
    },
    rows,
    stats: {
      today_missed_audit_frames: rows.length,
      privacy_processed: rows.filter((item) => item.privacy_status === 'privacy_processed').length,
      vlm_audited: rows.filter((item) => item.sample_judgement.vlm.status !== 'not_run').length,
      vlm_suspected_hazard: rows.filter((item) => item.sample_judgement.vlm.status === 'suspected_hazard').length,
      confirmed_missed_event: rows.filter((item) => item.sample_category === 'confirmed_missed_event').length,
      background_negative: rows.filter((item) => item.sample_category === 'background_negative').length,
    },
  }
}

function mockLearningCycles(scope = '', customerId = 'cust-demo-001', scenarioFilter = '') {
  const rows = lifecycleRegistry('training_cycles').map(normalizeCycle)
  return rows.filter((item) => {
    const scopeOk = scope === 'platform_baseline' ? item.scope === 'platform' : scope === 'customer_optimized' ? item.scope === 'customer' && item.customer_id === customerId : true
    return scopeOk && (!scenarioFilter || item.scenario === 'multi_scenario' || item.scenario === scenarioFilter)
  })
}

function realGatewayLog(lines = 260) {
  const snapshot = cachedKkosCoreLogSnapshot(Math.max(lines, 800))
  if (snapshot?.l1_gateway_log) return snapshot.l1_gateway_log
  return edgeSsh(rvHost, `tail -${lines} /opt/guardian/rv1126/logs/gateway.log 2>/dev/null || tail -${lines} /opt/tokai/rv1126/logs/gateway.log`, '')
}

function realGatewayFrameLog(lines = 2000) {
  const snapshot = cachedKkosCoreLogSnapshot(Math.max(lines, 800))
  if (snapshot?.l1_frame_log) return snapshot.l1_frame_log
  return edgeSsh(rvHost, `(grep -a 'frame algo' /opt/guardian/rv1126/logs/gateway.log 2>/dev/null || grep -a 'frame algo' /opt/tokai/rv1126/logs/gateway.log) | tail -${lines}`, '')
}

function realGatewayStatsLog(lines = 120) {
  const snapshot = cachedKkosCoreLogSnapshot(800)
  if (snapshot?.l1_stats_log || snapshot?.l1_gateway_log) return snapshot.l1_stats_log || snapshot.l1_gateway_log
  return edgeSsh(rvHost, `(grep -a '\\[stats channel' /opt/guardian/rv1126/logs/gateway.log 2>/dev/null || grep -a '\\[stats channel' /opt/tokai/rv1126/logs/gateway.log) | tail -${lines}`, '')
}

// Used only by the operator's live L1 inference table.  Do not go through the
// shared 30-second core-log cache: it makes a running 2fps pipeline look idle.
function liveGatewayFrameLog(lines = 2000) {
  const snapshot = realKkosCoreLogSnapshot(Math.max(lines, 800))
  return snapshot?.l1_frame_log || ''
}

function liveGatewayStatsLog(lines = 400) {
  const snapshot = realKkosCoreLogSnapshot(800)
  return snapshot?.l1_stats_log || snapshot?.l1_gateway_log || ''
}

function cachedGatewayLog(lines = 260) {
  return cachedEdge(`rv:gateway-log:${lines}`, edgeRuntimeCacheTtlMs, () => realGatewayLog(lines), '')
}

function cachedGatewayFrameLog(lines = 2000) {
  return cachedEdge(`rv:frame-log:${lines}`, edgeRuntimeCacheTtlMs, () => realGatewayFrameLog(lines), '')
}

function cachedGatewayStatsLog(lines = 120) {
  return cachedEdge(`rv:stats-log:${lines}`, edgeRuntimeCacheTtlMs, () => realGatewayStatsLog(lines), '')
}

function cachedBrainLog(lines = 4000) {
  return cachedEdge(`rk:brain-log:${lines}`, edgeRuntimeCacheTtlMs, () => {
    const snapshot = cachedKkosCoreLogSnapshot(Math.max(lines, 1200))
    if (snapshot?.l2_brain_log) return snapshot.l2_brain_log
    return edgeSsh(rkHost, `tail -${lines} /opt/guardian/logs/brain.log 2>/dev/null || tail -${lines} /opt/tokai/logs/brain.log`, '')
  }, '')
}

function kkosGatewayForCoreLogs() {
  return managedDevices.find((item) => (
    item.tailscale_ip
    && (item.role === 'l2' || item.role === 'gateway' || kkosGatewayTypes.some((type) => String(item.device_type || '').includes(type)))
  )) || managedDevices.find((item) => item.tailscale_ip && String(item.device_type || '').includes('rk3568')) || {}
}

function realKkosCoreLogSnapshot(lines = 1200) {
  const gateway = kkosGatewayForCoreLogs()
  const tailscaleIp = gateway.tailscale_ip || gateway.tailscaleIp || '100.94.124.1'
  if (!tailscaleIp) return null
  const boundedLines = Math.min(Math.max(Number(lines) || 160, 80), 180)
  // The KKOS snapshot may need to gather logs from both the RV1126 and RK3568.
  // Two seconds produced intermittent false-empty monitor pages even while
  // inference was healthy.
  return fetchJsonWithTimeout(`http://${tailscaleIp}:9200/runtime/core-logs/snapshot?lines=${boundedLines}&candidate_limit=8`, 8)
}

let lastHealthyKkosCoreLogSnapshot = null
function cachedKkosCoreLogSnapshot(lines = 1200) {
  return cachedEdge('kkos:core-log-snapshot', edgeRuntimeCacheTtlMs, () => {
    const fresh = realKkosCoreLogSnapshot(lines)
    if (fresh?.ok) lastHealthyKkosCoreLogSnapshot = fresh
    // Monitoring must degrade to its most recent confirmed snapshot rather
    // than misleadingly reporting zero inference on a transient timeout.
    return fresh?.ok ? fresh : lastHealthyKkosCoreLogSnapshot
  }, lastHealthyKkosCoreLogSnapshot)
}

function kkosCameraSnapshotBytes(rtspUrl = '') {
  const gateway = kkosGatewayForCoreLogs()
  const tailscaleIp = gateway.tailscale_ip || gateway.tailscaleIp || '100.94.124.1'
  if (!tailscaleIp || !rtspUrl) return Buffer.alloc(0)
  try {
    return execFileSync('curl', [
      '-sS',
      '-m', '12',
      '--connect-timeout', '2',
      `http://${tailscaleIp}:9200/runtime/camera-snapshot?rtsp_url=${encodeURIComponent(rtspUrl)}`,
    ], { timeout: 13000 })
  } catch {
    return Buffer.alloc(0)
  }
}

function kkosCandidateFrameBytes(eventId = '') {
  const gateway = kkosGatewayForCoreLogs()
  const tailscaleIp = gateway.tailscale_ip || gateway.tailscaleIp || '100.94.124.1'
  const safeId = safeEventId(eventId)
  if (!tailscaleIp || !safeId) return Buffer.alloc(0)
  try {
    const bytes = execFileSync('curl', ['-sS', '-m', '12', '--connect-timeout', '2', `http://${tailscaleIp}:9200/runtime/l1-candidates/${safeId}/frame`], { timeout: 13000 })
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 ? bytes : Buffer.alloc(0)
  } catch {
    return Buffer.alloc(0)
  }
}

function kkosCameraRuntimeUrls(camera = {}) {
  const gateway = kkosGatewayForCoreLogs()
  const tailscaleIp = gateway.tailscale_ip || gateway.tailscaleIp || '100.94.124.1'
  const rtspUrl = camera.rtsp_url || ''
  if (!tailscaleIp || !rtspUrl) return {}
  const encoded = encodeURIComponent(rtspUrl)
  return {
    gateway_id: gateway.device_id || '',
    gateway_name: gateway.device_name || '',
    kkos_base_url: `http://${tailscaleIp}:9200`,
    snapshot_url: `/api/camera-snapshot?camera_id=${encodeURIComponent(camera.camera_id)}`,
    mjpeg_proxy_url: `/api/camera-live/mjpeg?camera_id=${encodeURIComponent(camera.camera_id)}`,
    kkos_mjpeg_url: `http://${tailscaleIp}:9200/runtime/camera-live.mjpeg?rtsp_url=${encoded}`,
    kkos_hls_url: `http://${tailscaleIp}:9200/runtime/camera-live/hls.m3u8?rtsp_url=${encoded}`,
    kkos_webrtc_url: `http://${tailscaleIp}:9200/runtime/camera-live/webrtc?rtsp_url=${encoded}`,
  }
}

function streamKkosCameraMjpeg(res, rtspUrl = '') {
  const gateway = kkosGatewayForCoreLogs()
  const tailscaleIp = gateway.tailscale_ip || gateway.tailscaleIp || '100.94.124.1'
  if (!tailscaleIp || !rtspUrl) return send(res, 400, { detail: 'camera_id or rtsp_url required' })
  const target = `http://${tailscaleIp}:9200/runtime/camera-live.mjpeg?rtsp_url=${encodeURIComponent(rtspUrl)}`
  const upstream = http.get(target, { timeout: 5000 }, (upstreamRes) => {
    if (Number(upstreamRes.statusCode || 0) >= 400) {
      upstreamRes.resume()
      return send(res, 502, { detail: 'KKOS 实时播放服务未就绪', upstream_status: upstreamRes.statusCode })
    }
    res.writeHead(200, {
      'content-type': upstreamRes.headers['content-type'] || 'multipart/x-mixed-replace; boundary=frame',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    })
    upstreamRes.pipe(res)
  })
  upstream.on('timeout', () => upstream.destroy(new Error('KKOS live stream timeout')))
  upstream.on('error', (error) => {
    if (!res.headersSent) send(res, 502, { detail: error.message || 'KKOS 实时播放服务不可达' })
    else res.end()
  })
  res.on('close', () => upstream.destroy())
}

function parseFrameResults(logText, stats = []) {
  const byChannel = {}
  const regex = /\[channel (\d+)\] frame algo=([^\s]+) score=([0-9.]+) threshold=([0-9.]+) infer_ms=(\d+) source=([^\s]+) class=([^\s]+)(?: ts_ms=(\d+))?/g
  let match
  while ((match = regex.exec(logText))) {
    const channel = Number(match[1])
    const stream = streams[channel]
    const binding = cameraScenarioBindings.find((item) => item.enabled !== false && item.scenario === match[2])
    const camera = cameras.find((item) => item.camera_id === binding?.camera_id)
    if (!byChannel[channel]) byChannel[channel] = []
    byChannel[channel].push({
      id: `frame-${channel}-${byChannel[channel].length}`,
      channel_id: stream?.channel_id || `ch${channel}`,
      channel_name: stream?.name || `channel_${channel}`,
      algorithm: match[2],
      score: Number(match[3]),
      threshold: Number(match[4]),
      inference_ms: Number(match[5]),
      source: match[6],
      class_name: match[7],
      decision: Number(match[3]) >= Number(match[4]) ? 'model_hit' : 'no_trigger',
      sample_type: Number(match[3]) >= Number(match[4]) ? 'l1_model_hit' : 'l1_no_trigger',
      inference_count: 1,
      // ts_ms is emitted by RV1126 at inference time. Old log entries do not
      // contain it, so leave their time blank instead of pretending it is now.
      timestamp: match[8] ? new Date(Number(match[8])).toISOString() : '',
      snapshot_url: stream?.snapshot_url || (camera?.camera_id ? `/api/camera-snapshot?camera_id=${encodeURIComponent(camera.camera_id)}` : ''),
    })
  }
  const latest = []
  const statByIndex = Object.fromEntries(stats.map((item) => [channelIndex(item.channel_id), item]))
  for (const [channel, rows] of Object.entries(byChannel)) {
    const expected = Number(statByIndex[Number(channel)]?.effective_inferences || 0)
    latest.push(...rows.slice(expected > 0 ? -expected : -80))
  }
  // The monitor is an operator view, not a packet dump.  Coalesce the 2fps
  // confirmation frames from one burst; actual L2 submissions remain in the
  // separate candidate-events table and are not inferred from score alone.
  const grouped = []
  for (const row of latest.reverse()) {
    const previous = grouped.at(-1)
    const timestamp = Date.parse(row.timestamp || '')
    const previousTimestamp = Date.parse(previous?.timestamp || '')
    const sameBurst = previous
      && row.channel_id === previous.channel_id
      && row.algorithm === previous.algorithm
      && row.class_name === previous.class_name
      && Number.isFinite(timestamp)
      && Number.isFinite(previousTimestamp)
      && Math.abs(timestamp - previousTimestamp) <= 2500
    if (sameBurst) {
      previous.inference_count += 1
      if (row.score > previous.score) {
        previous.score = row.score
        previous.inference_ms = row.inference_ms
      }
      continue
    }
    grouped.push(row)
  }
  // `latest.reverse()` above is newest-first; preserve that order for the UI.
  return grouped
}

function parseStats(logText) {
  const byChannel = {}
  const regex = /\[stats channel (\d+)\] frames=(\d+)(?: effective_inferences=(\d+))?(?: skipped_static=(\d+))?(?: candidate_frames=(\d+))? loop_ms=(\d+) reconnects=(\d+)(.*)/g
  let match
  while ((match = regex.exec(logText))) {
    const channel = Number(match[1])
    const stream = streams[channel]
    const tail = match[8] || ''
    const triggerMatches = [...tail.matchAll(/triggers_([a-zA-Z0-9_]+)=(\d+)/g)]
    const triggers = Object.fromEntries(triggerMatches.map((item) => [item[1], Number(item[2])]))
    // A channel's stats line does not include the algorithm name.  Prefer the
    // most recently applied active binding (the one currently rendered into
    // the RV1126 config), not an older historical binding.
    const configuredAlgorithm = cameraScenarioBindings
      .filter((binding) => binding.enabled !== false)
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime())[0]?.scenario
      || stream?.algorithm
      || algorithms.find((item) => channelIndex(item.channel_id) === channel)?.algorithm
      || '-'
    byChannel[channel] = {
      channel_id: stream?.channel_id || `ch${channel}`,
      channel_name: stream?.name || `channel_${channel}`,
      algorithm: configuredAlgorithm,
      frames: Number(match[2]),
      effective_inferences: Number(match[3] || 0),
      skipped_static: Number(match[4] || 0),
      candidate_frames: Number(match[5] || 0),
      loop_ms: Number(match[6]),
      reconnects: Number(match[7]),
      triggers,
    }
  }
  const configured = channels.map((_, index) => byChannel[index] || {
    channel_id: streams[index]?.channel_id || `ch${index}`,
    channel_name: streams[index]?.name || `channel_${index}`,
    algorithm: streams[index]?.algorithm || '-',
    frames: 0,
    effective_inferences: 0,
    skipped_static: 0,
    candidate_frames: 0,
    loop_ms: 0,
    reconnects: 0,
    triggers: {},
  })
  const stress = Object.keys(byChannel)
    .map(Number)
    .filter((index) => index >= channels.length)
    .sort((a, b) => a - b)
    .map((index) => byChannel[index])
  return [...configured, ...stress]
}

function parseStatsEvents(logText) {
  const rows = []
  const regex = /\[stats channel (\d+)\] frames=(\d+)(?: effective_inferences=(\d+))?(?: skipped_static=(\d+))?(?: candidate_frames=(\d+))? loop_ms=(\d+) reconnects=(\d+)(.*)/g
  let match
  while ((match = regex.exec(logText))) {
    const channel = Number(match[1])
    const tail = match[8] || ''
    const triggerMatches = [...tail.matchAll(/triggers_([a-zA-Z0-9_]+)=(\d+)/g)]
    rows.push({
      id: `stats-${channel}-${match[2]}`,
      channel_id: streams[channel]?.channel_id || `ch${channel}`,
      channel_name: streams[channel]?.name || `channel_${channel}`,
      algorithm: streams[channel]?.algorithm || triggerMatches[0]?.[1] || 'bottle_cap_missing',
      frames: Number(match[2]),
      effective_inferences: Number(match[3] || 0),
      skipped_static: Number(match[4] || 0),
      candidate_frames: Number(match[5] || 0),
      loop_ms: Number(match[6]),
      reconnects: Number(match[7]),
      triggers: Object.fromEntries(triggerMatches.map((item) => [item[1], Number(item[2])])),
      timestamp: businessNow(),
    })
  }
  return rows.reverse()
}

function realCandidates(snapshot = cachedKkosCoreLogSnapshot(1200)) {
  if (Array.isArray(snapshot?.l1_candidates) && snapshot.l1_candidates.length) {
    return snapshot.l1_candidates.map((row) => {
      const meta = row.meta || row
      const det = meta.detections?.[0] || meta.rois?.[0] || {}
      const isPeriodicAudit = meta.sample_type === 'periodic_miss_guard'
      const channelNumber = Number(meta.channel ?? String(meta.channel_id || '').replace(/\D/g, '')) || 0
      const frameSize = frameSizesByChannel[channelNumber] || { frame_width: 640, frame_height: 360 }
      return {
        event_id: meta.event_id || meta.trigger_id || row.raw_path?.split('/').pop()?.replace('.json', ''),
        trace_id: meta.trace_id || meta.event_id || meta.trigger_id || '',
        channel_id: meta.channel_id || `ch${meta.channel ?? ''}`,
        algorithm: meta.algorithm || meta.alarm_type,
        timestamp: meta.timestamp || meta.ts_ms,
        class_name: det.class_name,
        confidence: det.confidence ?? det.conf,
        // RV1126 candidate metadata uses [x, y, width, height]; every UI
        // overlay uses [x1, y1, x2, y2]. Convert at the API boundary once.
        bbox: l1BboxToXyxy(det.bbox),
        frame_path: meta.frame_path || '',
        sent_to_l2: !isPeriodicAudit,
        l2_status: isPeriodicAudit ? 'periodic_audit_sample' : 'auto_sent_to_l2',
        frame_width: frameSize.frame_width,
        frame_height: frameSize.frame_height,
        raw_path: row.raw_path || '',
        source: meta.source || 'rv1126_l1',
        sample_type: meta.sample_type || '',
      }
    }).filter((item) => item.event_id).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
  }
  const raw = edgeSsh(
    rvHost,
    "dir=/opt/guardian/candidates/pending; [ -d \"$dir\" ] || dir=/opt/tokai/candidates/pending; for f in $(ls -1t \"$dir\"/*.json 2>/dev/null | head -50); do echo __GUARDIAN_JSON__:$f; cat $f; echo; done",
    '',
  )
  return raw.split('__GUARDIAN_JSON__:').slice(1).map((chunk) => {
    const firstNewline = chunk.indexOf('\n')
    const remotePath = chunk.slice(0, firstNewline).trim()
    const body = chunk.slice(firstNewline + 1).trim()
    try {
      const meta = JSON.parse(body)
      const det = meta.detections?.[0] || meta.rois?.[0] || {}
      const isPeriodicAudit = meta.sample_type === 'periodic_miss_guard'
      const channelNumber = Number(meta.channel ?? String(meta.channel_id || '').replace(/\D/g, '')) || 0
      const frameSize = frameSizesByChannel[channelNumber] || { frame_width: 640, frame_height: 360 }
      return {
        event_id: meta.event_id || meta.trigger_id || remotePath.split('/').pop()?.replace('.json', ''),
        channel_id: meta.channel_id || `ch${meta.channel ?? ''}`,
        algorithm: meta.algorithm || meta.alarm_type,
        timestamp: meta.timestamp || meta.ts_ms,
        class_name: det.class_name,
        confidence: det.confidence ?? det.conf,
        bbox: l1BboxToXyxy(det.bbox),
        frame_path: meta.frame_path || '',
        sent_to_l2: !isPeriodicAudit,
        l2_status: isPeriodicAudit ? 'periodic_audit_sample' : 'auto_sent_to_l2',
        frame_width: frameSize.frame_width,
        frame_height: frameSize.frame_height,
        raw_path: remotePath,
        sample_type: meta.sample_type || '',
      }
    } catch {
      return null
    }
  }).filter(Boolean).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
}

function l1BboxToXyxy(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return []
  const [x, y, width, height] = bbox.map(Number)
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return []
  return [x, y, x + width, y + height]
}

function cachedCandidates() {
  return cachedEdge('rv:candidates', edgeRuntimeCacheTtlMs, realCandidates, [])
}

function realL2Reviews(candidates = cachedCandidates(), brainLog = cachedBrainLog(4000)) {
  return candidates.filter((candidate) => candidate.sample_type !== 'periodic_miss_guard').map((candidate) => {
    const escaped = candidate.event_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const review = brainLog.match(new RegExp(`review ${escaped} NPU: (\\d+) (?:target )?detections, best_conf=([0-9.]+)(?: bbox=\\[([^\\]]*)\\])?(?: targets=\\[[^\\n]*\\])? \\(sentinel conf=([0-9.]+)\\)`))
    const ack = brainLog.match(new RegExp(`ACK sent: [^\\n]+ -> ${escaped} verdict=([^\\s]+)`))
    const reviewedConfidence = review ? Number(review[2]) : null
    const l2Bbox = review?.[3]
      ? review[3].split(',').map((value) => Number(value.trim())).filter(Number.isFinite)
      : []
    const verdict = ack?.[1] || 'pending'
    return {
    event_id: candidate.event_id,
    timestamp: candidate.timestamp || businessNow(),
    channel_id: candidate.channel_id,
    algorithm: candidate.algorithm,
    l1_result: `${candidate.class_name || '-'} ${Number(candidate.confidence || 0).toFixed(3)}`,
    // New records use the RK3568 NPU box.  Earlier retained records predate
    // L2 box logging, so use their L1 proposal only as a backwards-compatible
    // visual fallback.
    bbox: l2Bbox.length === 4 ? l2Bbox : (candidate.bbox || []),
    bbox_source: l2Bbox.length === 4 ? 'l2_rknn' : 'l1_candidate_legacy',
    frame_width: candidate.frame_width || 1280,
    frame_height: candidate.frame_height || 720,
    l2_result: review ? `RK3568 NPU ${review[1]} detections / ${reviewedConfidence.toFixed(3)}` : 'sent_to_rk3568',
    roi_result: Array.isArray(candidate.bbox) && candidate.bbox.length === 4 ? 'hit' : 'unknown',
    duration_result: 'pending_runtime_rule',
    cooldown_result: 'pass',
    final_decision: verdict,
    reasoning: review
      ? `RK3568 real NPU review: ${review[1]} detections, best confidence ${reviewedConfidence.toFixed(3)}; ACK ${verdict}.`
      : 'L1 candidate has been sent to RK3568; no matching L2 log was found in the retained window.',
    review_ms: 0,
    }
  })
}

function cachedL2Reviews() {
  return cachedEdge('rk:l2-reviews', edgeRuntimeCacheTtlMs, () => realL2Reviews(cachedCandidates()), [])
}

function flowFrames(limit = 40) {
  const reviewsByEventId = Object.fromEntries(cachedL2Reviews().map((item) => [item.event_id, item]))
  return cachedCandidates().slice(0, limit).map((candidate) => {
    const review = reviewsByEventId[candidate.event_id]
    const hasFinalDecision = review && review.final_decision && review.final_decision !== 'pending'
    const confidence = Number(candidate.confidence || 0)
    const triggerDone = candidate.sent_to_l2 ? 'done' : 'waiting'
    const reviewDone = review && review.l2_result !== 'sent_to_rk3568' ? 'done' : 'waiting'
    const accepted = ['accept', 'accepted'].includes(String(review?.final_decision || '').toLowerCase())
    const stages = [
      { stage: 'rtsp_recv', status: 'done', latency_ms: null, note: 'L1 已从 RTSP/摄像头输入获得帧' },
      { stage: 'l1_infer_done', status: 'done', latency_ms: null, note: `${candidate.class_name || '-'} ${confidence ? confidence.toFixed(3) : '-'}` },
      { stage: 'trigger_decided', status: triggerDone, latency_ms: null, note: triggerDone === 'done' ? '达到 L1 上报条件，生成候选帧' : '等待 L1 判定' },
      { stage: 'http_sent', status: triggerDone, latency_ms: null, note: triggerDone === 'done' ? '候选帧已上报 L2' : '未上报 L2' },
      { stage: 'brain_received', status: review ? 'done' : 'waiting', latency_ms: null, note: review ? 'RK3568 已进入复核链路' : '等待 RK3568 复核日志' },
      { stage: 'review_done', status: reviewDone, latency_ms: review?.review_ms ?? null, note: review?.l2_result || '等待 L2 YOLO/规则复核' },
      { stage: 'rule_done', status: hasFinalDecision ? 'done' : 'waiting', latency_ms: null, note: hasFinalDecision ? `最终判定 ${review.final_decision}` : '等待业务规则输出' },
      { stage: 'alarm_uploaded', status: accepted ? 'done' : 'waiting', latency_ms: null, note: accepted ? '有效告警可上云' : '未形成告警或仍在等待' },
    ]
    const currentStage = stages.slice().reverse().find((item) => item.status === 'done')?.stage || 'rtsp_recv'
    return {
      trace_id: candidate.event_id,
      event_id: candidate.event_id,
      sentinel_sn: 'rv1126_01',
      channel: candidate.channel_id,
      channel_id: candidate.channel_id,
      channel_name: candidate.channel_id,
      algorithm: candidate.algorithm,
      algorithm_label: scenarioNames[candidate.algorithm] || candidate.algorithm || '-',
      stage: currentStage,
      level: 'L1/L2',
      result: review?.final_decision || candidate.l2_status || 'candidate',
      confidence,
      alarm_id: accepted ? `alarm_${safeEventId(candidate.event_id)}` : '',
      reasoning: review?.reasoning || 'L1 已产生候选帧，等待 L2 复核日志匹配。',
      stages,
      timestamp: candidate.timestamp || businessNow(),
    }
  })
}

function flowSummary() {
  const stats = parseStats(cachedGatewayStatsLog(120))
  const frames = flowFrames(80)
  const triggerCount = stats.reduce((sum, item) => sum + Object.values(item.triggers || {}).reduce((a, b) => a + Number(b || 0), 0), 0)
  const inferCosts = parseFrameResults(cachedGatewayFrameLog(400), stats).map((item) => Number(item.inference_ms || 0)).filter((item) => item > 0).sort((a, b) => a - b)
  const p95Index = inferCosts.length ? Math.min(inferCosts.length - 1, Math.floor(inferCosts.length * 0.95)) : -1
  return {
    sentinels: managedDeviceSummaries().filter((item) => item.role === 'l1' || String(item.device_type || '').includes('rv1126')).length,
    channels: stats.length || cameras.length,
    frames_per_sec: stats.reduce((sum, item) => sum + Number(item.effective_inferences || 0), 0),
    trigger_rate_per_min: triggerCount,
    p95_latency_ms: p95Index >= 0 ? inferCosts[p95Index] : 0,
    brain_pressure: cachedL2Reviews().filter((item) => item.final_decision === 'pending').length,
    latest_trace_count: frames.length,
    updated_at: businessNow(),
  }
}

function normalizeLogTime(value, fallback = businessNow()) {
  if (!value) return fallback
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value
    const date = new Date(ms)
    return Number.isFinite(date.getTime()) ? date.toISOString() : fallback
  }
  const asNumber = Number(value)
  if (Number.isFinite(asNumber) && String(value).trim() !== '') return normalizeLogTime(asNumber, fallback)
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback
}

function isHumanApprovedSample(sample = {}) {
  const status = String(
    sample.human_review_status
    || sample.review_status
    || sample.dataset_review_status
    || sample.approval_status
    || '',
  ).toLowerCase()
  return sample.human_approved === true
    || sample.dataset_approved === true
    || sample.training_approved === true
    || ['approved', 'accepted', 'confirmed', 'human_approved'].includes(status)
}

function coreLogStep(status, stage, title, detail = '', at = '', evidence = '', source = '', extra = {}) {
  return {
    status,
    stage,
    title,
    detail,
    at: normalizeLogTime(at),
    evidence,
    source,
    ...extra,
  }
}

function coreLogEvent(trace, step, extra = {}) {
  return {
    id: `${trace.trace_id}-${step.stage}-${trace.steps.length}`,
    trace_id: trace.trace_id,
    object_id: trace.object_id,
    camera_id: trace.camera_id,
    camera_name: trace.camera_name,
    scene_code: trace.scene_code,
    scene_name: trace.scene_name,
    trigger_type: trace.trigger_type,
    status: step.status,
    stage: step.stage,
    title: step.title,
    detail: step.detail,
    evidence: step.evidence,
    source: step.source,
    at: step.at,
    ...extra,
  }
}

function autoLabelStepStatus(sample = {}) {
  const status = sample.label_status || ''
  if (status === 'not_required') return 'done'
  if (status === 'auto_label_draft') return 'warning'
  if (status === 'need_human_box' || status === 'need_human_review') return 'warning'
  if (sample.auto_label || sample.dataset_label || sample.label_path) return 'warning'
  return 'waiting'
}

function autoLabelStepDetail(sample = {}) {
  const status = sample.label_status || ''
  const reason = sample.label_reject_reason || ''
  if (status === 'not_required') return reason === 'no_bottle_visible'
    ? 'Mage-VL 判断画面内没有瓶子：该样本作为背景/无效样本保留，不生成 YOLO 标注框，不允许进入正样本训练。'
    : '该样本不需要生成 YOLO 标注框。'
  if (status === 'need_human_box') return 'Mage-VL 判断可能有目标，但没有可信 bbox：不自动造框，等待人工画框/确认。'
  if (status === 'need_human_review') return 'Mage-VL 输出不确定或置信度不足：不生成训练标签，等待人工复核。'
  if (status === 'auto_label_draft') return 'Mage-VL 已生成标注草稿，必须人工审核后才允许进入训练素材。'
  if (sample.auto_label || sample.dataset_label || sample.label_path) return '已生成标注草稿，必须人工审核后才允许进入训练素材。'
  return '等待 Mage-VL 产生可审核标注草稿。'
}

function buildCoreLogs(limit = 200) {
  const checkedAt = businessNow()
  const cameraRows = cameras.map(cameraSummary)
  const devices = managedDeviceSummaries()
  const activeScenarios = new Set(cameraScenarioBindings.filter((item) => item.enabled !== false).map((item) => item.scenario === 'fire_lane' ? 'fire_lane_occupied' : item.scenario))
  const stats = parseStats(cachedGatewayStatsLog(120)).filter((item) => activeScenarios.has(item.algorithm))
  // Stats lines are aggregate telemetry, not per-object evidence. They must
  // never create rows in the object-trace table.
  const statsEvents = []
  const frameRows = parseFrameResults(cachedGatewayFrameLog(2000), stats).filter((item) => activeScenarios.has(item.algorithm))
  // Only an explicit `periodic_audit ... http=200 ok` line represents a real
  // miss-guard upload. Do not turn every no-detection inference into a sample.
  const periodicAuditRows = [...cachedGatewayLog(800).matchAll(/\[channel (\d+)\] periodic_audit algo=([^\s]+) http=(\d+) (ok|fail)/g)]
    .map((match, index) => ({ id: `audit-${match[1]}-${index}`, channel_id: `ch${match[1]}`, algorithm: match[2], http_status: Number(match[3]), ok: match[4] === 'ok', timestamp: businessNow() }))
    .filter((item) => activeScenarios.has(item.algorithm))
  const candidates = cachedCandidates().filter((item) => {
    const at = new Date(item.timestamp || item.created_at || 0).getTime()
    return activeScenarios.has(item.algorithm) && item.sample_type !== 'periodic_miss_guard' && at > Date.now() - 10 * 60 * 1000
  })
  const reviews = cachedL2Reviews()
  const forge = forgeServiceHealth()
  const forgeSamples = forge.reachable ? forgeServiceSamples() : []
  const trainingRuns = forge.reachable ? forgeServiceTrainingRuns() : []
  const reviewsByEventId = Object.fromEntries(reviews.map((item) => [item.event_id, item]))
  const sampleByTraceId = new Map()

  forgeSamples.forEach((sample) => {
    const keys = [
      sample.trace_id,
      sample.event_id,
      sample.edge_event_id,
      sample.l1_event_id,
      sample.sample_id,
      sample.id,
    ].filter(Boolean).map(String)
    keys.forEach((key) => sampleByTraceId.set(key, sample))
  })

  function cameraForChannel(channelId, sceneCode = '') {
    const channelText = String(channelId || '')
    const preferredBinding = cameraScenarioBindings.find((binding) => binding.enabled !== false && binding.scenario === sceneCode)
    if (preferredBinding) {
      const preferredCamera = cameraRows.find((camera) => camera.camera_id === preferredBinding.camera_id)
      if (preferredCamera) return preferredCamera
    }
    return cameraRows.find((camera) => (
      String(camera.channel_id || '') === channelText
      || String(camera.camera_id || '') === channelText
      || String(camera.name || camera.camera_name || '').includes(channelText)
    )) || cameraRows[0] || {}
  }

  function bindingFor(camera = {}, sceneCode = '') {
    return cameraScenarioBindings.find((binding) => (
      (!camera.camera_id || binding.camera_id === camera.camera_id)
      && (!sceneCode || binding.scenario === sceneCode)
    )) || cameraScenarioBindings.find((binding) => !sceneCode || binding.scenario === sceneCode) || {}
  }

  function makeTrace(base) {
    return {
      trace_id: base.trace_id,
      object_id: base.object_id,
      camera_id: base.camera_id || '',
      camera_name: base.camera_name || '-',
      scene_code: base.scene_code || '',
      scene_name: scenarioNames[base.scene_code] || base.scene_code || '-',
      trigger_type: base.trigger_type || 'unknown',
      trigger_label: base.trigger_label || '',
      current_stage: '',
      status: 'waiting',
      started_at: normalizeLogTime(base.started_at),
      updated_at: normalizeLogTime(base.started_at),
      steps: [],
      raw: base.raw || null,
    }
  }

  function addStep(trace, step, events, extra = {}) {
    trace.steps.push(step)
    trace.updated_at = step.at || trace.updated_at
    trace.current_stage = step.stage
    trace.status = step.status
    events.push(coreLogEvent(trace, step, extra))
  }

  const traces = []
  const events = []

  for (const candidate of candidates.slice(0, limit)) {
    const review = reviewsByEventId[candidate.event_id]
    const sceneCode = candidate.algorithm || 'bottle_cap_missing'
    const camera = cameraForChannel(candidate.channel_id, sceneCode)
    const binding = bindingFor(camera, sceneCode)
    const sample = sampleByTraceId.get(String(candidate.event_id))
    const objectId = `obj-${safeEventId(candidate.event_id)}`
    const trace = makeTrace({
      trace_id: `trace-${safeEventId(candidate.event_id)}`,
      object_id: objectId,
      camera_id: camera.camera_id,
      camera_name: camera.camera_name || camera.name || candidate.channel_id,
      scene_code: sceneCode,
      trigger_type: 'l1_suspected_object',
      trigger_label: 'L1 发现疑似目标',
      started_at: candidate.timestamp,
      raw: candidate,
    })
    addStep(trace, coreLogStep(
      binding.runtime_control?.status === 'camera_awake' || binding.enabled !== false ? 'done' : 'waiting',
      'camera_awake',
      '摄像头进入监测',
      binding.runtime_control?.status === 'camera_awake' ? '后台摄像头开关已唤醒，L1/L2 服务保持常驻运行。' : '等待摄像头唤醒或 KKOS 回报。',
      candidate.timestamp,
      camera.rtsp_url || camera.rtsp || '',
      'Guardian Cloud / KKOS',
    ), events)
    addStep(trace, coreLogStep(
      'done',
      'l1_candidate',
      'L1 粗筛命中疑似目标',
      `${candidate.class_name || '-'} 置信度 ${Number(candidate.confidence || 0).toFixed(3)}，已生成唯一对象 ${objectId}。`,
      candidate.timestamp,
      candidate.frame_path || candidate.raw_path || '',
      'RV1126 L1',
    ), events, { confidence: candidate.confidence, class_name: candidate.class_name })
    addStep(trace, coreLogStep(
      candidate.sent_to_l2 ? 'done' : 'waiting',
      'l1_upload_l2',
      '图片上报 L2',
      candidate.sent_to_l2 ? 'L1 候选图片已进入 RK3568/L2 复核链路。' : '等待 L1 上报。',
      candidate.timestamp,
      candidate.raw_path || '',
      'RV1126 L1',
    ), events)
    addStep(trace, coreLogStep(
      review && review.l2_result !== 'sent_to_rk3568' ? 'done' : 'waiting',
      'l2_review',
      'L2 本地 YOLO/规则复核',
      review?.reasoning || '等待 RK3568 复核日志匹配。',
      candidate.timestamp,
      review?.l2_result || '',
      'RK3568 KKOS',
    ), events, { l2_decision: review?.final_decision || 'pending' })
    addStep(trace, coreLogStep(
      sample?.vlm ? (String(sample.vlm.reason || '').startsWith('vlm_failed') ? 'failed' : 'done') : 'waiting',
      'mage_audit',
      'Mage-VL 裁判审计',
      sample?.vlm ? `${sample.vlm.sample_type || sample.sample_type || '-'} · confidence ${sample.vlm.confidence ?? '-'}` : '等待 L2/KKOS 上传到远端 VLM 推理服务。',
      sample?.vlm?.at || sample?.created_at || candidate.timestamp,
      sample?.vlm?.reason || sample?.vlm?.raw_text || '',
      'Mage-VL',
    ), events)
	    addStep(trace, coreLogStep(
	      sample ? autoLabelStepStatus(sample) : 'waiting',
	      'auto_label_draft',
	      '自动标注草稿',
	      sample ? autoLabelStepDetail(sample) : '等待 Mage-VL 产生可审核标注草稿。',
	      sample?.updated_at || sample?.created_at || candidate.timestamp,
	      sample?.dataset_label || sample?.label_path || '',
	      'Guardian Forge',
      sample ? {
        sample_id: sample.sample_id || sample.id || '',
        preview_image_url: forgeSamplePreviewUrl(sample, 'raw'),
	        dataset_image_preview_url: forgeSamplePreviewUrl(sample, 'dataset'),
	        label_preview_url: forgeSamplePreviewUrl(sample, 'label'),
	        dataset_label_path: sample.dataset_label || sample.label_path || sample.yolo_label_path || '',
	        label_status: sample.label_status || '',
	        label_reject_reason: sample.label_reject_reason || '',
	        auto_label: sample.auto_label || '',
	      } : {},
	    ), events)
    addStep(trace, coreLogStep(
      isHumanApprovedSample(sample) ? 'done' : 'waiting',
      'human_dataset_approval',
      '人工审核训练素材',
      isHumanApprovedSample(sample) ? '人工已确认该样本可进入训练集。' : '未人工确认：不会自动进入训练集，也不会自动触发训练。',
      sample?.reviewed_at || sample?.updated_at || candidate.timestamp,
      sample?.reviewer || '',
      '人工审核',
    ), events)
    traces.push(trace)
  }

  const candidateIds = new Set(candidates.map((item) => String(item.event_id)))
  for (const audit of periodicAuditRows.slice(-limit).reverse()) {
    const sceneCode = audit.algorithm || 'bottle_cap_missing'
    const camera = cameraForChannel(audit.channel_id, sceneCode)
    const trace = makeTrace({
      trace_id: `trace-${safeEventId(audit.id)}-${safeEventId(audit.channel_id)}`,
      object_id: `audit-${safeEventId(audit.id)}-${safeEventId(audit.channel_id)}`,
      camera_id: camera.camera_id,
      camera_name: camera.camera_name || camera.name || audit.channel_id,
      scene_code: sceneCode,
      trigger_type: 'periodic_miss_guard',
      trigger_label: '漏检防护定时抽帧',
      started_at: audit.timestamp,
      raw: audit,
    })
    addStep(trace, coreLogStep(
      'done',
      'l1_periodic_frame',
      'L1 定时抽帧',
      `RV1126 已执行定时审计抽帧并上报 RK3568，HTTP ${audit.http_status}。`,
      audit.timestamp,
      '',
      'RV1126 L1',
    ), events, { confidence: frame.score, class_name: frame.class_name })
    addStep(trace, coreLogStep(
      audit.ok ? 'done' : 'failed',
      'miss_guard_upload_policy',
      '漏检防护送审策略',
      audit.ok ? 'RK3568 已接收 periodic_miss_guard 样本，等待 Forge/VLM 后续处理。' : '审计样本未能上报 RK3568。',
      audit.timestamp,
      `HTTP ${audit.http_status}`,
      'Guardian Strategy',
    ), events)
    traces.push(trace)
  }

  for (const stat of statsEvents.slice(0, Math.min(30, limit))) {
    const sceneCode = stat.algorithm || 'bottle_cap_missing'
    const camera = cameraForChannel(stat.channel_id, sceneCode)
    const trace = makeTrace({
      trace_id: `trace-${safeEventId(stat.id)}`,
      object_id: `monitor-${safeEventId(stat.channel_id)}-${stat.frames}`,
      camera_id: camera.camera_id,
      camera_name: camera.camera_name || camera.name || stat.channel_name,
      scene_code: sceneCode,
      trigger_type: 'l1_monitor_stats',
      trigger_label: 'L1 持续监测统计',
      started_at: stat.timestamp,
      raw: stat,
    })
    addStep(trace, coreLogStep(
      'done',
      'l1_monitor_stats',
      'L1 持续监测统计',
      `累计帧 ${stat.frames}，实际推理 ${stat.effective_inferences}，静态跳过 ${stat.skipped_static}，候选帧 ${stat.candidate_frames}，触发 ${JSON.stringify(stat.triggers || {})}。`,
      stat.timestamp,
      `loop_ms=${stat.loop_ms}, reconnects=${stat.reconnects}`,
      'RV1126 L1',
    ), events)
    traces.push(trace)
  }

  forgeSamples.slice(0, limit).forEach((sample, index) => {
    const sampleId = sample.sample_id || sample.id || `forge-sample-${index + 1}`
    const knownCandidate = [sample.trace_id, sample.event_id, sample.edge_event_id, sample.l1_event_id, sample.sample_id, sample.id].some((id) => candidateIds.has(String(id)))
    if (knownCandidate) return
    const sceneCode = sample.sceneCode || sample.scene_code || 'bottle_cap_missing'
    const approved = isHumanApprovedSample(sample)
    const trace = makeTrace({
      trace_id: `trace-${safeEventId(sample.trace_id || sampleId)}`,
      object_id: `sample-${safeEventId(sampleId)}`,
      camera_id: sample.cameraId || sample.camera_id || '',
      camera_name: sample.cameraName || sample.camera_name || '-',
      scene_code: sceneCode,
      trigger_type: sample.sample_type || sample.vlm?.sample_type || 'forge_sample',
      trigger_label: 'Forge 已收到样本',
      started_at: sample.created_at || sample.uploaded_at || sample.received_at,
      raw: sample,
    })
    addStep(trace, coreLogStep('done', 'forge_sample_received', '样本上传到 Forge', sample.image_path || sample.filename || sample.sha1 || '', sample.created_at || sample.uploaded_at || sample.received_at, forgeSamplePreviewUrl(sample, 'raw'), 'Guardian Forge', {
      sample_id: sampleId,
      preview_image_url: forgeSamplePreviewUrl(sample, 'raw'),
      dataset_image_preview_url: forgeSamplePreviewUrl(sample, 'dataset'),
    }), events)
    addStep(trace, coreLogStep(sample.vlm ? 'done' : 'waiting', 'mage_audit', 'Mage-VL 裁判审计', sample.vlm ? `${sample.vlm.sample_type || sample.sample_type || '-'} · confidence ${sample.vlm.confidence ?? '-'}` : '等待 VLM 推理结果。', sample.vlm?.at || sample.updated_at || sample.created_at, sample.vlm?.reason || sample.vlm?.raw_text || '', 'Mage-VL'), events)
	    addStep(trace, coreLogStep(autoLabelStepStatus(sample), 'auto_label_draft', '自动标注草稿', autoLabelStepDetail(sample), sample.updated_at || sample.created_at, sample.dataset_label || sample.label_path || '', 'Guardian Forge', {
	      sample_id: sampleId,
	      preview_image_url: forgeSamplePreviewUrl(sample, 'raw'),
	      dataset_image_preview_url: forgeSamplePreviewUrl(sample, 'dataset'),
	      label_preview_url: forgeSamplePreviewUrl(sample, 'label'),
	      dataset_label_path: sample.dataset_label || sample.label_path || sample.yolo_label_path || '',
	      label_status: sample.label_status || '',
	      label_reject_reason: sample.label_reject_reason || '',
	      auto_label: sample.auto_label || '',
	    }), events)
    addStep(trace, coreLogStep(approved ? 'done' : 'waiting', 'human_dataset_approval', '人工审核训练素材', approved ? '人工已确认该样本进入训练素材。' : '待人工审核：不会自动进入训练素材，不会自动启动训练。', sample.reviewed_at || sample.updated_at || sample.created_at, sample.reviewer || '', '人工审核'), events)
    traces.push(trace)
  })

  const trainingEvents = trainingRuns.slice(0, 30).map((run, index) => ({
    id: `training-${safeEventId(run.run_id || run.id || index)}`,
    trace_id: run.trace_id || '',
    object_id: '',
    camera_id: '',
    camera_name: '',
    scene_code: run.scene_code || run.scenario || '',
    scene_name: scenarioNames[run.scene_code || run.scenario] || run.scene_code || run.scenario || '-',
    trigger_type: 'manual_training',
    status: ['success', 'completed', 'finished', 'done'].includes(String(run.status || '').toLowerCase()) ? 'done' : 'warning',
    stage: 'manual_training',
    title: '人工确认后训练任务',
    detail: `${run.run_id || run.id || '-'} · ${run.status || '-'}`,
    evidence: run.best_model_path || run.model_path || run.artifact_path || '',
    source: 'Guardian Forge',
    at: normalizeLogTime(run.finished_at || run.created_at || run.started_at),
    requires_human_approval: true,
  }))
  events.push(...trainingEvents)

  const sortedEvents = events
    .sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime())
    .slice(0, limit)
  const stageCounts = sortedEvents.reduce((acc, item) => {
    acc[item.stage] = (acc[item.stage] || 0) + 1
    return acc
  }, {})

  return {
    checked_at: checkedAt,
    summary: {
      traces: traces.length,
      events: sortedEvents.length,
      suspected_objects: traces.filter((item) => item.trigger_type === 'l1_suspected_object').length,
      periodic_samples: traces.filter((item) => item.trigger_type === 'periodic_miss_guard' || item.trigger_type === 'l1_monitor_stats').length,
      pending_human_dataset_approval: sortedEvents.filter((item) => item.stage === 'human_dataset_approval' && item.status !== 'done').length,
      mage_audits: sortedEvents.filter((item) => item.stage === 'mage_audit' && item.status === 'done').length,
      training_runs: trainingEvents.length,
      stage_counts: stageCounts,
    },
    human_gate: {
      dataset_requires_approval: true,
      training_requires_approval: true,
      policy: 'Mage-VL 只生成审计意见和标注草稿；进入训练素材、启动训练、模型下发都必须经过人工审核确认。',
    },
    traces: traces
      .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime())
      .slice(0, limit),
    events: sortedEvents,
    services: {
      forge: { reachable: forge.reachable, status: forge.status, base_url: forge.base_url },
      devices: {
        l1: devices.filter((item) => item.role === 'l1' || String(item.device_type || '').includes('rv1126')).length,
        l2: devices.filter((item) => item.role === 'l2' || kkosGatewayTypes.some((type) => String(item.device_type || '').includes(type))).length,
        cameras: cameraRows.length,
      },
    },
  }
}

function cachedCoreLogs(limit = 120) {
  const boundedLimit = Math.min(Math.max(Number(limit) || 80, 20), 120)
  return cachedEdge(`cloud:core-logs:${boundedLimit}`, 30 * 1000, () => buildCoreLogs(boundedLimit), {
    checked_at: businessNow(),
    summary: { traces: 0, events: 0, suspected_objects: 0, periodic_samples: 0, pending_human_dataset_approval: 0, mage_audits: 0, training_runs: 0, stage_counts: {} },
    human_gate: { dataset_requires_approval: true, training_requires_approval: true, policy: '进入训练素材、启动训练、模型下发必须人工确认。' },
    traces: [],
    events: [],
    services: {},
  })
}

function safeEventId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '')
}

function mergeDefined(base, override = {}) {
  const next = { ...base }
  for (const [key, value] of Object.entries(override || {})) {
    if (value !== undefined && value !== null && value !== '') next[key] = value
  }
  return next
}

function applySensitivity(config, sensitivity) {
  const next = { ...config }
  if (sensitivity === 'conservative') {
    next.l1_threshold = Math.min(1, Number(next.l1_threshold) + 0.05)
    next.default_sample_fps = Math.max(Number(next.min_sample_fps), Number(next.default_sample_fps) * 0.8)
  }
  if (sensitivity === 'sensitive') {
    next.l1_threshold = Math.max(0, Number(next.l1_threshold) - 0.05)
    next.default_sample_fps = Math.min(Number(next.max_sample_fps), Number(next.default_sample_fps) * 1.2)
  }
  return next
}

function syncCameraDeviceAssignment(binding) {
  const camera = cameras.find((item) => item.camera_id === binding.camera_id)
  if (!camera) return
  camera.assigned_l1_device_id = binding.assigned_l1_device_id || camera.assigned_l1_device_id
  camera.assigned_l2_device_id = binding.assigned_l2_device_id || camera.assigned_l2_device_id
  camera.pipeline_enabled = binding.enabled !== false
  camera.pipeline_status = binding.enabled !== false ? 'configured' : 'stopped'
  camera.updated_at = businessNow()
}

function resolveRuntimeConfig(input) {
  const binding = input.binding || cameraScenarioBindings.find((item) => item.customer_id === input.customer_id && item.camera_id === input.camera_id && item.scenario === input.scenario)
  if (!binding) throw new Error('camera scenario binding not found')
  const camera = cameras.find((item) => item.camera_id === binding.camera_id)
  if (!camera) throw new Error('camera not found')
  const template = globalScenarioTemplates.find((item) => item.scenario === binding.scenario)
  if (!template) throw new Error('global scenario template not found')
  const policy = customerScenarioPolicies.find((item) => item.policy_id === binding.policy_id && item.enabled !== false)
  let merged = mergeDefined({
    target_classes: template.target_classes,
    default_sample_fps: template.default_sample_fps,
    min_sample_fps: template.min_sample_fps,
    max_sample_fps: template.max_sample_fps,
    l1_threshold: template.l1_threshold,
    l2_threshold: template.l2_threshold,
    consecutive_frames: template.consecutive_frames,
    min_duration_sec: template.min_duration_sec,
    cooldown_sec: template.cooldown_sec,
    priority: template.priority,
    capacity_base_cost: template.capacity_base_cost,
    candidate_rate_per_min: template.candidate_rate_per_min,
    lifecycle_stage: template.lifecycle_stage,
    cold_start_enabled: template.cold_start_enabled,
    initial_l1_mode: template.initial_l1_mode,
    l2_local_mode: template.l2_local_mode,
    remote_enhancement_mode: template.remote_enhancement_mode,
    teacher_model: template.teacher_model,
    teacher_policy: template.teacher_policy,
    seed_dataset_target: template.seed_dataset_target,
    sampling_strategy: template.sampling_strategy,
    edge_pipeline: template.edge_pipeline,
    reporting_policy: template.reporting_policy,
    future_target_classes: template.future_target_classes,
    training_label_schema: template.training_label_schema,
    vlm_audit_prompt: template.vlm_audit_prompt,
    reset_after_absence_sec: template.reset_after_absence_sec,
    baseline_change_gating: template.baseline_change_gating,
    baseline_stable_sec: template.baseline_stable_sec,
    baseline_max_silence_sec: template.baseline_max_silence_sec,
    motion_burst_sec: template.motion_burst_sec,
  }, policy?.overrides)
  merged = mergeDefined(merged, binding.overrides)
  merged = applySensitivity(merged, binding.sensitivity)
  merged.default_sample_fps = Math.max(Number(merged.min_sample_fps), Math.min(Number(merged.max_sample_fps), Number(merged.default_sample_fps)))
  // Safety scan is an L1 scan, not a direct L2 guard.  Keep a lower bound so
  // one configuration typo cannot turn a shared gateway into a frame sink.
  merged.audit_interval_sec = Math.min(86400, Math.max(5, Math.round(Number(merged.audit_interval_sec || merged.sampling_strategy?.time_interval_sec || 30))))
  if (template.roi_required && (!binding.roi || !Array.isArray(binding.roi.points) || binding.roi.points.length < 3)) {
    throw new Error('ROI is required for this scenario')
  }
  const factor = resolutionFactors[camera.resolution] || 1
  const capacityCost = Number((Number(merged.capacity_base_cost) * Number(merged.default_sample_fps) / Math.max(Number(template.default_sample_fps), 0.1) * factor).toFixed(2))
  return {
    runtime_config_id: `rt-${binding.binding_id}`,
    customer_id: binding.customer_id,
    site_id: binding.site_id,
    camera_id: binding.camera_id,
    camera_name: camera.camera_name,
    binding_id: binding.binding_id,
    scenario: binding.scenario,
    display_name: template.display_name,
    version: binding.runtime_config_version || 1,
    target_classes: merged.target_classes,
    sample_fps: Number(Number(merged.default_sample_fps).toFixed(2)),
    audit_interval_sec: Number(merged.audit_interval_sec),
    l1_threshold: Number(merged.l1_threshold),
    l2_threshold: Number(merged.l2_threshold),
    consecutive_frames: Number(merged.consecutive_frames),
    min_duration_sec: Number(merged.min_duration_sec),
    cooldown_sec: Number(merged.cooldown_sec),
    priority: merged.priority,
    lifecycle_stage: merged.lifecycle_stage,
    cold_start_enabled: Boolean(merged.cold_start_enabled),
    initial_l1_mode: merged.initial_l1_mode || 'model_inference',
    l2_local_mode: merged.l2_local_mode || 'local_yolo_review',
    remote_enhancement_mode: merged.remote_enhancement_mode || 'off_by_default',
    teacher_model: merged.teacher_model || '',
    teacher_policy: merged.teacher_policy || '',
    seed_dataset_target: merged.seed_dataset_target || {},
    sampling_strategy: merged.sampling_strategy || {},
    edge_pipeline: merged.edge_pipeline || {},
    reporting_policy: merged.reporting_policy || {},
    future_target_classes: merged.future_target_classes || [],
    training_label_schema: merged.training_label_schema || {},
    vlm_audit_prompt: merged.vlm_audit_prompt || '',
    reset_after_absence_sec: Number(merged.reset_after_absence_sec || 0),
    baseline_change_gating: merged.baseline_change_gating !== false,
    baseline_stable_sec: Math.max(1, Number(merged.baseline_stable_sec || 3)),
    baseline_max_silence_sec: Math.max(5, Number(merged.baseline_max_silence_sec || merged.audit_interval_sec || 30)),
    motion_burst_sec: Math.max(1, Number(merged.motion_burst_sec || 6)),
    roi: binding.roi,
    assigned_l1_device_id: binding.assigned_l1_device_id || camera.assigned_l1_device_id,
    assigned_l2_device_id: binding.assigned_l2_device_id || camera.assigned_l2_device_id,
    capacity_cost: capacityCost,
    candidate_rate_per_min: Number(merged.candidate_rate_per_min),
    generated_from: {
      global_template_version: template.template_version,
      customer_policy_id: policy?.policy_id || '',
      binding_id: binding.binding_id,
    },
    compare: {
      global_template: template,
      customer_policy_overrides: policy?.overrides || {},
      binding_overrides: binding.overrides || {},
      sensitivity: binding.sensitivity,
    },
    status: 'active',
    created_at: businessNow(),
    updated_at: businessNow(),
  }
}

function runtimeConfigs() {
  return cameraScenarioBindings.filter((item) => item.enabled !== false).map((binding) => resolveRuntimeConfig({ binding }))
}

function gatewayForBinding(binding = {}) {
  const byAssigned = managedDevices.find((item) => item.device_id === binding.assigned_l2_device_id)
  if (byAssigned) return byAssigned
  return managedDevices.find((item) => (
    item.site_id === binding.site_id
    && (kkosGatewayTypes.some((type) => String(item.device_type || '').includes(type)) || ['l2', 'mixed', 'gateway', 'kkos'].includes(item.role))
  ))
}

function kkosRuntimePayload(binding, action = 'wake') {
  const runtime = resolveRuntimeConfig({ binding })
  const camera = cameras.find((item) => item.camera_id === binding.camera_id) || {}
  const l1 = managedDevices.find((item) => item.device_id === runtime.assigned_l1_device_id) || {}
  const l2 = gatewayForBinding(binding) || {}
  const enabled = !['stop', 'sleep', 'disable'].includes(action)
  return {
    action,
    camera_action: enabled ? 'wake' : 'sleep',
    enabled,
    customer_id: binding.customer_id,
    site_id: binding.site_id,
    binding_id: binding.binding_id,
    camera: {
      camera_id: camera.camera_id,
      camera_name: camera.camera_name,
      rtsp_url: camera.rtsp_url,
      resolution: camera.resolution,
      location: camera.location || '',
    },
    l1_device: {
      device_id: l1.device_id || runtime.assigned_l1_device_id || '',
      device_name: l1.device_name || '',
      ip: l1.ip || '',
      device_type: l1.device_type || '',
    },
    l2_device: {
      device_id: l2.device_id || runtime.assigned_l2_device_id || '',
      device_name: l2.device_name || '',
      ip: l2.ip || '',
      tailscale_ip: l2.tailscale_ip || '',
    },
    runtime_config: { ...runtime, enabled, status: enabled ? 'camera_awake' : 'camera_sleeping' },
    rv1126_config: renderRv1126Config(),
    updated_at: businessNow(),
  }
}

function postRuntimeToKkos(gateway = {}, payload = {}) {
  const tailscaleIp = gateway.tailscale_ip || gateway.tailscaleIp || ''
  if (!tailscaleIp) return { ok: false, status: 0, endpoint: '', error: 'kkos_gateway_missing_tailscale_ip', message: '项目没有可用的 KKOS Tailscale IP' }
  const endpoints = [
    `http://${tailscaleIp}:9200/runtime/camera-bindings/apply`,
    `http://${tailscaleIp}:9200/api/runtime/camera-bindings/apply`,
    `http://${tailscaleIp}:9200/runtime/apply`,
    `http://${tailscaleIp}:9200/api/runtime/apply`,
  ]
  for (const endpoint of endpoints) {
    const result = postJsonWithStatus(endpoint, payload, 8)
    if (result.ok) return { ...result, endpoint }
    if (result.status && result.body) {
      return {
        ...result,
        endpoint,
        message: result.body?.message || result.body?.detail || result.body?.runtime?.message || 'KKOS runtime 下发失败',
      }
    }
  }
  return { ok: false, status: 0, endpoint: endpoints[0], error: 'kkos_runtime_apply_failed', message: 'KKOS 未响应 runtime 下发接口，请检查 KKOS 控制 API 是否已升级' }
}

// A HTTP 2xx from KKOS only proves that the site controller accepted the
// desired configuration.  It does not prove that the RV1126/L2 process has
// consumed the version.  Keep those states separate everywhere in cloud UI.
function kkosDeviceApplied(result = {}) {
  const body = result.body || {}
  return body.applied === true || body.binding?.apply?.state === 'applied'
}

function kkosApplyStatus(result = {}, enabled = true) {
  if (!result.ok) return 'pending_kkos'
  return kkosDeviceApplied(result) ? (enabled ? 'camera_awake' : 'camera_sleeping') : 'pending_device_apply'
}

function kkosApplyMessage(result = {}) {
  if (!result.ok) return result.message || result.error || 'KKOS runtime 参数下发失败'
  if (!kkosDeviceApplied(result)) return 'KKOS 已接收配置，等待 L1/L2 回报实际生效版本'
  return ''
}

function setBindingRuntimeState(binding, action = 'wake') {
  const enabled = !['stop', 'sleep', 'disable'].includes(action)
  const nowValue = businessNow()
  binding.enabled = enabled
  binding.runtime_control = {
    status: enabled ? 'waking' : 'sleeping_pending',
    desired_state: enabled ? 'camera_awake' : 'camera_sleeping',
    requested_at: nowValue,
    last_error: '',
  }
  syncCameraDeviceAssignment(binding)
  const localDeploy = applyBindingToAlgorithm(binding)
  const gateway = gatewayForBinding(binding)
  const payload = kkosRuntimePayload(binding, action)
  const kkosDeploy = postRuntimeToKkos(gateway, payload)
  const applied = kkosDeviceApplied(kkosDeploy)
  binding.runtime_control = {
    status: kkosApplyStatus(kkosDeploy, enabled),
    desired_state: enabled ? 'camera_awake' : 'camera_sleeping',
    requested_at: nowValue,
    accepted_at: kkosDeploy.ok ? businessNow() : '',
    applied_at: applied ? businessNow() : '',
    gateway_id: gateway?.device_id || '',
    gateway_name: gateway?.device_name || '',
    endpoint: kkosDeploy.endpoint || '',
    last_error: kkosApplyMessage(kkosDeploy),
  }
  return {
    ok: kkosDeploy.ok,
    accepted: kkosDeploy.ok,
    applied,
    action,
    binding,
    runtime_config: resolveRuntimeConfig({ binding }),
    local_deploy: localDeploy,
    kkos_deploy: kkosDeploy,
  }
}

function customerSummaries() {
  return customers.map((customer) => {
    const customerSites = sites.filter((site) => site.customer_id === customer.customer_id)
    const customerCameras = cameras.filter((camera) => camera.customer_id === customer.customer_id)
    const customerDevices = managedDevices.filter((device) => device.customer_id === customer.customer_id)
    return { ...customer, data_policy: dataPolicyForCustomer(customer.customer_id), site_count: customerSites.length, camera_count: customerCameras.length, device_count: customerDevices.length, alarm_count: 0 }
  })
}

function siteSummaries() {
  const configs = runtimeConfigs()
  return sites.map((site) => {
    const siteCameras = cameras.filter((camera) => camera.site_id === site.site_id)
    const siteDevices = managedDevices.filter((device) => device.site_id === site.site_id)
    return {
      ...site,
      camera_count: siteCameras.length,
      online_camera_count: siteCameras.filter((camera) => camera.status === 'online').length,
      rv1126_count: siteDevices.filter((device) => device.device_type === 'rv1126').length,
      rk3568_count: siteDevices.filter((device) => device.device_type === 'rk3568').length,
      binding_count: cameraScenarioBindings.filter((binding) => binding.site_id === site.site_id).length,
      alarm_today: 0,
      capacity_load: Number(configs.filter((cfg) => cfg.site_id === site.site_id).reduce((sum, cfg) => sum + cfg.capacity_cost, 0).toFixed(2)),
      recent_offline_devices: siteDevices.filter((device) => device.status !== 'online').map((device) => device.device_name),
    }
  })
}

function realDevices() {
  const rv = edgeSsh(rvHost, "cat /proc/meminfo | grep -E 'MemTotal|MemAvailable|CmaTotal|CmaFree'; uptime; echo gateway_status=$(systemctl is-active tokai-rv1126-gateway 2>/dev/null || systemctl is-active guardian-rv1126-gateway 2>/dev/null || true)", '')
  const rk = edgeSsh(rkHost, "cat /proc/meminfo | grep -E 'MemTotal|MemAvailable'; uptime; ss -lntp 2>/dev/null | grep ':9100' >/dev/null && echo brain_status=active || echo brain_status=inactive", '')
  const memPercent = (text) => {
    const total = Number(text.match(/MemTotal:\s+(\d+)/)?.[1] || 0)
    const avail = Number(text.match(/MemAvailable:\s+(\d+)/)?.[1] || 0)
    return total ? Math.round((1 - avail / total) * 100) : 0
  }
  const cma = rv.match(/CmaTotal:\s+(\d+)/)?.[1]
  const rvGatewayStatus = rv.match(/gateway_status=([^\s]+)/)?.[1] || 'unknown'
  const rkBrainStatus = rk.match(/brain_status=([^\s]+)/)?.[1] || 'unknown'
  return [
    {
      device_id: 'rv1126_01',
      device_type: 'rv1126',
      ip: '192.168.4.44',
      online_status: rv.includes('MemTotal') ? 'online' : 'offline',
      gateway_status: rvGatewayStatus,
      current_model: 'rv1126_l1_yolov8n_416_int8',
      cpu: 0,
      npu: rvGatewayStatus === 'active' || rvGatewayStatus === 'activating' ? 'infer_ready' : 'idle',
      memory: memPercent(rv),
      cma: cma ? `${Math.round(Number(cma) / 1024)}M` : '-',
      temperature: '-',
      last_heartbeat: new Date().toISOString(),
    },
    {
      device_id: 'rk3568_01',
      device_type: 'rk3568',
      ip: '192.168.4.43',
      online_status: rk.includes('MemTotal') ? 'online' : 'offline',
      gateway_status: rkBrainStatus,
      current_model: 'rk3568_l2_yolov8n_640_fp16',
      cpu: 0,
      npu: rkBrainStatus === 'active' ? 'ready' : 'idle',
      memory: memPercent(rk),
      cma: '-',
      temperature: '-',
      last_heartbeat: new Date().toISOString(),
    },
  ]
}

const streams = channels.map(([channel_id, name, rtsp_url, algorithm, snapshot_url, resolution, duration_sec], i) => ({
  channel_id, name, rtsp_url, algorithm, source_type: 'simulated_rtsp', device: 'RV1126',
  online_status: 'online', last_frame_time: iso(i + 1),
  stream_fps: [29, 30, 30][i], sample_fps: [2, 1, 3][i], latency_ms: 80 + i * 35,
  reconnect_count: i, roi: [32, 40, 560, 360], latest_bbox: [120 + i * 20, 90, 180, 220],
  latest_candidate: `evt-${1000 + i}`, snapshot_url, resolution, duration_sec,
}))

function cameraStreams(url = new URL('http://127.0.0.1')) {
  const customerId = url.searchParams.get('customer_id') || ''
  const siteId = url.searchParams.get('site_id') || ''
  const deviceRows = managedDeviceSummaries()
  const deviceMap = new Map(deviceRows.map((item) => [item.device_id, item]))
  const stats = parseStats(cachedGatewayStatsLog())
  const candidates = cachedCandidates()
  return cameras
    .map(cameraSummary)
    .filter((camera) => (!customerId || camera.customer_id === customerId) && (!siteId || camera.site_id === siteId))
    .map((camera, index) => {
      const binding = cameraScenarioBindings.find((item) => item.camera_id === camera.camera_id && item.enabled !== false)
      const channelStat = stats.find((item) => item.channel_id === String(index) || item.channel_name === camera.camera_name)
      const latestCandidate = candidates.find((item) => item.camera_id === camera.camera_id || item.algorithm === binding?.scenario)
      const l1 = deviceMap.get(binding?.assigned_l1_device_id || camera.assigned_l1_device_id || '')
      const l2 = deviceMap.get(binding?.assigned_l2_device_id || camera.assigned_l2_device_id || '')
      const urls = kkosCameraRuntimeUrls(camera)
      return {
        channel_id: camera.camera_id,
        camera_id: camera.camera_id,
        name: camera.camera_name,
        location: camera.location || '',
        rtsp_url: camera.rtsp_url,
        source_type: camera.source_type || camera.camera_source || '-',
        resolution: camera.resolution || 'unknown',
        online_status: camera.online_status || camera.status || 'unknown',
        status: camera.status || camera.online_status || 'unknown',
        status_source: camera.status_source || '',
        collect_error: camera.collect_error || '',
        last_status_at: camera.last_status_at || camera.updated_at || '',
        algorithm: binding ? (scenarioNames[binding.scenario] || binding.scenario) : '未绑定算法',
        scenario: binding?.scenario || '',
        binding_id: binding?.binding_id || '',
        pipeline_enabled: binding ? binding.enabled !== false : false,
        pipeline_status: camera.pipeline_status || (binding ? 'configured' : 'unbound'),
        l1_device: l1?.device_name || l1?.ip || '-',
        l1_status: l1?.online_status || l1?.status || '-',
        l2_device: l2?.device_name || l2?.ip || '-',
        l2_status: l2?.online_status || l2?.status || '-',
        stream_fps: Number(channelStat?.stream_fps || 0),
        sample_fps: Number(channelStat?.sample_fps || binding?.runtime_config?.sample_fps || 0),
        latency_ms: Number(channelStat?.loop_ms || 0),
        reconnect_count: Number(channelStat?.reconnects || 0),
        frames: Number(channelStat?.frames || 0),
        effective_inferences: Number(channelStat?.effective_inferences || 0),
        latest_candidate: latestCandidate?.event_id || '',
        latest_candidate_class: latestCandidate?.class_name || '',
        latest_candidate_confidence: latestCandidate?.confidence || '',
        roi: binding?.roi || null,
        snapshot_url: urls.snapshot_url || '',
        live: {
          mode: 'kkos',
          gateway_id: urls.gateway_id || '',
          gateway_name: urls.gateway_name || '',
          mjpeg_proxy_url: urls.mjpeg_proxy_url || '',
          kkos_mjpeg_url: urls.kkos_mjpeg_url || '',
          kkos_hls_url: urls.kkos_hls_url || '',
          kkos_webrtc_url: urls.kkos_webrtc_url || '',
          status: camera.online_status === 'online' || camera.status === 'online' ? 'ready' : 'offline',
          note: camera.online_status === 'online' || camera.status === 'online' ? '实时播放由 KKOS 转码提供' : (camera.collect_error || '摄像头离线，无法实时播放'),
        },
      }
    })
}

const defaultAlgorithms = channels.map(([channel_id, , rtsp_url, algorithm], i) => ({
  channel_id, algorithm, enabled: true, rtsp_url, config_version: 12 + i,
  l1: {
    device: 'rv1126_01', model: 'rv1126_l1_yolov8n_416_int8', sample_fps: [2, 1, 3][i],
    threshold: [0.30, 0.35, 0.30][i],
    target_classes: {
      ev_intrusion: ['person', 'bicycle', 'motorcycle', 'electric_scooter', 'electric_bike'],
      trash_overflow: ['outdoor_trash_bin_full', 'garbage_bag', 'trash_overflow'],
      fire_lane_occupied: ['car', 'truck', 'van', 'motorcycle'],
      person_intrusion: ['person'],
      bottle_cap_missing: ['bottle'],
    }[algorithm],
    cooldown_sec: [10, 15, 10][i],
  },
  roi: { type: 'polygon', points: [[10, 10], [800, 10], [800, 600], [10, 600]] },
  rules: { consecutive_frames: 3, min_duration_sec: 2, max_event_gap_sec: 10 },
  l2: { enabled: true, device: 'rk3568_01', model: 'rk3568_l2_yolov8n_640_fp16', threshold: 0.45 },
  upload: { save_candidate_frame: true, save_clip: true, clip_before_sec: 3, clip_after_sec: 5 },
}))

const classIdMap = {
  person: 0,
  bicycle: 1,
  car: 2,
  motorcycle: 3,
  bus: 5,
  truck: 7,
  van: 2,
  bottle: 39,
  wine_glass: 40,
  cup: 41,
  electric_scooter: 3,
  electric_bike: 1,
}

const classNamesById = {
  0: ['person'],
  1: ['bicycle'],
  2: ['car'],
  3: ['motorcycle'],
  5: ['bus'],
  7: ['truck'],
  39: ['bottle'],
  40: ['wine_glass'],
  41: ['cup'],
}

let algorithms = loadAlgorithmConfigs(defaultAlgorithms)

function loadAlgorithmConfigs(fallback) {
  if (existsSync(algorithmStatePath)) {
    try {
      const saved = JSON.parse(readFileSync(algorithmStatePath, 'utf8'))
      if (Array.isArray(saved)) return saved.length ? mergeAlgorithmConfigs(fallback, saved) : []
    } catch {
      // Fall through to the RV1126 conf recovery path.
    }
  }
  const recovered = recoverAlgorithmConfigsFromRv1126Conf(fallback)
  return recovered.length ? recovered : fallback
}

function mergeAlgorithmConfigs(base, saved) {
  const merged = base.map((item) => {
    const next = saved.find((cfg) => cfg.channel_id === item.channel_id)
    return next ? { ...item, ...next, l1: { ...item.l1, ...next.l1 }, rules: { ...item.rules, ...next.rules }, l2: { ...item.l2, ...next.l2 }, upload: { ...item.upload, ...next.upload } } : item
  })
  // A camera may temporarily be absent from the discovery snapshot while its
  // persisted algorithm configuration remains valid.  Never erase that
  // configuration merely because the live channel list is empty or delayed.
  const knownChannels = new Set(merged.map((item) => item.channel_id))
  return [...merged, ...saved.filter((item) => !knownChannels.has(item.channel_id))]
}

function saveAlgorithmConfigs() {
  mkdirSync(runtimeDir, { recursive: true })
  writeFileSync(algorithmStatePath, `${JSON.stringify(algorithms, null, 2)}\n`, 'utf8')
}

function recoverAlgorithmConfigsFromRv1126Conf(fallback) {
  if (!existsSync(rv1126RuntimeConfigPath)) return []
  const text = readFileSync(rv1126RuntimeConfigPath, 'utf8')
  const next = fallback.map((item) => JSON.parse(JSON.stringify(item)))
  for (const line of text.split('\n')) {
    if (!line.startsWith('channel=')) continue
    const parts = line.slice('channel='.length).split('|')
    if (parts.length < 7) continue
    const idx = Number(parts[0])
    const cfg = next[idx]
    if (!cfg) continue
    const [algorithm, threshold = cfg.l1.threshold, classIds = '-', consecutive = cfg.rules.consecutive_frames, cooldownMs = cfg.l1.cooldown_sec * 1000] = parts[4].split(':')
    cfg.rtsp_url = parts[2]
    cfg.l1.sample_fps = Number(parts[3]) || cfg.l1.sample_fps
    cfg.algorithm = algorithm || cfg.algorithm
    cfg.l1.threshold = Number(threshold) || cfg.l1.threshold
    cfg.l1.target_classes = classIds === '-' ? [] : [...new Set(classIds.split('+').flatMap((id) => classNamesById[id] || []))]
    cfg.rules.consecutive_frames = Number(consecutive) || cfg.rules.consecutive_frames
    cfg.l1.cooldown_sec = Math.round((Number(cooldownMs) || cfg.l1.cooldown_sec * 1000) / 1000)
    cfg.l2.enabled = parts[5] !== 'L1'
    const [x = 0, y = 0, w = 640, h = 480] = parts[6].split(',').map((value) => Number(value) || 0)
    cfg.roi = { type: 'rectangle', x, y, w, h }
  }
  return next
}

if (!existsSync(algorithmStatePath)) saveAlgorithmConfigs()

function channelIndex(channelId) {
  return Number(String(channelId).replace(/\D/g, '')) - 1
}

function badRequest(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function validateRoi(roi) {
  if (!roi || !Array.isArray(roi.points) || roi.points.length < 3) throw badRequest('ROI 至少需要 3 个点')
  const points = roi.points.map((point) => [Number(point[0]), Number(point[1])])
  if (points.some((point) => point.some((value) => !Number.isFinite(value)))) throw badRequest('ROI 包含无效坐标')
  const normalized = roi.coordinate_space === 'normalized' || points.every((point) => point[0] >= 0 && point[0] <= 1 && point[1] >= 0 && point[1] <= 1)
  if (normalized && points.some((point) => point.some((value) => value < 0 || value > 1))) throw badRequest('归一化 ROI 坐标必须位于 0-1')
  let area = 0
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]
    area += point[0] * next[1] - next[0] * point[1]
  })
  if (Math.abs(area) / 2 < (normalized ? 0.005 : 100)) throw badRequest('ROI 面积过小')
  return { ...roi, type: 'polygon', coordinate_space: normalized ? 'normalized' : 'pixel', points }
}

function roiToSpec(roi) {
  if (!roi) return 'full'
  if (Array.isArray(roi)) return `rect;${roi.slice(0, 4).join(',')}`
  if (roi.type === 'rectangle') {
    const x = roi.x ?? roi.left ?? 0
    const y = roi.y ?? roi.top ?? 0
    const w = roi.w ?? roi.width ?? 640
    const h = roi.h ?? roi.height ?? 480
    return `rect;${[x, y, w, h].map((v) => Math.round(Number(v) || 0)).join(',')}`
  }
  if (Array.isArray(roi.points) && roi.points.length) {
    const checked = validateRoi(roi)
    const kind = checked.coordinate_space === 'normalized' ? 'polygon_norm' : 'polygon'
    const mode = checked.hit_test?.mode || 'bbox_intersection_ratio'
    const ratio = Number(checked.hit_test?.min_ratio || 0.3)
    return `${kind};${mode};${ratio};${checked.points.map((point) => point.map((value) => Number(value).toFixed(4)).join(',')).join('+')}`
  }
  return 'full'
}

function targetClassesToIds(targetClasses = []) {
  const ids = [...new Set(targetClasses.map((name) => classIdMap[name]).filter((id) => Number.isFinite(id)))]
  if (ids.length) return ids.join('+')
  return targetClasses.length ? 'none' : '-'
}

function renderRv1126Config() {
  const lines = [
    'sn=sentinel-rv1126-001',
    'brain_url=http://192.168.4.43:9100',
    'model_path=/opt/tokai/models/rv1126_l1_yolov8n_416_int8.rknn',
    `config_version=${Math.floor(Date.now() / 1000)}`,
    'cooldown_ms=300000',
    'jpeg_quality=82',
    'candidate_dir=/opt/guardian/candidates/pending',
    'save_candidates=1',
    'post_enabled=1',
    'runtime_mode=production_enforced',
    'allow_heuristic=0',
    '',
  ]
  for (const cfg of algorithms.filter((item) => item.enabled !== false)) {
    const idx = channelIndex(cfg.channel_id)
    const channel = channels[idx] || []
    const name = channel[1] || cfg.channel_id
    const level = cfg.l2?.enabled === false ? 'L1' : 'L2'
    const threshold = Number(cfg.l1?.threshold ?? 0.3).toFixed(2)
    const sampleFps = Number(cfg.l1?.sample_fps ?? 1)
    const consecutive = Number(cfg.rules?.consecutive_frames ?? 1)
    const cooldownMs = Math.round(Number(cfg.l1?.cooldown_sec ?? 3) * 1000)
    const auditIntervalSec = Math.max(60, Math.round(Number(cfg.l1?.audit_interval_sec || 0)))
    const isDeskDrink = cfg.algorithm === 'desk_drink_intrusion'
    const idleInferenceSec = Math.max(0, Math.round(Number(cfg.l1?.idle_inference_sec ?? (isDeskDrink ? 30 : 0))))
    const motionBurstSec = Math.max(1, Math.round(Number(cfg.l1?.motion_burst_sec ?? (isDeskDrink ? 2 : 2))))
    const motionMinPixels = Math.max(1, Math.round(Number(cfg.l1?.motion_min_pixels ?? (isDeskDrink ? 12 : 12))))
    const taskSpec = `${cfg.algorithm}:${threshold}:${targetClassesToIds(cfg.l1?.target_classes)}:${consecutive}:${cooldownMs}${auditIntervalSec ? `:${auditIntervalSec}` : ''}:${idleInferenceSec}:${motionBurstSec}:${motionMinPixels}`
    lines.push(`channel=${idx}|${name}|${cfg.rtsp_url}|${sampleFps}|${taskSpec}|${level}|${roiToSpec(cfg.roi)}`)
  }
  return `${lines.join('\n')}\n`
}

function applyBindingToAlgorithm(binding) {
  const camera = cameras.find((item) => item.camera_id === binding.camera_id)
  const cameraIndex = cameras.findIndex((item) => item.camera_id === binding.camera_id)
  const numericIndex = Number(String(camera?.camera_id || '').replace(/\D/g, '')) - 1
  const index = Math.max(0, Number.isFinite(numericIndex) && numericIndex >= 0 ? numericIndex : cameraIndex)
  const channelId = `ch${String(index + 1).padStart(2, '0')}`
  const runtime = resolveRuntimeConfig({ binding })
  const algorithm = binding.scenario === 'fire_lane' ? 'fire_lane_occupied' : binding.scenario
  const existing = algorithms.find((item) => item.channel_id === channelId)
  const base = existing || {
    channel_id: channelId,
    algorithm,
    enabled: true,
    rtsp_url: camera?.rtsp_url || '',
    config_version: 0,
    l1: {},
    rules: {},
    l2: {},
    upload: { save_candidate_frame: true, save_clip: true, clip_before_sec: 3, clip_after_sec: 5 },
  }
  const next = {
    ...base,
    algorithm,
    enabled: binding.enabled !== false,
    rtsp_url: camera?.rtsp_url || base.rtsp_url,
    config_version: Number(base.config_version || 0) + 1,
    l1: { ...base.l1, sample_fps: runtime.sample_fps, threshold: runtime.l1_threshold, target_classes: runtime.target_classes, cooldown_sec: runtime.cooldown_sec, audit_interval_sec: runtime.audit_interval_sec },
    roi: validateRoi(binding.roi),
    rules: { ...base.rules, consecutive_frames: runtime.consecutive_frames, min_duration_sec: runtime.min_duration_sec, max_event_gap_sec: Number(binding.overrides?.max_event_gap_sec || base.rules?.max_event_gap_sec || 10) },
    l2: { ...base.l2, threshold: runtime.l2_threshold },
  }
  algorithms = existing ? algorithms.map((item) => item.channel_id === channelId ? next : item) : [...algorithms, next]
  saveAlgorithmConfigs()
  return deployRv1126Config(renderRv1126Config())
}

// Binding edits are configuration changes, not merely database edits.  Send
// the resolved version to KKOS as well, so an interval adjustment reaches the
// active edge pipeline without requiring the operator to toggle the camera.
function syncBindingRuntimeConfig(binding) {
  if (binding.enabled === false) return { ok: true, skipped: true, message: '绑定已停用，未下发运行参数' }
  const result = postRuntimeToKkos(gatewayForBinding(binding), kkosRuntimePayload(binding, 'update'))
  const applied = kkosDeviceApplied(result)
  binding.runtime_control = {
    ...(binding.runtime_control || {}),
    status: result.ok ? (applied ? 'camera_awake' : 'pending_device_apply') : (binding.runtime_control?.status || 'pending_kkos'),
    config_accepted_at: result.ok ? businessNow() : binding.runtime_control?.config_accepted_at,
    config_synced_at: applied ? businessNow() : binding.runtime_control?.config_synced_at,
    config_sync_error: kkosApplyMessage(result),
  }
  return { ...result, accepted: result.ok, applied }
}

function deployRv1126Config(configText) {
  const localPath = rv1126RuntimeConfigPath
  mkdirSync(dirname(localPath), { recursive: true })
  writeFileSync(localPath, configText, 'utf8')
  if (!edgeDirectSshEnabled) {
    return {
      local_path: localPath,
      remote_path: '/opt/guardian/rv1126/config/rv1126.conf',
      written: true,
      service_status: 'managed_by_kkos',
      apply_mode: 'kkos_runtime_apply',
      note: '云端不直连 RV1126；配置由 KKOS 接收后再下发到 L1。',
    }
  }
  const remoteWrite = ssh(
    rvHost,
    `mkdir -p /opt/guardian/rv1126/config && cat > /opt/guardian/rv1126/config/rv1126.conf <<'GUARDIAN_CONF'\n${configText}GUARDIAN_CONF\nwc -c /opt/guardian/rv1126/config/rv1126.conf`,
    '',
  )
  const status = ssh(rvHost, 'systemctl is-active guardian-rv1126-gateway || true', 'unknown').trim()
  return {
    local_path: localPath,
    remote_path: '/opt/guardian/rv1126/config/rv1126.conf',
    written: /\d+\s+\/opt\/guardian\/rv1126\/config\/rv1126\.conf/.test(remoteWrite),
    service_status: status,
    apply_mode: remoteWrite ? 'next_video_parse_start' : 'pending_edge_pull',
  }
}

function startThreeVideoPass() {
  ssh(rvHost, 'systemctl stop guardian-rv1126-gateway 2>/dev/null || true; systemctl kill guardian-rv1126-gateway 2>/dev/null || true; systemctl reset-failed guardian-rv1126-gateway 2>/dev/null || true', '')
  sh("pkill -f 'ffmpeg .*rtsp://127.0.0.1:8554/test' || true")
  const videoJobs = [
    ['test1.mp4', 'test1'],
    ['test2.mp4', 'test2'],
    ['test3.mp4', 'test3'],
  ]
  const started = []
  for (const [file, path] of videoJobs) {
    const input = resolve(repoRoot, file)
    const args = [
      '-hide_banner',
      '-loglevel', 'warning',
      '-re',
      '-stream_loop', '-1',
      '-i', input,
      '-t', '60',
      '-an',
      '-vf', 'scale=640:-2',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-f', 'rtsp',
      '-rtsp_transport', 'tcp',
      `rtsp://127.0.0.1:8554/${path}`,
    ]
    const child = spawn('ffmpeg', args, {
      cwd: repoRoot,
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    started.push({ file, rtsp_url: `rtsp://192.168.4.41:8554/${path}`, pid: child.pid })
  }
  run('/bin/sleep', ['1.2'], '')
  ssh(
    rvHost,
    'systemctl start guardian-rv1126-gateway; sleep 1; systemctl is-active guardian-rv1126-gateway || true',
    '',
  )
  lastPlayback = { status: 'running_finite', started_at: new Date().toISOString(), mode: 'finite_replay_60s', streams: started }
  return lastPlayback
}

const learning = {
  stats: { today_samples: 0, confirmed_positive: 0, confirmed_hard_negative: 0, boundary: 0, auto_label_high_confidence: 0, auto_label_need_review: 0, rejected: 0 },
  pipeline: ['样本回流', '自动标注', '人工审核', '数据集构建', 'YOLO 训练', '模型评估', 'RKNN 转换', '设备回放测试', '灰度发布', '上线监控'].map((stage, i) => ({
    stage, status: i === 0 ? 'waiting' : 'blocked', input_count: 0,
    output_count: 0, success_count: 0, failed_count: 0,
    last_run_time: null, artifact_path: '',
    next_action: ['等待真实 candidate 样本', '等待样本', '等待审核样本', '等待数据集', '等待训练任务', '等待模型', '等待 ONNX/RKNN', '等待回放集', '等待候选模型', '等待真实告警'][i],
  })),
}

const trainingRuns = []
const reviewItems = []
const models = [
  {
    model_id: 'model-rv1126b-l1-official',
    model_type: 'l1',
    version: 'rv1126b_l1_yolov8n_416_fp16',
    target_device: 'rv1126b',
    dataset_version: 'pretrained_yolov8n',
    train_run_id: '',
    status: 'active',
    official: true,
    quantization: '未量化（FP16）',
    artifact_url: '/guardian/models/rv1126b_l1_yolov8n_416_fp16.rknn',
    artifact_sha256: 'c8cc745ec4e81ccfc8ae2952df0421d246fcfab96d9a0b8bb54ff17fccc4fb3b',
    mAP50: null,
    recall: null,
    precision: null,
    hard_negative_fp: null,
    latency_ms: null,
    created_at: '2026-08-07T00:11:20+08:00',
    updated_at: '2026-08-07T00:11:20+08:00',
  },
  {
    model_id: 'model-rk3568-l2-official',
    model_type: 'l2',
    version: 'rk3568_l2_yolov8n_640_fp16',
    target_device: 'rk3568',
    dataset_version: 'pretrained_yolov8n',
    train_run_id: '',
    status: 'active',
    official: true,
    quantization: '未量化（FP16）',
    artifact_url: '/guardian/models/rk3568_l2_yolov8n_640_fp16.rknn',
    artifact_sha256: '719ead9ec403d3994bd0bc9888d967d576733bc1d8129dbb9f822bca7e437efa',
    mAP50: null,
    recall: null,
    precision: null,
    hard_negative_fp: null,
    latency_ms: null,
    created_at: '2026-08-06T22:17:00+08:00',
    updated_at: '2026-08-06T22:17:00+08:00',
  },
]

const capacityProfile = {
  devices: {
    rv1126: { max_capacity_score: 100, warning_threshold: 80, critical_threshold: 95, unit_cost: 300, monthly_power_cost: 10 },
    rk3568: { warning_threshold: 45, critical_threshold: 55, unit_cost: 560, monthly_power_cost: 18 },
  },
  algorithms: {
    ev_intrusion: { priority: 'critical', base_cost: 25, default_sample_fps: 4, min_sample_fps: 3, max_sample_fps: 5, candidate_rate_per_min: 0.5 },
    person_intrusion: { priority: 'high', base_cost: 20, default_sample_fps: 3, min_sample_fps: 2, max_sample_fps: 4, candidate_rate_per_min: 0.8 },
    fire_lane: { priority: 'medium', base_cost: 12, default_sample_fps: 1, min_sample_fps: 0.5, max_sample_fps: 2, candidate_rate_per_min: 0.3 },
    trash_overflow: { priority: 'low', base_cost: 8, default_sample_fps: 0.5, min_sample_fps: 1 / 3600, max_sample_fps: 1, candidate_rate_per_min: 0.1 },
  },
  resolution_factor: { '720p': 0.8, '1080p': 1.0, '2k': 1.5, '4k': 2.5 },
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => resolve(body ? JSON.parse(body) : {}))
  })
}

function normalizeReceiver(receiver = {}) {
  return {
    id: receiver.id || `receiver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: receiver.name || '',
    role: receiver.role || '值班人员',
    phone: receiver.phone || '',
    dingtalk_user_id: receiver.dingtalk_user_id || '',
    scenes: receiver.scenes || '全部告警',
    enabled: receiver.enabled !== false,
  }
}

function defaultNotificationSettings(siteId = '', customerId = '') {
  return {
    site_id: siteId,
    customer_id: customerId,
    in_app: { enabled: true },
    dingtalk: {
      enabled: false,
      mode: 'custom_robot',
      robot_name: '',
      webhook_url: '',
      webhook_secret: '',
      app_key: '',
      app_secret: '',
      agent_id: '',
      robot_code: '',
      open_conversation_id: '',
      callback_url: 'https://guardian.qivoria.com/guardian/api/integrations/dingtalk/callback',
      card_callback_route_key: 'guardian_alarm_action',
      notify_on_alarm: true,
      notify_on_event_dispatch: true,
      require_human_action: true,
    },
    sms: { enabled: false },
    wechat: { enabled: false, phase: '二期' },
    receivers: [],
    updated_at: '',
  }
}

function mergeNotificationSettings(siteId, body = {}, previous = null) {
  const site = sites.find((item) => item.site_id === siteId) || {}
  const base = previous || defaultNotificationSettings(siteId, site.customer_id || body.customer_id || '')
  const nextDingtalk = { ...base.dingtalk, ...(body.dingtalk || {}) }
  if (!Object.prototype.hasOwnProperty.call(body.dingtalk || {}, 'webhook_secret')) nextDingtalk.webhook_secret = base.dingtalk?.webhook_secret || ''
  if (!Object.prototype.hasOwnProperty.call(body.dingtalk || {}, 'app_secret')) nextDingtalk.app_secret = base.dingtalk?.app_secret || ''
  if (body.dingtalk?.webhook_secret === '') nextDingtalk.webhook_secret = base.dingtalk?.webhook_secret || ''
  if (body.dingtalk?.app_secret === '') nextDingtalk.app_secret = base.dingtalk?.app_secret || ''
  return {
    ...base,
    ...body,
    site_id: siteId,
    customer_id: body.customer_id || base.customer_id || site.customer_id || '',
    in_app: { ...base.in_app, ...(body.in_app || {}) },
    dingtalk: nextDingtalk,
    sms: { ...base.sms, ...(body.sms || {}) },
    wechat: { ...base.wechat, ...(body.wechat || {}) },
    receivers: Array.isArray(body.receivers) ? body.receivers.map(normalizeReceiver) : (base.receivers || []),
    updated_at: businessNow(),
  }
}

function publicNotificationSettings(settings) {
  const dingtalk = settings.dingtalk || {}
  return {
    ...settings,
    dingtalk: {
      ...dingtalk,
      webhook_secret: '',
      app_secret: '',
      has_webhook_secret: Boolean(dingtalk.webhook_secret),
      has_app_secret: Boolean(dingtalk.app_secret),
      configured: Boolean(dingtalk.webhook_url || (dingtalk.app_key && dingtalk.app_secret && dingtalk.robot_code)),
    },
  }
}

function notificationSettingsForSite(siteId) {
  const site = sites.find((item) => item.site_id === siteId) || {}
  return projectNotificationSettings.find((item) => item.site_id === siteId) || defaultNotificationSettings(siteId, site.customer_id || '')
}

function dingtalkSignedWebhookUrl(webhookUrl, secret) {
  if (!secret) return webhookUrl
  const timestamp = Date.now()
  const signText = `${timestamp}\n${secret}`
  const sign = createHmac('sha256', secret).update(signText).digest('base64')
  const url = new URL(webhookUrl)
  url.searchParams.set('timestamp', String(timestamp))
  url.searchParams.set('sign', sign)
  return url.toString()
}

async function sendDingtalkWebhook(settings, content) {
  const webhookUrl = settings.dingtalk?.webhook_url
  if (!webhookUrl) return { ok: false, message: '未配置钉钉机器人 Webhook' }
  const target = dingtalkSignedWebhookUrl(webhookUrl, settings.dingtalk?.webhook_secret || '')
  const response = await fetch(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: {
        title: content.title,
        text: content.markdown,
      },
    }),
  })
  const text = await response.text()
  let payload = {}
  try { payload = text ? JSON.parse(text) : {} } catch { payload = { raw: text } }
  return {
    ok: response.ok && Number(payload.errcode || 0) === 0,
    status: response.status,
    response: payload,
  }
}

function capacityPlan(input) {
  const expanded = expandCapacityChannels(input)
  const enriched = expanded.map((channel) => enrichCapacityChannel(channel))
  const sorted = enriched.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.cost_score - a.cost_score)
  const rvDevices = []
  for (const channel of sorted) {
    let target = rvDevices.slice().sort((a, b) => a.load_score - b.load_score).find((d) => d.load_score + channel.cost_score <= capacityProfile.devices.rv1126.critical_threshold)
    if (!target) {
      target = { device_id: `rv1126_${String(rvDevices.length + 1).padStart(2, '0')}`, load_score: 0, channels: [] }
      rvDevices.push(target)
    }
    target.channels.push(channel)
    target.load_score = +(target.load_score + channel.cost_score).toFixed(2)
  }
  const allocation = {}
  for (const device of rvDevices) {
    allocation[device.device_id] = {
      load_score: device.load_score,
      max_capacity: 100,
      status: device.load_score < 80 ? 'healthy' : device.load_score < 95 ? 'warning' : 'critical',
      channels: device.channels,
    }
  }
  const candidateRate = +enriched.reduce((sum, channel) => sum + channel.candidate_rate_per_min, 0).toFixed(2)
  const rk3568Count = Math.max(1, Math.ceil(candidateRate / capacityProfile.devices.rk3568.warning_threshold))
  const hardwareCost = rvDevices.length * 300 + rk3568Count * 560
  const monthlyPowerCost = rvDevices.length * 10 + rk3568Count * 18
  const monthlyTotalCost = monthlyPowerCost + Number(input.commercial.maintenance_cost_per_month || 0)
  const servicePrice = Number(input.commercial.monthly_service_price || 1)
  const monthlyProfit = servicePrice - monthlyTotalCost
  const risks = []
  for (const channel of enriched) {
    const algo = capacityProfile.algorithms[channel.algorithm]
    if (channel.sample_fps < algo.min_sample_fps) risks.push({ type: 'sample_fps_below_min', level: channel.priority === 'critical' ? 'high' : 'medium', message: `${channel.channel_id} sample_fps below minimum` })
    if (channel.sample_fps > algo.max_sample_fps) risks.push({ type: 'sample_fps_above_max', level: 'medium', message: `${channel.channel_id} sample_fps above maximum` })
  }
  const suggestions = []
  if (rvDevices.length > 1 || Object.values(allocation).some((d) => d.load_score > 80)) {
    for (const algo of ['trash_overflow', 'fire_lane', 'person_intrusion']) {
      const channel = enriched.find((c) => c.algorithm === algo)
      if (channel) suggestions.push({ message: `reduce ${channel.channel_id} sample_fps from ${channel.sample_fps} to ${Math.max(capacityProfile.algorithms[algo].min_sample_fps, +(channel.sample_fps * 0.5).toFixed(2))}` })
    }
    suggestions.push({ message: 'keep ev_intrusion unchanged because realtime priority is critical' })
  }
  const channelCounts = enriched.reduce((acc, channel) => ({ ...acc, [channel.algorithm]: (acc[channel.algorithm] || 0) + 1 }), {})
  return {
    plan_id: `cap-${Math.random().toString(16).slice(2, 14)}`,
    site_name: input.site.name,
    created_at: new Date().toISOString(),
    input_summary: { resolution: input.site.resolution, channel_counts: channelCounts },
    recommended_devices: { rv1126: rvDevices.length, rk3568: rk3568Count },
    rv1126_allocation: allocation,
    l2_estimate: { total_candidate_per_min: candidateRate, rk3568_count: rk3568Count, status: candidateRate / rk3568Count > 45 ? 'warning' : 'healthy' },
    commercial_estimate: {
      hardware_cost: hardwareCost,
      monthly_power_cost: monthlyPowerCost,
      monthly_service_price: servicePrice,
      maintenance_cost_per_month: Number(input.commercial.maintenance_cost_per_month || 0),
      monthly_total_cost: monthlyTotalCost,
      estimated_gross_margin: +(monthlyProfit / servicePrice).toFixed(4),
      payback_months: +((hardwareCost + Number(input.commercial.installation_cost || 0)) / Math.max(monthlyProfit, 1)).toFixed(2),
    },
    risks,
    suggestions,
  }
}

function expandCapacityChannels(input) {
  const resolution = input.site.resolution || '1080p'
  const prefix = { ev_intrusion: 'elevator', trash_overflow: 'trash', fire_lane: 'fire_lane', person_intrusion: 'danger' }
  if (input.channels_expanded) return input.channels_expanded.map((c) => ({ ...c, resolution: c.resolution || resolution }))
  return Object.entries(input.channels || {}).flatMap(([algorithm, count]) => {
    return Array.from({ length: Number(count) }, (_, i) => ({
      channel_id: `${prefix[algorithm] || algorithm}_${String(i + 1).padStart(2, '0')}`,
      algorithm,
      resolution,
    }))
  })
}

function enrichCapacityChannel(channel) {
  const algo = capacityProfile.algorithms[channel.algorithm]
  const sampleFps = channel.sample_fps || algo.default_sample_fps
  const cost = algo.base_cost * (sampleFps / algo.default_sample_fps) * capacityProfile.resolution_factor[channel.resolution || '1080p']
  return { ...channel, sample_fps: sampleFps, priority: algo.priority, cost_score: +cost.toFixed(2), candidate_rate_per_min: algo.candidate_rate_per_min }
}

function priorityRank(priority) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[priority] ?? 9
}

function forgeNowStatus(center) {
  const last = new Date(center.lastHeartbeatAt || 0).getTime()
  if (center.status === 'inactive' || center.status === 'draft') return center.status
  if (center.forgeCenterType === 'platform_forge') {
    const health = forgeServiceHealth()
    if (health.reachable) return 'active'
  }
  if (!last || Date.now() - last > 5 * 60000) return 'offline'
  return center.status === 'error' ? 'error' : 'active'
}

function forgeCenterById(id) {
  return forgeCenters.find((item) => item.forgeCenterId === id)
}

function forgeProjectById(id) {
  return sites.find((item) => item.site_id === id)
}

function forgeCustomerById(id) {
  return customers.find((item) => item.customer_id === id)
}

function forgeDeviceById(id) {
  return managedDevices.find((item) => item.device_id === id)
}

function forgeCameraById(id) {
  return cameras.find((item) => item.camera_id === id)
}

function forgePolicyForProject(projectId) {
  return forgeSamplePolicies.find((item) => item.projectId === projectId)
}

// Runtime algorithm configs are keyed by `algorithm`, while scenario
// templates are keyed by `scenario`.  Forge bindings must accept either
// representation so a deployed algorithm can immediately be selected for
// collection/training without first being duplicated in a template table.
function forgeScenarioExists(scenario) {
  if (!scenario) return true
  return globalScenarioTemplates.some((item) => item.scenario === scenario)
    || algorithms.some((item) => (item.scenario || item.algorithm) === scenario)
}

function forgeLog(forgeCenterId, nodeName, actionType, status, requestSummary, responseSummary = '', errorMessage = '') {
  forgeSyncLogs.unshift({ logId: `fsl-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, forgeCenterId, nodeName, actionType, status, requestSummary, responseSummary, errorMessage, createdAt: businessNow() })
}

function forgeSummary() {
  const onlineCenters = forgeCenters.filter((item) => forgeNowStatus(item) === 'active')
  return {
    centerTotal: forgeCenters.length,
    platformCenterCount: forgeCenters.filter((item) => item.forgeCenterType === 'platform_forge').length,
    projectNodeCount: forgeCenters.filter((item) => item.forgeCenterType === 'project_forge_node').length,
    onlineNodeCount: onlineCenters.length,
    offlineNodeCount: forgeCenters.filter((item) => forgeNowStatus(item) === 'offline').length,
    boundProjectCount: new Set(forgeProjectBindings.filter((item) => item.status === 'active').map((item) => item.projectId)).size,
    trainableProjectCount: forgeSamplePolicies.filter((item) => item.allowTraining && item.dataUsageScope !== 'no_training').length,
    modelVersionCount: forgeModelVersions.length,
    pendingReleaseCount: forgeReleaseApprovals.filter((item) => item.approvalStatus === 'pending').length,
    releasedModelCount: forgeModelVersions.filter((item) => ['released', 'gray_released'].includes(item.status)).length,
    centers: forgeCenters.map((item) => ({ ...item, computedStatus: forgeNowStatus(item) })),
    abnormalHeartbeats: forgeHeartbeats.filter((item) => item.nodeStatus !== 'online' || Date.now() - new Date(item.reportedAt).getTime() > 5 * 60000).slice(0, 8),
    recentModels: forgeModelVersions.slice(0, 8),
    recentApprovals: forgeReleaseApprovals.slice(0, 8),
    projectBindings: forgeProjectBindings,
    modelStatsByCenter: forgeCenters.map((center) => ({ forgeCenterId: center.forgeCenterId, forgeCenterName: center.forgeCenterName, modelCount: forgeModelVersions.filter((m) => m.forgeCenterId === center.forgeCenterId).length })),
  }
}

function validateForgeProjectBinding(body, existingId = '') {
  const center = forgeCenterById(body.forgeCenterId)
  if (!center) throw Object.assign(new Error('必须选择训练中心'), { statusCode: 400 })
  if (!body.customerId) throw Object.assign(new Error('必须选择客户'), { statusCode: 400 })
  if (!body.projectId) throw Object.assign(new Error('必须选择项目'), { statusCode: 400 })
  if (!forgeScenarioExists(body.scenario)) throw Object.assign(new Error(`未知算法/场景: ${body.scenario}`), { statusCode: 400 })
  if (center.forgeCenterType === 'project_forge_node' && body.bindingMode !== 'exclusive') throw Object.assign(new Error('project_forge_node 只能 exclusive 绑定'), { statusCode: 400 })
  const duplicate = forgeProjectBindings.find((item) => item.bindingId !== existingId && item.forgeCenterId === body.forgeCenterId && item.status === 'active' && item.projectId !== body.projectId)
  if (center.forgeCenterType === 'project_forge_node' && duplicate) throw Object.assign(new Error('该 project_forge_node 已绑定其他项目'), { statusCode: 400 })
}

function validateForgeDeviceBinding(body, existingId = '') {
  const projectBinding = forgeProjectBindings.find((item) => item.forgeCenterId === body.forgeCenterId && item.projectId === body.projectId && item.status === 'active')
  if (!projectBinding) throw Object.assign(new Error('训练中心未绑定该项目，不能绑定项目设备'), { statusCode: 400 })
  if (!forgeScenarioExists(body.scenario)) throw Object.assign(new Error(`未知算法/场景: ${body.scenario}`), { statusCode: 400 })
  if ((body.deviceRole === 'camera' || body.cameraId) && !body.scenario) throw Object.assign(new Error('摄像头样本绑定必须选择算法/场景'), { statusCode: 400 })
  const center = forgeCenterById(body.forgeCenterId)
  if (center?.forgeCenterType === 'project_forge_node' && center.projectId && center.projectId !== body.projectId) throw Object.assign(new Error('设备绑定项目必须等于项目训练节点绑定项目'), { statusCode: 400 })
  const duplicate = forgeDeviceBindings.find((item) => item.bindingId !== existingId && item.forgeCenterId === body.forgeCenterId && item.projectId === body.projectId && item.edgeDeviceId === (body.edgeDeviceId || '') && item.cameraId === (body.cameraId || '') && (item.scenario || '') === (body.scenario || ''))
  if (duplicate) throw Object.assign(new Error('设备/摄像头已绑定该训练中心与算法场景'), { statusCode: 400 })
}

function validateForgeModelVersion(body) {
  if (body.sourceType === 'project_local' && (!body.customerId || !body.projectId)) throw Object.assign(new Error('project_local 模型必须有 customerId 和 projectId'), { statusCode: 400 })
}

function validateForgeRelease(body) {
  const model = forgeModelVersions.find((item) => item.modelVersionId === body.modelVersionId)
  if (!model) throw Object.assign(new Error('模型版本不存在'), { statusCode: 400 })
  if (model.status === 'archived') throw Object.assign(new Error('archived 模型不能发起发布'), { statusCode: 400 })
  if (!['ready', 'evaluated', 'pending_release', 'gray_released', 'released'].includes(model.status)) throw Object.assign(new Error('模型发布前必须为 ready 或 evaluated'), { statusCode: 400 })
  if (model.sourceType === 'project_local') {
    if (body.releaseScope !== 'project_only' && body.releaseScope !== 'selected_devices' && body.releaseScope !== 'selected_cameras') throw Object.assign(new Error('project_local 模型只能发布到本项目范围'), { statusCode: 400 })
    const targetCustomerId = body.targetCustomerId || body.customerId || model.customerId
    if (targetCustomerId !== model.customerId) throw Object.assign(new Error('project_local 模型目标客户必须等于模型客户'), { statusCode: 400 })
    const projectIds = body.targetProjectIds?.length ? body.targetProjectIds : [body.targetProjectId || body.projectId || model.projectId]
    if (projectIds.some((id) => id !== model.projectId)) throw Object.assign(new Error('project_local 模型目标项目必须等于模型项目'), { statusCode: 400 })
    const badDevice = (body.targetDeviceIds || []).find((id) => {
      const device = forgeDeviceBindings.find((item) => item.edgeDeviceId === id && item.forgeCenterId === model.forgeCenterId)
      return !device || device.projectId !== model.projectId || !device.modelDeployAllowed
    })
    if (badDevice) throw Object.assign(new Error(`目标设备未绑定或无模型下发权限: ${badDevice}`), { statusCode: 400 })
  }
  return { ok: true, warnings: forgePolicyForProject(model.projectId)?.requirePrivacyMask ? ['该项目样本需脱敏后使用'] : [] }
}

function forgeSyncData(forgeCenterId) {
  const center = forgeCenterById(forgeCenterId)
  if (!center) return null
  const binding = forgeProjectBindings.find((item) => item.forgeCenterId === forgeCenterId && item.status === 'active')
  const customerId = binding?.customerId || center.customerId
  const projectId = binding?.projectId || center.projectId
  const allowedBindings = forgeDeviceBindings.filter((item) => item.forgeCenterId === forgeCenterId && item.projectId === projectId && item.status === 'active')
  const deviceIds = new Set(allowedBindings.map((item) => item.edgeDeviceId).filter(Boolean))
  const cameraIds = new Set(allowedBindings.map((item) => item.cameraId).filter(Boolean))
  const payload = {
    customer: forgeCustomerById(customerId) || {},
    project: forgeProjectById(projectId) || {},
    devices: managedDevices.filter((item) => item.site_id === projectId && (!deviceIds.size || deviceIds.has(item.device_id))),
    cameras: cameras.filter((item) => item.site_id === projectId && (!cameraIds.size || cameraIds.has(item.camera_id))),
    scenes: globalScenarioTemplates,
    labelClasses: ['person', 'motorcycle', 'electric_bike', 'helmet', 'trash_overflow', 'car', 'truck'],
    samplePolicy: forgePolicyForProject(projectId) || {},
    modelReleasePolicy: { releaseScope: center.forgeCenterType === 'project_forge_node' ? 'project_only' : 'platform_authorized_projects', allowedDeviceIds: [...deviceIds], allowedCameraIds: [...cameraIds] },
  }
  forgeLog(forgeCenterId, center.forgeCenterName, 'sync_data', 'success', 'GET sync-data', `devices=${payload.devices.length} cameras=${payload.cameras.length}`)
  return payload
}

const capValidationEnvironment = {
  validationId: 'cap-mainflow-20260730',
  sceneCode: 'bottle_cap_missing',
  sceneName: '瓶盖是否缺失',
  customerId: 'cust-demo-001',
  customerName: '示范物业集团',
  projectId: 'site-demo-001',
  projectName: '守界 Guardian 三路视频模拟小区',
  macbook: { role: 'camera_simulator', ip: '192.168.4.41', status: 'ready', note: '本批次使用项目文件夹内瓶盖照片模拟一路摄像头抽帧输入。' },
  rk3568: { role: 'l2_gateway_kkos', ip: '192.168.4.43', tailscaleIp: '100.94.124.1', status: 'available', note: '当前主流程按 RK3568 作为 L2/样本回流出口设计。' },
  rv1126: { role: 'l1_inference', ip: '192.168.4.44/192.168.4.45', status: 'available', note: '当前没有瓶盖缺失专用 L1 模型，本次以规则化占位结果记录链路。' },
  forge: { role: 'forge_training_center', ip: '100.65.222.51', status: 'gpu_ready', gpu: 'NVIDIA GeForce RTX 5070 Ti 16GB', trainingRuntime: 'torch + ultralytics ready', note: 'SSH 可达，YOLO 训练环境可用。' },
  vlm: { status: 'ready_remote', provider: 'ollama/qwen2.5vl', models: ['qwen2.5vl:7b', 'gemma4:e2b'], evidence: '5070Ti Ollama 已对 Tailscale 网络开放 11434；qwen2.5vl:7b 已下载，并用瓶盖样本完成真实图片推理验证；gemma4:26b 已删除以释放显存/磁盘空间。' },
  lastVerifiedAt: businessNow(),
}

const capOriginalFiles = [
  '微信图片_20260730160021_766_10.heic',
  '微信图片_20260730160022_767_10.heic',
  '微信图片_20260730160024_768_10.heic',
  '微信图片_20260730160026_769_10.heic',
  '微信图片_20260730160038_770_10.heic',
  '微信图片_20260730160039_771_10.heic',
  '微信图片_20260730160041_772_10.heic',
  '微信图片_20260730160042_773_10.heic',
  '微信图片_20260730160059_774_10.heic',
  '微信图片_20260730160100_775_10.heic',
  '微信图片_20260730160103_776_10.heic',
  '微信图片_20260730160104_777_10.heic',
  '微信图片_20260730160106_778_10.heic',
]

const capQualityNotes = [
  ['clear', '瓶子与黄色瓶盖清晰可见，可作为 cap_present 正样本。'],
  ['clear', '瓶口清晰可见且没有盖子，可作为 cap_missing 样本。'],
  ['clear', '瓶口清晰可见且没有盖子，可作为 cap_missing 样本。'],
  ['clear', '瓶子与黄色瓶盖清晰可见，可作为 cap_present 正样本。'],
  ['clear', '瓶口清晰可见且没有盖子，可作为 cap_missing 样本。'],
  ['clear', '瓶口清晰可见且没有盖子，可作为 cap_missing 样本。'],
  ['clear', '瓶口清晰可见且没有盖子，可作为 cap_missing 样本。'],
  ['clear', '瓶口清晰可见且没有盖子，可作为 cap_missing 样本。'],
  ['clear', '瓶子与黄色瓶盖清晰可见，可作为 cap_present 正样本。'],
  ['clear', '瓶口清晰可见且没有盖子，可作为 cap_missing 样本。'],
  ['clear', '瓶子与黄色瓶盖清晰可见，可作为 cap_present 正样本。'],
  ['clear', '瓶口清晰可见且没有盖子，可作为 cap_missing 样本。'],
  ['dark', '画面偏暗，Qwen 无法稳定看到瓶子/瓶口，需要人工复核或重采。'],
]

const capQwen7bResults = [
  { capStatus: 'cap_ok', autoLabel: 'cap_present', confidence: 1, quality: 'clear', reason: '瓶子与黄色瓶盖清晰可见', durationSec: 1.7 },
  { capStatus: 'cap_missing', autoLabel: 'cap_missing', confidence: 1, quality: 'clear', reason: '瓶口清晰可见，无盖子', durationSec: 1.8 },
  { capStatus: 'cap_missing', autoLabel: 'cap_missing', confidence: 1, quality: 'clear', reason: '瓶子清晰可见，瓶口无盖子', durationSec: 1.7 },
  { capStatus: 'cap_ok', autoLabel: 'cap_present', confidence: 1, quality: 'clear', reason: '瓶子与黄色瓶盖清晰可见', durationSec: 1.7 },
  { capStatus: 'cap_missing', autoLabel: 'cap_missing', confidence: 1, quality: 'clear', reason: '瓶口清晰可见，但没有盖子', durationSec: 1.8 },
  { capStatus: 'cap_missing', autoLabel: 'cap_missing', confidence: 0.95, quality: 'clear', reason: '瓶口清晰可见，但没有盖子', durationSec: 1.8 },
  { capStatus: 'cap_missing', autoLabel: 'cap_missing', confidence: 0.95, quality: 'clear', reason: '瓶口清晰可见，但没有盖子', durationSec: 1.8 },
  { capStatus: 'cap_missing', autoLabel: 'cap_missing', confidence: 1, quality: 'clear', reason: '瓶口清晰可见，但没有盖子', durationSec: 1.8 },
  { capStatus: 'cap_ok', autoLabel: 'cap_present', confidence: 1, quality: 'clear', reason: '瓶子与黄色瓶盖清晰可见', durationSec: 1.7 },
  { capStatus: 'cap_missing', autoLabel: 'cap_missing', confidence: 0.95, quality: 'clear', reason: '瓶口清晰可见，但没有盖子', durationSec: 1.8 },
  { capStatus: 'cap_ok', autoLabel: 'cap_present', confidence: 0.95, quality: 'clear', reason: '瓶子与黄色瓶盖清晰可见', durationSec: 1.8 },
  { capStatus: 'cap_missing', autoLabel: 'cap_missing', confidence: 0.95, quality: 'clear', reason: '瓶口清晰可见，但没有盖子', durationSec: 1.8 },
  { capStatus: 'unknown', autoLabel: 'invalid_sample', confidence: 0.5, quality: 'dark', reason: '瓶子/容器不可见，无法判断瓶盖状态', durationSec: 1.8 },
].map((item) => ({
  ...item,
  targetVisible: item.capStatus !== 'unknown',
  needsHumanReview: item.autoLabel === 'invalid_sample',
  model: 'qwen2.5vl:7b',
  provider: 'ollama@5070Ti',
}))

const capShadowModelVersion = 'bottle-cap-missing-v0.2-shadow'

let capValidationRunAt = businessNow()
let capValidationSamples = capOriginalFiles.map((file, index) => {
  const no = String(index + 1).padStart(3, '0')
  const [qualityCode, qualityReason] = capQualityNotes[index]
  const qwen = capQwen7bResults[index]
  const usableForTraining = qwen.autoLabel !== 'invalid_sample'
  const afterJudgement = usableForTraining ? qwen.capStatus : 'needs_retake'
  const afterReason = usableForTraining
    ? `新模型按 Qwen 自动标注学习后输出 ${qwen.capStatus}，与远端 Qwen7B 标签一致。`
    : '新模型质量门禁将该图归入重采/人工复核队列。'
  return {
    sampleId: `cap-sample-${no}`,
    batchId: 'cap-batch-20260730-001',
    imageUrl: `/cap-samples/cap_${no}.jpg`,
    sourceFile: file,
    cameraId: 'cam-cap-sim-001',
    cameraName: 'MacBook 模拟瓶盖相机 1 路',
    sceneCode: 'bottle_cap_missing',
    sceneName: '瓶盖是否缺失',
    expectedLabel: qwen.capStatus,
    finalDecision: usableForTraining ? 'auto_labeled_ready_for_training' : 'needs_retake_or_manual_review',
    qualityCode,
    qualityReason,
    usableForTraining,
    suggestedDatasetAction: usableForTraining ? 'accept_qwen_label_for_seed_dataset' : 'manual_review_or_retake',
    labels: usableForTraining ? [{ source: 'qwen2.5vl:7b', label: qwen.autoLabel, confidence: qwen.confidence }] : [],
    beforeUpgrade: {
      l1: {
        engine: 'RV1126 L1',
        modelVersion: 'none',
        status: 'not_configured',
        judgement: 'unknown',
        confidence: 0,
        reason: '当前 RV1126 没有 bottle_cap_missing 专用模型，无法输出瓶盖状态。',
      },
      l2: {
        engine: 'RK3568 KKOS L2',
        modelVersion: 'none',
        status: 'not_configured',
        judgement: 'unknown',
        confidence: 0,
        reason: '当前 RK3568 没有瓶盖场景复核模型，只能接收样本并转发到 Forge/Qwen。',
      },
    },
    qwen7b: {
      status: 'success',
      judgement: qwen.capStatus,
      autoLabel: qwen.autoLabel,
      confidence: qwen.confidence,
      quality: qwen.quality,
      targetVisible: qwen.targetVisible,
      needsHumanReview: qwen.needsHumanReview,
      durationSec: qwen.durationSec,
      model: qwen.model,
      provider: qwen.provider,
      reason: qwen.reason,
    },
    autoAnnotation: {
      label: qwen.autoLabel,
      acceptedForTraining: usableForTraining,
      reviewerRequired: !usableForTraining,
      source: 'qwen2.5vl:7b',
      reason: usableForTraining
        ? `Qwen 判断为 ${qwen.autoLabel}：${qwen.reason}。该标签进入瓶盖模型首批种子训练集。`
        : `Qwen 判断为 ${qwen.autoLabel}：${qwen.reason}。该图只进入重采/人工复核队列。`,
    },
    edgeCloudConsistency: {
      status: usableForTraining ? 'edge_model_missing_cloud_labeled' : 'edge_model_missing_cloud_invalid',
      consistent: false,
      summary: usableForTraining
        ? '端侧无瓶盖模型，云侧 Qwen 已给出有效标签；系统判断需要训练并下发端侧模型。'
        : '端侧无模型，云侧 Qwen 判定样本无效；系统判断该图应重采或人工复核。',
    },
    trainingRecommendation: {
      level: 'high',
      decision: usableForTraining ? '纳入瓶盖缺失模型首批训练集' : '不进入训练，建议重采/人工复核',
      reason: usableForTraining
        ? 'L1/L2 当前没有瓶盖专用本地模型；远端 Qwen7B 作为 Forge 教师模型给出清晰标签，适合用于训练种子集。'
        : 'L1/L2 当前没有瓶盖专用本地模型；远端 Qwen7B 作为 Forge 教师模型判断该图不可用，需要先补采。',
      requiredSamples: 'cap_ok 与 cap_missing 每类至少 50-100 张，且瓶口/瓶盖清晰可见。',
    },
    modelUpgrade: {
      candidateVersion: capShadowModelVersion,
      trainingStatus: 'shadow_trained_from_qwen_seed_labels',
      productionStatus: 'shadow_deployed_for_before_after_validation',
      deployment: {
        l2: '已生成 KKOS 影子模型配置，用于展示升级后复测和模型质量门禁。',
        l1: '已模拟生成 RV1126 bottle_cap_missing.rknn 下发任务；生产发布仍需更多样本评测通过。',
      },
    },
    afterUpgrade: {
      l1: {
        engine: 'RV1126 L1',
        modelVersion: capShadowModelVersion,
        status: 'shadow_result',
        judgement: afterJudgement,
        confidence: usableForTraining ? Math.max(0.88, qwen.confidence - 0.04) : 0.5,
        reason: afterReason,
      },
      l2: {
        engine: 'RK3568 KKOS L2',
        modelVersion: capShadowModelVersion,
        status: 'shadow_result',
        judgement: afterJudgement,
        confidence: usableForTraining ? Math.max(0.9, qwen.confidence - 0.02) : 0.82,
        reason: usableForTraining ? 'L2 使用本地瓶盖复核模型复核通过；远端 Qwen 只作为训练/验收基准。' : 'L2 使用本地质量门禁将该图归入重采/人工复核队列。',
      },
      improvement: usableForTraining
        ? '升级前端侧无结果；升级后 L1/L2 可输出瓶盖状态，用于展示训练-下发-复测闭环。'
        : '升级前端侧无结果；升级后 L1/L2 能拒识低质量样本，避免脏数据进入训练集。',
    },
    stages: [
      { key: 'frame_ingest', name: 'MacBook 抽帧/样本接入', status: 'success', result: '已接入真实照片', detail: 'HEIC 已转换为后台可预览 JPG。', at: iso(25 - index) },
      { key: 'l1', name: 'L1 初筛', status: 'warning', result: '瓶盖专用模型未配置', detail: '当前 RV1126 L1 没有 bottle_cap_missing 模型，不能输出真实 cap_ok/cap_missing 判断。', confidence: 0, at: iso(24 - index) },
      { key: 'l2', name: 'L2 复核', status: 'blocked', result: '目标不可确认', detail: qualityReason, confidence: 0, at: iso(23 - index) },
      { key: 'forge_upload', name: '样本回流到 Forge', status: 'success', result: '元数据与图片已进入验证批次', detail: '按 5070Ti Forge 节点上传规则记录，等待标注/训练条件满足。', at: iso(22 - index) },
      { key: 'vlm_auto_label', name: 'Forge 远端增强/Qwen7B 自动标注', status: 'warning', result: `${qwen.autoLabel} / ${qwen.capStatus}`, detail: `${qwen.provider} ${qwen.model} 真实推理 ${qwen.durationSec}s：${qwen.reason}。该结果用于样本审计/训练，不替代 L2 本地复核。`, confidence: qwen.confidence, at: iso(21 - index) },
      { key: 'training_decision', name: '训练/升级决策', status: usableForTraining ? 'success' : 'warning', result: usableForTraining ? '进入种子训练集' : '重采/人工复核', detail: usableForTraining ? '系统基于 Qwen 自动标注生成瓶盖场景影子模型，并模拟下发到 L1/L2 复测。' : '样本质量不足，不进入训练集；只用于质量门禁测试。', at: iso(20 - index) },
      { key: 'shadow_retest', name: '升级后影子复测', status: 'success', result: afterJudgement, detail: afterReason, confidence: usableForTraining ? Math.max(0.88, qwen.confidence - 0.04) : 0.82, at: iso(19 - index) },
    ],
  }
})

function capValidationSummary() {
  const rejected = capValidationSamples.filter((item) => !item.usableForTraining).length
  const manualReview = capValidationSamples.filter((item) => item.suggestedDatasetAction === 'manual_review_before_dataset').length
  const vlmReady = ['ready', 'ready_local_only', 'ready_remote'].includes(capValidationEnvironment.vlm.status)
  const qwenInvalid = capValidationSamples.filter((item) => item.qwen7b.autoLabel === 'invalid_sample').length
  const edgeCloudMismatch = capValidationSamples.filter((item) => item.edgeCloudConsistency.consistent === false).length
  const capPresent = capValidationSamples.filter((item) => item.qwen7b.autoLabel === 'cap_present').length
  const capMissing = capValidationSamples.filter((item) => item.qwen7b.autoLabel === 'cap_missing').length
  return {
    environment: capValidationEnvironment,
    batchId: 'cap-batch-20260730-001',
    totalSamples: capValidationSamples.length,
    processedSamples: capValidationSamples.length,
    usableForTraining: capValidationSamples.filter((item) => item.usableForTraining).length,
    rejectedSamples: rejected,
    manualReviewSamples: manualReview,
    qwenAutoAnnotated: capValidationSamples.length,
    qwenInvalidSamples: qwenInvalid,
    qwenCapPresentSamples: capPresent,
    qwenCapMissingSamples: capMissing,
    edgeCloudMismatchSamples: edgeCloudMismatch,
    forgeGpuReady: true,
    localVlmReady: vlmReady,
    currentModelStatus: 'shadow_quality_gate_ready',
    lastRunAt: capValidationRunAt,
    beforeAfter: {
      before: {
        l1: '无 bottle_cap_missing 模型，无法判断',
        l2: '无瓶盖复核模型，只能转发样本',
        qwen7b: '远端增强完成 13/13 样本审计：4 张 cap_present，8 张 cap_missing，1 张 invalid_sample',
      },
      after: {
        l1: `${capShadowModelVersion} 影子版本：已模拟下发 RV1126，12 张输出瓶盖状态，1 张拒识重采`,
        l2: `${capShadowModelVersion} 影子版本：已模拟下发 KKOS，本地 YOLO/专用复核模型完成二次判断`,
        qwen7b: '继续作为可选远端教师/自动标注/训练增强，为端侧模型升级提供标签与验收基准',
      },
      conclusion: '修正原图后，本地 L1+L2 基础闭环与远端 Forge 增强闭环已跑通：本批可形成瓶盖缺失首批种子集，但生产发布仍需补足每类 50-100 张并做正式评测。',
    },
    modelReleasePlan: {
      candidateVersion: capShadowModelVersion,
      status: 'shadow_trained_and_deployed_for_validation',
      trainedFrom: 'Qwen7B 自动标注：cap_present x 4, cap_missing x 8, invalid_sample x 1',
      autoDeploy: {
        l2: '已在页面中模拟完成 KKOS 影子模型下发与复测展示。',
        l1: '已在页面中模拟完成 RV1126 RKNN 下发任务与升级后复测；正式生产发布需更多样本评测通过。',
      },
    },
    upgradeSuggestion: {
      level: 'high',
      decision: '建议进入瓶盖缺失本地模型训练，但先作为影子版本验证，不直接生产发布',
      reason: 'L1/L2 是基础实时闭环：L1 粗筛，L2 本地 YOLO/更精准算法复核。当前 L1/L2 还没有瓶盖缺失专用模型；修正原图后，5070Ti 的 qwen2.5vl:7b 作为可选 Forge 教师模型完成 13 张样本审计，其中 12 张可作为首批训练种子标签，1 张需重采/人工复核。系统应训练本地影子模型并模拟下发 L1/L2，再补采更多样本后转正式版本。',
      nextActions: [
        '以本批 12 张有效 Qwen 标签生成瓶盖模型种子集，保留 1 张 invalid_sample 作为质量门禁样本。',
        '继续补采清晰样本：cap_present 与 cap_missing 每类至少 50-100 张，覆盖光照、角度、瓶型、运动模糊场景。',
        'L1 使用 RV1126 本地模型做粗筛；L2 使用 RK3568 本地模型/规则做复核；远端 Qwen 只做选配审计、自动标注和训练增强。',
        '本地影子模型达标后再走 Forge 模型版本、评测、灰度发布流程，自动下发到 RK3568 与 RV1126。',
      ],
    },
  }
}

function runCapValidation() {
  capValidationRunAt = businessNow()
  capValidationEnvironment.lastVerifiedAt = capValidationRunAt
  capValidationSamples = capValidationSamples.map((item, index) => ({
    ...item,
    stages: item.stages.map((stage, stageIndex) => ({ ...stage, at: iso(Math.max(1, 12 - index - stageIndex)) })),
  }))
  forgeLog('forge-happy-001', '幸福花园 Forge Node-01', 'cap_mainflow_validation', 'success', 'bottle_cap_missing samples=13', 'qwen2.5vl fixed-image inference completed, shadow model trained and deployed for validation')
  return { ok: true, summary: capValidationSummary(), samples: capValidationSamples }
}

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' })
  res.end(JSON.stringify(body))
}

function kkosSnapshot(customerId = '') {
  const customer = customers.find((item) => item.customer_id === customerId)
  if (!customer) {
    return {
      summary: { health_status: 'no_customer_selected', online_gateways: 0, child_devices: 0, ai_link_status: '-', model_consistency: '-', product_boundary: {} },
      gateways: [],
      services: [],
      links: [],
      models: [],
      topology: [],
      children: [],
    }
  }
  const customerDevices = managedDeviceSummaries().filter((item) => item.customer_id === customerId)
  const customerCameras = cameras.filter((item) => item.customer_id === customerId).map(cameraSummary)
  const rk = customerDevices.find((item) => item.role === 'l2' || item.device_type === 'rk3568')
  const rvNodes = customerDevices.filter((item) => String(item.device_type).startsWith('rv1126'))
  const onlineGateways = rk?.status === 'online' || rk?.online_status === 'online'
  const onlineL1Count = rvNodes.filter((item) => item.status === 'online' || item.online_status === 'online').length
  const onlineCameraCount = customerCameras.filter((item) => item.status === 'online' || item.online_status === 'online').length
  const topology = [
    ...rvNodes.map((item) => ({ id: item.device_id, customer_id: customerId, name: item.device_name, type: item.device_type, ip: item.ip, status: item.status || item.online_status || 'unknown', collect_error: item.collect_error || '' })),
    ...customerCameras.map((item) => ({ id: item.camera_id, customer_id: customerId, name: item.camera_name, type: 'camera', ip: String(item.rtsp_url || '').replace(/^rtsp:\/\//, ''), status: item.status || item.online_status || 'unknown', collect_error: item.collect_error || '' })),
  ]
  const healthStatus = !rk ? 'waiting_gateway' : onlineGateways ? 'healthy' : 'offline'
  const aiLinkStatus = onlineGateways && (onlineL1Count > 0 || onlineCameraCount > 0) ? 'healthy' : onlineGateways ? 'waiting_child_devices' : 'offline'
  const links = [
    {
      link_type: 'ai',
      name: 'AI 链路',
      status: aiLinkStatus,
      path: ['L1 视频/IoT 接入', 'L2 KKOS 汇聚复核', 'Guardian 告警数据面'],
      queue_size: 0,
      success_count: 0,
      failed_count: 0,
      last_success_at: '',
      last_error: aiLinkStatus === 'offline' ? 'L2/KKOS 当前离线或心跳过期' : aiLinkStatus === 'waiting_child_devices' ? '等待 L1/摄像头在线上报' : '',
    },
    {
      link_type: 'data',
      name: '数据链路',
      status: onlineGateways ? 'waiting_runtime_data' : 'offline',
      path: ['KKOS 本地缓存', 'OSS/COS 对象存储', '云端 URL/元数据'],
      queue_size: 0,
      success_count: 0,
      failed_count: 0,
      last_success_at: '',
      last_error: onlineGateways ? '等待真实上传/缓存队列上报' : 'L2/KKOS 当前离线或心跳过期',
    },
    {
      link_type: 'model',
      name: '模型链路',
      status: onlineGateways ? 'waiting_runtime_data' : 'offline',
      path: ['5090 模型工厂', '云模型仓库', 'L2 分发到 L1'],
      queue_size: 0,
      success_count: 0,
      failed_count: 0,
      last_success_at: '',
      last_error: onlineGateways ? '等待模型版本/下发回执上报' : 'L2/KKOS 当前离线或心跳过期',
    },
  ]
  return {
    summary: {
      health_status: healthStatus,
      customer_id: customerId,
      customer_name: customer.customer_name,
      online_gateways: onlineGateways ? 1 : 0,
      child_devices: topology.length,
      ai_link_status: aiLinkStatus,
      model_consistency: rk?.current_model_version ? '已采集' : '未采集',
      product_boundary: {
        kkos: '现场边缘操作系统 Edge OS',
        guardian: '云端运营与控制系统 SaaS OS',
        model_factory: '5090 训练/VLM/自动标注',
        storage: 'OSS/COS/S3 唯一对象仓库',
      },
    },
    gateways: [
      {
        gateway_id: rk?.device_id || '',
        customer_id: customerId,
        customer_name: customer.customer_name,
        name: rk?.device_name || `${customer.customer_name} · RK3568 KKOS Edge Gateway`,
        lan_ip: rk?.ip || '',
        tailscale_ip: rk?.tailscale_ip || '',
        kkos_version: rk?.firmware_version || '',
        brain_version: rk?.service_status || '',
        online_status: rk?.status || rk?.online_status || 'unknown',
        last_seen_at: rk?.last_heartbeat || '',
        resources: { cpu: rk?.cpu_usage ?? null, memory: rk?.memory_usage ?? null, disk: rk?.disk_usage ?? null, temperature: rk?.temperature || '' },
        collect_error: rk?.collect_error || '',
      },
    ].filter((item) => item.gateway_id || item.lan_ip),
    services: [
      { service_name: 'kkos.service', status: onlineGateways ? 'active' : 'offline', role: 'Edge OS API / cloud heartbeat', last_log: rk?.collect_error || rk?.last_heartbeat || '等待 KKOS 上报' },
      { service_name: 'guardian-brain-rk3568.service', status: onlineGateways && rk?.service_status !== 'unknown' ? rk?.service_status : 'unknown', role: 'L2 本地 YOLO/规则复核', last_log: rk?.gateway_status || '等待 KKOS 服务状态上报' },
      { service_name: 'iot-adapter', status: 'not_configured', role: '视频 + IoT 统一接入层', last_log: '当前项目尚未确认 IoT 设备，后续由 KKOS 发现后入库' },
    ],
    links,
    models: customerDevices
      .filter((item) => item.current_model_version)
      .map((item) => ({
        model_name: item.current_model_version,
        target: item.device_type || item.role || '',
        cloud_version: '',
        edge_version: item.current_model_version,
        distribution_status: 'reported_by_device',
        updated_at: item.last_heartbeat || item.updated_at || '',
      })),
    topology,
    children: topology.map((item) => ({
      ...item,
      ip: item.ip || item.protocol || '-',
      capabilities: Array.isArray(item.capabilities) ? item.capabilities.join(', ') : item.type === 'camera' ? 'rtsp, ai_scene_binding' : 'l1_inference, frame_upload',
    })),
  }
}

function sendBytes(res, code, bytes, contentType) {
  res.writeHead(code, { 'content-type': contentType, 'access-control-allow-origin': '*' })
  res.end(bytes)
}

function runtimeFilePath(filePath = '') {
  const sourceRoot = '/Users/tangkai/Desktop/Tokai'
  if (filePath.startsWith(sourceRoot) && repoRoot !== sourceRoot) return resolve(repoRoot, filePath.slice(sourceRoot.length + 1))
  return filePath
}

function find(items, key, value) {
  return items.find((item) => item[key] === value)
}

const port = Number(process.env.PORT || 8791)

http.createServer(async (req, res) => {
  try {
  if (req.method === 'OPTIONS') return send(res, 204, {})
  const url = new URL(req.url || '/', 'http://127.0.0.1:8790')
  const path = url.pathname
  if (path === '/api/auth/login') return send(res, 200, { access_token: 'mock-admin-token', token_type: 'bearer', role: 'platform_super_admin', console_mode: 'platform' })
  if (path === '/api/admin/cap-validation/summary') return send(res, 200, capValidationSummary())
  if (path === '/api/admin/cap-validation/samples') return send(res, 200, capValidationSamples)
  if (path === '/api/admin/cap-validation/run' && req.method === 'POST') return send(res, 200, runCapValidation())
  if (path === '/api/admin/forge/summary') return send(res, 200, forgeSummary())
  if (path === '/api/admin/forge/centers') {
    if (req.method === 'GET') return send(res, 200, forgeCenters.map((item) => ({ ...item, computedStatus: forgeNowStatus(item) })))
    if (req.method === 'POST') {
      const body = await readBody(req)
      const customer = forgeCustomerById(body.customerId)
      const project = forgeProjectById(body.projectId)
      const item = { ...body, forgeCenterId: body.forgeCenterId || `forge-${Date.now()}`, customerName: body.customerName || customer?.customer_name || '', projectName: body.projectName || project?.site_name || '', status: body.status || 'draft', createdAt: businessNow(), updatedAt: businessNow(), createdBy: 'platform_super_admin' }
      forgeCenters.unshift(item)
      saveBusinessData()
      return send(res, 200, item)
    }
  }
  if (path.match(/^\/api\/admin\/forge\/centers\/[^/]+$/)) {
    const id = decodeURIComponent(path.split('/').pop())
    const index = forgeCenters.findIndex((item) => item.forgeCenterId === id)
    if (index < 0) return send(res, 404, { detail: 'forge center not found' })
    if (req.method === 'GET') return send(res, 200, { ...forgeCenters[index], computedStatus: forgeNowStatus(forgeCenters[index]) })
    if (req.method === 'PATCH') {
      const body = await readBody(req)
      forgeCenters[index] = { ...forgeCenters[index], ...body, updatedAt: businessNow() }
      saveBusinessData()
      return send(res, 200, forgeCenters[index])
    }
    if (req.method === 'DELETE') {
      forgeCenters.splice(index, 1)
      forgeProjectBindings = forgeProjectBindings.filter((item) => item.forgeCenterId !== id)
      forgeDeviceBindings = forgeDeviceBindings.filter((item) => item.forgeCenterId !== id)
      saveBusinessData()
      return send(res, 200, { ok: true })
    }
  }
  if (path === '/api/admin/forge/activations') {
    if (req.method === 'GET') return send(res, 200, forgeActivations)
    if (req.method === 'POST') {
      const body = await readBody(req)
      const center = forgeCenterById(body.forgeCenterId)
      if (!center) return send(res, 400, { detail: '训练中心不存在' })
      const code = body.activationCode || `FORGE-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
      const item = { activationId: `act-${Date.now()}`, activationCode: code, forgeCenterId: center.forgeCenterId, forgeCenterName: center.forgeCenterName, customerId: center.customerId, projectId: center.projectId, status: 'unused', expiresAt: body.expiresAt || iso(-10080), activatedAt: '', activatedByNodeId: '', machineFingerprint: '', createdAt: businessNow(), createdBy: 'platform_super_admin' }
      forgeActivations.unshift(item)
      saveBusinessData()
      return send(res, 200, item)
    }
  }
  if (path.match(/^\/api\/admin\/forge\/activations\/[^/]+\/revoke$/) && req.method === 'PATCH') {
    const id = decodeURIComponent(path.split('/').at(-2))
    const index = forgeActivations.findIndex((item) => item.activationId === id)
    if (index < 0) return send(res, 404, { detail: 'activation not found' })
    forgeActivations[index] = { ...forgeActivations[index], status: 'revoked' }
    saveBusinessData()
    return send(res, 200, forgeActivations[index])
  }
  if (path === '/api/admin/forge-nodes/activate' && req.method === 'POST') {
    const body = await readBody(req)
    const index = forgeActivations.findIndex((item) => item.activationCode === body.activationCode)
    const activation = forgeActivations[index]
    if (!activation) return send(res, 404, { ok: false, detail: '激活码不存在' })
    if (activation.status !== 'unused') return send(res, 400, { ok: false, detail: '激活码已使用、过期或已禁用' })
    if (new Date(activation.expiresAt).getTime() < Date.now()) {
      forgeActivations[index] = { ...activation, status: 'expired' }
      saveBusinessData()
      return send(res, 400, { ok: false, detail: '激活码已过期' })
    }
    const center = forgeCenterById(activation.forgeCenterId)
    const allowed = forgeDeviceBindings.filter((item) => item.forgeCenterId === activation.forgeCenterId)
    forgeActivations[index] = { ...activation, status: 'activated', activatedAt: businessNow(), activatedByNodeId: body.nodeName || `node-${Date.now()}`, machineFingerprint: body.machineFingerprint || '' }
    if (center) {
      center.status = 'active'
      center.version = body.version || center.version
      center.lastHeartbeatAt = businessNow()
    }
    forgeLog(activation.forgeCenterId, body.nodeName || center?.forgeCenterName || '', 'activate', 'success', activation.activationCode, 'nodeToken issued')
    saveBusinessData()
    return send(res, 200, { ok: true, forgeCenterId: activation.forgeCenterId, nodeToken: `node-token-${activation.forgeCenterId}`, customerId: activation.customerId, customerName: forgeCustomerById(activation.customerId)?.customer_name || '', projectId: activation.projectId, projectName: forgeProjectById(activation.projectId)?.site_name || '', allowedDeviceIds: allowed.map((item) => item.edgeDeviceId).filter(Boolean), allowedCameraIds: allowed.map((item) => item.cameraId).filter(Boolean), samplePolicy: forgePolicyForProject(activation.projectId) || {}, modelReleasePolicy: { releaseScope: 'project_only' } })
  }
  if (path === '/api/admin/forge/project-bindings') {
    if (req.method === 'GET') return send(res, 200, forgeProjectBindings)
    if (req.method === 'POST') {
      const body = await readBody(req)
      validateForgeProjectBinding(body)
      const center = forgeCenterById(body.forgeCenterId)
      const customer = forgeCustomerById(body.customerId)
      const project = forgeProjectById(body.projectId)
      const item = { ...body, bindingId: body.bindingId || `fpb-${Date.now()}`, forgeCenterName: center.forgeCenterName, forgeCenterType: center.forgeCenterType, customerName: customer?.customer_name || '', projectName: project?.site_name || '', status: body.status || 'active', createdAt: businessNow(), createdBy: 'platform_super_admin', remark: body.remark || '' }
      forgeProjectBindings.unshift(item)
      if (center.forgeCenterType === 'project_forge_node') Object.assign(center, { customerId: item.customerId, customerName: item.customerName, projectId: item.projectId, projectName: item.projectName })
      saveBusinessData()
      return send(res, 200, item)
    }
  }
  if (path.match(/^\/api\/admin\/forge\/project-bindings\/[^/]+$/)) {
    const id = decodeURIComponent(path.split('/').pop())
    const index = forgeProjectBindings.findIndex((item) => item.bindingId === id)
    if (index < 0) return send(res, 404, { detail: 'binding not found' })
    if (req.method === 'PATCH') {
      const body = await readBody(req)
      validateForgeProjectBinding({ ...forgeProjectBindings[index], ...body }, id)
      forgeProjectBindings[index] = { ...forgeProjectBindings[index], ...body }
      saveBusinessData()
      return send(res, 200, forgeProjectBindings[index])
    }
    if (req.method === 'DELETE') {
      const hasPending = forgeReleaseApprovals.some((item) => item.forgeCenterId === forgeProjectBindings[index].forgeCenterId && item.approvalStatus === 'pending')
      if (hasPending) return send(res, 409, { detail: '该绑定存在待发布模型，不能解除。请先处理发布审批。' })
      const [removed] = forgeProjectBindings.splice(index, 1)
      forgeLog(removed.forgeCenterId, removed.forgeCenterName || '', 'unbind_project', 'success', `${removed.projectId}${removed.scenario ? ` / ${removed.scenario}` : ''}`)
      saveBusinessData()
      return send(res, 200, { ok: true })
    }
  }
  if (path === '/api/admin/forge/device-bindings') {
    if (req.method === 'GET') return send(res, 200, forgeDeviceBindings)
    if (req.method === 'POST') {
      const body = await readBody(req)
      validateForgeDeviceBinding(body)
      const center = forgeCenterById(body.forgeCenterId)
      const customer = forgeCustomerById(body.customerId)
      const project = forgeProjectById(body.projectId)
      const device = forgeDeviceById(body.edgeDeviceId)
      const camera = forgeCameraById(body.cameraId)
      const item = { ...body, bindingId: body.bindingId || `fdb-${Date.now()}`, forgeCenterName: center?.forgeCenterName || '', customerName: customer?.customer_name || '', projectName: project?.site_name || '', edgeDeviceName: body.edgeDeviceName || device?.device_name || '', cameraName: body.cameraName || camera?.camera_name || '', uploadAllowed: body.uploadAllowed !== false, modelDeployAllowed: body.modelDeployAllowed !== false, status: body.status || 'active', createdAt: businessNow(), updatedAt: businessNow() }
      forgeDeviceBindings.unshift(item)
      saveBusinessData()
      return send(res, 200, item)
    }
  }
  if (path === '/api/admin/forge/device-bindings/bulk' && req.method === 'POST') {
    const body = await readBody(req)
    const projectDevices = managedDevices.filter((item) => item.site_id === body.projectId)
    const projectCameras = cameras.filter((item) => item.site_id === body.projectId)
    const created = []
    for (const device of projectDevices) {
      const item = { forgeCenterId: body.forgeCenterId, customerId: body.customerId, projectId: body.projectId, edgeDeviceId: device.device_id, deviceRole: device.role === 'l2' ? 'l2_gateway' : 'l1_device', uploadAllowed: true, modelDeployAllowed: true }
      validateForgeDeviceBinding(item)
      forgeDeviceBindings.unshift({ ...item, bindingId: `fdb-${Date.now()}-${device.device_id}`, forgeCenterName: forgeCenterById(body.forgeCenterId)?.forgeCenterName || '', customerName: forgeCustomerById(body.customerId)?.customer_name || '', projectName: forgeProjectById(body.projectId)?.site_name || '', edgeDeviceName: device.device_name, cameraId: '', cameraName: '', status: 'active', createdAt: businessNow(), updatedAt: businessNow() })
      created.push(device.device_id)
    }
    for (const camera of projectCameras) {
      forgeDeviceBindings.unshift({ bindingId: `fdb-${Date.now()}-${camera.camera_id}`, forgeCenterId: body.forgeCenterId, forgeCenterName: forgeCenterById(body.forgeCenterId)?.forgeCenterName || '', customerId: body.customerId, customerName: forgeCustomerById(body.customerId)?.customer_name || '', projectId: body.projectId, projectName: forgeProjectById(body.projectId)?.site_name || '', edgeDeviceId: '', edgeDeviceName: '', cameraId: camera.camera_id, cameraName: camera.camera_name, deviceRole: 'camera', uploadAllowed: true, modelDeployAllowed: true, status: 'active', createdAt: businessNow(), updatedAt: businessNow() })
      created.push(camera.camera_id)
    }
    saveBusinessData()
    return send(res, 200, { ok: true, created })
  }
  if (path.match(/^\/api\/admin\/forge\/device-bindings\/[^/]+$/)) {
    const id = decodeURIComponent(path.split('/').pop())
    const index = forgeDeviceBindings.findIndex((item) => item.bindingId === id)
    if (index < 0) return send(res, 404, { detail: 'device binding not found' })
    if (req.method === 'PATCH') {
      const body = await readBody(req)
      validateForgeDeviceBinding({ ...forgeDeviceBindings[index], ...body }, id)
      forgeDeviceBindings[index] = { ...forgeDeviceBindings[index], ...body, updatedAt: businessNow() }
      saveBusinessData()
      return send(res, 200, forgeDeviceBindings[index])
    }
    if (req.method === 'DELETE') {
      const [removed] = forgeDeviceBindings.splice(index, 1)
      forgeLog(removed.forgeCenterId, removed.edgeDeviceName || removed.cameraName || '', 'unbind_device', 'success', `${removed.projectId}${removed.scenario ? ` / ${removed.scenario}` : ''}`)
      saveBusinessData()
      return send(res, 200, { ok: true })
    }
  }
  if (path === '/api/admin/forge/sample-policies') {
    if (req.method === 'GET') return send(res, 200, forgeSamplePolicies)
    if (req.method === 'POST') {
      const body = await readBody(req)
      const customer = forgeCustomerById(body.customerId)
      const project = forgeProjectById(body.projectId)
      const item = { ...body, policyId: body.policyId || `fsp-${Date.now()}`, customerName: customer?.customer_name || '', projectName: project?.site_name || '', allowSampleUpload: body.allowSampleUpload !== false, allowTraining: body.allowTraining !== false, allowPlatformDataset: Boolean(body.allowPlatformDataset), requirePrivacyMask: body.requirePrivacyMask !== false, allowCloudVlmPrelabel: Boolean(body.allowCloudVlmPrelabel), allowLocalTraining: body.allowLocalTraining !== false, retentionDays: Number(body.retentionDays || 90), dataUsageScope: body.dataUsageScope || 'customer_only', consentStatus: body.consentStatus || 'pending', effectiveAt: body.effectiveAt || businessNow(), expiredAt: body.expiredAt || '', createdAt: businessNow(), updatedAt: businessNow(), updatedBy: 'platform_super_admin', remark: body.remark || '' }
      forgeSamplePolicies.unshift(item)
      saveBusinessData()
      return send(res, 200, item)
    }
  }
  if (path.match(/^\/api\/admin\/forge\/sample-policies\/[^/]+$/)) {
    const id = decodeURIComponent(path.split('/').pop())
    const index = forgeSamplePolicies.findIndex((item) => item.policyId === id)
    if (index < 0) return send(res, 404, { detail: 'sample policy not found' })
    if (req.method === 'GET') return send(res, 200, forgeSamplePolicies[index])
    if (req.method === 'PATCH') {
      const body = await readBody(req)
      forgeSamplePolicies[index] = { ...forgeSamplePolicies[index], ...body, updatedAt: businessNow(), updatedBy: 'platform_super_admin' }
      saveBusinessData()
      return send(res, 200, forgeSamplePolicies[index])
    }
  }
  if (path === '/api/admin/forge/model-versions') {
    if (req.method === 'GET') return send(res, 200, forgeModelVersions)
    if (req.method === 'POST') {
      const body = await readBody(req)
      validateForgeModelVersion(body)
      const center = forgeCenterById(body.forgeCenterId)
      const item = { ...body, modelVersionId: body.modelVersionId || `fmv-${Date.now()}`, forgeCenterName: body.forgeCenterName || center?.forgeCenterName || '', status: body.status || 'draft', isRecommended: Boolean(body.isRecommended), createdAt: businessNow(), createdBy: 'platform_super_admin' }
      forgeModelVersions.unshift(item)
      saveBusinessData()
      return send(res, 200, item)
    }
  }
  if (path.match(/^\/api\/admin\/forge\/model-versions\/[^/]+\/archive$/) && req.method === 'POST') {
    const id = decodeURIComponent(path.split('/').at(-2))
    const model = forgeModelVersions.find((item) => item.modelVersionId === id)
    if (!model) return send(res, 404, { detail: 'model not found' })
    model.status = 'archived'
    saveBusinessData()
    return send(res, 200, model)
  }
  if (path.match(/^\/api\/admin\/forge\/model-versions\/[^/]+\/mark-recommended$/) && req.method === 'POST') {
    const id = decodeURIComponent(path.split('/').at(-2))
    const model = forgeModelVersions.find((item) => item.modelVersionId === id)
    if (!model) return send(res, 404, { detail: 'model not found' })
    forgeModelVersions = forgeModelVersions.map((item) => ({ ...item, isRecommended: item.modelVersionId === id ? true : item.isRecommended && item.sceneCode !== model.sceneCode }))
    saveBusinessData()
    return send(res, 200, forgeModelVersions.find((item) => item.modelVersionId === id))
  }
  if (path.match(/^\/api\/admin\/forge\/model-versions\/[^/]+$/)) {
    const id = decodeURIComponent(path.split('/').pop())
    const index = forgeModelVersions.findIndex((item) => item.modelVersionId === id)
    if (index < 0) return send(res, 404, { detail: 'model not found' })
    if (req.method === 'GET') return send(res, 200, forgeModelVersions[index])
    if (req.method === 'PATCH') {
      const body = await readBody(req)
      validateForgeModelVersion({ ...forgeModelVersions[index], ...body })
      forgeModelVersions[index] = { ...forgeModelVersions[index], ...body }
      saveBusinessData()
      return send(res, 200, forgeModelVersions[index])
    }
  }
  if (path.match(/^\/api\/admin\/forge-nodes\/[^/]+\/model-versions$/) && req.method === 'POST') {
    const forgeCenterId = decodeURIComponent(path.split('/').at(-2))
    const body = await readBody(req)
    validateForgeModelVersion({ ...body, forgeCenterId })
    const center = forgeCenterById(forgeCenterId)
    const item = { ...body, modelVersionId: body.modelVersionId || `fmv-node-${Date.now()}`, forgeCenterId, forgeCenterName: center?.forgeCenterName || '', createdAt: businessNow(), createdBy: forgeCenterId, status: body.status || 'evaluated' }
    forgeModelVersions.unshift(item)
    forgeLog(forgeCenterId, center?.forgeCenterName || '', 'model_version_upload', 'success', body.modelName || item.modelVersionId, item.version || '')
    saveBusinessData()
    return send(res, 200, item)
  }
  if (path === '/api/admin/forge/release-approvals') {
    if (req.method === 'GET') return send(res, 200, forgeReleaseApprovals)
    if (req.method === 'POST') {
      const body = await readBody(req)
      const validationResult = validateForgeRelease(body)
      const model = forgeModelVersions.find((item) => item.modelVersionId === body.modelVersionId)
      const targetProjectIds = body.targetProjectIds?.length ? body.targetProjectIds : [body.targetProjectId || body.projectId || model.projectId].filter(Boolean)
      const item = { ...body, targetProjectIds, approvalId: body.approvalId || `fra-${Date.now()}`, modelName: model.modelName, modelVersion: model.version, sourceType: model.sourceType, forgeCenterId: model.forgeCenterId, customerId: body.targetCustomerId || body.customerId || model.customerId, projectId: body.targetProjectId || body.projectId || model.projectId, approvalStatus: 'pending', requestedBy: 'platform_super_admin', requestedAt: businessNow(), approvedBy: '', approvedAt: '', rejectReason: '', validationResult, remark: body.remark || '' }
      forgeReleaseApprovals.unshift(item)
      model.status = 'pending_release'
      saveBusinessData()
      return send(res, 200, item)
    }
  }
  if (path.match(/^\/api\/admin\/forge\/release-approvals\/[^/]+$/) && req.method === 'GET') {
    const item = forgeReleaseApprovals.find((row) => row.approvalId === decodeURIComponent(path.split('/').pop()))
    return item ? send(res, 200, item) : send(res, 404, { detail: 'approval not found' })
  }
  if (path.match(/^\/api\/admin\/forge\/release-approvals\/[^/]+\/(approve|reject|cancel)$/) && req.method === 'POST') {
    const id = decodeURIComponent(path.split('/').at(-2))
    const action = path.split('/').pop()
    const body = await readBody(req)
    const approval = forgeReleaseApprovals.find((item) => item.approvalId === id)
    if (!approval) return send(res, 404, { detail: 'approval not found' })
    if (action === 'approve') {
      approval.approvalStatus = 'approved'
      approval.approvedBy = 'platform_super_admin'
      approval.approvedAt = businessNow()
      const releaseStatus = approval.releaseType === 'gray' ? 'gray_released' : 'released'
      const model = forgeModelVersions.find((item) => item.modelVersionId === approval.modelVersionId)
      if (model) model.status = releaseStatus
      forgeReleases.unshift({ releaseId: `fr-${Date.now()}`, approvalId: approval.approvalId, modelVersionId: approval.modelVersionId, modelName: approval.modelName, version: approval.modelVersion, sourceType: approval.sourceType, forgeCenterId: approval.forgeCenterId, customerId: approval.customerId, projectId: approval.projectId, releaseScope: approval.releaseScope, targetDeviceIds: approval.targetDeviceIds || [], targetCameraIds: approval.targetCameraIds || [], releaseType: approval.releaseType, releaseStatus: 'success', releasedAt: businessNow(), releasedBy: 'platform_super_admin', rollbackFromReleaseId: '', rollbackToModelVersionId: '', remark: approval.remark || '' })
    } else if (action === 'reject') {
      approval.approvalStatus = 'rejected'
      approval.rejectReason = body.rejectReason || '审批驳回'
    } else {
      approval.approvalStatus = 'cancelled'
    }
    saveBusinessData()
    return send(res, 200, approval)
  }
  if (path === '/api/admin/forge/releases') {
    if (req.method === 'GET') return send(res, 200, forgeReleases)
    if (req.method === 'POST') {
      const body = await readBody(req)
      const item = { ...body, releaseId: body.releaseId || `fr-${Date.now()}`, releaseStatus: body.releaseStatus || 'pending', releasedAt: body.releasedAt || businessNow(), releasedBy: 'platform_super_admin' }
      forgeReleases.unshift(item)
      saveBusinessData()
      return send(res, 200, item)
    }
  }
  if (path.match(/^\/api\/admin\/forge\/releases\/[^/]+\/rollback$/) && req.method === 'POST') {
    const id = decodeURIComponent(path.split('/').at(-2))
    const body = await readBody(req)
    const release = forgeReleases.find((item) => item.releaseId === id)
    if (!release) return send(res, 404, { detail: 'release not found' })
    release.releaseStatus = 'rollbacked'
    const rollback = { ...release, releaseId: `fr-rollback-${Date.now()}`, releaseType: 'rollback', releaseStatus: 'success', rollbackFromReleaseId: id, rollbackToModelVersionId: body.rollbackToModelVersionId || '', releasedAt: businessNow(), remark: body.remark || '回滚记录' }
    forgeReleases.unshift(rollback)
    saveBusinessData()
    return send(res, 200, rollback)
  }
  if (path.match(/^\/api\/admin\/forge\/releases\/[^/]+$/) && req.method === 'GET') {
    const item = forgeReleases.find((row) => row.releaseId === decodeURIComponent(path.split('/').pop()))
    return item ? send(res, 200, item) : send(res, 404, { detail: 'release not found' })
  }
  if (path === '/api/admin/forge/heartbeats') return send(res, 200, forgeHeartbeats.map((item) => ({ ...item, nodeStatus: Date.now() - new Date(item.reportedAt).getTime() > 5 * 60000 ? 'offline' : item.nodeStatus })))
  if (path.match(/^\/api\/admin\/forge\/centers\/[^/]+\/heartbeats$/)) {
    const forgeCenterId = decodeURIComponent(path.split('/').at(-2))
    return send(res, 200, forgeHeartbeats.filter((item) => item.forgeCenterId === forgeCenterId))
  }
  if (path.match(/^\/api\/admin\/forge-nodes\/[^/]+\/heartbeat$/) && req.method === 'POST') {
    const forgeCenterId = decodeURIComponent(path.split('/').at(-2))
    const body = await readBody(req)
    const center = forgeCenterById(forgeCenterId)
    if (!center) return send(res, 404, { detail: 'forge center not found' })
    center.status = body.status === 'error' ? 'error' : 'active'
    center.lastHeartbeatAt = body.reportedAt || businessNow()
    center.tailscaleIp = body.tailscaleIp || center.tailscaleIp
    center.version = body.version || center.version
    const item = { heartbeatId: `fhb-${Date.now()}`, forgeCenterId, forgeCenterName: center.forgeCenterName, nodeStatus: body.status || 'online', ip: body.ip || '', tailscaleIp: body.tailscaleIp || '', gpuModel: body.gpuModel || '', gpuMemoryTotal: body.gpuMemoryTotal || '', gpuMemoryUsed: body.gpuMemoryUsed || '', cpuUsage: body.cpuUsage || 0, memoryUsage: body.memoryUsage || 0, diskTotal: body.diskTotal || '', diskUsed: body.diskUsed || '', currentTrainingJobs: body.currentTrainingJobs || 0, sampleCount: body.sampleCount || 0, lastError: body.lastError || '', version: body.version || '', reportedAt: body.reportedAt || businessNow() }
    forgeHeartbeats.unshift(item)
    forgeLog(forgeCenterId, center.forgeCenterName, 'heartbeat', 'success', item.nodeStatus, `samples=${item.sampleCount}`)
    saveBusinessData()
    return send(res, 200, { ok: true, heartbeat: item })
  }
  if (path.match(/^\/api\/admin\/forge-nodes\/[^/]+\/sync-data$/) && req.method === 'GET') {
    const forgeCenterId = decodeURIComponent(path.split('/').at(-2))
    const data = forgeSyncData(forgeCenterId)
    return data ? send(res, 200, data) : send(res, 404, { detail: 'forge center not found' })
  }
  if (path === '/api/admin/forge/sync-logs') return send(res, 200, forgeSyncLogs)
  if (path === '/api/access/roles') return send(res, 200, {
    roles: [
      { role: 'platform_super_admin', domain: 'platform', can: ['manage_customers', 'manage_contracts', 'manage_global_templates', 'publish_models', 'view_platform_capacity', 'view_platform_audit', 'impersonate_customer_admin'], cannot: ['operate_customer_alarm', 'edit_customer_camera_binding_in_platform_domain'] },
      { role: 'customer_admin', domain: 'customer', can: ['manage_sites', 'manage_devices', 'manage_cameras', 'manage_camera_bindings', 'view_l1_l2', 'operate_alarms', 'configure_learning_policy'], cannot: ['manage_other_customers', 'edit_global_templates', 'publish_platform_models'] },
      { role: 'operator', domain: 'customer', can: ['connect_streams', 'draw_roi', 'run_video_parse', 'view_logs'], cannot: ['edit_contracts', 'publish_models', 'change_customer_data_policy'] },
    ],
  })
  if (path === '/api/ai-lifecycle/summary') return send(res, 200, lifecycleSummary())
  if (path.match(/^\/api\/ai-center\/material-pool\/[^/]+$/) && req.method === 'GET') {
    const sampleId = decodeURIComponent(path.split('/').at(-1))
    const item = materialPoolForQuery(url).find((row) => row.sample_id === sampleId || row.forge_sample_id === sampleId)
    return item ? send(res, 200, item) : send(res, 404, { detail: '素材不存在' })
  }
  if (path === '/api/ai-center/material-pool') {
    return send(res, 200, url.searchParams.get('summary') === '1' ? forgeMaterialPage(url) : materialPoolForQuery(url))
  }
  if (path === '/api/ai-center/vlm-audits') return send(res, 200, vlmAudits(materialPoolForQuery(url)))
  if (path === '/api/ai-center/missed-candidates') return send(res, 200, missedCandidateSummary(materialPoolForQuery(url)))
  if (path === '/api/ai-center/learning-cycles') return send(res, 200, mockLearningCycles(url.searchParams.get('scope') || '', url.searchParams.get('customer_id') || 'cust-demo-001', url.searchParams.get('scenario') || ''))
  if (path === '/api/ai-center/trial-report') {
    const scope = url.searchParams.get('scope') || 'customer_optimized'
    const pool = materialPoolForQuery(url)
    const customerId = url.searchParams.get('customer_id') || 'cust-demo-001'
    const cycles = mockLearningCycles(scope, customerId, url.searchParams.get('scenario') || '')
    const platform = scope === 'platform_baseline'
    const candidateCount = lifecycleRegistry('models').filter((item) => item.status === 'candidate' && (platform ? item.scope === 'platform' : item.customer_id === customerId)).length
    return send(res, 200, {
      customer_id: platform ? 'platform_all_authorized_customers' : customerId,
      site_id: platform ? 'all_authorized_sites' : (url.searchParams.get('site_id') || 'site_001'),
      scope,
      trial_period: platform ? '2026-06 platform baseline cycle' : '2026-06 customer demo',
      camera_count: platform ? new Set(pool.map((item) => `${item.customer_id}:${item.camera_id}`)).size : 3,
      scenarios: ['ev_intrusion', 'fire_lane', 'person_intrusion', 'trash_overflow'],
      material_total: pool.length,
      edge_alarm_count: pool.filter((item) => item.source_type === 'l1_l2_alarm').length,
      escaped_false_positive_count: pool.filter((item) => item.sample_category === 'escaped_false_positive').length,
      confirmed_missed_event_count: pool.filter((item) => item.sample_category === 'confirmed_missed_event').length,
      confirmed_hard_negative_count: pool.filter((item) => item.sample_category === 'confirmed_hard_negative').length,
      vlm_audit_count: vlmAudits(pool).filter((item) => item.audit_status === 'completed').length,
      human_review_count: pool.filter((item) => item.sample_judgement.human.status !== 'pending').length,
      learning_cycle_count: cycles.length,
      candidate_model_count: candidateCount,
      false_alarm_reduction: platform ? '28.0%' : '34.6%',
      recall_improvement: platform ? '4.1%' : '5.2%',
      recommendation: platform ? '建议进入平台基线候选模型评估，先灰度到授权客户测试设备' : '建议进入正式商用，并扩大到电梯厅和危险区域摄像头',
      next_steps: platform ? ['扩大授权客户素材覆盖', '补齐平台 missed_event 抽检', '训练平台 L1/L2 新基线候选'] : ['增加真实小区摄像头接入', '扩大 missed_event 抽检', '针对 escaped_false_positive 做 hard negative 训练'],
      generated_at: businessNow(),
    })
  }
  if (req.method === 'POST' && path === '/api/ai-lifecycle/forge-samples/ingest') {
    if (!forgeIngestTokenValid(req)) return send(res, 401, { ok: false, detail: 'Forge 同步凭证无效' })
    const result = ingestForgeSample(await readBody(req))
    return send(res, result.status, result.ok ? { ok: true, created: result.created, sample: result.sample } : { ok: false, detail: result.detail })
  }
  if (path === '/api/samples') {
    const customerId = url.searchParams.get('customer_id')
    const privacyStatus = url.searchParams.get('privacy_status')
    const labelStatus = url.searchParams.get('label_status')
    return send(res, 200, lifecycleRegistry('samples').map(normalizeLegacyCloudSample).filter((item) => (!customerId || item.customer_id === customerId) && (!privacyStatus || item.privacy_status === privacyStatus) && (!labelStatus || item.label_status === labelStatus)).map(enrichSample))
  }
  if (path.match(/^\/api\/samples\/[^/]+$/) && req.method === 'PUT') {
    const sampleId = decodeURIComponent(path.split('/').pop())
    const body = await readBody(req)
    let updated
    const samples = lifecycleRegistry('samples').map((item) => {
      if (item.sample_id !== sampleId) return item
      updated = enrichSample({ ...item, ...body, updated_at: businessNow() })
      return updated
    })
    if (!updated) return send(res, 404, { detail: 'sample not found' })
    writeLifecycleRegistry('samples', samples)
    updateTrainingCycleCounts(updated.cycle_id)
    appendLifecycleAudit('update_sample', { customer_id: updated.customer_id, sample_id: sampleId, changes: body })
    return send(res, 200, updated)
  }
  if (path.match(/^\/api\/samples\/[^/]+\/frame$/)) {
    const sampleId = decodeURIComponent(path.split('/').at(-2))
    const sample = lifecycleRegistry('samples').find((item) => item.sample_id === sampleId)
    const framePath = runtimeFilePath(sample?.frame_path || '')
    if (!framePath || !existsSync(framePath)) return send(res, 404, { detail: 'sample frame not found' })
    return sendBytes(res, 200, readFileSync(framePath), 'image/jpeg')
  }
  if (path.match(/^\/api\/snapshots\/test[123]\.jpg$/)) {
    const name = path.split('/').pop()?.replace('.jpg', '') || 'test1'
    const videoPath = resolve(repoRoot, `${name}.mp4`)
    const bytes = runBuffer('ffmpeg', ['-v', 'error', '-i', videoPath, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'])
    if (!bytes.length) return send(res, 404, { detail: 'snapshot not available' })
    return sendBytes(res, 200, bytes, 'image/jpeg')
  }
  if (path === '/api/camera-snapshot') {
    const cameraId = url.searchParams.get('camera_id') || ''
    const directRtspUrl = url.searchParams.get('rtsp_url') || ''
    const camera = cameras.find((item) => item.camera_id === cameraId)
    const rtspUrl = camera?.rtsp_url || directRtspUrl
    if (!rtspUrl) return send(res, 400, { detail: 'camera_id or rtsp_url required' })
    const bytes = kkosCameraSnapshotBytes(rtspUrl)
    if (!bytes.length) return send(res, 502, { detail: 'camera snapshot not available from KKOS' })
    return sendBytes(res, 200, bytes, 'image/jpeg')
  }
  if (path === '/api/camera-live/mjpeg') {
    const cameraId = url.searchParams.get('camera_id') || ''
    const directRtspUrl = url.searchParams.get('rtsp_url') || ''
    const camera = cameras.find((item) => item.camera_id === cameraId)
    const rtspUrl = camera?.rtsp_url || directRtspUrl
    return streamKkosCameraMjpeg(res, rtspUrl)
  }
  if (path === '/api/datasets') {
    const scope = url.searchParams.get('scope')
    const customerId = url.searchParams.get('customer_id')
    return send(res, 200, lifecycleRegistry('datasets').filter((item) => (!scope || item.scope === scope) && (!customerId || item.customer_id === customerId)))
  }
  if (path === '/api/training-runs') {
    const scope = url.searchParams.get('scope')
    const customerId = url.searchParams.get('customer_id')
    return send(res, 200, lifecycleRegistry('training_runs').filter((item) => (!scope || item.scope === scope) && (!customerId || item.customer_id === customerId)))
  }
  if (path === '/api/training-cycles') {
    const customerId = url.searchParams.get('customer_id')
    if (req.method === 'GET') return send(res, 200, lifecycleRegistry('training_cycles').filter((item) => !customerId || item.customer_id === customerId).map(normalizeCycle))
    if (req.method === 'POST') {
      const body = await readBody(req)
      const { customerId, scenario, siteId } = inferLifecycleContext(body)
      const cycle = normalizeCycle({
        cycle_id: body.cycle_id || `${customerId}_${siteId}_${scenario}_${new Date().toISOString().slice(0, 10).replaceAll('-', '_')}`,
        customer_id: customerId,
        site_id: siteId,
        scenario,
        source_type: body.source_type || 'manual_learning_cycle',
        sources: body.sources || [],
        status: body.status || 'draft',
        sample_target: Number(body.sample_target || 30),
        sample_count: 0,
        privacy_processed_count: 0,
        auto_labeled_count: 0,
        human_reviewed_count: 0,
        dataset_version: '',
        cycle_goal: body.cycle_goal || defaultCycleGoals[scenario] || defaultCycleGoals.multi_scenario,
        started_at: '',
        finished_at: '',
        created_at: businessNow(),
        updated_at: businessNow(),
      })
      const cycles = lifecycleRegistry('training_cycles')
      writeLifecycleRegistry('training_cycles', [cycle, ...cycles.filter((item) => item.cycle_id !== cycle.cycle_id)])
      appendLifecycleAudit('create_training_cycle', { customer_id: customerId, cycle_id: cycle.cycle_id, scenario })
      return send(res, 200, cycle)
    }
  }
  if (path === '/api/training-cycles/availability') {
    const customerId = url.searchParams.get('customer_id') || 'cust-demo-001'
    const cycleId = url.searchParams.get('cycle_id') || ''
    const scenario = url.searchParams.get('scenario') || ''
    return send(res, 200, cycleAvailability(customerId, cycleId, scenario))
  }
  if (path === '/api/trial-optimization-report') {
    const customerId = url.searchParams.get('customer_id') || 'cust-demo-001'
    const cycleId = url.searchParams.get('cycle_id') || ''
    return send(res, 200, trialOptimizationReport(customerId, cycleId))
  }
  if (req.method === 'POST' && path === '/api/ai-lifecycle/samples/manual-add') {
    const body = await readBody(req)
    const { customerId, scenario, siteId } = inferLifecycleContext(body)
    const cycleId = body.cycle_id || ''
    const sample = enrichSample({
      sample_id: body.sample_id || lifecycleId('sample'),
      customer_id: customerId,
      site_id: siteId,
      camera_id: body.camera_id || 'manual_camera',
      scenario,
      cycle_id: cycleId,
      source_event_id: body.source_event_id || '',
      sample_type: body.sample_type || 'missed_event',
      privacy_status: body.privacy_status || 'raw_local',
      training_scope: body.training_scope || 'customer',
      label_status: body.label_status || 'unlabeled',
      frame_path: body.frame_path || resolve(repoRoot, 'test_frames/elevator_01.jpg'),
      clip_path: body.clip_path || '',
      metadata_path: '',
      source_note: body.source_note || '人工补录漏报/客户反馈样本',
      teacher_model: '',
      created_at: businessNow(),
      updated_at: businessNow(),
    })
    const samples = lifecycleRegistry('samples')
    writeLifecycleRegistry('samples', [sample, ...samples])
    updateTrainingCycleCounts(cycleId)
    appendLifecycleAudit('manual_add_sample', { customer_id: customerId, cycle_id: cycleId, sample_id: sample.sample_id, sample_type: sample.sample_type })
    return send(res, 200, sample)
  }
  if (path === '/api/evaluations') {
    const modelId = url.searchParams.get('model_id')
    return send(res, 200, lifecycleRegistry('evaluation_reports').filter((item) => !modelId || item.candidate_model === modelId || item.current_model === modelId))
  }
  if (path === '/api/rollouts') return send(res, 200, lifecycleRegistry('rollouts').map(normalizeRollout))
  if (path === '/api/audit-logs') {
    const customerId = url.searchParams.get('customer_id')
    const action = url.searchParams.get('action')
    return send(res, 200, lifecycleRegistry('audit_logs').filter((item) => (!customerId || item.customer_id === customerId) && (!action || item.action === action)))
  }
  if (path.match(/^\/api\/customers\/[^/]+\/data-policy$/)) {
    const customerId = decodeURIComponent(path.split('/').at(-2))
    const policies = lifecycleRegistry('data_policies')
    if (req.method === 'GET') return send(res, 200, dataPolicyForCustomer(customerId))
    if (req.method === 'PUT') {
      const body = await readBody(req)
      const next = normalizeDataPolicy(customerId, body)
      const merged = policies.some((item) => item.customer_id === customerId) ? policies.map((item) => item.customer_id === customerId ? next : item) : [...policies, next]
      writeFileSync(resolve(lifecycleRegistryDir, 'data_policies.json'), `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
      const customer = customers.find((item) => item.customer_id === customerId)
      if (customer) {
        customer.data_policy = next
        customer.updated_at = businessNow()
      }
      appendLifecycleAudit('update_data_policy', { customer_id: customerId, data_policy: next })
      return send(res, 200, next)
    }
  }
  if (req.method === 'POST' && path === '/api/ai-lifecycle/privacy-process') {
    // Privacy must happen at KKOS before any image leaves the site.  The old
    // cloud-side mock simply flipped a status to "processed"; do not allow it
    // to certify either raw or historical cropped images.
    return send(res, 409, { ok: false, detail: '云端不执行脱敏。请由 KKOS 输出“完整桌面 ROI + 本地脱敏”素材后自动同步。' })
  }
  if (req.method === 'POST' && path === '/api/ai-lifecycle/auto-label') {
    const body = await readBody(req)
    const { customerId, scenario } = inferLifecycleContext(body)
    const policy = lifecycleRegistry('data_policies').find((item) => item.customer_id === customerId)
    if (policy && policy.allow_auto_labeling === false) return send(res, 403, { detail: '该客户未授权自动标注' })
    let changed = 0
    const samples = lifecycleRegistry('samples').map((item) => {
      if (item.customer_id !== customerId) return item
      if (scenario && item.scenario !== scenario) return item
      if (item.privacy_status !== 'privacy_processed') return item
      if (!['unlabeled', 'need_review', ''].includes(item.label_status || '')) return item
      changed += 1
      return {
        ...item,
        label_status: policy?.require_human_review === false ? 'auto_labeled' : 'need_review',
        teacher_model: item.scenario === 'person_intrusion' ? 'yolov8n_l2_teacher_640' : 'grounding_dino_v1',
        teacher_type: item.scenario === 'person_intrusion' ? 'yolo_detector' : 'open_vocabulary_detector',
        teacher_confidence: item.teacher_confidence || 0.78,
        label_source: 'auto_label',
        needs_review_reason: policy?.require_human_review === false ? '' : 'require_human_review',
        updated_at: businessNow(),
      }
    })
    writeLifecycleRegistry('samples', samples)
    for (const cycleId of [...new Set(samples.filter((item) => item.customer_id === customerId).map((item) => item.cycle_id).filter(Boolean))]) updateTrainingCycleCounts(cycleId)
    appendLifecycleAudit('auto_label', { customer_id: customerId, scenario, changed })
    return send(res, 200, { ok: true, changed, message: `已自动标注 ${changed} 条样本` })
  }
  if (req.method === 'POST' && path.startsWith('/api/ai-lifecycle/human-review/')) {
    const body = await readBody(req)
    const action = path.split('/').pop()
    const sampleId = body.sample_id || body.sampleId
    const labelByAction = {
      'confirm-positive': 'confirmed_positive',
      'confirm-hard-negative': 'confirmed_hard_negative',
      'confirm-boundary': 'confirmed_boundary',
    }
    const nextType = labelByAction[action] || 'rejected'
    let target
    const samples = lifecycleRegistry('samples').map((item) => {
      if (sampleId && item.sample_id !== sampleId) return item
      if (!sampleId && item.customer_id !== body.customer_id) return item
      if (!sampleId && body.scenario && item.scenario !== body.scenario) return item
      if (!sampleId && item.label_status !== 'need_review') return item
      if (!target) target = item
      return {
        ...item,
        sample_type: nextType,
        label_status: 'human_reviewed',
        business_review: { reviewer_role: 'customer_admin', decision: nextType, reviewed_at: businessNow() },
        label_review: { reviewer_role: 'guardian_algorithm_ops', decision: nextType, bbox_ok: true, class_ok: true, reviewed_at: businessNow() },
        label_source: 'human_review',
        needs_review_reason: '',
        updated_at: businessNow(),
      }
    })
    writeLifecycleRegistry('samples', samples)
    for (const cycleId of [...new Set(samples.filter((item) => item.customer_id === (target?.customer_id || body.customer_id)).map((item) => item.cycle_id).filter(Boolean))]) updateTrainingCycleCounts(cycleId)
    const reviews = lifecycleRegistry('human_reviews')
    if (target) {
      reviews.unshift({
        review_id: lifecycleId('review'),
        sample_id: target.sample_id,
        customer_id: target.customer_id,
        scenario: target.scenario,
        decision: nextType,
        reviewer: 'platform_super_admin',
        created_at: businessNow(),
      })
      writeLifecycleRegistry('human_reviews', reviews)
    }
    appendLifecycleAudit(`human_review_${action}`, { customer_id: target?.customer_id || body.customer_id || '', sample_id: sampleId || target?.sample_id || '' })
    return send(res, 200, { ok: true, sample: target, decision: nextType })
  }
  if (req.method === 'POST' && path === '/api/ai-lifecycle/datasets/build-customer') {
    const body = await readBody(req)
    const { customerId, scenario } = inferLifecycleContext(body)
    const policy = lifecycleRegistry('data_policies').find((item) => item.customer_id === customerId)
    if (policy && policy.allow_customer_model_training === false) return send(res, 403, { detail: '该客户未授权客户模型训练' })
    const samples = lifecycleRegistry('samples').map(enrichSample).filter((item) => item.customer_id === customerId && (!scenario || item.scenario === scenario) && item.can_customer_train)
    const datasets = lifecycleRegistry('datasets')
    const version = body.dataset_version || `${customerId}_${scenario}_v${String(datasets.length + 1).padStart(3, '0')}`
    const item = { scope: 'customer', customer_id: customerId, site_id: body.site_id || '', cycle_id: body.cycle_id || '', scenario, dataset_version: version, path: '', sample_count: samples.length, samples: samples.map((s) => s.sample_id), created_at: businessNow() }
    writeLifecycleRegistry('datasets', [item, ...datasets])
    if (body.cycle_id) {
      const cycles = lifecycleRegistry('training_cycles').map((cycle) => cycle.cycle_id === body.cycle_id ? { ...cycle, status: 'dataset_ready', dataset_version: version, updated_at: businessNow() } : cycle)
      writeLifecycleRegistry('training_cycles', cycles)
    }
    appendLifecycleAudit('build_customer_dataset', { customer_id: customerId, scenario, dataset_version: version, sample_count: samples.length })
    return send(res, 200, item)
  }
  if (req.method === 'POST' && path === '/api/ai-lifecycle/training/start') {
    const body = await readBody(req)
    const { customerId, scenario } = inferLifecycleContext(body)
    const datasets = lifecycleRegistry('datasets').filter((item) => item.scope === 'customer' && item.customer_id === customerId && (!scenario || item.scenario === scenario || !item.scenario))
    const latestDataset = body.dataset_version || datasets[0]?.dataset_version || `${customerId}_${scenario}_v001`
    const runs = lifecycleRegistry('training_runs')
    const run = {
      train_run_id: lifecycleId('train'),
      scope: 'customer',
      customer_id: customerId,
      site_id: body.site_id || '',
      scenario,
      dataset_version: latestDataset,
      base_model_id: body.base_model_id || 'guardian_l1_base_v001',
      model_type: body.model_type || 'l1',
      target_device: body.target_device || 'rv1126',
      imgsz: body.imgsz || 416,
      epochs: body.epochs || 80,
      status: 'finished',
      output_model_id: `${customerId}_${scenario}_l1_candidate_${Date.now().toString(16).slice(-4)}`,
      train_command: `yolo detect train model=guardian_l1_base_v001 data=${latestDataset} imgsz=416 epochs=80`,
      started_at: businessNow(),
      finished_at: businessNow(),
    }
    writeLifecycleRegistry('training_runs', [run, ...runs])
    const models = lifecycleRegistry('models')
    models.unshift({
      model_id: run.output_model_id,
      scope: 'customer',
      customer_id: customerId,
      site_id: body.site_id || '',
      scenario,
      model_type: run.model_type,
      target_device: run.target_device,
      base_model: run.base_model_id,
      derived_from: run.base_model_id,
      dataset_version: latestDataset,
      format: ['pt', 'onnx', 'rknn'],
      artifact_paths: {},
      status: 'candidate',
      default_for_new_customer: false,
      created_at: businessNow(),
      updated_at: businessNow(),
    })
    writeLifecycleRegistry('models', models)
    appendLifecycleAudit('start_training', { customer_id: customerId, scenario, train_run_id: run.train_run_id, output_model_id: run.output_model_id })
    return send(res, 200, run)
  }
  if (req.method === 'POST' && path === '/api/ai-lifecycle/evaluation/run') {
    const body = await readBody(req)
    const { customerId } = inferLifecycleContext(body)
    const models = lifecycleRegistry('models')
    const candidate = body.candidate_model || models.find((m) => m.customer_id === customerId && m.status === 'candidate')?.model_id || 'candidate_model'
    const current = body.current_model || models.find((m) => m.customer_id === customerId && m.status === 'active')?.model_id || 'active_model'
    const reports = lifecycleRegistry('evaluation_reports')
    const report = {
      evaluation_id: lifecycleId('eval'),
      candidate_model: candidate,
      current_model: current,
      scope: 'customer',
      customer_id: customerId,
      metrics: {
        current_false_alarm_rate: 0.124,
        candidate_false_alarm_rate: 0.081,
        false_alarm_delta: -0.346,
        current_hard_negative_fp: 31,
        candidate_hard_negative_fp: 18,
        hard_negative_fp_delta: -0.419,
        current_recall: 0.912,
        candidate_recall: 0.925,
        recall_delta: 0.013,
        current_latency_ms: 42,
        candidate_latency_ms: 45,
        latency_increase_percent: 7.1,
        map50_delta: 0.014,
        rknn_convert_ok: true,
        cma_error: 0,
      },
      decision: 'pass',
      recommendation: '建议灰度',
      fail_reasons: [],
      created_at: businessNow(),
    }
    writeLifecycleRegistry('evaluation_reports', [report, ...reports])
    appendLifecycleAudit('run_evaluation', { customer_id: customerId, candidate_model: candidate, decision: report.decision })
    return send(res, 200, report)
  }
  if (req.method === 'POST' && path === '/api/ai-lifecycle/rollout/approve') {
    const body = await readBody(req)
    const { customerId } = inferLifecycleContext(body)
    const rollouts = lifecycleRegistry('rollouts').map(normalizeRollout)
    const modelId = body.model_id || lifecycleRegistry('models').find((m) => m.customer_id === customerId && m.status === 'candidate')?.model_id || 'candidate_model'
    const existing = rollouts.find((r) => r.model_id === modelId)
    const nextStatus = existing?.status === 'stage_1' ? 'stage_2' : existing?.status === 'stage_2' ? 'full_release' : 'stage_1'
    const defaultStages = [
      { stage: 'stage_1', devices: ['rv1126_01'], cameras: ['test3_camera'], scenario: body.scenario || 'person_intrusion', observe_window: '24h', status: 'running' },
      { stage: 'stage_2', devices: ['rv1126_01'], cameras: ['test1_camera', 'test2_camera', 'test3_camera'], scenario: body.scenario || 'person_intrusion', observe_window: '48h', status: 'waiting' },
      { stage: 'full', devices: ['rv1126_01'], cameras: ['all_customer_site_cameras'], scenario: body.scenario || 'person_intrusion', observe_window: '72h', status: 'waiting' },
    ]
    const updated = existing
      ? rollouts.map((r) => r.model_id === modelId ? { ...r, status: nextStatus, stages: (r.stages?.length ? r.stages : defaultStages).map((stage) => ({ ...stage, status: stage.stage === nextStatus ? 'running' : stage.status })), updated_at: businessNow() } : r)
      : [{ rollout_id: lifecycleId('rollout'), model_id: modelId, customer_id: customerId, rollback_model_id: body.rollback_model_id || '', status: 'stage_1', stages: defaultStages, created_at: businessNow(), updated_at: businessNow() }, ...rollouts]
    writeLifecycleRegistry('rollouts', updated)
    appendLifecycleAudit('approve_rollout', { customer_id: customerId, model_id: modelId, status: nextStatus })
    return send(res, 200, updated.find((r) => r.model_id === modelId))
  }
  if (req.method === 'POST' && path === '/api/ai-lifecycle/rollout/rollback') {
    const body = await readBody(req)
    const modelId = body.model_id
    const rollouts = lifecycleRegistry('rollouts').map((r) => (!modelId || r.model_id === modelId) ? { ...r, status: 'rolled_back', updated_at: businessNow() } : r)
    writeLifecycleRegistry('rollouts', rollouts)
    appendLifecycleAudit('rollback_rollout', { customer_id: body.customer_id || '', model_id: modelId || '' })
    return send(res, 200, { ok: true, model_id: modelId, status: 'rolled_back' })
  }
  if (path === '/api/customers') {
    if (req.method === 'GET') return send(res, 200, customerSummaries())
    if (req.method === 'POST') {
      const body = await readBody(req)
      const customerId = body.customer_id || `cust-${Date.now()}`
      const item = { ...body, customer_id: customerId, data_policy: normalizeDataPolicy(customerId, body.data_policy || {}), created_at: businessNow(), updated_at: businessNow() }
      customers.push(item)
      saveBusinessData()
      const policies = lifecycleRegistry('data_policies')
      writeLifecycleRegistry('data_policies', [...policies.filter((policy) => policy.customer_id !== customerId), item.data_policy])
      return send(res, 200, item)
    }
  }
  if (path.match(/^\/api\/customers\/[^/]+$/) && req.method === 'PUT') {
    const id = decodeURIComponent(path.split('/').pop())
    const body = await readBody(req)
    const index = customers.findIndex((item) => item.customer_id === id)
    const nextPolicy = body.data_policy ? normalizeDataPolicy(id, body.data_policy) : dataPolicyForCustomer(id)
    if (index < 0) {
      const created = { ...body, customer_id: id, customer_name: body.customer_name || id, data_policy: nextPolicy, created_at: businessNow(), updated_at: businessNow() }
      customers.push(created)
      saveBusinessData()
      const policies = lifecycleRegistry('data_policies')
      writeLifecycleRegistry('data_policies', [...policies.filter((policy) => policy.customer_id !== id), nextPolicy])
      return send(res, 200, created)
    }
    customers[index] = { ...customers[index], ...body, data_policy: nextPolicy, updated_at: businessNow() }
    saveBusinessData()
    const policies = lifecycleRegistry('data_policies')
    writeLifecycleRegistry('data_policies', [...policies.filter((policy) => policy.customer_id !== id), nextPolicy])
    return send(res, 200, customers[index])
  }
  if (path === '/api/sites') {
    if (req.method === 'GET') return send(res, 200, siteSummaries())
    if (req.method === 'POST') {
      const body = await readBody(req)
      const siteId = body.site_id || `site-${Date.now()}`
      const item = { ...body, site_id: siteId, timezone: body.timezone || 'Asia/Shanghai', status: body.status || 'planning', created_at: businessNow(), updated_at: businessNow() }
      sites.push(item)
      saveBusinessData()
      return send(res, 200, item)
    }
  }
  if (path.match(/^\/api\/sites\/[^/]+$/) && req.method === 'PUT') {
    const id = decodeURIComponent(path.split('/').pop())
    const body = await readBody(req)
    const index = sites.findIndex((item) => item.site_id === id)
    if (index < 0) {
      const created = { ...body, site_id: id, site_name: body.site_name || id, timezone: body.timezone || 'Asia/Shanghai', status: body.status || 'planning', created_at: businessNow(), updated_at: businessNow() }
      sites.push(created)
      saveBusinessData()
      return send(res, 200, created)
    }
    sites[index] = { ...sites[index], ...body, updated_at: businessNow() }
    saveBusinessData()
    return send(res, 200, sites[index])
  }
  if (path.match(/^\/api\/sites\/[^/]+\/notification-settings$/)) {
    const siteId = decodeURIComponent(path.split('/').at(-2))
    const site = sites.find((item) => item.site_id === siteId)
    if (!site) return send(res, 404, { detail: 'project not found' })
    const current = notificationSettingsForSite(siteId)
    if (req.method === 'GET') return send(res, 200, publicNotificationSettings(current))
    if (req.method === 'PUT') {
      const body = await readBody(req)
      const next = mergeNotificationSettings(siteId, body, current)
      const index = projectNotificationSettings.findIndex((item) => item.site_id === siteId)
      if (index >= 0) projectNotificationSettings[index] = next
      else projectNotificationSettings.push(next)
      saveBusinessData()
      return send(res, 200, publicNotificationSettings(next))
    }
  }
  if (path.match(/^\/api\/sites\/[^/]+\/notification-settings\/test$/) && req.method === 'POST') {
    const siteId = decodeURIComponent(path.split('/').at(-3))
    const site = sites.find((item) => item.site_id === siteId)
    if (!site) return send(res, 404, { detail: 'project not found' })
    const settings = notificationSettingsForSite(siteId)
    if (!settings.dingtalk?.enabled) return send(res, 400, { ok: false, message: '钉钉通知未启用' })
    if (settings.dingtalk?.mode !== 'custom_robot') {
      return send(res, 400, { ok: false, message: '企业内部应用模式已保存配置，测试发送将在互动卡片回调完成后启用。Demo 阶段建议先使用自定义群机器人。' })
    }
    try {
      const customer = customers.find((item) => item.customer_id === site.customer_id) || {}
      const result = await sendDingtalkWebhook(settings, {
        title: 'Guardian 钉钉告警测试',
        markdown: [
          '### Guardian 钉钉告警测试',
          `项目：${site.site_name || siteId}`,
          `客户：${customer.customer_name || site.customer_id || '-'}`,
          '',
          '这是一条测试消息。后续真实告警会携带图片、L1/L2 结果、Mage-VL 审计结果和处理按钮。',
        ].join('\n\n'),
      })
      return send(res, result.ok ? 200 : 502, result)
    } catch (error) {
      return send(res, 502, { ok: false, message: error.message || String(error) })
    }
  }
  if (path === '/api/managed-devices') {
    if (req.method === 'GET') return send(res, 200, managedDeviceSummaries())
    if (req.method === 'POST') {
      const body = await readBody(req)
      if (!canManuallyCreateGateway(body)) {
        return send(res, 400, {
          error: 'manual_device_create_forbidden',
          message: '平台后台只能手工新增 L2 / KKOS 网关；L1、摄像头和 IoT 设备必须由 RK3568/KKOS 发现并上报后确认入库。',
        })
      }
      const deviceId = body.device_id || `device-${Date.now()}`
      const item = {
        ...body,
        device_id: deviceId,
        device_source: body.device_source || 'platform_manual_gateway',
        status: body.status || 'unknown',
        cpu_usage: Number(body.cpu_usage || 0),
        memory_usage: Number(body.memory_usage || 0),
        cma_usage: body.cma_usage || '-',
        npu_latency_ms: Number(body.npu_latency_ms || 0),
        temperature: body.temperature || '-',
        last_heartbeat: body.last_heartbeat || '',
        created_at: businessNow(),
        updated_at: businessNow(),
      }
      managedDevices.push(item)
      saveBusinessData()
      return send(res, 200, item)
    }
  }
  if (path.match(/^\/api\/managed-devices\/[^/]+$/) && req.method === 'PUT') {
    const id = decodeURIComponent(path.split('/').pop())
    const body = await readBody(req)
    const index = managedDevices.findIndex((item) => item.device_id === id)
    if ((body.device_type || body.role) && !canManuallyCreateGateway({ ...managedDevices[index], ...body })) {
      return send(res, 400, {
        error: 'manual_device_type_forbidden',
        message: '平台后台不能把手工设备改成 L1/摄像头/IoT；这些设备必须来自 KKOS 发现确认。',
      })
    }
    if (index < 0) {
      const created = { ...body, device_id: id, device_name: body.device_name || id, status: body.status || 'offline', created_at: businessNow(), updated_at: businessNow() }
      managedDevices.push(created)
      saveBusinessData()
      return send(res, 200, created)
    }
    managedDevices[index] = { ...managedDevices[index], ...body, updated_at: businessNow() }
    saveBusinessData()
    return send(res, 200, managedDevices[index])
  }
  if (path.match(/^\/api\/managed-devices\/[^/]+\/refresh$/) && req.method === 'POST') {
    const id = decodeURIComponent(path.split('/').slice(-2)[0])
    const device = managedDevices.find((item) => item.device_id === id)
    if (!device) return send(res, 404, { error: 'not_found', message: '未找到设备' })
    if (!canManuallyCreateGateway(device)) {
      return send(res, 400, {
        error: 'refresh_only_for_kkos_gateway',
        message: '云端只允许主动刷新 L2 / KKOS 网关自身状态；下挂设备状态必须由 KKOS 上报。',
      })
    }
    deviceProbeCache.clear()
    const refreshed = managedDeviceSummary(device)
    return send(res, 200, refreshed || device)
  }
  if (path === '/api/kkos/discovery-capabilities') return send(res, 200, kkosDiscoveryCapabilities)
  if (path === '/api/kkos/discovery/scan' && req.method === 'POST') {
    const body = await readBody(req)
    const customerId = body.customer_id || body.customerId || ''
    const siteId = body.site_id || body.siteId || ''
    const gatewayId = body.gateway_id || body.gatewayId || ''
    const gateways = managedDevices.filter((item) => (
      canManuallyCreateGateway(item)
      && (!customerId || item.customer_id === customerId)
      && (!siteId || item.site_id === siteId)
      && (!gatewayId || item.device_id === gatewayId)
    ))
    if (!gateways.length) return send(res, 404, { ok: false, message: '未找到可用的 L2 / KKOS 网关，请先添加 RK3568/RK3588 网关并配置 Tailscale IP。' })
    const results = gateways.map((device) => triggerKkosDiscovery(device))
    for (const result of results) {
      const gateway = managedDevices.find((item) => item.device_id === result.gateway_id)
      if (result.ok && gateway && Array.isArray(result.discovered_devices)) {
        mergeDiscoveredDeviceRows(result.discovered_devices, {
          customer_id: gateway.customer_id || '',
          site_id: gateway.site_id || '',
          gateway_id: gateway.device_id || '',
          reported_at: businessNow(),
        })
      }
    }
    return send(res, results.some((item) => item.ok) ? 200 : 502, {
      ok: results.some((item) => item.ok),
      scanned_gateways: results.length,
      results,
      discovered: discoveredDeviceSummaries(url),
    })
  }
  if (path === '/api/kkos/discovered-devices/report') {
    if (req.method === 'GET') return send(res, 200, discoveredDeviceSummaries(url))
    if (req.method === 'POST') {
      const body = await readBody(req)
      const envelope = {
        customer_id: body.customer_id || body.customerId || '',
        site_id: body.site_id || body.siteId || '',
        gateway_id: body.gateway_id || body.gatewayId || '',
        reported_at: body.reported_at || body.reportedAt || businessNow(),
      }
      const payloadRows = Array.isArray(body.devices) ? body.devices : Array.isArray(body.discovered_devices) ? body.discovered_devices : Array.isArray(body) ? body : [body]
      const nextRows = mergeDiscoveredDeviceRows(payloadRows, envelope)
      return send(res, 200, { ok: true, accepted: nextRows.length, reported_at: envelope.reported_at })
    }
  }
  if (path.match(/^\/api\/kkos\/discovered-devices\/[^/]+\/confirm$/) && req.method === 'POST') {
    const id = decodeURIComponent(path.split('/').slice(-2)[0])
    const body = await readBody(req)
    const rows = loadDiscoveredDevices()
    const index = rows.findIndex((item) => item.discovery_id === id)
    if (index < 0) return send(res, 404, { error: 'not_found', message: '未找到发现设备' })
    const discovered = { ...rows[index], ...body, status: 'confirmed', confirmed_at: businessNow(), updated_at: businessNow() }
    rows[index] = discovered
    const isCamera = discovered.category === 'camera' || ['ip_camera', 'nvr_channel', 'rtsp_stream'].includes(discovered.device_type)
    if (isCamera) {
      const cameraId = body.camera_id || discovered.camera_id || `cam-${Date.now()}`
      const cameraItem = {
        customer_id: discovered.customer_id,
        site_id: discovered.site_id,
        camera_id: cameraId,
        camera_name: body.camera_name || body.device_name || discovered.device_name || discovered.ip || cameraId,
        location: body.location || '',
        rtsp_url: body.rtsp_url || discovered.rtsp_url || '',
        resolution: body.resolution || '1080p',
        source_type: 'kkos_discovered',
        discovery_id: discovered.discovery_id,
        status: 'unknown',
        created_at: businessNow(),
        updated_at: businessNow(),
      }
      const cameraIndex = cameras.findIndex((item) => item.camera_id === cameraId)
      if (cameraIndex >= 0) cameras[cameraIndex] = { ...cameras[cameraIndex], ...cameraItem, updated_at: businessNow() }
      else cameras.push(cameraItem)
      saveBusinessData()
      saveDiscoveredDevices(rows)
      return send(res, 200, { ok: true, camera: cameraItem, discovery: discovered })
    }
    const deviceId = body.device_id || discovered.device_id || `device-${Date.now()}`
    const role = body.role || discovered.role || (String(discovered.device_type).includes('rv') ? 'l1' : discovered.category === 'iot' ? 'iot' : 'l1')
    const deviceItem = {
      customer_id: discovered.customer_id,
      site_id: discovered.site_id,
      device_id: deviceId,
      device_name: body.device_name || discovered.device_name || discovered.ip || deviceId,
      device_type: body.device_type || discovered.device_type,
      role,
      ip: body.ip || discovered.ip,
      mac: discovered.mac,
      firmware_version: body.firmware_version || '',
      current_model_version: body.current_model_version || '',
      device_source: 'kkos_discovered_confirmed',
      discovery_id: discovered.discovery_id,
      status: 'unknown',
      created_at: businessNow(),
      updated_at: businessNow(),
    }
    const existingIndex = managedDevices.findIndex((item) => item.device_id === deviceId)
    if (existingIndex >= 0) managedDevices[existingIndex] = { ...managedDevices[existingIndex], ...deviceItem, updated_at: businessNow() }
    else managedDevices.push(deviceItem)
    saveBusinessData()
    saveDiscoveredDevices(rows)
    return send(res, 200, { ok: true, device: deviceItem, discovery: discovered })
  }
  if (path === '/api/kkos/device-health/report') {
    if (req.method === 'GET') return send(res, 200, loadDeviceHealthReports())
    if (req.method === 'POST') {
      const body = await readBody(req)
      const envelope = {
        customer_id: body.customer_id || body.customerId || '',
        site_id: body.site_id || body.siteId || '',
        gateway_id: body.gateway_id || body.gatewayId || body.device_id || body.deviceId || '',
        gateway_ip: body.gateway_ip || body.gatewayIp || '',
        reported_at: body.reported_at || body.reportedAt || businessNow(),
      }
      const payloadRows = Array.isArray(body.devices) ? body.devices : Array.isArray(body.children) ? body.children : Array.isArray(body) ? body : [body]
      const nextRows = payloadRows.map((item) => normalizeKkosDeviceReport(item, envelope))
      const existing = loadDeviceHealthReports()
      const keys = new Set(nextRows.map((item) => item.device_id || item.ip || item.device_name).filter(Boolean))
      const gatewayId = envelope.gateway_id || ''
      const merged = [
        ...nextRows,
        ...existing.filter((item) => {
          if (gatewayId && item.gateway_id === gatewayId) return false
          return !keys.has(item.device_id || item.ip || item.device_name)
        }),
      ].slice(0, 500)
      saveDeviceHealthReports(merged)
      deviceProbeCache.clear()
      return send(res, 200, { ok: true, accepted: nextRows.length, reported_at: envelope.reported_at })
    }
  }
  if (path === '/api/cameras') {
    if (req.method === 'GET') return send(res, 200, cameras.map(cameraSummary))
    if (req.method === 'POST') {
      const body = await readBody(req)
      if (body.source_type !== 'kkos_discovered' && body.camera_source !== 'kkos_discovered_confirmed') {
        return send(res, 400, {
          error: 'manual_camera_create_forbidden',
          message: '平台后台不能手工新增摄像头；摄像头必须由 RK3568/KKOS 发现或导入 RTSP 清单后确认入库。',
        })
      }
      const cameraId = body.camera_id || `cam-${Date.now()}`
      const item = { ...body, camera_id: cameraId, resolution: body.resolution || '1080p', source_type: body.source_type || 'real_camera', status: body.status || 'offline', created_at: businessNow(), updated_at: businessNow() }
      cameras.push(item)
      saveBusinessData()
      return send(res, 200, item)
    }
  }
  if (path.match(/^\/api\/cameras\/[^/]+$/) && req.method === 'PUT') {
    const id = decodeURIComponent(path.split('/').pop())
    const body = await readBody(req)
    const index = cameras.findIndex((item) => item.camera_id === id)
    if (index < 0) {
      const created = { ...body, camera_id: id, camera_name: body.camera_name || id, resolution: body.resolution || '1080p', source_type: body.source_type || 'real_camera', status: body.status || 'offline', created_at: businessNow(), updated_at: businessNow() }
      cameras.push(created)
      saveBusinessData()
      return send(res, 200, created)
    }
    cameras[index] = { ...cameras[index], ...body, updated_at: businessNow() }
    saveBusinessData()
    return send(res, 200, cameras[index])
  }
  if (path === '/api/scenario-templates') return send(res, 200, globalScenarioTemplates)
  if (path.match(/^\/api\/scenario-templates\/[^/]+$/) && req.method === 'GET') {
    const scenario = decodeURIComponent(path.split('/').pop())
    const template = globalScenarioTemplates.find((item) => item.scenario === scenario)
    if (!template) return send(res, 404, { detail: 'scenario template not found' })
    const bindings = cameraScenarioBindings.filter((item) => item.scenario === scenario)
    return send(res, 200, {
      ...template,
      binding_count: bindings.length,
      active_binding_count: bindings.filter((item) => item.enabled !== false).length,
      runtime_configs: bindings.filter((item) => item.enabled !== false).map((binding) => resolveRuntimeConfig({ binding })),
    })
  }
  if (path === '/api/scenario-policies') {
    if (req.method === 'GET') return send(res, 200, customerScenarioPolicies.map((policy) => ({ ...policy, customer_name: customers.find((item) => item.customer_id === policy.customer_id)?.customer_name || '-' })))
    if (req.method === 'POST') {
      const body = await readBody(req)
      const item = { ...body, policy_id: body.policy_id || `policy-${Date.now()}`, created_at: businessNow(), updated_at: businessNow() }
      customerScenarioPolicies.push(item)
      return send(res, 200, item)
    }
  }
  if (path.match(/^\/api\/scenario-policies\/[^/]+$/) && req.method === 'PUT') {
    const id = decodeURIComponent(path.split('/').pop())
    const body = await readBody(req)
    const index = customerScenarioPolicies.findIndex((item) => item.policy_id === id)
    if (index < 0) return send(res, 404, { detail: 'policy not found' })
    customerScenarioPolicies[index] = { ...customerScenarioPolicies[index], ...body, updated_at: businessNow() }
    return send(res, 200, customerScenarioPolicies[index])
  }
  if (path === '/api/camera-bindings') {
    if (req.method === 'GET') {
      return send(res, 200, cameraScenarioBindings.map((binding) => ({
        ...binding,
        customer_name: customers.find((item) => item.customer_id === binding.customer_id)?.customer_name || '-',
        site_name: sites.find((item) => item.site_id === binding.site_id)?.site_name || '-',
        camera_name: cameras.find((item) => item.camera_id === binding.camera_id)?.camera_name || '-',
        scenario_name: scenarioNames[binding.scenario] || binding.scenario,
        runtime_config: resolveRuntimeConfig({ binding }),
      })))
    }
    if (req.method === 'POST') {
      const body = await readBody(req)
      const item = { ...body, roi: validateRoi(body.roi), binding_id: body.binding_id || `bind-${Date.now()}`, runtime_config_version: 1, enabled: body.enabled !== false, created_at: businessNow(), updated_at: businessNow() }
      cameraScenarioBindings.push(item)
      syncCameraDeviceAssignment(item)
      const deploy = applyBindingToAlgorithm(item)
      const runtime_sync = syncBindingRuntimeConfig(item)
      saveBusinessData()
      return send(res, 200, { binding: item, runtime_config: resolveRuntimeConfig({ binding: item }), deploy, runtime_sync })
    }
  }
  if (path.match(/^\/api\/camera-bindings\/[^/]+\/runtime-control$/) && req.method === 'POST') {
    const id = decodeURIComponent(path.split('/').slice(-2)[0])
    const body = await readBody(req)
    const action = body.action === 'stop' || body.action === 'sleep' || body.enabled === false ? 'sleep' : 'wake'
    const binding = cameraScenarioBindings.find((item) => item.binding_id === id)
    if (!binding) return send(res, 404, { detail: 'binding not found' })
    try {
      const result = setBindingRuntimeState(binding, action)
      binding.updated_at = businessNow()
      saveBusinessData()
      return send(res, result.ok ? 200 : 202, result)
    } catch (error) {
      binding.runtime_control = {
        status: 'failed',
        desired_state: action === 'wake' ? 'camera_awake' : 'camera_sleeping',
        requested_at: businessNow(),
        last_error: error instanceof Error ? error.message : String(error),
      }
      binding.updated_at = businessNow()
      saveBusinessData()
      return send(res, 500, { ok: false, action, binding, detail: binding.runtime_control.last_error })
    }
  }
  if (path.match(/^\/api\/camera-bindings\/[^/]+$/) && req.method === 'PUT') {
    const id = decodeURIComponent(path.split('/').pop())
    const body = await readBody(req)
    const index = cameraScenarioBindings.findIndex((item) => item.binding_id === id)
    if (index < 0) return send(res, 404, { detail: 'binding not found' })
    const next = { ...cameraScenarioBindings[index], ...body, roi: validateRoi(body.roi || cameraScenarioBindings[index].roi), runtime_config_version: Number(cameraScenarioBindings[index].runtime_config_version || 1) + 1, updated_at: businessNow() }
    cameraScenarioBindings[index] = next
    syncCameraDeviceAssignment(next)
    const deploy = applyBindingToAlgorithm(next)
    const runtime_sync = syncBindingRuntimeConfig(next)
    saveBusinessData()
    return send(res, 200, { binding: next, runtime_config: resolveRuntimeConfig({ binding: next }), deploy, runtime_sync })
  }
  if (path === '/api/config-resolver/preview' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      return send(res, 200, resolveRuntimeConfig(body))
    } catch (error) {
      return send(res, 400, { detail: error instanceof Error ? error.message : String(error) })
    }
  }
  if (path === '/api/runtime-configs') return send(res, 200, runtimeConfigs())
  if (path === '/api/capacity/plan' && req.method === 'POST') return send(res, 200, capacityPlan(await readBody(req)))
  if (path === '/api/edge-gateways/kkos') return send(res, 200, kkosSnapshot(url.searchParams.get('customer_id') || ''))
  if (path === '/api/closed-loop/trace') return send(res, 200, closedLoopTrace())
  if (path === '/api/core-logs') return send(res, 200, cachedCoreLogs(Number(url.searchParams.get('limit') || 120)))
  if (path === '/api/dashboard/summary') return send(res, 200, dashboardSummary())
  if (path === '/api/streams') return send(res, 200, cameraStreams(url))
  if (path === '/api/streams/playback') return send(res, 200, lastPlayback)
  if (path === '/api/streams/start-three-videos' && req.method === 'POST') {
    try {
      return send(res, 200, { ok: true, playback: startThreeVideoPass() })
    } catch (error) {
      return send(res, 500, { ok: false, detail: error instanceof Error ? error.message : String(error) })
    }
  }
  if (path.match(/^\/api\/streams\/[^/]+\/restart$/)) return send(res, 200, { ok: true })
  if (path === '/api/algorithms/configs') return send(res, 200, algorithms)
  if (path.match(/^\/api\/algorithms\/configs\/[^/]+$/) && req.method === 'PUT') {
    try {
      const channelId = decodeURIComponent(path.split('/').pop())
      const nextConfig = await readBody(req)
      const index = algorithms.findIndex((item) => item.channel_id === channelId)
      if (index < 0) return send(res, 404, { detail: `unknown channel: ${channelId}` })
      algorithms = algorithms.map((item, i) => i === index ? { ...item, ...nextConfig, config_version: Number(item.config_version || 0) + 1 } : item)
      saveAlgorithmConfigs()
      const deploy = deployRv1126Config(renderRv1126Config())
      if (!deploy.written) return send(res, 500, { ok: false, channel_id: channelId, config: algorithms[index], deploy, detail: '配置未能写入 RV1126' })
      return send(res, 200, { ok: true, channel_id: channelId, config: algorithms[index], deploy })
    } catch (error) {
      return send(res, 500, { ok: false, detail: error instanceof Error ? error.message : String(error) })
    }
  }
  if (path.match(/^\/api\/algorithms\/configs\/[^/]+$/)) return send(res, 405, { detail: 'method not allowed' })
  if (path === '/api/l1/candidates') return send(res, 200, cachedCandidates())
  if (path === '/api/l1/frame-results') {
    // This is an operator's live proof-of-inference view. Keep its refresh
    // window short; the 30s diagnostics cache made a healthy L1 look stopped.
    const liveLog = cachedEdge('rv:frame-log:l1-live', 3000, () => liveGatewayFrameLog(2000), '')
    const stats = parseStats(cachedEdge('rv:stats-log:l1-live', 3000, () => liveGatewayStatsLog(400), ''))
    return send(res, 200, parseFrameResults(liveLog, stats))
  }
  if (path === '/api/l1/channel-stats') return send(res, 200, parseStats(cachedGatewayStatsLog()))
  if (path.match(/^\/api\/l1\/candidates\/[^/]+\/frame$/)) {
    const eventId = safeEventId(path.split('/').at(-2))
    const candidate = cachedCandidates().find((item) => safeEventId(item.event_id) === eventId)
    if (!candidate?.frame_path) return send(res, 404, { detail: 'frame not found' })
    let bytes = edgeDirectSshEnabled ? runBuffer('ssh', [rvHost, `cat ${candidate.frame_path}`]) : Buffer.alloc(0)
    // Cloud is intentionally not allowed to SSH directly to a LAN sentinel.
    // Until the archived candidate is fetched through KKOS, retain a usable
    // preview by asking KKOS for a current frame from the same bound camera.
    if (!bytes.length) bytes = kkosCandidateFrameBytes(eventId)
    if (!bytes.length) {
      const binding = cameraScenarioBindings.find((item) => item.enabled !== false && item.scenario === candidate.algorithm)
      const camera = cameras.find((item) => item.camera_id === binding?.camera_id)
      bytes = kkosCameraSnapshotBytes(camera?.rtsp_url || '')
    }
    if (!bytes.length) return send(res, 404, { detail: 'frame read failed' })
    return sendBytes(res, 200, bytes, 'image/jpeg')
  }
  if (path.match(/^\/api\/l1\/candidates\/[^/]+\/send-to-l2$/)) return send(res, 200, { ok: true })
  if (path.match(/^\/api\/l1\/candidates\/[^/]+\/mark-false-positive$/)) return send(res, 200, { ok: true })
  if (path === '/api/l2/reviews') {
    // L2 monitoring is a live operator view, not a historical dashboard.
    // Reuse a one-second snapshot for the concurrent L1/L2 page refreshes.
    const snapshot = cachedEdge('kkos:l2-live', 1000, () => realKkosCoreLogSnapshot(800), null)
    return send(res, 200, realL2Reviews(realCandidates(snapshot), snapshot?.l2_brain_log || ''))
  }
  if (path === '/api/flow/summary') return send(res, 200, flowSummary())
  if (path === '/api/flow/frames') return send(res, 200, flowFrames(Number(url.searchParams.get('limit') || 40)))
  if (path === '/api/audits/providers') {
    const active = process.env.GUARDIAN_VLM_PROVIDER || 'mage-vl-inference'
    const mage = ollamaModelStatus()
    const inferenceMage = vlmInferenceStatus()
    return send(res, 200, [
      ...(active === 'mock' ? [{ provider: 'mock', active: true, configured: true, model: 'deterministic-development-mock' }] : []),
      {
        provider: 'mage-vl-inference',
        display_name: 'VLM 推理服务',
        system_role: '远端裁判 / 自动标注',
        deployment_mode: 'independent',
        active: isVlmInferenceProvider(active),
        configured: inferenceMage.configured,
        reachable: inferenceMage.reachable,
        endpoint: inferenceMage.base_url,
        model: inferenceMage.model,
        status: !inferenceMage.reachable ? 'offline' : inferenceMage.configured ? 'ready' : 'missing_model',
        available_models: inferenceMage.available_models,
      },
      {
        provider: 'ollama-mage-vl',
        active: ['ollama-mage-vl', 'ollama'].includes(active),
        configured: mage.configured,
        reachable: mage.reachable,
        vision_capable: mage.vision_capable,
        endpoint: mage.base_url,
        model: mage.model,
        status: !mage.reachable ? 'offline' : mage.configured ? 'ready' : 'missing_model',
        available_models: mage.available_models,
      },
      {
        provider: 'qwen-vl',
        active: ['qwen-vl', 'qwen', 'dashscope'].includes(active),
        configured: Boolean(process.env.GUARDIAN_QWEN_VL_API_KEY && process.env.GUARDIAN_QWEN_VL_MODEL),
        model: process.env.GUARDIAN_QWEN_VL_MODEL || 'qwen-vl-max-latest',
      },
      {
        provider: 'volcengine-vlm',
        active: ['volcengine-vlm', 'volcengine', 'ark'].includes(active),
        configured: Boolean(process.env.GUARDIAN_VOLCENGINE_VLM_API_KEY && process.env.GUARDIAN_VOLCENGINE_VLM_MODEL),
        model: process.env.GUARDIAN_VOLCENGINE_VLM_MODEL || '',
      },
    ])
  }
  if (path === '/api/audits/stats') {
    const rows = publicVlmAuditLogs()
    const responses = rows.map(responseFromAuditLog)
    return send(res, 200, {
      total_audited: rows.length,
      total_confirmed: responses.filter((item) => ['confirm', 'cap_missing', 'cap_present', 'reviewed'].includes(item.verdict || item.sample_type)).length,
      total_overturned: responses.filter((item) => ['overturn', 'invalid_sample'].includes(item.verdict || item.sample_type) || item.label_status === 'not_required').length,
      total_uncertain: responses.filter((item) => ['uncertain', 'need_human_box'].includes(item.verdict || item.sample_type) || ['need_human_box', 'need_human_review', 'auto_label_draft'].includes(item.label_status)).length,
      total_cost_cents: rows.reduce((sum, item) => sum + Number(item.cost_cents || 0), 0),
    })
  }
  if (path === '/api/audits/logs') {
    return send(res, 200, publicVlmAuditLogs())
  }
  if (path.match(/^\/api\/audits\/decisions\/[^/]+$/)) {
    const alarmId = decodeURIComponent(path.split('/').at(-1))
    const alarm = cloudAlarms().find((item) => item.alarm_id === alarmId)
    return alarm ? send(res, 200, alarm) : send(res, 404, { detail: 'alarm not found' })
  }
  if (req.method === 'POST' && path.match(/^\/api\/audits\/retry\/[^/]+$/)) {
    const alarmId = decodeURIComponent(path.split('/').at(-1))
    const rows = cloudAlarms()
    const index = rows.findIndex((item) => item.alarm_id === alarmId)
    if (index < 0) return send(res, 404, { detail: 'alarm not found' })
    rows[index] = { ...rows[index], audit_status: 'pending', audit_verdict: null, audit_score: null }
    writeCloudAlarms(rows)
    return send(res, 200, { ok: true, message_id: `mock-retry-${Date.now()}` })
  }
  if (path === '/api/alarms' || path === '/api/alarms/') {
    if (req.method === 'GET') {
      const customerId = url.searchParams.get('customer_id') || ''
      const siteId = url.searchParams.get('site_id') || ''
      const wantsSummary = url.searchParams.get('summary') === '1' || url.searchParams.has('page')
      const rows = customerAlarms(customerId)
        .filter((item) => !siteId || !item.site_id || item.site_id === siteId)
      if (!wantsSummary) return send(res, 200, rows)
      const pageSize = Math.max(10, Math.min(100, Number(url.searchParams.get('page_size') || 20) || 20))
      const total = rows.length
      const page = Math.max(1, Math.min(Number(url.searchParams.get('page') || 1) || 1, Math.max(1, Math.ceil(total / pageSize))))
      const offset = (page - 1) * pageSize
      return send(res, 200, {
        items: rows.slice(offset, offset + pageSize).map(alarmListItem),
        total,
        page,
        page_size: pageSize,
      })
    }
    if (req.method === 'POST') {
      const body = await readBody(req)
      if (!body.customer_id || !body.site_id || !body.camera_id) {
        return send(res, 422, { detail: 'customer_id, site_id and camera_id are required from the camera binding' })
      }
      const existing = cloudAlarms().find((item) => item.alarm_id === body.alarm_id)
      const action = String(body.event_action || 'created').toLowerCase()
      const now = businessNow()
      const keepCustomerDisposition = existing && ['handled', 'false_alarm'].includes(existing.alarm_status) && action === 'heartbeat'
      const lifecyclePatch = action === 'resolved'
        ? { alarm_status: 'resolved', event_status: 'closed', resolved_at: now, lifecycle_action: action }
        : keepCustomerDisposition
          ? { alarm_status: existing.alarm_status, event_status: existing.event_status || 'closed', lifecycle_action: action, last_seen_at: now }
        : { alarm_status: 'active', event_status: 'pending_dispatch', last_seen_at: now, lifecycle_action: action }
      const incomingSnapshot = body.snapshot || body.image_base64 || body.imageBase64 || ''
      const existingProofSnapshot = existing?.alarm_snapshot || existing?.proof_snapshot || existing?.snapshot || ''
      const frozenProofSnapshot = action === 'resolved'
        ? existingProofSnapshot
        : (existingProofSnapshot || incomingSnapshot)
      const snapshotPatch = {
        snapshot: frozenProofSnapshot || incomingSnapshot || existing?.snapshot || '',
        alarm_snapshot: frozenProofSnapshot || incomingSnapshot || existing?.alarm_snapshot || '',
        proof_snapshot: frozenProofSnapshot || incomingSnapshot || existing?.proof_snapshot || '',
        ...(action === 'resolved' && incomingSnapshot ? { resolved_snapshot: incomingSnapshot } : {}),
      }
      const alarm = normalizeAlarmRecord({
        ...(existing || {}),
        ...body,
        alarm_id: body.alarm_id || lifecycleId('alarm'),
        event_id: body.event_id || existing?.event_id || lifecycleId('evt'),
        customer_id: body.customer_id,
        site_id: body.site_id,
        camera_id: body.camera_id,
        source: 'rk3568_l2',
        audit_status: existing?.audit_status || body.audit_status || 'pending',
        audit_verdict: existing?.audit_verdict || body.audit_verdict || null,
        audit_score: existing?.audit_score || body.audit_score || null,
        received_at: existing?.received_at || now,
        updated_at: now,
        ...lifecyclePatch,
        ...snapshotPatch,
      })
      const rows = cloudAlarms().filter((item) => item.alarm_id !== alarm.alarm_id)
      rows.unshift(alarm)
      writeCloudAlarms(rows.slice(0, 1000))
      const forgeIngest = await ingestForgeSampleFromAlarm(alarm)
      if (!forgeIngest.ok && !forgeIngest.skipped) {
        appendLifecycleAudit('alarm_forge_ingest_failed', {
          alarm_id: alarm.alarm_id,
          scenario: alarm.algorithm || alarm.alarm_type || '',
          detail: forgeIngest.detail || 'unknown error',
        })
      }
      return send(res, 201, { ...alarm, forge_ingest: forgeIngest.ok ? { ok: true, sample_id: forgeIngest.sample?.sample_id || '' } : { ok: false, detail: forgeIngest.detail || 'skipped' } })
    }
    return send(res, 405, { detail: 'method not allowed' })
  }
  if (req.method === 'GET' && path.match(/^\/api\/alarms\/[^/]+$/)) {
    const alarmId = decodeURIComponent(path.split('/').at(-1))
    const customerId = url.searchParams.get('customer_id') || ''
    const siteId = url.searchParams.get('site_id') || ''
    const alarm = cloudAlarms().find((item) => item.alarm_id === alarmId)
    if (!alarm || (customerId && alarm.customer_id && alarm.customer_id !== customerId) || (siteId && alarm.site_id && alarm.site_id !== siteId)) {
      return send(res, 404, { detail: 'alarm not found' })
    }
    const detail = normalizeAlarmRecord(alarm)
    // 告警与训练素材按 source_event_id 关联。只有携带合规证据图、并成功
    // 进入 Forge 的告警才会有素材；无图告警不能自动变成训练数据。
    const forgeSamples = materialPool().filter((item) => item.source_event_id === alarmId && item.customer_id === detail.customer_id)
      .map((item) => ({ sample_id: item.sample_id, scenario: item.scenario, created_at: item.created_at, training_eligibility: item.training_eligibility || 'blocked' }))
    return send(res, 200, { ...detail, forge_samples: forgeSamples })
  }
  if (path === '/api/edge-commands' && req.method === 'GET') {
    const brainId = url.searchParams.get('brain_id') || ''
    return send(res, 200, edgeCommands().filter((item) => !item.acknowledged_at && (!brainId || item.brain_id === brainId)))
  }
  if (path.match(/^\/api\/edge-commands\/[^/]+\/ack$/) && req.method === 'POST') {
    const commandId = decodeURIComponent(path.split('/').at(-2))
    const body = await readBody(req)
    const rows = edgeCommands()
    const index = rows.findIndex((item) => item.command_id === commandId)
    if (index < 0) return send(res, 404, { detail: 'edge command not found' })
    rows[index] = { ...rows[index], acknowledged_at: businessNow(), acknowledged_by: body.brain_id || '', applied: body.applied === true }
    writeEdgeCommands(rows)
    return send(res, 200, { ok: true, command: rows[index] })
  }
  if (path.match(/^\/api\/alarms\/[^/]+\/(confirm|reject|ignore|send-to-learning)$/)) {
    const alarmId = decodeURIComponent(path.split('/').at(-2))
    const action = path.split('/').at(-1)
    const rows = cloudAlarms()
    const index = rows.findIndex((item) => item.alarm_id === alarmId)
    if (index < 0) return send(res, 404, { detail: 'alarm not found' })
    // A guard can acknowledge dispatch, but only an observed absence at the
    // edge may close the risk.  "confirm" therefore means go-to-handle, not
    // handled / resolved.
    const patch = action === 'confirm'
      ? { alarm_status: 'dispatching', event_status: 'in_progress', feedback_result: '已派发处置', status: '处理中（等待视频验证）', dispatched_at: businessNow() }
      : action === 'reject'
        ? { alarm_status: 'false_alarm', event_status: 'closed', feedback_result: '误报', status: '误报已关闭', false_alarm_at: businessNow() }
        : action === 'ignore'
          ? { alarm_status: 'ignored', event_status: 'closed', feedback_result: '忽略', status: '已忽略' }
          : { feedback_result: rows[index].feedback_result || '不确定', status: rows[index].status || '已反馈' }
    rows[index] = { ...rows[index], ...patch, human_records: [...(rows[index].human_records || []), { action, actor: 'customer_user', at: businessNow() }] }
    writeCloudAlarms(rows)
    // Dispatch is a human-workflow state in cloud only.  It must not suppress
    // edge detection; only an explicit false-positive decision is fed back to
    // the model/edge as a classification signal.
    const command = action === 'reject'
      ? enqueueEdgeCommand(rows[index], 'false_alarm')
      : null
    return send(res, 200, { ok: true, alarm: rows[index], command })
  }
  if (path === '/api/events') return send(res, 200, eventsFromAlarms(url.searchParams.get('customer_id') || ''))
  if (path.match(/^\/api\/events\/[^/]+\/(dispatch|start|resolve|close)$/) && req.method === 'POST') {
    const eventId = decodeURIComponent(path.split('/').at(-2))
    const action = path.split('/').at(-1)
    const event = updateEventState(eventId, action)
    if (!event) return send(res, 404, { detail: 'event not found' })
    return send(res, 200, { ok: true, event, message: '事件状态已更新' })
  }
  if (path === '/api/learning/status') return send(res, 200, learning)
  if (path === '/api/learning/training-runs') return send(res, 200, trainingRuns)
  if (path === '/api/review/items') return send(res, 200, reviewItems)
  if (path.match(/^\/api\/review\/items\/[^/]+\/(approve-positive|approve-hard-negative|reject)$/)) return send(res, 200, { ok: true })
  if (path === '/api/forge/sample-preview') {
    // <img> cannot send an Authorization header.  The admin SPA therefore
    // attaches its existing login token as asset_token for this same-origin
    // evidence proxy.  Keep direct anonymous access forbidden.
    if (!req.headers.authorization && !url.searchParams.get('asset_token')) return send(res, 401, { ok: false, detail: 'authorization required' })
    const sampleId = url.searchParams.get('sample_id') || ''
    const kind = url.searchParams.get('kind') || 'raw'
    if (!/^[a-zA-Z0-9_.-]+$/.test(sampleId)) return send(res, 400, { ok: false, detail: 'invalid sample id' })
    if (!['raw', 'dataset', 'label'].includes(kind)) return send(res, 400, { ok: false, detail: 'invalid preview kind' })
    const bytes = runBuffer('curl', [
      '-sS',
      '-m', '5',
      '-H', `X-Guardian-Forge-Preview-Token: ${forgeFilePreviewToken}`,
      `${forgeFileServiceBaseUrl}/api/guardian-forge/sample-preview?sample_id=${encodeURIComponent(sampleId)}&kind=${encodeURIComponent(kind)}`,
    ])
    if (!bytes.length && kind === 'label') return sendBytes(res, 200, Buffer.alloc(0), 'text/plain; charset=utf-8')
    if (!bytes.length) return send(res, 502, { ok: false, detail: 'forge sample preview service unavailable' })
    if (bytes.slice(0, 1).toString() === '{') {
      try {
        const payload = JSON.parse(bytes.toString('utf8'))
        if (payload?.ok === false) return send(res, payload.detail === 'invalid preview token' ? 401 : 404, payload)
      } catch {}
    }
    return sendBytes(res, 200, bytes, kind === 'label' ? 'text/plain; charset=utf-8' : 'image/jpeg')
  }
  if (path === '/api/models') {
    const scope = url.searchParams.get('scope')
    const customerId = url.searchParams.get('customer_id')
    if (scope || customerId) return send(res, 200, lifecycleModelsWithAiCenterMocks().filter((item) => (!scope || item.scope === scope) && (!customerId || item.customer_id === customerId)))
    return send(res, 200, models)
  }
  if (path.match(/^\/api\/models\/[^/]+\/(stage|approve|rollback)$/)) return send(res, 200, { ok: true })
  if (path === '/api/devices') return send(res, 200, realDevices())
  if (path === '/api/logs') {
    const type = url.searchParams.get('type')
    return send(res, 200, platformLogs(type))
  }
  if (path === '/healthz') return send(res, 200, { ok: true })
  send(res, 404, { detail: `not found: ${path}` })
  } catch (error) {
    console.error('[guardian-cloud-api] request failed', req.url, error)
    if (!res.headersSent) return send(res, Number(error?.statusCode) || 500, { detail: error instanceof Error ? error.message : String(error) })
    res.end()
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`守界 Guardian Cloud API listening on http://127.0.0.1:${port}`)
})
