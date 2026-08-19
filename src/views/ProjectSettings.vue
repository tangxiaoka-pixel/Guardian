<template>
  <section class="page">
    <header>
      <h2>项目设置</h2>
      <p>一期只开放基础运营配置：用户角色、告警接收人、点位基础信息和钉钉告警通知。</p>
    </header>

    <el-tabs v-model="tab">
      <el-tab-pane label="用户/角色" name="users">
        <el-card class="panel" shadow="never">
          <el-table :data="roles" stripe>
            <el-table-column prop="role" label="角色" width="160" />
            <el-table-column prop="scope" label="范围" width="160" />
            <el-table-column prop="can" label="可操作" min-width="360" />
          </el-table>
        </el-card>
      </el-tab-pane>
      <el-tab-pane label="告警接收人" name="receivers">
        <el-card class="panel" shadow="never">
          <el-table :data="receivers" stripe>
            <el-table-column prop="name" label="姓名" width="140" />
            <el-table-column prop="role" label="职责" width="160" />
            <el-table-column prop="phone" label="联系方式" width="160" />
            <el-table-column prop="dingtalk_user_id" label="钉钉 UserId" width="180" />
            <el-table-column prop="scenes" label="接收场景" min-width="260" />
          </el-table>
          <p class="hint">接收人先用于项目告警通知寻址；正式接入钉钉企业内部应用后，可按钉钉 UserId 精准单聊推送。</p>
        </el-card>
      </el-tab-pane>
      <el-tab-pane label="点位基础信息" name="points">
        <el-card class="panel" shadow="never">
          <el-table :data="cameras" stripe>
            <el-table-column prop="camera_name" label="点位" min-width="160" />
            <el-table-column prop="location" label="安装位置" min-width="160" />
            <el-table-column prop="rtsp_url" label="视频源" min-width="260" />
            <el-table-column prop="status" label="状态" width="100" />
          </el-table>
        </el-card>
      </el-tab-pane>
      <el-tab-pane label="通知方式" name="notify">
        <el-card class="panel" shadow="never">
          <div class="notify-layout">
            <div class="status-card">
              <strong>站内通知</strong>
              <span>已启用，后台告警中心与事件处理页面实时展示。</span>
            </div>
            <div class="status-card active">
              <strong>钉钉通知</strong>
              <span>{{ dingtalkStatusText }}</span>
            </div>
            <div class="status-card">
              <strong>微信服务号 / 小程序</strong>
              <span>后续正式客户交付阶段再接入。</span>
            </div>
          </div>

          <el-alert
            class="tip"
            type="info"
            :closable="false"
            title="Demo 阶段建议先用钉钉自定义群机器人：配置简单、成本低，能快速跑通告警推送和处理闭环。企业内部应用模式已预留，用于后续单聊、互动卡片、组织权限和正式客户交付。"
          />

          <el-form label-width="150px" class="notify-form">
            <el-form-item label="启用钉钉">
              <el-switch v-model="notifyForm.dingtalk.enabled" />
            </el-form-item>
            <el-form-item label="接入模式">
              <el-radio-group v-model="notifyForm.dingtalk.mode">
                <el-radio-button label="custom_robot">自定义群机器人</el-radio-button>
                <el-radio-button label="internal_app">企业内部应用</el-radio-button>
              </el-radio-group>
            </el-form-item>

            <template v-if="notifyForm.dingtalk.mode === 'custom_robot'">
              <el-form-item label="机器人名称">
                <el-input v-model="notifyForm.dingtalk.robot_name" placeholder="例如：Guardian 告警机器人" />
              </el-form-item>
              <el-form-item label="Webhook">
                <el-input v-model="notifyForm.dingtalk.webhook_url" placeholder="https://oapi.dingtalk.com/robot/send?access_token=..." show-password />
              </el-form-item>
              <el-form-item label="加签 Secret">
                <el-input v-model="notifyForm.dingtalk.webhook_secret" :placeholder="secretPlaceholder('webhook')" show-password />
              </el-form-item>
            </template>

            <template v-else>
              <el-form-item label="AppKey">
                <el-input v-model="notifyForm.dingtalk.app_key" placeholder="钉钉开放平台企业内部应用 AppKey" />
              </el-form-item>
              <el-form-item label="AppSecret">
                <el-input v-model="notifyForm.dingtalk.app_secret" :placeholder="secretPlaceholder('app')" show-password />
              </el-form-item>
              <el-form-item label="AgentId">
                <el-input v-model="notifyForm.dingtalk.agent_id" placeholder="应用 AgentId" />
              </el-form-item>
              <el-form-item label="RobotCode">
                <el-input v-model="notifyForm.dingtalk.robot_code" placeholder="应用机器人 robotCode" />
              </el-form-item>
              <el-form-item label="群会话 ID">
                <el-input v-model="notifyForm.dingtalk.open_conversation_id" placeholder="openConversationId，群推送时使用" />
              </el-form-item>
            </template>

            <el-form-item label="告警触发">
              <el-checkbox v-model="notifyForm.dingtalk.notify_on_alarm">L2 形成告警后推送</el-checkbox>
              <el-checkbox v-model="notifyForm.dingtalk.notify_on_event_dispatch">事件派单后推送</el-checkbox>
              <el-checkbox v-model="notifyForm.dingtalk.require_human_action">需要人工确认按钮</el-checkbox>
            </el-form-item>
            <el-form-item label="回调地址">
              <el-input v-model="notifyForm.dingtalk.callback_url" disabled />
            </el-form-item>
            <el-form-item label="卡片回调 Key">
              <el-input v-model="notifyForm.dingtalk.card_callback_route_key" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="saveNotify">保存配置</el-button>
              <el-button :loading="testing" :disabled="!notifyForm.dingtalk.enabled" @click="sendTest">发送测试消息</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const customerId = localStorage.getItem('guardian_customer_id') || ''
const siteId = localStorage.getItem('guardian_site_id') || ''
const tab = ref('users')
const cameras = ref<any[]>([])
const saving = ref(false)
const testing = ref(false)
const hasWebhookSecret = ref(false)
const hasAppSecret = ref(false)
const roles = [
  { role: '客户管理员', scope: '本客户', can: '用户、项目、告警、设备状态、项目设置' },
  { role: '项目管理员', scope: '本项目', can: '告警、事件、设备、点位基础信息' },
  { role: '值班人员', scope: '本项目', can: '查看告警、确认、派单' },
  { role: '现场处理人员', scope: '派单任务', can: '接收任务、上传处理结果' },
  { role: '只读观察者', scope: '本项目', can: '只看大屏和统计' },
]
const receivers = ref<any[]>([])
const notifyForm = ref<any>({
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
  receivers: [],
})
const dingtalkStatusText = computed(() => {
  if (!notifyForm.value.dingtalk?.enabled) return '未启用'
  if (notifyForm.value.dingtalk?.mode === 'custom_robot') return notifyForm.value.dingtalk?.webhook_url ? '自定义群机器人已配置' : '已启用，等待填写 Webhook'
  return notifyForm.value.dingtalk?.app_key ? '企业内部应用配置中' : '已启用，等待填写应用凭证'
})

function secretPlaceholder(kind: 'webhook' | 'app') {
  const hasSecret = kind === 'webhook' ? hasWebhookSecret.value : hasAppSecret.value
  return hasSecret ? '已保存，留空表示不修改' : '可选；启用加签时填写'
}

async function load() {
  cameras.value = ((await api.get('/cameras')).data).filter((item: any) => item.customer_id === customerId && (!siteId || item.site_id === siteId))
  if (!siteId) return
  const { data } = await api.get(`/sites/${siteId}/notification-settings`)
  notifyForm.value = { ...notifyForm.value, ...data, dingtalk: { ...notifyForm.value.dingtalk, ...(data.dingtalk || {}) } }
  hasWebhookSecret.value = Boolean(data.dingtalk?.has_webhook_secret)
  hasAppSecret.value = Boolean(data.dingtalk?.has_app_secret)
  receivers.value = data.receivers?.length ? data.receivers : [
    { name: '项目值班室', role: '值班人员', phone: '', dingtalk_user_id: '', scenes: '全部告警' },
  ]
  notifyForm.value.receivers = receivers.value
}

async function saveNotify() {
  if (!siteId) return ElMessage.warning('请先进入具体项目后台')
  saving.value = true
  try {
    const payload = { ...notifyForm.value, customer_id: customerId, receivers: receivers.value }
    const { data } = await api.put(`/sites/${siteId}/notification-settings`, payload)
    notifyForm.value = { ...notifyForm.value, ...data, dingtalk: { ...notifyForm.value.dingtalk, ...(data.dingtalk || {}) } }
    hasWebhookSecret.value = Boolean(data.dingtalk?.has_webhook_secret)
    hasAppSecret.value = Boolean(data.dingtalk?.has_app_secret)
    ElMessage.success('钉钉通知配置已保存')
  } finally {
    saving.value = false
  }
}

async function sendTest() {
  if (!siteId) return ElMessage.warning('请先进入具体项目后台')
  testing.value = true
  try {
    await api.post(`/sites/${siteId}/notification-settings/test`)
    ElMessage.success('测试消息已发送，请查看钉钉群')
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || '测试消息发送失败')
  } finally {
    testing.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
.panel { border-radius:8px; border:1px solid #dbe4ef; }
.hint { color:#64748b; font-size:13px; }
.notify-layout { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
.status-card { padding:14px; border-radius:8px; border:1px solid #e2e8f0; background:#f8fafc; display:flex; flex-direction:column; gap:8px; }
.status-card.active { border-color:#93c5fd; background:#eff6ff; }
.status-card span { color:#64748b; }
.tip { margin:16px 0; }
.notify-form { max-width:980px; }
</style>
