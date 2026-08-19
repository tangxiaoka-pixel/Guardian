import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/login', component: () => import('../views/Login.vue') },
  {
    path: '/',
    component: () => import('../views/Layout.vue'),
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'alarms', component: () => import('../views/Alarms.vue') },
      { path: 'audit', component: () => import('../views/Audit.vue') },
      { path: 'dashboard', component: () => import('../views/Dashboard.vue') },
      { path: 'role-matrix', component: () => import('../views/RoleMatrix.vue') },
      { path: 'customer-workspace', component: () => import('../views/CustomerWorkspace.vue') },
      { path: 'ai-lifecycle', redirect: '/forge/materials' },
      { path: 'platform-edge-gateways', component: () => import('../views/PlatformEdgeGateways.vue') },
      { path: 'edge-gateways', component: () => import('../views/EdgeGateways.vue') },
      { path: 'customer-ai-optimization', component: () => import('../views/CustomerAIOptimization.vue') },
      { path: 'customer-center', component: () => import('../views/CustomerCenter.vue') },
      { path: 'forge', redirect: '/forge/materials' },
      { path: 'forge/materials', component: () => import('../views/ForgeTrainingWorkspace.vue'), meta: { forgeStage: 'materials' } },
      { path: 'forge/vlm-audit', component: () => import('../views/ForgeTrainingWorkspace.vue'), meta: { forgeStage: 'vlm' } },
      { path: 'forge/human-review', component: () => import('../views/ForgeTrainingWorkspace.vue'), meta: { forgeStage: 'review' } },
      { path: 'forge/datasets', component: () => import('../views/ForgeTrainingWorkspace.vue'), meta: { forgeStage: 'datasets' } },
      { path: 'forge/release', component: () => import('../views/ForgeTrainingWorkspace.vue'), meta: { forgeStage: 'release' } },
      { path: 'closed-loop-trace', component: () => import('../views/ClosedLoopTrace.vue') },
      { path: 'core-logs', component: () => import('../views/CoreLogs.vue') },
      { path: 'forge/centers', component: () => import('../views/ForgeAdmin.vue') },
      { path: 'forge/activation', component: () => import('../views/ForgeAdmin.vue') },
      { path: 'forge/project-bindings', component: () => import('../views/ForgeAdmin.vue') },
      { path: 'forge/device-bindings', component: () => import('../views/ForgeAdmin.vue') },
      { path: 'forge/sample-policies', component: () => import('../views/ForgeAdmin.vue') },
      { path: 'forge/model-versions', component: () => import('../views/ForgeAdmin.vue') },
      { path: 'forge/release-approvals', component: () => import('../views/ForgeAdmin.vue') },
      { path: 'forge/releases', component: () => import('../views/ForgeAdmin.vue') },
      { path: 'forge/heartbeats', component: () => import('../views/ForgeAdmin.vue') },
      { path: 'forge/sync-logs', component: () => import('../views/ForgeAdmin.vue') },
      { path: 'scenario-policies', component: () => import('../views/ScenarioPolicies.vue') },
      { path: 'algorithm-details', component: () => import('../views/AlgorithmDetails.vue') },
      { path: 'camera-bindings', component: () => import('../views/CameraBindings.vue') },
      { path: 'runtime-configs', component: () => import('../views/RuntimeConfigs.vue') },
      { path: 'streams', component: () => import('../views/VideoStreams.vue') },
      { path: 'algorithm-config', component: () => import('../views/AlgorithmConfig.vue') },
      { path: 'l1-monitor', component: () => import('../views/L1Monitor.vue') },
      { path: 'l2-monitor', component: () => import('../views/L2Monitor.vue') },
      { path: 'alarm-center', component: () => import('../views/AlarmCenter.vue') },
      { path: 'event-handling', component: () => import('../views/EventHandling.vue') },
      { path: 'device-status', component: () => import('../views/ClientDeviceStatus.vue') },
      { path: 'client-dashboard', component: () => import('../views/ClientDashboardEntry.vue') },
      { path: 'project-settings', component: () => import('../views/ProjectSettings.vue') },
      { path: 'learning-loop', component: () => import('../views/LearningLoop.vue') },
      { path: 'human-review', component: () => import('../views/HumanReview.vue') },
      { path: 'model-registry', component: () => import('../views/ModelRegistry.vue') },
      { path: 'devices-logs', component: () => import('../views/DevicesLogs.vue') },
      { path: 'capacity-planner', component: () => import('../views/CapacityPlanner.vue') },
      { path: 'flow', component: () => import('../views/FlowMonitor.vue') },
    ],
  },
]

const router = createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes })

router.beforeEach((to) => {
  if (to.path !== '/login' && !localStorage.getItem('guardian_token')) {
    return '/login'
  }
  const storedMode = localStorage.getItem('guardian_console_mode') || 'platform'
  const mode = storedMode === 'customer' || storedMode === 'project' || storedMode === 'project_manager' ? 'project_manager' : storedMode === 'project_operator' ? 'project_operator' : 'platform'
  if (storedMode === 'customer' || storedMode === 'project') localStorage.setItem('guardian_console_mode', 'project_manager')
  const platformPaths = ['/dashboard', '/customer-center', '/audit', '/role-matrix', '/platform-edge-gateways', '/devices-logs', '/capacity-planner', '/algorithm-details', '/closed-loop-trace', '/scenario-policies', '/model-registry']
  const projectManagerPaths = ['/customer-workspace', '/edge-gateways', '/streams', '/camera-bindings', '/runtime-configs', '/l1-monitor', '/l2-monitor', '/alarm-center', '/event-handling', '/device-status', '/project-settings', '/human-review', '/core-logs', '/ai-lifecycle', '/scenario-policies', '/forge', '/forge/materials', '/forge/vlm-audit', '/forge/human-review', '/forge/datasets', '/forge/release', '/forge/centers', '/forge/activation', '/forge/project-bindings', '/forge/device-bindings', '/forge/sample-policies', '/forge/model-versions', '/forge/release-approvals', '/forge/releases', '/forge/heartbeats', '/forge/sync-logs', '/model-registry']
  const projectOperatorPaths = ['/customer-workspace', '/alarm-center', '/event-handling', '/device-status', '/core-logs']
  const projectPaths = Array.from(new Set([...projectManagerPaths, ...projectOperatorPaths]))
  const trainingCenterPaths = ['/ai-lifecycle']
  const isTrainingCenterPath = to.path.startsWith('/forge') || trainingCenterPaths.includes(to.path)
  if (mode === 'platform' && (projectPaths.includes(to.path) || isTrainingCenterPath)) {
    return '/customer-center'
  }
  if (mode !== 'platform' && (!localStorage.getItem('guardian_customer_id') || !localStorage.getItem('guardian_site_id'))) {
    localStorage.setItem('guardian_console_mode', 'platform')
    return '/customer-center'
  }
  if (mode !== 'platform' && platformPaths.includes(to.path)) {
    return '/customer-workspace'
  }
  if (mode === 'project_operator' && !projectOperatorPaths.includes(to.path) && to.path !== '/login') {
    return '/customer-workspace'
  }
})

export default router
