<template>
  <div class="trace-page">
    <div class="page-head">
      <div>
        <h2>闭环追踪 Trace</h2>
        <p>从摄像头、L1、L2、Forge、Mage-VL、训练集、YOLO 训练到模型下发，每一步都保留状态、证据和失败原因。</p>
      </div>
      <div class="head-actions">
        <span>检查时间：{{ shortTime(trace.checked_at) }}</span>
        <el-button :icon="Refresh" type="primary" :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>

    <el-alert
      v-for="note in trace.notes || []"
      :key="note"
      class="note"
      type="info"
      :closable="false"
      :title="note"
      show-icon
    />

    <el-row :gutter="12" class="service-row">
      <el-col :span="6">
        <div class="service-card">
          <span>摄像头</span>
          <strong>{{ trace.services?.cameras?.online || 0 }}/{{ trace.services?.cameras?.total || 0 }}</strong>
          <small>由 KKOS/RTSP 状态判定</small>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="service-card">
          <span>L1 哨兵</span>
          <strong>{{ trace.services?.l1?.online || 0 }}/{{ trace.services?.l1?.total || 0 }}</strong>
          <small>只接受 KKOS 上报状态</small>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="service-card">
          <span>Forge 训练服务</span>
          <strong><el-tag :type="tagType(trace.services?.forge?.status)">{{ statusText(trace.services?.forge?.status) }}</el-tag></strong>
          <small>{{ trace.endpoints?.forge || '-' }}</small>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="service-card">
          <span>Mage-VL 裁判</span>
          <strong><el-tag :type="tagType(trace.services?.vlm?.status)">{{ statusText(trace.services?.vlm?.status) }}</el-tag></strong>
          <small>{{ trace.endpoints?.vlm || '-' }}</small>
        </div>
      </el-col>
    </el-row>

    <el-card shadow="never" class="panel">
      <template #header>
        <div class="panel-title">
          <span>主流程环节总账</span>
          <el-tag type="info">{{ trace.stages?.length || 0 }} 个环节</el-tag>
        </div>
      </template>
      <el-table :data="trace.stages || []" stripe>
        <el-table-column label="环节" prop="label" min-width="160" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="tagType(row.status)">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="数量" prop="count" width="90" />
        <el-table-column label="证据" prop="evidence" min-width="300" show-overflow-tooltip />
        <el-table-column label="排查提示" prop="error" min-width="300" show-overflow-tooltip />
      </el-table>
    </el-card>

    <el-card shadow="never" class="panel">
      <template #header>
        <div class="panel-title">
          <span>样本级追踪</span>
          <el-tag type="info">{{ trace.samples?.length || 0 }} 条</el-tag>
        </div>
      </template>
      <el-table :data="trace.samples || []" stripe height="520">
        <el-table-column label="样本" min-width="210">
          <template #default="{ row }">
            <strong>{{ row.sample_id || row.trace_id }}</strong>
            <div class="muted">{{ row.camera_name || row.camera_id || '-' }} · {{ row.scene_code || '-' }}</div>
            <div class="muted">{{ shortTime(row.created_at) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="图片" width="130">
          <template #default="{ row }">
            <el-image
              v-if="row.preview_blob_url"
              class="sample-thumb"
              :src="row.preview_blob_url"
              :preview-src-list="[row.preview_blob_url]"
              preview-teleported
              fit="cover"
            />
            <span v-else class="muted">暂无预览</span>
          </template>
        </el-table-column>
        <el-table-column label="L1" width="86"><template #default="{ row }"><el-tag :type="tagType(row.statuses.l1)">{{ shortStatus(row.statuses.l1) }}</el-tag></template></el-table-column>
        <el-table-column label="L2" width="86"><template #default="{ row }"><el-tag :type="tagType(row.statuses.l2)">{{ shortStatus(row.statuses.l2) }}</el-tag></template></el-table-column>
        <el-table-column label="上传" width="86"><template #default="{ row }"><el-tag :type="tagType(row.statuses.upload)">{{ shortStatus(row.statuses.upload) }}</el-tag></template></el-table-column>
        <el-table-column label="VLM" width="86"><template #default="{ row }"><el-tag :type="tagType(row.statuses.vlm)">{{ shortStatus(row.statuses.vlm) }}</el-tag></template></el-table-column>
        <el-table-column label="标注" width="86"><template #default="{ row }"><el-tag :type="tagType(row.statuses.label)">{{ shortStatus(row.statuses.label) }}</el-tag></template></el-table-column>
        <el-table-column label="训练" width="86"><template #default="{ row }"><el-tag :type="tagType(row.statuses.training)">{{ shortStatus(row.statuses.training) }}</el-tag></template></el-table-column>
        <el-table-column label="下发" width="86"><template #default="{ row }"><el-tag :type="tagType(row.statuses.deploy)">{{ shortStatus(row.statuses.deploy) }}</el-tag></template></el-table-column>
        <el-table-column label="Mage-VL 结果" min-width="260" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.vlm?.sample_type || row.sample_type || '-' }}
            <span class="muted">confidence {{ row.vlm?.confidence ?? '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="证据文件" min-width="260" show-overflow-tooltip>
          <template #default="{ row }">{{ row.dataset_label || row.image_path || row.sha1 || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openDetail(row)">追踪详情</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !(trace.samples || []).length" description="Forge 暂无样本，或 Forge 服务当前不可达" />
    </el-card>

    <el-card shadow="never" class="panel">
      <template #header><div class="panel-title"><span>训练与发布记录</span></div></template>
      <el-table :data="trace.training_runs || []" stripe>
        <el-table-column label="训练任务" min-width="220">
          <template #default="{ row }">{{ row.run_id || row.id || '-' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }"><el-tag :type="tagType(row.status)">{{ statusText(row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="样本数" width="100">
          <template #default="{ row }">{{ row.samples || row.sample_count || '-' }}</template>
        </el-table-column>
        <el-table-column label="产物" min-width="360" show-overflow-tooltip>
          <template #default="{ row }">{{ row.best_model_path || row.model_path || row.artifact_path || '-' }}</template>
        </el-table-column>
        <el-table-column label="完成时间" width="190">
          <template #default="{ row }">{{ shortTime(row.finished_at || row.created_at || row.started_at) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && !(trace.training_runs || []).length" description="还没有 Forge 训练记录" />
    </el-card>

    <el-dialog v-model="detailVisible" title="样本追踪详情" width="860px">
      <div v-if="selected">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="Trace ID">{{ selected.trace_id }}</el-descriptions-item>
          <el-descriptions-item label="样本 ID">{{ selected.sample_id || '-' }}</el-descriptions-item>
          <el-descriptions-item label="摄像头">{{ selected.camera_name || selected.camera_id || '-' }}</el-descriptions-item>
          <el-descriptions-item label="场景">{{ selected.scene_code || '-' }}</el-descriptions-item>
          <el-descriptions-item label="图片">{{ selected.image_path || '-' }}</el-descriptions-item>
          <el-descriptions-item label="标签">{{ selected.dataset_label || '-' }}</el-descriptions-item>
        </el-descriptions>
        <div v-if="selected.preview_blob_url" class="preview-wrap">
          <el-image
            class="preview-image"
            :src="selected.preview_blob_url"
            :preview-src-list="[selected.preview_blob_url]"
            preview-teleported
            fit="contain"
          />
        </div>
        <el-timeline class="timeline">
          <el-timeline-item
            v-for="item in selected.timeline"
            :key="item.label"
            :type="timelineType(item.status)"
            :timestamp="shortTime(item.at)"
          >
            <strong>{{ item.label }}</strong>
            <div>{{ item.evidence || '-' }}</div>
            <small>{{ item.detail }}</small>
          </el-timeline-item>
        </el-timeline>
        <pre>{{ JSON.stringify(selected.raw, null, 2) }}</pre>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import api from '../api'

const loading = ref(false)
const trace = ref<any>({})
const selected = ref<any | null>(null)
const detailVisible = ref(false)

function tagType(status: string) {
  if (['done', 'ready', 'success', 'completed', 'finished', 'online'].includes(status)) return 'success'
  if (['warning', 'waiting', 'degraded', 'running', 'pending'].includes(status)) return 'warning'
  if (['failed', 'offline', 'error'].includes(status)) return 'danger'
  return 'info'
}

function statusText(status: string) {
  const map: Record<string, string> = {
    done: '完成',
    ready: '正常',
    success: '成功',
    completed: '完成',
    finished: '完成',
    online: '在线',
    warning: '需关注',
    waiting: '等待',
    degraded: '降级',
    running: '运行中',
    pending: '待处理',
    failed: '失败',
    offline: '离线',
    error: '错误',
  }
  return map[status] || status || '-'
}

function shortStatus(status: string) {
  const map: Record<string, string> = { done: '完成', waiting: '等待', warning: '关注', failed: '失败' }
  return map[status] || statusText(status)
}

function timelineType(status: string) {
  if (['done', 'ready', 'success', 'completed', 'finished'].includes(status)) return 'success'
  if (['failed', 'offline', 'error'].includes(status)) return 'danger'
  if (['warning', 'waiting', 'degraded'].includes(status)) return 'warning'
  return 'info'
}

function shortTime(value: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function openDetail(row: any) {
  selected.value = row
  detailVisible.value = true
}

async function loadPreview(row: any) {
  if (!row.image_preview_url || row.preview_blob_url || row.preview_error) return
  try {
    const apiPath = row.image_preview_url.replace(/^\/api/, '')
    const resp = await api.get(apiPath, { responseType: 'blob' })
    row.preview_blob_url = URL.createObjectURL(resp.data)
  } catch {
    row.preview_error = true
  }
}

async function load() {
  loading.value = true
  try {
    trace.value = (await api.get('/closed-loop/trace')).data
    ;(trace.value.samples || []).slice(0, 12).forEach((row: any) => loadPreview(row))
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.trace-page { color: #1f2937; }
.page-head { align-items: center; display: flex; justify-content: space-between; margin-bottom: 12px; }
.page-head h2 { font-size: 22px; margin: 0 0 6px; }
.page-head p { color: #64748b; margin: 0; }
.head-actions { align-items: center; color: #64748b; display: flex; gap: 12px; }
.note { margin-bottom: 8px; }
.service-row { margin: 12px 0; }
.service-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 106px; padding: 16px; }
.service-card span { color: #64748b; }
.service-card strong { font-size: 24px; }
.service-card small, .muted { color: #64748b; font-size: 12px; }
.panel { border-radius: 10px; margin-bottom: 12px; }
.panel-title { align-items: center; display: flex; justify-content: space-between; }
.timeline { margin-top: 18px; }
.sample-thumb { background: #0f172a; border-radius: 6px; display: block; height: 72px; width: 96px; }
.preview-wrap { align-items: center; background: #0f172a; border-radius: 10px; display: flex; justify-content: center; margin: 14px 0 4px; min-height: 320px; overflow: hidden; }
.preview-image { max-height: 68vh; max-width: 100%; }
pre { background: #0f172a; border-radius: 8px; color: #dbeafe; max-height: 260px; overflow: auto; padding: 12px; }
</style>
