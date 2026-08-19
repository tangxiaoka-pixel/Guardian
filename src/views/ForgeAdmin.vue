<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>Guardian Forge 训练中心</h2>
        <p>云端主控平台：训练节点、项目/设备绑定、样本授权、模型版本、发布审批、心跳与同步接口。</p>
      </div>
      <el-button type="primary" @click="refreshAll">刷新</el-button>
    </header>

    <el-card class="panel" shadow="never">
      <el-tabs v-model="activeTab" @tab-change="goTab">
        <el-tab-pane v-for="tab in tabs" :key="tab.name" :name="tab.name" :label="tab.label" />
      </el-tabs>

      <template v-if="activeTab === 'dashboard'">
        <div class="metrics">
          <el-card v-for="item in summaryCards" :key="item.label" shadow="never" class="metric">
            <strong>{{ item.value }}</strong>
            <span>{{ item.label }}</span>
          </el-card>
        </div>
        <div class="grid2">
          <el-card shadow="never" header="训练节点在线状态">
            <el-table :data="summary.centers || []" height="260">
              <el-table-column prop="forgeCenterName" label="节点" min-width="190" />
              <el-table-column prop="forgeCenterType" label="类型" width="150" />
              <el-table-column label="状态" width="100"><template #default="{ row }"><StatusTag :value="row.computedStatus || row.status" /></template></el-table-column>
              <el-table-column prop="tailscaleIp" label="Tailscale" width="150" />
            </el-table>
          </el-card>
          <el-card shadow="never" header="最近模型版本">
            <el-table :data="summary.recentModels || []" height="260">
              <el-table-column prop="modelName" label="模型" min-width="220" />
              <el-table-column prop="sourceType" label="来源" width="150" />
              <el-table-column prop="status" label="状态" width="130" />
              <el-table-column prop="map50" label="mAP50" width="90" />
            </el-table>
          </el-card>
        </div>
      </template>

      <template v-else-if="activeTab === 'centers'">
        <Toolbar title="训练中心管理" action="新增训练中心" @action="openCreate('center')" />
        <el-table :data="centers" stripe>
          <el-table-column prop="forgeCenterName" label="训练中心" min-width="210" />
          <el-table-column prop="forgeCenterType" label="类型" width="160" />
          <el-table-column label="状态" width="100"><template #default="{ row }"><StatusTag :value="row.computedStatus || row.status" /></template></el-table-column>
          <el-table-column prop="customerName" label="客户" width="150" />
          <el-table-column prop="projectName" label="项目" width="180" />
          <el-table-column prop="tailscaleIp" label="Tailscale IP" width="150" />
          <el-table-column prop="gpuModel" label="GPU" width="130" />
          <el-table-column prop="version" label="版本" width="90" />
          <el-table-column label="操作" width="260" fixed="right">
            <template #default="{ row }">
              <el-button size="small" @click="inspect(row)">查看</el-button>
              <el-button size="small" @click="patchCenter(row, { status: row.status === 'active' ? 'inactive' : 'active' })">{{ row.status === 'active' ? '停用' : '启用' }}</el-button>
              <el-button size="small" type="primary" @click="createActivation(row)">激活码</el-button>
              <el-button size="small" type="danger" @click="deleteCenter(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </template>

      <template v-else-if="activeTab === 'activation'">
        <Toolbar title="节点注册与激活" action="生成激活码" @action="openCreate('activation')" />
        <el-table :data="activations" stripe>
          <el-table-column prop="activationCode" label="激活码" min-width="190" />
          <el-table-column prop="forgeCenterName" label="训练中心" min-width="220" />
          <el-table-column label="状态" width="110"><template #default="{ row }"><StatusTag :value="row.status" /></template></el-table-column>
          <el-table-column prop="expiresAt" label="有效期" min-width="190" />
          <el-table-column prop="activatedByNodeId" label="激活节点" min-width="180" />
          <el-table-column label="操作" width="160"><template #default="{ row }"><el-button size="small" @click="copy(row.activationCode)">复制</el-button><el-button size="small" type="danger" @click="revokeActivation(row)">禁用</el-button></template></el-table-column>
        </el-table>
      </template>

      <template v-else-if="activeTab === 'projectBindings'">
        <Toolbar title="项目绑定" action="新增项目绑定" @action="openCreate('projectBinding')" />
        <el-alert type="info" :closable="false" show-icon title="规则：project_forge_node 只能 exclusive 且只能绑定一个项目；platform_forge 可 shared/delegated 绑定多个项目。" />
        <el-table :data="projectBindings" stripe>
          <el-table-column prop="forgeCenterName" label="训练中心" min-width="220" />
          <el-table-column prop="forgeCenterType" label="类型" width="160" />
          <el-table-column prop="customerName" label="客户" width="160" />
          <el-table-column prop="projectName" label="项目" min-width="180" />
          <el-table-column label="算法 / 场景" min-width="190"><template #default="{ row }">{{ algorithmLabel(row.scenario) }}</template></el-table-column>
          <el-table-column prop="bindingMode" label="模式" width="120" />
          <el-table-column label="状态" width="100"><template #default="{ row }"><StatusTag :value="row.status" /></template></el-table-column>
          <el-table-column label="操作" width="120"><template #default="{ row }"><el-button size="small" type="danger" @click="deleteProjectBinding(row)">解除</el-button></template></el-table-column>
        </el-table>
      </template>

      <template v-else-if="activeTab === 'deviceBindings'">
        <Toolbar title="设备绑定" action="新增设备绑定" @action="openCreate('deviceBinding')" />
        <el-table :data="deviceBindings" stripe>
          <el-table-column prop="forgeCenterName" label="训练中心" min-width="220" />
          <el-table-column prop="projectName" label="项目" min-width="180" />
          <el-table-column prop="edgeDeviceName" label="设备" min-width="190" />
          <el-table-column prop="cameraName" label="摄像头" min-width="180" />
          <el-table-column label="算法 / 场景" min-width="190"><template #default="{ row }">{{ algorithmLabel(row.scenario) }}</template></el-table-column>
          <el-table-column prop="deviceRole" label="角色" width="130" />
          <el-table-column label="上传" width="90"><template #default="{ row }"><el-tag :type="row.uploadAllowed ? 'success' : 'info'">{{ row.uploadAllowed ? '允许' : '禁止' }}</el-tag></template></el-table-column>
          <el-table-column label="下发" width="90"><template #default="{ row }"><el-tag :type="row.modelDeployAllowed ? 'success' : 'info'">{{ row.modelDeployAllowed ? '允许' : '禁止' }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="290"><template #default="{ row }"><el-button size="small" @click="openEditDeviceBinding(row)">配置算法</el-button><el-button size="small" @click="patchDeviceBinding(row, { uploadAllowed: !row.uploadAllowed })">切换上传</el-button><el-button size="small" type="danger" @click="deleteDeviceBinding(row)">解除</el-button></template></el-table-column>
        </el-table>
      </template>

      <template v-else-if="activeTab === 'samplePolicies'">
        <Toolbar title="样本策略中心" action="新增样本策略" @action="openCreate('samplePolicy')" />
        <el-table :data="samplePolicies" stripe>
          <el-table-column prop="customerName" label="客户" width="160" />
          <el-table-column prop="projectName" label="项目" min-width="180" />
          <el-table-column label="策略" min-width="330">
            <template #default="{ row }">
              <el-tag :type="row.allowSampleUpload ? 'success' : 'info'">上传 {{ row.allowSampleUpload ? '开' : '关' }}</el-tag>
              <el-tag :type="row.allowTraining ? 'success' : 'danger'">训练 {{ row.allowTraining ? '允许' : '禁止' }}</el-tag>
              <el-tag :type="row.allowPlatformDataset ? 'warning' : 'info'">平台库 {{ row.allowPlatformDataset ? '允许' : '禁止' }}</el-tag>
              <el-tag :type="row.requirePrivacyMask ? 'warning' : 'info'">脱敏 {{ row.requirePrivacyMask ? '需要' : '不需要' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="dataUsageScope" label="使用范围" width="170" />
          <el-table-column prop="consentStatus" label="授权" width="110" />
          <el-table-column label="风险提示" min-width="240"><template #default="{ row }"><span class="risk">{{ policyRisk(row) }}</span></template></el-table-column>
        </el-table>
      </template>

      <template v-else-if="activeTab === 'modelVersions'">
        <Toolbar title="模型版本中心" action="手动新增模型" @action="openCreate('modelVersion')" />
        <el-table :data="modelVersions" stripe>
          <el-table-column prop="modelName" label="模型名称" min-width="250" />
          <el-table-column prop="version" label="版本" width="90" />
          <el-table-column prop="sourceType" label="来源" width="160" />
          <el-table-column prop="forgeCenterName" label="训练中心" min-width="210" />
          <el-table-column prop="projectName" label="项目" min-width="180" />
          <el-table-column prop="sceneName" label="场景" width="140" />
          <el-table-column prop="targetDevice" label="目标" width="100" />
          <el-table-column prop="map50" label="mAP50" width="90" />
          <el-table-column label="状态" width="120"><template #default="{ row }"><StatusTag :value="row.status" /></template></el-table-column>
          <el-table-column label="操作" width="250"><template #default="{ row }"><el-button size="small" @click="markRecommended(row)">推荐</el-button><el-button size="small" type="primary" @click="createApproval(row)">发起发布</el-button><el-button size="small" type="danger" @click="archiveModel(row)">归档</el-button></template></el-table-column>
        </el-table>
      </template>

      <template v-else-if="activeTab === 'releaseApprovals'">
        <Toolbar title="模型发布审批" action="创建发布申请" @action="openCreate('approval')" />
        <el-table :data="releaseApprovals" stripe>
          <el-table-column prop="modelName" label="模型" min-width="240" />
          <el-table-column prop="releaseScope" label="范围" width="180" />
          <el-table-column prop="releaseType" label="类型" width="100" />
          <el-table-column label="校验结果" min-width="240"><template #default="{ row }"><el-tag :type="row.validationResult?.ok ? 'success' : 'danger'">{{ row.validationResult?.ok ? '通过' : '失败' }}</el-tag><span class="hint">{{ (row.validationResult?.warnings || []).join('；') }}</span></template></el-table-column>
          <el-table-column label="状态" width="120"><template #default="{ row }"><StatusTag :value="row.approvalStatus" /></template></el-table-column>
          <el-table-column label="操作" width="180"><template #default="{ row }"><el-button size="small" type="success" @click="approve(row)">通过</el-button><el-button size="small" type="danger" @click="reject(row)">驳回</el-button></template></el-table-column>
        </el-table>
      </template>

      <template v-else-if="activeTab === 'releases'">
        <Toolbar title="发布与回滚记录" action="刷新记录" @action="loadReleases" />
        <el-table :data="releases" stripe>
          <el-table-column prop="modelName" label="模型" min-width="250" />
          <el-table-column prop="version" label="版本" width="90" />
          <el-table-column prop="releaseScope" label="范围" width="180" />
          <el-table-column prop="releaseType" label="类型" width="100" />
          <el-table-column label="状态" width="120"><template #default="{ row }"><StatusTag :value="row.releaseStatus" /></template></el-table-column>
          <el-table-column prop="releasedAt" label="发布时间" min-width="190" />
          <el-table-column label="操作" width="120"><template #default="{ row }"><el-button size="small" @click="rollback(row)">回滚</el-button></template></el-table-column>
        </el-table>
      </template>

      <template v-else-if="activeTab === 'heartbeats'">
        <Toolbar title="节点心跳监控" />
        <el-table :data="heartbeats" stripe>
          <el-table-column prop="forgeCenterName" label="节点" min-width="220" />
          <el-table-column label="状态" width="110"><template #default="{ row }"><StatusTag :value="row.nodeStatus" /></template></el-table-column>
          <el-table-column prop="tailscaleIp" label="Tailscale" width="150" />
          <el-table-column prop="gpuModel" label="GPU" width="140" />
          <el-table-column label="资源" min-width="260"><template #default="{ row }">CPU {{ pct(row.cpuUsage) }} · MEM {{ pct(row.memoryUsage) }} · GPU {{ row.gpuMemoryUsed }}/{{ row.gpuMemoryTotal }} · Disk {{ row.diskUsed }}/{{ row.diskTotal }}</template></el-table-column>
          <el-table-column prop="sampleCount" label="样本数" width="100" />
          <el-table-column prop="reportedAt" label="上报时间" min-width="190" />
          <el-table-column prop="lastError" label="异常" min-width="180" />
        </el-table>
      </template>

      <template v-else-if="activeTab === 'syncLogs'">
        <Toolbar title="同步接口日志" />
        <el-table :data="syncLogs" stripe>
          <el-table-column prop="nodeName" label="节点" min-width="220" />
          <el-table-column prop="actionType" label="动作" width="170" />
          <el-table-column label="状态" width="100"><template #default="{ row }"><StatusTag :value="row.status" /></template></el-table-column>
          <el-table-column prop="requestSummary" label="请求摘要" min-width="240" />
          <el-table-column prop="responseSummary" label="响应摘要" min-width="240" />
          <el-table-column prop="errorMessage" label="错误" min-width="180" />
          <el-table-column prop="createdAt" label="时间" min-width="190" />
        </el-table>
      </template>
    </el-card>

    <el-dialog v-model="dialog.visible" :title="dialog.title" width="760px">
      <el-form label-width="150px">
        <template v-if="dialog.kind === 'center'">
          <el-form-item label="训练中心名称"><el-input v-model="form.forgeCenterName" /></el-form-item>
          <el-form-item label="类型"><el-select v-model="form.forgeCenterType"><el-option v-for="v in centerTypes" :key="v" :label="v" :value="v" /></el-select></el-form-item>
          <el-form-item label="客户"><el-select v-model="form.customerId" filterable clearable><el-option v-for="c in customers" :key="c.customer_id" :label="c.customer_name" :value="c.customer_id" /></el-select></el-form-item>
          <el-form-item label="项目"><el-select v-model="form.projectId" filterable clearable><el-option v-for="s in sites" :key="s.site_id" :label="s.site_name" :value="s.site_id" /></el-select></el-form-item>
          <el-form-item label="Tailscale IP"><el-input v-model="form.tailscaleIp" /></el-form-item>
          <el-form-item label="GPU"><el-input v-model="form.gpuModel" /></el-form-item>
        </template>
        <template v-else-if="dialog.kind === 'activation'">
          <el-form-item label="训练中心"><el-select v-model="form.forgeCenterId" filterable><el-option v-for="c in centers" :key="c.forgeCenterId" :label="c.forgeCenterName" :value="c.forgeCenterId" /></el-select></el-form-item>
          <el-form-item label="有效期"><el-date-picker v-model="form.expiresAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss.sssZ" /></el-form-item>
        </template>
        <template v-else-if="dialog.kind === 'projectBinding'">
          <el-form-item label="训练中心"><el-select v-model="form.forgeCenterId" filterable><el-option v-for="c in centers" :key="c.forgeCenterId" :label="c.forgeCenterName" :value="c.forgeCenterId" /></el-select></el-form-item>
          <el-form-item label="客户"><el-select v-model="form.customerId" filterable><el-option v-for="c in customers" :key="c.customer_id" :label="c.customer_name" :value="c.customer_id" /></el-select></el-form-item>
          <el-form-item label="项目"><el-select v-model="form.projectId" filterable><el-option v-for="s in sites" :key="s.site_id" :label="s.site_name" :value="s.site_id" /></el-select></el-form-item>
          <el-form-item label="算法 / 场景"><el-select v-model="form.scenario" filterable clearable placeholder="可选：限定该项目的训练场景"><el-option v-for="item in algorithms" :key="item.scenario" :label="`${item.display_name || item.scenario} · ${item.scenario}`" :value="item.scenario" /></el-select></el-form-item>
          <el-form-item label="绑定模式"><el-select v-model="form.bindingMode"><el-option label="exclusive" value="exclusive" /><el-option label="shared" value="shared" /><el-option label="delegated" value="delegated" /></el-select></el-form-item>
        </template>
        <template v-else-if="dialog.kind === 'deviceBinding' || dialog.kind === 'deviceBindingEdit'">
          <el-form-item label="训练中心"><el-select v-model="form.forgeCenterId" filterable><el-option v-for="c in centers" :key="c.forgeCenterId" :label="c.forgeCenterName" :value="c.forgeCenterId" /></el-select></el-form-item>
          <el-form-item label="客户"><el-select v-model="form.customerId" filterable><el-option v-for="c in customers" :key="c.customer_id" :label="c.customer_name" :value="c.customer_id" /></el-select></el-form-item>
          <el-form-item label="项目"><el-select v-model="form.projectId" filterable><el-option v-for="s in sites" :key="s.site_id" :label="s.site_name" :value="s.site_id" /></el-select></el-form-item>
          <el-form-item label="设备"><el-select v-model="form.edgeDeviceId" filterable clearable><el-option v-for="d in devices" :key="d.device_id" :label="d.device_name" :value="d.device_id" /></el-select></el-form-item>
          <el-form-item label="摄像头"><el-select v-model="form.cameraId" filterable clearable><el-option v-for="c in cameras" :key="c.camera_id" :label="c.camera_name" :value="c.camera_id" /></el-select></el-form-item>
          <el-form-item label="算法 / 场景"><el-select v-model="form.scenario" filterable clearable placeholder="摄像头样本必须选择算法"><el-option v-for="item in algorithms" :key="item.scenario" :label="`${item.display_name || item.scenario} · ${item.scenario}`" :value="item.scenario" /></el-select></el-form-item>
          <el-form-item label="角色"><el-select v-model="form.deviceRole"><el-option v-for="v in deviceRoles" :key="v" :label="v" :value="v" /></el-select></el-form-item>
          <el-form-item label="权限"><el-checkbox v-model="form.uploadAllowed">允许上传样本</el-checkbox><el-checkbox v-model="form.modelDeployAllowed">允许模型下发</el-checkbox></el-form-item>
        </template>
        <template v-else-if="dialog.kind === 'samplePolicy'">
          <el-form-item label="客户"><el-select v-model="form.customerId" filterable><el-option v-for="c in customers" :key="c.customer_id" :label="c.customer_name" :value="c.customer_id" /></el-select></el-form-item>
          <el-form-item label="项目"><el-select v-model="form.projectId" filterable><el-option v-for="s in sites" :key="s.site_id" :label="s.site_name" :value="s.site_id" /></el-select></el-form-item>
          <el-form-item label="授权"><el-checkbox v-model="form.allowSampleUpload">允许上传</el-checkbox><el-checkbox v-model="form.allowTraining">允许训练</el-checkbox><el-checkbox v-model="form.allowPlatformDataset">允许平台公共库</el-checkbox><el-checkbox v-model="form.requirePrivacyMask">需要脱敏</el-checkbox></el-form-item>
          <el-form-item label="使用范围"><el-select v-model="form.dataUsageScope"><el-option label="customer_only" value="customer_only" /><el-option label="platform_anonymous" value="platform_anonymous" /><el-option label="no_training" value="no_training" /></el-select></el-form-item>
        </template>
        <template v-else-if="dialog.kind === 'modelVersion'">
          <el-form-item label="模型名称"><el-input v-model="form.modelName" /></el-form-item>
          <el-form-item label="版本"><el-input v-model="form.version" /></el-form-item>
          <el-form-item label="来源"><el-select v-model="form.sourceType"><el-option label="platform_baseline" value="platform_baseline" /><el-option label="customer_delegated" value="customer_delegated" /><el-option label="project_local" value="project_local" /></el-select></el-form-item>
          <el-form-item label="训练中心"><el-select v-model="form.forgeCenterId" filterable><el-option v-for="c in centers" :key="c.forgeCenterId" :label="c.forgeCenterName" :value="c.forgeCenterId" /></el-select></el-form-item>
          <el-form-item label="客户/项目"><el-select v-model="form.customerId" filterable clearable><el-option v-for="c in customers" :key="c.customer_id" :label="c.customer_name" :value="c.customer_id" /></el-select><el-select v-model="form.projectId" filterable clearable><el-option v-for="s in sites" :key="s.site_id" :label="s.site_name" :value="s.site_id" /></el-select></el-form-item>
          <el-form-item label="目标设备"><el-select v-model="form.targetDevice"><el-option label="rv1126" value="rv1126" /><el-option label="rk3568" value="rk3568" /><el-option label="cloud" value="cloud" /></el-select></el-form-item>
        </template>
        <template v-else-if="dialog.kind === 'approval'">
          <el-form-item label="模型"><el-select v-model="form.modelVersionId" filterable><el-option v-for="m in modelVersions" :key="m.modelVersionId" :label="`${m.modelName} ${m.version}`" :value="m.modelVersionId" /></el-select></el-form-item>
          <el-form-item label="发布范围"><el-select v-model="form.releaseScope"><el-option label="project_only" value="project_only" /><el-option label="selected_devices" value="selected_devices" /><el-option label="selected_cameras" value="selected_cameras" /><el-option label="platform_authorized_projects" value="platform_authorized_projects" /></el-select></el-form-item>
          <el-form-item label="发布类型"><el-select v-model="form.releaseType"><el-option label="gray" value="gray" /><el-option label="full" value="full" /><el-option label="rollback" value="rollback" /></el-select></el-form-item>
          <el-form-item label="目标设备"><el-select v-model="form.targetDeviceIds" multiple filterable><el-option v-for="d in devices" :key="d.device_id" :label="d.device_name" :value="d.device_id" /></el-select></el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" @click="submitDialog">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, ElTag } from 'element-plus'
import api from '../api'

const route = useRoute()
const router = useRouter()
const tabs = [
  { name: 'dashboard', label: '训练中心总览', path: '/forge' },
  { name: 'centers', label: '训练中心管理', path: '/forge/centers' },
  { name: 'activation', label: '节点注册与激活', path: '/forge/activation' },
  { name: 'projectBindings', label: '项目绑定', path: '/forge/project-bindings' },
  { name: 'deviceBindings', label: '设备绑定', path: '/forge/device-bindings' },
  { name: 'samplePolicies', label: '样本策略中心', path: '/forge/sample-policies' },
  { name: 'modelVersions', label: '模型版本中心', path: '/forge/model-versions' },
  { name: 'releaseApprovals', label: '模型发布审批', path: '/forge/release-approvals' },
  { name: 'releases', label: '发布与回滚记录', path: '/forge/releases' },
  { name: 'heartbeats', label: '节点心跳监控', path: '/forge/heartbeats' },
  { name: 'syncLogs', label: '同步接口日志', path: '/forge/sync-logs' },
]
const activeTab = ref('dashboard')
const summary = ref<any>({})
const centers = ref<any[]>([])
const activations = ref<any[]>([])
const projectBindings = ref<any[]>([])
const deviceBindings = ref<any[]>([])
const samplePolicies = ref<any[]>([])
const modelVersions = ref<any[]>([])
const releaseApprovals = ref<any[]>([])
const releases = ref<any[]>([])
const heartbeats = ref<any[]>([])
const syncLogs = ref<any[]>([])
const customers = ref<any[]>([])
const sites = ref<any[]>([])
const devices = ref<any[]>([])
const cameras = ref<any[]>([])
const algorithms = ref<any[]>([])
const dialog = reactive({ visible: false, kind: '', title: '' })
const form = reactive<any>({})
const centerTypes = ['platform_forge', 'project_forge_node', 'customer_private', 'cloud_gpu_node']
const deviceRoles = ['l1_device', 'l2_gateway', 'camera', 'training_node']

const Toolbar = defineComponent({
  props: { title: String, action: String },
  emits: ['action'],
  setup(props, { emit }) {
    return () => h('div', { class: 'toolbar' }, [
      h('strong', props.title),
      h('div'),
      props.action ? h('button', { class: 'el-button el-button--primary', onClick: () => emit('action') }, props.action) : null,
    ])
  },
})
const StatusTag = defineComponent({
  props: { value: String },
  setup(props) {
    const type = computed(() => ['active', 'online', 'approved', 'success', 'released', 'ready', 'evaluated'].includes(props.value || '') ? 'success' : ['offline', 'error', 'rejected', 'failed'].includes(props.value || '') ? 'danger' : ['pending', 'draft', 'warning', 'pending_release', 'gray_released'].includes(props.value || '') ? 'warning' : 'info')
    return () => h(ElTag, { type: type.value as any }, () => props.value || '-')
  },
})
const summaryCards = computed(() => [
  ['训练中心总数', summary.value.centerTotal],
  ['平台级训练中心', summary.value.platformCenterCount],
  ['项目级训练节点', summary.value.projectNodeCount],
  ['在线节点', summary.value.onlineNodeCount],
  ['离线节点', summary.value.offlineNodeCount],
  ['已绑定项目', summary.value.boundProjectCount],
  ['可训练项目', summary.value.trainableProjectCount],
  ['模型版本', summary.value.modelVersionCount],
  ['待发布', summary.value.pendingReleaseCount],
  ['已发布模型', summary.value.releasedModelCount],
].map(([label, value]) => ({ label, value: value ?? 0 })))

function syncTabFromRoute() {
  activeTab.value = tabs.find((item) => item.path === route.path)?.name || 'dashboard'
}
function goTab(name: string | number) {
  const tab = tabs.find((item) => item.name === name)
  if (tab) router.push(tab.path)
}
function pct(v: number) { return `${Math.round(Number(v || 0) * 100)}%` }
function policyRisk(row: any) {
  if (row.dataUsageScope === 'no_training') return '不允许加入训练数据集'
  if (row.requirePrivacyMask) return '该项目样本需脱敏后使用'
  if (row.allowPlatformDataset) return '需确认客户已授权平台公共样本库'
  return '低风险'
}
async function refreshAll() {
  await Promise.all([loadSummary(), loadCore(), loadCenters(), loadActivations(), loadProjectBindings(), loadDeviceBindings(), loadSamplePolicies(), loadModelVersions(), loadApprovals(), loadReleases(), loadHeartbeats(), loadSyncLogs()])
}
async function loadSummary() { summary.value = (await api.get('/admin/forge/summary')).data }
async function loadCore() {
  customers.value = (await api.get('/customers')).data
  sites.value = (await api.get('/sites')).data
  devices.value = (await api.get('/managed-devices')).data
  cameras.value = (await api.get('/cameras')).data
  const configs = (await api.get('/algorithms/configs')).data
  // 算法配置接口使用 algorithm 字段；Forge 绑定页面统一使用 scenario。
  // 在此归一化，避免下拉框出现 “undefined · undefined”。
  const displayNames: Record<string, string> = {
    desk_drink_intrusion: '桌面饮品容器禁放检测',
  }
  algorithms.value = (Array.isArray(configs) ? configs : []).map((item: any) => ({
    ...item,
    scenario: item.scenario || item.algorithm,
    display_name: item.display_name || displayNames[item.scenario || item.algorithm] || item.algorithm,
  })).filter((item: any) => Boolean(item.scenario))
}
function algorithmLabel(scenario: string) {
  if (!scenario) return '全部算法'
  const item = algorithms.value.find((row) => row.scenario === scenario)
  return item ? `${item.display_name || scenario} · ${scenario}` : scenario
}
async function loadCenters() { centers.value = (await api.get('/admin/forge/centers')).data }
async function loadActivations() { activations.value = (await api.get('/admin/forge/activations')).data }
async function loadProjectBindings() { projectBindings.value = (await api.get('/admin/forge/project-bindings')).data }
async function loadDeviceBindings() { deviceBindings.value = (await api.get('/admin/forge/device-bindings')).data }
async function loadSamplePolicies() { samplePolicies.value = (await api.get('/admin/forge/sample-policies')).data }
async function loadModelVersions() { modelVersions.value = (await api.get('/admin/forge/model-versions')).data }
async function loadApprovals() { releaseApprovals.value = (await api.get('/admin/forge/release-approvals')).data }
async function loadReleases() { releases.value = (await api.get('/admin/forge/releases')).data }
async function loadHeartbeats() { heartbeats.value = (await api.get('/admin/forge/heartbeats')).data }
async function loadSyncLogs() { syncLogs.value = (await api.get('/admin/forge/sync-logs')).data }

function resetForm(payload: any = {}) {
  Object.keys(form).forEach((key) => delete form[key])
  Object.assign(form, payload)
}
function openCreate(kind: string) {
  const defaults: Record<string, any> = {
    center: { forgeCenterName: '新训练中心', forgeCenterType: 'project_forge_node', status: 'draft', version: '0.1.0' },
    activation: { forgeCenterId: centers.value[0]?.forgeCenterId, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() },
    projectBinding: { forgeCenterId: centers.value[1]?.forgeCenterId, customerId: customers.value[0]?.customer_id, projectId: sites.value[0]?.site_id, scenario: '', bindingMode: 'exclusive' },
    deviceBinding: { forgeCenterId: centers.value[1]?.forgeCenterId, customerId: customers.value[0]?.customer_id, projectId: sites.value[0]?.site_id, scenario: '', deviceRole: 'l2_gateway', uploadAllowed: true, modelDeployAllowed: true },
    samplePolicy: { customerId: customers.value[0]?.customer_id, projectId: sites.value[0]?.site_id, allowSampleUpload: true, allowTraining: true, allowPlatformDataset: false, requirePrivacyMask: true, allowLocalTraining: true, retentionDays: 90, dataUsageScope: 'customer_only', consentStatus: 'pending' },
    modelVersion: { modelName: 'manual_model_placeholder', version: '0.1.0', sourceType: 'project_local', forgeCenterId: centers.value[1]?.forgeCenterId, targetDevice: 'rv1126', status: 'draft' },
    approval: { modelVersionId: modelVersions.value.find((m) => ['ready', 'evaluated'].includes(m.status))?.modelVersionId, releaseScope: 'project_only', releaseType: 'gray', targetDeviceIds: [] },
  }
  resetForm(defaults[kind] || {})
  dialog.kind = kind
  dialog.title = ({ center: '新增训练中心', activation: '生成激活码', projectBinding: '新增项目绑定', deviceBinding: '新增设备绑定', deviceBindingEdit: '配置摄像头算法', samplePolicy: '新增样本策略', modelVersion: '手动新增模型', approval: '创建发布申请' } as any)[kind]
  dialog.visible = true
}
async function submitDialog() {
  const map: Record<string, string> = {
    center: '/admin/forge/centers',
    activation: '/admin/forge/activations',
    projectBinding: '/admin/forge/project-bindings',
    deviceBinding: '/admin/forge/device-bindings',
    samplePolicy: '/admin/forge/sample-policies',
    modelVersion: '/admin/forge/model-versions',
    approval: '/admin/forge/release-approvals',
  }
  try {
    if (dialog.kind === 'deviceBindingEdit') await api.patch(`/admin/forge/device-bindings/${form.bindingId}`, form)
    else await api.post(map[dialog.kind], form)
    ElMessage.success('已保存')
    dialog.visible = false
    await refreshAll()
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.detail || error?.message || '保存失败')
  }
}
async function patchCenter(row: any, patch: any) { await api.patch(`/admin/forge/centers/${row.forgeCenterId}`, patch); await refreshAll() }
async function deleteCenter(row: any) { await ElMessageBox.confirm(`确认删除 ${row.forgeCenterName}？`); await api.delete(`/admin/forge/centers/${row.forgeCenterId}`); await refreshAll() }
async function createActivation(row: any) { await api.post('/admin/forge/activations', { forgeCenterId: row.forgeCenterId }); ElMessage.success('激活码已生成'); await refreshAll() }
async function revokeActivation(row: any) { await api.patch(`/admin/forge/activations/${row.activationId}/revoke`); await refreshAll() }
async function deleteProjectBinding(row: any) { const res = await api.delete(`/admin/forge/project-bindings/${row.bindingId}`); ElMessage.warning(res.data.warning || '已解除绑定'); await refreshAll() }
async function patchDeviceBinding(row: any, patch: any) { await api.patch(`/admin/forge/device-bindings/${row.bindingId}`, patch); await refreshAll() }
function openEditDeviceBinding(row: any) {
  resetForm({ ...row })
  dialog.kind = 'deviceBindingEdit'
  dialog.title = '配置摄像头算法'
  dialog.visible = true
}
async function deleteDeviceBinding(row: any) { await api.delete(`/admin/forge/device-bindings/${row.bindingId}`); await refreshAll() }
async function markRecommended(row: any) { await api.post(`/admin/forge/model-versions/${row.modelVersionId}/mark-recommended`); await refreshAll() }
async function archiveModel(row: any) { await api.post(`/admin/forge/model-versions/${row.modelVersionId}/archive`); await refreshAll() }
function createApproval(row: any) { openCreate('approval'); form.modelVersionId = row.modelVersionId; form.releaseScope = row.sourceType === 'platform_baseline' ? 'platform_authorized_projects' : 'project_only'; form.releaseType = 'gray'; form.targetDeviceIds = deviceBindings.value.filter((d) => d.forgeCenterId === row.forgeCenterId && d.modelDeployAllowed && d.edgeDeviceId).map((d) => d.edgeDeviceId) }
async function approve(row: any) { await api.post(`/admin/forge/release-approvals/${row.approvalId}/approve`, {}); await refreshAll() }
async function reject(row: any) { await api.post(`/admin/forge/release-approvals/${row.approvalId}/reject`, { rejectReason: '评审驳回' }); await refreshAll() }
async function rollback(row: any) { await api.post(`/admin/forge/releases/${row.releaseId}/rollback`, { remark: '后台发起回滚' }); await refreshAll() }
function inspect(row: any) { ElMessage.info(JSON.stringify(row, null, 2).slice(0, 500)) }
async function copy(text: string) { await navigator.clipboard?.writeText(text); ElMessage.success('已复制') }

watch(() => route.path, syncTabFromRoute, { immediate: true })
onMounted(refreshAll)
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 14px; }
.page-head { display: flex; align-items: center; justify-content: space-between; }
.page-head h2 { margin: 0; }
.page-head p { margin: 6px 0 0; color: #64748b; }
.panel { border-radius: 14px; }
.metrics { display: grid; grid-template-columns: repeat(5, minmax(130px, 1fr)); gap: 12px; margin-bottom: 14px; }
.metric strong { display: block; font-size: 24px; color: #0f172a; }
.metric span { color: #64748b; font-size: 13px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.toolbar { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; margin: 8px 0 14px; }
.hint { margin-left: 8px; color: #92400e; font-size: 12px; }
.risk { color: #b45309; }
:deep(.el-tag) { margin-right: 6px; }
:deep(.el-select) { width: 100%; margin-right: 8px; }
</style>
