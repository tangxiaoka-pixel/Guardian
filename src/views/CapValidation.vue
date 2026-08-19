<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h2>瓶盖主流程验证</h2>
        <p>使用项目文件夹内 13 张真实瓶盖照片，验证 MacBook 模拟相机 → L1 → L2 → Forge → VLM/标注 → 模型升级建议的闭环。</p>
      </div>
      <el-button type="primary" :loading="running" @click="runValidation">重新跑一遍主流程</el-button>
    </div>

    <el-alert
      v-if="summary.upgradeSuggestion"
      class="recommendation"
      type="warning"
      :closable="false"
      show-icon
    >
      <template #title>{{ summary.upgradeSuggestion.decision }}</template>
      <div class="alert-body">{{ summary.upgradeSuggestion.reason }}</div>
    </el-alert>

    <div class="metrics">
      <el-card v-for="card in cards" :key="card.label" shadow="never" class="metric">
        <strong>{{ card.value }}</strong>
        <span>{{ card.label }}</span>
      </el-card>
    </div>

    <el-card class="panel" shadow="never">
      <template #header>
        <div class="card-head">
          <strong>当前验证环境</strong>
          <el-tag :type="summary.localVlmReady ? 'success' : 'danger'">{{ summary.localVlmReady ? '远端增强 Qwen7B 已就绪' : '远端增强 Qwen7B 未就绪' }}</el-tag>
        </div>
      </template>
      <div class="env-grid">
        <div v-for="item in envCards" :key="item.title" class="env-card">
          <div class="env-title">{{ item.title }}</div>
          <strong>{{ item.status }}</strong>
          <p>{{ item.note }}</p>
        </div>
      </div>
      <el-divider />
      <div class="next-actions">
        <strong>系统给出的模型升级前置动作</strong>
        <ol>
          <li v-for="action in summary.upgradeSuggestion?.nextActions || []" :key="action">{{ action }}</li>
        </ol>
      </div>
    </el-card>

    <el-card v-if="summary.beforeAfter" class="panel" shadow="never">
      <template #header>
        <div class="card-head">
          <strong>升级前后闭环结论</strong>
          <el-tag type="warning">{{ summary.modelReleasePlan?.status || '待验证' }}</el-tag>
        </div>
      </template>
      <div class="compare-grid">
        <div class="compare-card before">
          <div class="compare-title">升级前</div>
          <p><b>L1：</b>{{ summary.beforeAfter.before.l1 }}</p>
          <p><b>L2：</b>{{ summary.beforeAfter.before.l2 }}</p>
          <p><b>远端增强：</b>{{ summary.beforeAfter.before.qwen7b }}</p>
        </div>
        <div class="compare-card after">
          <div class="compare-title">升级后 / 影子验证</div>
          <p><b>L1：</b>{{ summary.beforeAfter.after.l1 }}</p>
          <p><b>L2：</b>{{ summary.beforeAfter.after.l2 }}</p>
          <p><b>远端增强：</b>{{ summary.beforeAfter.after.qwen7b }}</p>
        </div>
        <div class="compare-card decision">
          <div class="compare-title">系统判断</div>
          <p>{{ summary.beforeAfter.conclusion }}</p>
          <p><b>候选版本：</b>{{ summary.modelReleasePlan?.candidateVersion }}</p>
          <p><b>自动下发：</b>{{ summary.modelReleasePlan?.autoDeploy?.l1 }}</p>
        </div>
      </div>
    </el-card>

    <el-card class="panel" shadow="never">
      <template #header>
        <div class="card-head">
          <strong>逐图识别链路与升级前后对比</strong>
          <span>每张图片展示 L1 粗筛、L2 本地复核、远端增强标注、模型升级建议与影子复测</span>
        </div>
      </template>

      <div class="sample-grid">
        <el-card v-for="sample in samples" :key="sample.sampleId" shadow="never" class="sample-card">
          <button class="image-button" type="button" @click="openPreview(sample)">
            <img class="sample-image" :src="assetUrl(sample.imageUrl)" :alt="sample.sampleId" />
            <span>点击查看原图</span>
          </button>
          <div class="sample-title">
            <strong>{{ sample.sampleId }}</strong>
            <el-tag :type="sample.usableForTraining ? 'success' : 'warning'">{{ sample.usableForTraining ? '可训练' : '需复核/重采' }}</el-tag>
          </div>
          <div class="image-actions">
            <el-button size="small" type="primary" plain @click="openPreview(sample)">弹窗查看大图</el-button>
            <el-link :href="assetUrl(sample.imageUrl)" target="_blank" type="primary">打开原图文件</el-link>
          </div>
          <div class="source-file">源文件：{{ sample.sourceFile }}</div>
          <p class="quality">{{ sample.qualityReason }}</p>
          <div class="inference-grid">
            <div class="inference-card">
              <span>升级前 L1</span>
              <strong>{{ resultLabel(sample.beforeUpgrade?.l1?.judgement) }}</strong>
              <small>{{ sample.beforeUpgrade?.l1?.reason }}</small>
            </div>
            <div class="inference-card">
              <span>升级前 L2</span>
              <strong>{{ resultLabel(sample.beforeUpgrade?.l2?.judgement) }}</strong>
              <small>{{ sample.beforeUpgrade?.l2?.reason }}</small>
            </div>
            <div class="inference-card qwen">
              <span>远端增强/Qwen7B</span>
              <strong>{{ resultLabel(sample.qwen7b?.judgement) }} / {{ sample.qwen7b?.autoLabel }}</strong>
              <small>{{ sample.qwen7b?.reason }} · {{ sample.qwen7b?.durationSec }}s</small>
            </div>
            <div class="inference-card">
              <span>自动标注</span>
              <strong>{{ sample.autoAnnotation?.label }}</strong>
              <small>{{ sample.autoAnnotation?.reason }}</small>
            </div>
            <div class="inference-card after">
              <span>升级后 L1</span>
              <strong>{{ resultLabel(sample.afterUpgrade?.l1?.judgement) }}</strong>
              <small>{{ sample.afterUpgrade?.l1?.reason }}</small>
            </div>
            <div class="inference-card after">
              <span>升级后 L2</span>
              <strong>{{ resultLabel(sample.afterUpgrade?.l2?.judgement) }}</strong>
              <small>{{ sample.afterUpgrade?.l2?.reason }}</small>
            </div>
          </div>
          <el-alert class="sample-decision" type="warning" :closable="false">
            <template #title>{{ sample.trainingRecommendation?.decision }}</template>
            <div>{{ sample.edgeCloudConsistency?.summary }}</div>
            <div>{{ sample.afterUpgrade?.improvement }}</div>
          </el-alert>
          <el-timeline class="timeline">
            <el-timeline-item
              v-for="stage in sample.stages"
              :key="stage.key"
              :type="stageType(stage.status)"
              :timestamp="formatTime(stage.at)"
            >
              <div class="stage-title">{{ stage.name }}：{{ stage.result }}</div>
              <div class="stage-detail">{{ stage.detail }}</div>
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </div>
    </el-card>

    <el-dialog v-model="previewVisible" :title="previewTitle" width="82vw" class="image-preview-dialog">
      <div class="preview-wrap">
        <img v-if="previewSample" class="preview-image" :src="assetUrl(previewSample.imageUrl)" :alt="previewSample.sampleId" />
      </div>
      <template #footer>
        <div class="preview-footer">
          <span>{{ previewSample?.qualityReason }}</span>
          <el-button @click="previewVisible = false">关闭</el-button>
        </div>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const summary = ref<any>({})
const samples = ref<any[]>([])
const running = ref(false)
const previewVisible = ref(false)
const previewSample = ref<any | null>(null)

const previewTitle = computed(() => {
  if (!previewSample.value) return '查看原图'
  return `${previewSample.value.sampleId} · ${previewSample.value.sourceFile}`
})

const cards = computed(() => [
  { label: '真实照片总数', value: summary.value.totalSamples ?? 0 },
  { label: '已走完链路', value: summary.value.processedSamples ?? 0 },
  { label: 'Qwen 自动标注', value: summary.value.qwenAutoAnnotated ?? 0 },
  { label: 'Qwen 判有盖', value: summary.value.qwenCapPresentSamples ?? 0 },
  { label: 'Qwen 判缺盖', value: summary.value.qwenCapMissingSamples ?? 0 },
  { label: 'Qwen 判无效', value: summary.value.qwenInvalidSamples ?? 0 },
  { label: '端云不一致/缺口', value: summary.value.edgeCloudMismatchSamples ?? 0 },
  { label: '可直接训练', value: summary.value.usableForTraining ?? 0 },
  { label: '需复核/重采', value: summary.value.rejectedSamples ?? 0 },
  { label: '模型状态', value: summary.value.currentModelStatus === 'shadow_quality_gate_ready' ? '影子质检' : '未配置' },
])

const envCards = computed(() => {
  const env = summary.value.environment || {}
  return [
    { title: 'MacBook 模拟相机', status: env.macbook?.status || '-', note: `${env.macbook?.ip || '-'} · ${env.macbook?.note || ''}` },
    { title: 'RV1126 L1', status: env.rv1126?.status || '-', note: `${env.rv1126?.ip || '-'} · ${env.rv1126?.note || ''}` },
    { title: 'RK3568 / KKOS L2', status: env.rk3568?.status || '-', note: `${env.rk3568?.ip || '-'} / ${env.rk3568?.tailscaleIp || '-'} · ${env.rk3568?.note || ''}` },
    { title: '5070Ti Forge', status: env.forge?.status || '-', note: `${env.forge?.ip || '-'} · ${env.forge?.gpu || ''} · ${env.forge?.trainingRuntime || ''}` },
    { title: '本地 VLM', status: env.vlm?.status || '-', note: env.vlm?.evidence || '' },
  ]
})

function assetUrl(path: string) {
  if (!path) return ''
  if (/^https?:\/\//.test(path)) return path
  const base = import.meta.env.BASE_URL || '/'
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

function stageType(status: string) {
  if (status === 'success') return 'success'
  if (status === 'warning' || status === 'skipped') return 'warning'
  if (status === 'blocked' || status === 'failed') return 'danger'
  return 'info'
}

function resultLabel(value: string) {
  const map: Record<string, string> = {
    unknown: '无法判断',
    cap_ok: '瓶盖正常',
    cap_missing: '瓶盖缺失',
    needs_retake: '需要重采',
  }
  return map[value] || value || '-'
}

function openPreview(sample: any) {
  previewSample.value = sample
  previewVisible.value = true
}

function formatTime(value: string) {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

async function load() {
  const [summaryRes, samplesRes] = await Promise.all([
    api.get('/admin/cap-validation/summary'),
    api.get('/admin/cap-validation/samples'),
  ])
  summary.value = summaryRes.data
  samples.value = samplesRes.data
}

async function runValidation() {
  running.value = true
  try {
    const res = await api.post('/admin/cap-validation/run', {})
    summary.value = res.data.summary
    samples.value = res.data.samples
    ElMessage.warning('主流程已重新验证：Qwen7B 已完成自动标注，本批样本进入重采/人工复核建议。')
  } finally {
    running.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 14px; }
.page-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
.page-head h2 { margin: 0; color: #0f172a; }
.page-head p { margin: 6px 0 0; color: #64748b; }
.recommendation { border-radius: 12px; }
.alert-body { line-height: 1.7; }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
.metric strong { display: block; font-size: 25px; color: #0f172a; }
.metric span { color: #64748b; font-size: 13px; }
.panel { border-radius: 14px; }
.card-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
.card-head span { color: #64748b; font-size: 13px; }
.env-grid { display: grid; grid-template-columns: repeat(5, minmax(150px, 1fr)); gap: 12px; }
.env-card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; background: #f8fafc; }
.env-title { color: #64748b; font-size: 13px; margin-bottom: 6px; }
.env-card strong { color: #0f172a; }
.env-card p { color: #475569; line-height: 1.6; margin: 8px 0 0; font-size: 13px; }
.next-actions ol { margin: 10px 0 0; padding-left: 20px; line-height: 1.8; color: #334155; }
.compare-grid { display: grid; grid-template-columns: repeat(3, minmax(220px, 1fr)); gap: 12px; }
.compare-card { border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px; background: #f8fafc; }
.compare-card.before { background: #fff7ed; border-color: #fed7aa; }
.compare-card.after { background: #ecfdf5; border-color: #bbf7d0; }
.compare-card.decision { background: #eff6ff; border-color: #bfdbfe; }
.compare-title { font-weight: 800; color: #0f172a; margin-bottom: 8px; }
.compare-card p { margin: 6px 0; color: #334155; line-height: 1.65; }
.sample-grid { display: grid; grid-template-columns: repeat(3, minmax(260px, 1fr)); gap: 14px; }
.sample-card { border-radius: 14px; overflow: hidden; }
.image-button { position: relative; width: 100%; padding: 0; border: 0; border-radius: 10px; overflow: hidden; cursor: zoom-in; background: #0f172a; display: block; }
.image-button span { position: absolute; right: 10px; bottom: 10px; padding: 5px 8px; border-radius: 999px; color: #fff; background: rgba(15, 23, 42, .72); font-size: 12px; }
.sample-image { width: 100%; height: 180px; object-fit: contain; border-radius: 10px; background: #0f172a; display: block; }
.sample-title { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 10px; }
.source-file { margin-top: 6px; color: #64748b; font-size: 12px; word-break: break-all; }
.quality { color: #b45309; line-height: 1.6; min-height: 42px; }
.inference-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
.inference-card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 9px; background: #f8fafc; min-height: 104px; }
.inference-card.qwen { background: #eef2ff; border-color: #c7d2fe; }
.inference-card.after { background: #ecfdf5; border-color: #bbf7d0; }
.inference-card span { display: block; color: #64748b; font-size: 12px; }
.inference-card strong { display: block; color: #0f172a; margin: 4px 0; }
.inference-card small { color: #475569; line-height: 1.45; }
.sample-decision { margin-top: 10px; border-radius: 10px; }
.timeline { margin-top: 12px; }
.stage-title { font-weight: 700; color: #0f172a; }
.stage-detail { color: #64748b; line-height: 1.55; margin-top: 4px; }
.preview-wrap { display: flex; justify-content: center; align-items: center; min-height: 360px; background: #020617; border-radius: 12px; overflow: hidden; }
.preview-image { max-width: 100%; max-height: 72vh; object-fit: contain; }
.preview-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; color: #475569; }
@media (max-width: 1280px) {
  .metrics { grid-template-columns: repeat(3, 1fr); }
  .env-grid { grid-template-columns: repeat(2, 1fr); }
  .compare-grid { grid-template-columns: 1fr; }
  .sample-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 860px) {
  .page-head { flex-direction: column; }
  .metrics, .env-grid, .sample-grid { grid-template-columns: 1fr; }
}
</style>
