<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>客户中心 Customer Center</h2>
        <p>平台只手工开通客户、项目和 L2/KKOS 网关；L1、摄像头和 IoT 由 KKOS 发现后确认入库。</p>
      </div>
      <div class="actions">
        <el-button @click="openSite()">新增项目</el-button>
        <el-button @click="openDevice()">新增 KKOS 网关</el-button>
        <el-button type="primary" @click="openCustomer()">新增客户</el-button>
      </div>
    </header>

    <el-alert
      v-if="!customers.length"
      title="当前是干净初始化状态"
      description="请先新增客户和项目，再给项目新增 RK3568/RK3588 KKOS 网关；L1、摄像头和 IoT 由 KKOS 发现后在“现场发现”里确认。"
      type="info"
      show-icon
      :closable="false"
    />

    <el-tabs v-model="tab">
      <el-tab-pane label="客户 Customers" name="customers">
        <el-table :data="customers" stripe empty-text="暂无客户，请点击右上角新增客户">
          <el-table-column prop="customer_name" label="客户" min-width="160" />
          <el-table-column prop="customer_type" label="类型" width="150" />
          <el-table-column prop="service_plan" label="套餐" width="130" />
          <el-table-column prop="status" label="状态" width="110" />
          <el-table-column label="资源" min-width="220">
            <template #default="{ row }">项目 {{ row.site_count }} · 摄像头 {{ row.camera_count }} · 设备 {{ row.device_count }} · 告警 {{ row.alarm_count }}</template>
          </el-table-column>
          <el-table-column label="数据策略" min-width="260">
            <template #default="{ row }">
              云端 {{ yes(row.data_policy.allow_cloud_upload) }} · 自动标注 {{ yes(row.data_policy.allow_auto_labeling) }} · 客户训练 {{ yes(row.data_policy.allow_customer_model_training) }} · 平台基线 {{ yes(row.data_policy.allow_platform_baseline_training) }} · 人审 {{ yes(row.data_policy.require_human_review) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90">
            <template #default="{ row }">
              <el-button size="small" @click="openCustomer(row)">编辑</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="项目 Sites" name="sites">
        <el-table :data="sites" stripe empty-text="暂无项目，请先新增客户，再新增项目">
          <el-table-column prop="site_name" label="项目/小区" min-width="180" />
          <el-table-column prop="customer_name" label="所属客户" min-width="160" />
          <el-table-column prop="site_type" label="类型" width="180" />
          <el-table-column prop="status" label="状态" width="120" />
          <el-table-column label="运行概况" min-width="300">
            <template #default="{ row }">摄像头 {{ row.online_camera_count }}/{{ row.camera_count }} · RV1126 {{ row.rv1126_count }} · RK3568 {{ row.rk3568_count }} · 绑定 {{ row.binding_count }} · 负载 {{ row.capacity_load }}</template>
          </el-table-column>
          <el-table-column prop="address" label="地址" min-width="220" />
          <el-table-column label="操作" width="300">
            <template #default="{ row }">
              <el-button size="small" @click="openSite(row)">编辑</el-button>
              <el-button size="small" type="primary" @click="enterProject(row, 'project_manager')">项目管理后台</el-button>
              <el-button size="small" @click="enterProject(row, 'project_operator')">值班操作台</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="设备 Devices" name="devices">
        <el-alert
          class="tab-tip"
          type="info"
          :closable="false"
          show-icon
          title="平台手工新增只允许 L2 / KKOS 网关"
          description="RV1126、摄像头、IoT 设备必须由 RK3568/KKOS 扫描发现并上报，平台确认后自动加入项目。"
        />
        <el-table :data="devicesWithNames" stripe empty-text="暂无设备，请先新增 KKOS 网关">
          <el-table-column prop="device_name" label="设备" min-width="190" />
          <el-table-column prop="customer_name" label="客户" min-width="150" />
          <el-table-column prop="site_name" label="项目" min-width="150" />
          <el-table-column prop="device_type" label="类型" width="110" />
          <el-table-column prop="role" label="角色" width="90" />
          <el-table-column prop="ip" label="IP" width="140" />
          <el-table-column prop="current_model_version" label="模型" min-width="220" />
          <el-table-column label="状态" width="180">
            <template #default="{ row }">
              <el-tag :type="deviceStatusTag(row.status)">{{ deviceStatusText(row.status) }}</el-tag>
              <div class="device-sub">{{ row.collect_error || statusSourceText(row.status_source) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="性能" min-width="240">
            <template #default="{ row }">
              <div>{{ perfText(row) }}</div>
              <div class="device-sub">采集：{{ row.health_checked_at || row.last_heartbeat || '未采集' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="210">
            <template #default="{ row }">
              <el-button v-if="canEditDevice(row)" size="small" @click="openDevice(row)">编辑网关</el-button>
              <el-button v-if="canEditDevice(row)" size="small" type="primary" plain @click="refreshDevice(row)">刷新状态</el-button>
              <el-tag v-else type="info">KKOS 管理</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="现场发现 Discovery" name="discovery">
        <el-card class="discovery-card" shadow="never">
          <template #header>KKOS 可识别设备范围</template>
          <el-table :data="discoveryCapabilities" stripe>
            <el-table-column prop="display_name" label="类别" width="160" />
            <el-table-column label="设备类型" min-width="220"><template #default="{ row }">{{ row.device_types.join(' / ') }}</template></el-table-column>
            <el-table-column label="发现方式" min-width="280"><template #default="{ row }">{{ row.discovery_methods.join(' / ') }}</template></el-table-column>
            <el-table-column label="确认" width="90"><template #default="{ row }">{{ row.confirm_required ? '需要' : '自动' }}</template></el-table-column>
            <el-table-column prop="notes" label="说明" min-width="320" />
          </el-table>
        </el-card>
        <el-card class="discovery-card" shadow="never">
          <template #header>
            <div class="card-header">
              <span>KKOS 发现待确认设备</span>
              <el-button size="small" type="primary" plain :loading="scanningDiscovery" @click="scanDiscovery">刷新</el-button>
            </div>
          </template>
          <el-table :data="discoveredDevicesWithNames" stripe empty-text="暂无 KKOS 上报的发现设备">
            <el-table-column prop="device_name" label="名称" min-width="150" />
            <el-table-column prop="customer_name" label="客户" min-width="140" />
            <el-table-column prop="site_name" label="项目" min-width="140" />
            <el-table-column prop="category" label="类别" width="120" />
            <el-table-column prop="device_type" label="类型" width="130" />
            <el-table-column prop="ip" label="IP" width="140" />
            <el-table-column prop="mac" label="MAC" width="150" />
            <el-table-column prop="discovery_method" label="发现方式" min-width="150" />
            <el-table-column prop="status" label="状态" width="120" />
            <el-table-column label="操作" width="130">
              <template #default="{ row }">
                <el-button v-if="row.status !== 'confirmed'" size="small" type="primary" @click="confirmDiscovered(row)">确认入库</el-button>
                <el-tag v-else type="success">已确认</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="摄像头 Cameras" name="cameras">
        <el-alert
          class="tab-tip"
          type="info"
          :closable="false"
          show-icon
          title="这里只维护摄像头资产基础信息"
          description="摄像头与算法、L1 哨兵资源的运行绑定，请到“算法配置”和“资源分配”相关模块中维护。"
        />
        <el-table :data="camerasWithNames" stripe empty-text="暂无摄像头，请先从现场发现确认入库">
          <el-table-column prop="camera_name" label="摄像头" min-width="160" />
          <el-table-column prop="customer_name" label="客户" min-width="150" />
          <el-table-column prop="site_name" label="项目" min-width="150" />
          <el-table-column prop="location" label="位置" width="140" />
          <el-table-column prop="rtsp_url" label="RTSP" min-width="260" />
          <el-table-column prop="resolution" label="分辨率" width="100" />
          <el-table-column prop="source_type" label="来源" width="150" />
          <el-table-column label="状态" width="180">
            <template #default="{ row }">
              <el-tag :type="deviceStatusTag(row.status)">{{ deviceStatusText(row.status) }}</el-tag>
              <div class="device-sub">{{ row.collect_error || statusSourceText(row.status_source) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90"><template #default="{ row }"><el-button size="small" @click="openCamera(row)">编辑</el-button></template></el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="editingCustomer" title="客户信息" width="760px">
      <el-form v-if="customerForm" label-width="150px">
        <el-form-item label="客户名称"><el-input v-model="customerForm.customer_name" /></el-form-item>
        <el-form-item label="客户类型"><el-select v-model="customerForm.customer_type" style="width:100%"><el-option v-for="item in customerTypes" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="联系人"><el-input v-model="customerForm.contact_name" /></el-form-item>
        <el-form-item label="电话"><el-input v-model="customerForm.contact_phone" /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model="customerForm.contact_email" /></el-form-item>
        <el-form-item label="地址"><el-input v-model="customerForm.address" /></el-form-item>
        <el-form-item label="服务状态"><el-select v-model="customerForm.status" style="width:100%"><el-option v-for="item in statuses" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="服务套餐"><el-select v-model="customerForm.service_plan" style="width:100%"><el-option v-for="item in plans" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="数据策略">
          <el-checkbox v-model="customerForm.data_policy.allow_cloud_upload">允许云端上传</el-checkbox>
          <el-checkbox v-model="customerForm.data_policy.allow_auto_labeling">允许自动标注</el-checkbox>
          <el-checkbox v-model="customerForm.data_policy.allow_customer_model_training">允许客户模型训练</el-checkbox>
          <el-checkbox v-model="customerForm.data_policy.allow_platform_baseline_training">允许进入平台基线</el-checkbox>
          <el-checkbox v-model="customerForm.data_policy.require_human_review">要求人工审核</el-checkbox>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="editingCustomer=false">取消</el-button><el-button type="primary" @click="saveCustomer">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="editingSite" title="项目信息" width="720px">
      <el-form v-if="siteForm" label-width="130px">
        <el-form-item label="所属客户"><el-select v-model="siteForm.customer_id" filterable style="width:100%"><el-option v-for="c in customers" :key="c.customer_id" :label="c.customer_name" :value="c.customer_id" /></el-select></el-form-item>
        <el-form-item label="项目名称"><el-input v-model="siteForm.site_name" /></el-form-item>
        <el-form-item label="项目类型"><el-select v-model="siteForm.site_type" style="width:100%"><el-option v-for="item in siteTypes" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="地址"><el-input v-model="siteForm.address" /></el-form-item>
        <el-form-item label="状态"><el-select v-model="siteForm.status" style="width:100%"><el-option v-for="item in siteStatuses" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="备注"><el-input v-model="siteForm.notes" type="textarea" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="editingSite=false">取消</el-button><el-button type="primary" @click="saveSite">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="editingDevice" title="KKOS 网关信息" width="760px">
      <el-form v-if="deviceForm" label-width="130px">
        <el-form-item label="所属客户"><el-select v-model="deviceForm.customer_id" filterable style="width:100%" @change="deviceForm.site_id=''"><el-option v-for="c in customers" :key="c.customer_id" :label="c.customer_name" :value="c.customer_id" /></el-select></el-form-item>
        <el-form-item label="所属项目"><el-select v-model="deviceForm.site_id" filterable clearable style="width:100%"><el-option v-for="s in sitesFor(deviceForm.customer_id)" :key="s.site_id" :label="s.site_name" :value="s.site_id" /></el-select></el-form-item>
        <el-form-item label="网关名称"><el-input v-model="deviceForm.device_name" /></el-form-item>
        <el-form-item label="网关类型"><el-select v-model="deviceForm.device_type" style="width:100%"><el-option v-for="item in deviceTypes" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="角色"><el-select v-model="deviceForm.role" style="width:100%"><el-option v-for="item in roles" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="局域网 IP"><el-input v-model="deviceForm.ip" /></el-form-item>
        <el-form-item label="Tailscale IP"><el-input v-model="deviceForm.tailscale_ip" placeholder="例如 100.94.124.1，用于云端识别 KKOS 网关自身" /></el-form-item>
        <el-form-item label="固件版本"><el-input v-model="deviceForm.firmware_version" /></el-form-item>
        <el-form-item label="当前模型"><el-input v-model="deviceForm.current_model_version" /></el-form-item>
        <el-form-item label="状态"><el-select v-model="deviceForm.status" style="width:100%"><el-option v-for="item in deviceStatuses" :key="item" :label="item" :value="item" /></el-select></el-form-item>
      </el-form>
      <template #footer><el-button @click="editingDevice=false">取消</el-button><el-button type="primary" @click="saveDevice">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="editingCamera" title="摄像头信息" width="760px">
      <el-form v-if="cameraForm" label-width="130px">
        <el-form-item label="所属客户"><el-select v-model="cameraForm.customer_id" filterable style="width:100%" @change="cameraForm.site_id=''"><el-option v-for="c in customers" :key="c.customer_id" :label="c.customer_name" :value="c.customer_id" /></el-select></el-form-item>
        <el-form-item label="所属项目"><el-select v-model="cameraForm.site_id" filterable clearable style="width:100%"><el-option v-for="s in sitesFor(cameraForm.customer_id)" :key="s.site_id" :label="s.site_name" :value="s.site_id" /></el-select></el-form-item>
        <el-form-item label="摄像头名称"><el-input v-model="cameraForm.camera_name" /></el-form-item>
        <el-form-item label="安装位置"><el-input v-model="cameraForm.location" /></el-form-item>
        <el-form-item label="RTSP"><el-input v-model="cameraForm.rtsp_url" /></el-form-item>
        <el-form-item label="分辨率"><el-select v-model="cameraForm.resolution" style="width:100%"><el-option v-for="item in resolutions" :key="item" :label="item" :value="item" /></el-select></el-form-item>
        <el-form-item label="来源"><el-select v-model="cameraForm.source_type" style="width:100%"><el-option label="KKOS 发现" value="kkos_discovered" /><el-option label="真实摄像头" value="real_camera" /><el-option label="模拟 RTSP" value="simulated_rtsp" /></el-select></el-form-item>
        <el-form-item label="状态"><el-select v-model="cameraForm.status" style="width:100%"><el-option v-for="item in deviceStatuses" :key="item" :label="item" :value="item" /></el-select></el-form-item>
      </el-form>
      <template #footer><el-button @click="editingCamera=false">取消</el-button><el-button type="primary" @click="saveCamera">保存</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import api from '../api'

const router = useRouter()
const tab = ref('customers')
const customers = ref<any[]>([])
const sites = ref<any[]>([])
const devices = ref<any[]>([])
const cameras = ref<any[]>([])
const discoveredDevices = ref<any[]>([])
const discoveryCapabilities = ref<any[]>([])
const editingCustomer = ref(false)
const editingSite = ref(false)
const editingDevice = ref(false)
const editingCamera = ref(false)
const scanningDiscovery = ref(false)
const customerForm = ref<any>(null)
const siteForm = ref<any>(null)
const deviceForm = ref<any>(null)
const cameraForm = ref<any>(null)

const customerTypes = ['property_company', 'community', 'construction_site', 'industrial_park', 'government', 'integrator']
const statuses = ['trial', 'active', 'suspended', 'archived']
const plans = ['trial', 'standard', 'enterprise', 'private_deploy']
const siteTypes = ['residential_community', 'construction_site', 'industrial_park', 'campus', 'office_building']
const siteStatuses = ['planning', 'running', 'paused', 'archived']
const deviceTypes = ['rk3568', 'rk3588', 'kkos_gateway']
const roles = ['l2', 'mixed']
const deviceStatuses = ['offline', 'online', 'maintenance', 'disabled']
const resolutions = ['720p', '1080p', '2k', '4k']

const customerMap = computed(() => new Map(customers.value.map((item) => [item.customer_id, item])))
const siteMap = computed(() => new Map(sites.value.map((item) => [item.site_id, item])))

function withNames<T extends any>(rows: T[]) {
  return rows.map((row: any) => ({
    ...row,
    customer_name: customerMap.value.get(row.customer_id)?.customer_name || '-',
    site_name: siteMap.value.get(row.site_id)?.site_name || '-',
  }))
}
const devicesWithNames = computed(() => withNames(devices.value))
const camerasWithNames = computed(() => withNames(cameras.value))
const discoveredDevicesWithNames = computed(() => withNames(discoveredDevices.value))

function yes(value: boolean) { return value ? '是' : '否' }
function hasValue(value: any) { return value !== null && value !== undefined && value !== '' }
function deviceStatusText(status: string) {
  return ({ online: '在线', offline: '离线', unknown: '未知', maintenance: '维护', disabled: '禁用' } as any)[status] || status || '未知'
}
function deviceStatusTag(status: string) {
  return status === 'online' ? 'success' : status === 'offline' ? 'danger' : status === 'maintenance' ? 'warning' : 'info'
}
function statusSourceText(source: string) {
  return ({
    kkos_report: 'KKOS 上报',
    kkos_direct: 'KKOS 网关心跳',
    kkos_http: 'KKOS 主动刷新',
    kkos_report_stale: 'KKOS 上报已过期',
    kkos_probe_failed: 'KKOS 主动刷新失败',
    kkos_discovery: 'KKOS 发现',
    kkos_discovery_stale: 'KKOS 发现已过期',
    waiting_kkos_camera_report: '等待 KKOS 摄像头上报',
    cloud_rtsp_probe: '云端 RTSP 探测',
    cloud_rtsp_probe_failed: '云端 RTSP 探测失败',
    waiting_kkos_report: '等待 KKOS 上报',
    manual: '手工录入',
  } as any)[source] || source || '等待 KKOS 上报'
}
function perfText(row: any) {
  const memory = hasValue(row.memory_usage) ? `Memory ${row.memory_usage}%` : 'Memory 未采集'
  const cma = row.cma_usage ? `CMA ${row.cma_usage}` : 'CMA 未采集'
  const npu = hasValue(row.npu_latency_ms) ? `NPU ${row.npu_latency_ms}ms` : 'NPU 未采集'
  const temp = row.temperature ? `温度 ${row.temperature}` : '温度 未采集'
  return `${memory} · ${cma} · ${npu} · ${temp}`
}
function clone(row: any) { return JSON.parse(JSON.stringify(row || {})) }
function normalizePolicy(policy: any = {}) {
  return {
    allow_local_storage: policy.allow_local_storage !== false,
    allow_cloud_upload: policy.allow_cloud_upload !== false,
    allow_auto_labeling: policy.allow_auto_labeling !== false,
    allow_customer_model_training: (policy.allow_customer_model_training ?? policy.allow_model_training) !== false,
    allow_platform_baseline_training: policy.allow_platform_baseline_training === true,
    require_human_review: policy.require_human_review !== false,
  }
}
async function load() {
  customers.value = (await api.get('/customers')).data
  sites.value = (await api.get('/sites')).data
  devices.value = (await api.get('/managed-devices')).data
  cameras.value = (await api.get('/cameras')).data
  discoveredDevices.value = (await api.get('/kkos/discovered-devices/report')).data
  discoveryCapabilities.value = (await api.get('/kkos/discovery-capabilities')).data
}
function firstCustomerId() { return customers.value[0]?.customer_id || '' }
function firstSiteId(customerId = firstCustomerId()) { return sites.value.find((item) => item.customer_id === customerId)?.site_id || '' }
function sitesFor(customerId: string) { return sites.value.filter((item) => item.customer_id === customerId) }
function isKkosGateway(payload: any) {
  return ['rk3568', 'rk3588', 'kkos_gateway'].includes(payload.device_type) && ['l2', 'mixed'].includes(payload.role)
}
function canEditDevice(row: any) { return isKkosGateway(row) }

function openCustomer(row?: any) {
  customerForm.value = row ? { ...clone(row), data_policy: normalizePolicy(row.data_policy) } : {
    customer_name: '',
    customer_type: 'property_company',
    contact_name: '',
    contact_phone: '',
    contact_email: '',
    address: '',
    status: 'trial',
    service_plan: 'standard',
    data_policy: { allow_local_storage: true, allow_cloud_upload: false, allow_auto_labeling: true, allow_customer_model_training: true, allow_platform_baseline_training: false, require_human_review: true },
  }
  editingCustomer.value = true
}
function openSite(row?: any) {
  siteForm.value = row ? clone(row) : { customer_id: firstCustomerId(), site_name: '', site_type: 'residential_community', address: '', timezone: 'Asia/Shanghai', status: 'planning', notes: '' }
  editingSite.value = true
}
function openDevice(row?: any) {
  const customerId = firstCustomerId()
  deviceForm.value = row ? clone(row) : { customer_id: customerId, site_id: firstSiteId(customerId), device_name: '', device_type: 'rk3568', role: 'l2', ip: '', tailscale_ip: '', firmware_version: '', current_model_version: '', status: 'unknown' }
  editingDevice.value = true
}
function openCamera(row?: any) {
  const customerId = firstCustomerId()
  const siteId = firstSiteId(customerId)
  cameraForm.value = row ? clone(row) : { customer_id: customerId, site_id: siteId, camera_name: '', location: '', rtsp_url: '', resolution: '1080p', source_type: 'real_camera', status: 'offline' }
  editingCamera.value = true
}

async function saveCustomer() {
  const payload = customerForm.value
  const saved = payload.customer_id ? (await api.put(`/customers/${payload.customer_id}`, payload)).data : (await api.post('/customers', payload)).data
  window.dispatchEvent(new CustomEvent('guardian-data-policy-change', { detail: { customer_id: saved.customer_id, policy: saved.data_policy } }))
  ElMessage.success('客户信息已保存')
  editingCustomer.value = false
  await load()
}
async function saveSite() {
  const payload = siteForm.value
  if (!payload.customer_id) return ElMessage.warning('请先选择所属客户')
  payload.site_id ? await api.put(`/sites/${payload.site_id}`, payload) : await api.post('/sites', payload)
  ElMessage.success('项目信息已保存')
  editingSite.value = false
  await load()
}
async function saveDevice() {
  const payload = deviceForm.value
  if (!payload.customer_id) return ElMessage.warning('请先选择所属客户')
  if (!isKkosGateway(payload)) return ElMessage.warning('平台只能手工新增 L2 / KKOS 网关，L1/摄像头/IoT 请从现场发现确认入库')
  const saved = payload.device_id ? (await api.put(`/managed-devices/${payload.device_id}`, payload)).data : (await api.post('/managed-devices', payload)).data
  try {
    await api.post(`/managed-devices/${saved.device_id}/refresh`)
    ElMessage.success('KKOS 网关已保存，并已主动刷新状态')
  } catch (error: any) {
    ElMessage.warning(error?.response?.data?.message || 'KKOS 网关已保存，但主动刷新失败')
  }
  editingDevice.value = false
  await load()
}
async function refreshDevice(row: any) {
  try {
    await api.post(`/managed-devices/${row.device_id}/refresh`)
    ElMessage.success('网关状态已刷新')
  } catch (error: any) {
    ElMessage.warning(error?.response?.data?.message || '网关状态刷新失败')
  }
  await load()
}
async function confirmDiscovered(row: any) {
  await api.post(`/kkos/discovered-devices/${row.discovery_id}/confirm`, {})
  ElMessage.success(row.category === 'camera' ? '摄像头已确认入库' : '设备已确认入库')
  await load()
}
async function scanDiscovery() {
  scanningDiscovery.value = true
  try {
    const customerId = firstCustomerId()
    const siteId = firstSiteId(customerId)
    const res = await api.post('/kkos/discovery/scan', { customer_id: customerId, site_id: siteId })
    const count = res.data?.results?.reduce((sum: number, item: any) => sum + Number(item.scan_count || 0), 0) ?? 0
    ElMessage.success(`已触发 KKOS 现场扫描，发现 ${count} 个候选设备`)
  } catch (error: any) {
    ElMessage.warning(error?.response?.data?.message || 'KKOS 现场扫描失败，请检查网关在线状态')
  } finally {
    scanningDiscovery.value = false
    await load()
  }
}
async function saveCamera() {
  const { assigned_l1_device_id, assigned_l2_device_id, ...payload } = cameraForm.value
  if (!payload.customer_id) return ElMessage.warning('请先选择所属客户')
  payload.camera_id ? await api.put(`/cameras/${payload.camera_id}`, payload) : await api.post('/cameras', payload)
  ElMessage.success('摄像头信息已保存')
  editingCamera.value = false
  await load()
}
function enterProject(row: any, targetMode = 'project_manager') {
  const customer = customerMap.value.get(row.customer_id)
  localStorage.setItem('guardian_console_mode', targetMode)
  localStorage.setItem('guardian_customer_id', row.customer_id)
  localStorage.setItem('guardian_customer_name', customer?.customer_name || row.customer_name || row.customer_id)
  localStorage.setItem('guardian_site_id', row.site_id)
  localStorage.setItem('guardian_site_name', row.site_name)
  window.dispatchEvent(new Event('guardian-session-change'))
  router.push('/customer-workspace')
}
onMounted(load)
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
.page-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
.actions { display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
.device-sub { margin-top:4px; font-size:12px; color:#94a3b8; line-height:1.3; }
.tab-tip { margin-bottom:12px; }
.discovery-card { margin-bottom:14px; border-radius:8px; border:1px solid #dbe4ef; }
.card-header { display:flex; justify-content:space-between; align-items:center; gap:12px; }
</style>
