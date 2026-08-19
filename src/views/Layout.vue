<template>
  <el-container class="shell">
    <el-aside width="238px" class="sidebar">
      <div class="brand">
        <div class="brand-mark">T</div>
        <div>
          <div class="brand-title">守界 Guardian</div>
          <div class="brand-subtitle">AI 运行驾驶舱</div>
        </div>
      </div>
      <div class="scope">
        <div class="scope-label">{{ scopeLabel }}</div>
        <div class="scope-name">{{ mode === 'platform' ? 'platform_super_admin' : siteName }}</div>
        <div v-if="mode !== 'platform'" class="scope-customer">{{ customerName }}</div>
        <el-button v-if="mode !== 'platform'" size="small" @click="leaveProject">返回平台后台</el-button>
      </div>
      <el-menu :router="true" background-color="#111827" text-color="#aeb7c8" active-text-color="#57c7ff" :default-active="$route.path" :default-openeds="defaultOpeneds">
        <template v-for="group in menuGroups" :key="group.label">
          <el-sub-menu v-if="group.children" :index="group.label">
            <template #title>{{ group.label }}</template>
            <el-menu-item v-for="item in group.children" :key="item.path" :index="item.path">{{ item.label }}</el-menu-item>
          </el-sub-menu>
          <el-menu-item v-else :index="group.path">{{ group.label }}</el-menu-item>
        </template>
      </el-menu>
    </el-aside>
    <el-main class="main">
      <router-view />
    </el-main>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const rawMode = localStorage.getItem('guardian_console_mode') || 'platform'
function normalizeMode(value: string) {
  if (value === 'customer' || value === 'project' || value === 'project_manager') return 'project_manager'
  if (value === 'project_operator') return 'project_operator'
  return 'platform'
}
const mode = ref(normalizeMode(rawMode))
const customerName = ref(localStorage.getItem('guardian_customer_name') || '未选择客户')
const siteName = ref(localStorage.getItem('guardian_site_name') || '未选择项目')
const platformMenuGroups = [
  {
    label: '平台管理员',
    children: [
      { path: '/dashboard', label: '平台总览' },
      { path: '/customer-center', label: '客户 / 项目 / 授权' },
      { path: '/audit', label: '平台审计' },
      { path: '/devices-logs', label: '平台日志' },
    ],
  },
  {
    label: '算法与模型',
    children: [
      { path: '/scenario-policies', label: '场景模板 / 冷启动' },
      { path: '/model-registry', label: '模型仓库' },
    ],
  },
]
const projectManagerMenuGroups = [
  {
    label: '项目管理',
    children: [
      { path: '/customer-workspace', label: '项目总览' },
      { path: '/alarm-center', label: '告警中心' },
      { path: '/event-handling', label: '事件处理' },
      { path: '/device-status', label: '设备状态' },
    ],
  },
  {
    label: '现场配置',
    children: [
      { path: '/camera-bindings', label: '摄像头 / 算法 / 哨兵绑定' },
      { path: '/runtime-configs', label: 'L1/L2 运行配置' },
      { path: '/project-settings', label: '项目设置' },
    ],
  },
  {
    label: '边缘监控',
    children: [
      { path: '/l1-monitor', label: 'L1 哨兵监控' },
      { path: '/l2-monitor', label: 'L2 网关监控' },
      { path: '/streams', label: '视频流状态' },
    ],
  },
  {
    label: 'Forge 训练中心',
    children: [
      { path: '/forge/materials', label: '素材收集' },
      { path: '/forge/vlm-audit', label: 'VLM 审计' },
      { path: '/forge/human-review', label: '人工审核' },
      { path: '/forge/datasets', label: '训练数据集' },
      { path: '/forge/release', label: '训练与发布' },
    ],
  },
]
const projectOperatorMenuGroups = [
  {
    label: '值班操作',
    children: [
      { path: '/customer-workspace', label: '值班首页' },
      { path: '/alarm-center', label: '告警中心' },
      { path: '/event-handling', label: '事件处理' },
      { path: '/device-status', label: '设备状态' },
    ],
  },
  {
    label: '追溯排查',
    children: [
      { path: '/core-logs', label: '核心链路追踪' },
    ],
  },
]
const menuGroups = computed(() => {
  if (mode.value === 'platform') return platformMenuGroups
  if (mode.value === 'project_operator') return projectOperatorMenuGroups
  return projectManagerMenuGroups
})
const scopeLabel = computed(() => {
  if (mode.value === 'platform') return '平台管理员后台'
  if (mode.value === 'project_operator') return '项目操作台'
  return '项目管理后台'
})
const defaultOpeneds = computed(() => menuGroups.value.map((group) => group.label))

function refreshSession() {
  const nextMode = localStorage.getItem('guardian_console_mode') || 'platform'
  mode.value = normalizeMode(nextMode)
  customerName.value = localStorage.getItem('guardian_customer_name') || '未选择客户'
  siteName.value = localStorage.getItem('guardian_site_name') || '未选择项目'
}
function leaveProject() {
  localStorage.setItem('guardian_console_mode', 'platform')
  localStorage.removeItem('guardian_customer_id')
  localStorage.removeItem('guardian_customer_name')
  localStorage.removeItem('guardian_site_id')
  localStorage.removeItem('guardian_site_name')
  refreshSession()
  router.push('/dashboard')
}
onMounted(() => window.addEventListener('guardian-session-change', refreshSession))
onUnmounted(() => window.removeEventListener('guardian-session-change', refreshSession))
</script>

<style scoped>
.shell { min-height: 100vh; background: #0f172a; }
.sidebar { background: #111827; border-right: 1px solid #223049; }
.brand { display: flex; gap: 12px; align-items: center; padding: 18px 16px; color: #f8fafc; }
.brand-mark { width: 38px; height: 38px; border-radius: 8px; background: #0ea5e9; display: grid; place-items: center; font-weight: 800; }
.brand-title { font-size: 17px; font-weight: 700; }
.brand-subtitle { font-size: 12px; color: #94a3b8; margin-top: 2px; }
.scope { margin: 0 14px 12px; padding: 10px; border: 1px solid #223049; border-radius: 8px; color: #dbeafe; background: #0b1220; }
.scope-label { font-weight: 700; font-size: 13px; }
.scope-name { color: #94a3b8; font-size: 12px; margin: 4px 0 8px; word-break: break-all; }
.scope-customer { color: #64748b; font-size: 12px; margin: -4px 0 8px; word-break: break-all; }
.main { background: #f4f7fb; padding: 18px; }
:deep(.el-menu) { border-right: 0; }
:deep(.el-menu-item) { height: 42px; }
:deep(.el-sub-menu__title) { height: 42px; font-weight: 700; color: #dbeafe; }
</style>
