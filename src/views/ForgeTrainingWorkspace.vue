<template>
  <section class="page forge-workspace">
    <header class="page-head">
      <div>
        <p class="eyebrow">Guardian Forge</p>
        <h2>{{ stage.title }}</h2>
        <p>{{ stage.description }}</p>
      </div>
      <el-button @click="refresh" :loading="loading">刷新</el-button>
    </header>

    <el-card shadow="never" class="context-card">
      <div class="context">
        <label>客户 ID<el-input v-model="customerId" placeholder="当前授权客户" @change="refresh" /></label>
        <label>站点 ID<el-input v-model="siteId" placeholder="当前授权站点" @change="refresh" /></label>
        <label>算法 / 场景<el-input v-model="scenario" placeholder="例如 desk_drink_intrusion" @change="refresh" /></label>
        <label>关联告警 ID<el-input v-model="alarmId" clearable placeholder="从告警中心自动带入" @change="refresh" /></label>
      </div>
    </el-card>

    <template v-if="activeStage === 'materials'">
      <div class="metrics">
        <Metric label="合规素材" :value="materialMetrics.trusted || 0" hint="完整 ROI、KKOS 本地脱敏、授权来源齐全" />
        <Metric label="待 VLM 审计" :value="materialMetrics.pending_vlm || 0" hint="系统自动提交，不需要手动逐张运行" />
        <Metric label="历史隔离" :value="materialMetrics.legacy || 0" hint="仅保留追溯，不可审计、审核或训练" danger />
      </div>
      <el-card shadow="never" class="panel">
        <template #header><div class="panel-head"><b>素材收集</b><span>现场事件级去重后入库；云端不保存原始未脱敏图。</span></div></template>
        <el-table :data="materials" v-loading="loading" height="560" row-key="sample_id">
          <el-table-column prop="sample_id" label="素材 ID" min-width="220" show-overflow-tooltip />
          <el-table-column prop="scenario" label="算法 / 场景" min-width="190" />
          <el-table-column label="采集时间" min-width="180"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column>
          <el-table-column label="来源" width="150"><template #default="{ row }"><el-tag :type="row.source_type === 'guardian_forge_historical' ? 'warning' : 'success'">{{ sourceLabel(row) }}</el-tag></template></el-table-column>
          <el-table-column label="上报原因" min-width="260" show-overflow-tooltip><template #default="{ row }">{{ collectionReason(row) }}</template></el-table-column>
          <el-table-column label="隐私与授权" min-width="180"><template #default="{ row }"><span :class="row.privacy_status === 'privacy_processed' ? 'ok' : 'blocked'">{{ privacyLabel(row) }}</span></template></el-table-column>
          <el-table-column label="处理状态" min-width="180"><template #default="{ row }">{{ flowLabel(row) }}</template></el-table-column>
          <el-table-column label="当前阶段" width="150"><template #default="{ row }"><el-tag :type="stageType(row)">{{ stageLabel(row) }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="90" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">详情</el-button></template></el-table-column>
        </el-table>
        <div class="pager"><el-pagination v-model:current-page="materialPage" :page-size="pageSize" :total="materialTotal" layout="total, prev, pager, next" @current-change="loadMaterials" /></div>
      </el-card>
    </template>

    <template v-else-if="activeStage === 'vlm'">
      <div class="metrics"><Metric label="待审计" :value="materialMetrics.pending_vlm || 0" /><Metric label="已完成" :value="materialMetrics.completed_vlm || 0" /><Metric label="待人工确认" :value="materialMetrics.need_human || 0" hint="仅 uncertain、低置信或冲突样本进入" /></div>
      <el-alert type="success" :closable="false" show-icon title="自动 VLM 队列已启用" description="合规新素材入库后自动发送 Forge VLM；positive/negative 生成标注草稿，uncertain 与冲突结果才送人工审核。VLM 不参与现场即时报警。" />
      <el-card shadow="never" class="panel"><template #header><div class="panel-head"><b>VLM 审计队列</b><span>使用算法绑定的审计提示词，不需要按图片切换规则。</span></div></template>
        <el-table :data="vlmRows" v-loading="loading" height="560">
          <el-table-column prop="sample_id" label="素材 ID" min-width="220" show-overflow-tooltip />
          <el-table-column label="审计模型" width="180"><template #default="{ row }">{{ auditModel(row) }}</template></el-table-column>
          <el-table-column label="结论" width="130"><template #default="{ row }"><el-tag :type="decisionType(row.vlm_decision)">{{ decisionLabel(row.vlm_decision) }}</el-tag></template></el-table-column>
          <el-table-column label="置信度" width="110"><template #default="{ row }">{{ score(row) }}</template></el-table-column>
          <el-table-column prop="reason" label="审计说明" min-width="330" show-overflow-tooltip />
          <el-table-column label="审计完成时间" min-width="180"><template #default="{ row }">{{ formatTime(auditTime(row)) }}</template></el-table-column>
          <el-table-column label="操作" width="90" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row, 'vlm')">看审计图</el-button></template></el-table-column>
        </el-table>
        <div class="pager"><el-pagination v-model:current-page="materialPage" :page-size="pageSize" :total="materialTotal" layout="total, prev, pager, next" @current-change="loadMaterials" /></div>
      </el-card>
    </template>

    <template v-else-if="activeStage === 'review'">
      <div class="metrics"><Metric label="待人工审核" :value="materialMetrics.need_human || 0" /><Metric label="已确认正样本" :value="materialMetrics.confirmed_positive || 0" /><Metric label="已确认负样本" :value="materialMetrics.confirmed_negative || 0" /></div>
      <el-card shadow="never" class="panel"><template #header><div class="panel-head"><b>人工审核</b><span>只处理 VLM 不确定、低置信或 L1/L2 与 VLM 结论冲突的合规素材。</span></div></template>
        <el-table :data="reviewRows" v-loading="loading" height="560">
          <el-table-column prop="sample_id" label="素材 ID" min-width="220" show-overflow-tooltip />
          <el-table-column label="VLM 建议" min-width="190"><template #default="{ row }">{{ row.sample_judgement?.vlm?.suggested_category || '等待审计结论' }}</template></el-table-column>
          <el-table-column label="进入原因" min-width="300"><template #default="{ row }">{{ row.sample_judgement?.vlm?.reason || row.blocked_reasons?.join('、') || '需要人工确认' }}</template></el-table-column>
          <el-table-column label="当前状态" width="160"><template #default="{ row }"><el-tag>{{ humanLabel(row) }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="90"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">查看</el-button></template></el-table-column>
        </el-table>
        <div class="pager"><el-pagination v-model:current-page="materialPage" :page-size="pageSize" :total="materialTotal" layout="total, prev, pager, next" @current-change="loadMaterials" /></div>
      </el-card>
    </template>

    <template v-else-if="activeStage === 'datasets'">
      <div class="metrics"><Metric label="可入训练素材" :value="materialMetrics.eligible || 0" hint="已完成 VLM 与人工确认" /><Metric label="正样本" :value="materialMetrics.confirmed_positive || 0" /><Metric label="困难负样本" :value="materialMetrics.confirmed_negative || 0" /></div>
      <el-alert type="warning" :closable="false" show-icon title="冻结后才可训练" description="创建训练数据集会固化素材清单、类别分布、采集时间范围与数据版本；训练过程不会受后续新增素材影响。" />
      <el-card shadow="never" class="panel"><template #header><div class="panel-head"><b>训练数据集版本</b><el-button type="primary" :disabled="eligibleRows === 0" @click="buildDataset">创建数据集版本</el-button></div></template>
        <el-table :data="pagedDatasets" v-loading="loading" height="520"><el-table-column prop="dataset_version" label="数据集版本" min-width="260" /><el-table-column prop="scenario" label="场景" min-width="180" /><el-table-column prop="sample_count" label="素材数" width="110" /><el-table-column label="创建时间" min-width="190"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column><el-table-column label="状态" width="140"><template #default><el-tag type="success">已冻结</el-tag></template></el-table-column></el-table>
        <div class="pager"><el-pagination v-model:current-page="datasetPage" :page-size="pageSize" :total="datasets.length" layout="total, prev, pager, next" /></div>
      </el-card>
    </template>

    <template v-else>
      <div class="metrics"><Metric label="训练任务" :value="trainingRuns.length" /><Metric label="候选模型" :value="candidateModels.length" /><Metric label="评估报告" :value="evaluations.length" /></div>
      <el-card shadow="never" class="panel"><template #header><div class="panel-head"><b>训练与发布</b><span>训练 → 离线评估 → 人工批准 → 灰度下发 → 生效回报；任一步失败均可回滚。</span></div></template>
        <el-table :data="pagedTrainingRuns" height="260"><el-table-column prop="train_run_id" label="训练任务" min-width="220" /><el-table-column prop="dataset_version" label="数据集版本" min-width="220" /><el-table-column prop="status" label="状态" width="130" /><el-table-column label="发起时间" min-width="190"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column><el-table-column prop="output_model_id" label="输出模型" min-width="220" /></el-table>
        <div class="pager"><el-pagination v-model:current-page="trainingPage" :page-size="pageSize" :total="trainingRuns.length" layout="total, prev, pager, next" /></div>
      </el-card>
      <el-card shadow="never" class="panel"><template #header><div class="panel-head"><b>候选模型与发布门禁</b><span>需查看事件级召回、空桌误报、链路成功率与灰度设备回报。</span></div></template>
        <el-table :data="pagedCandidateModels" height="260"><el-table-column prop="model_id" label="模型 ID" min-width="240" /><el-table-column prop="scenario" label="场景" min-width="180" /><el-table-column prop="status" label="状态" width="120" /><el-table-column label="更新时间" min-width="190"><template #default="{ row }">{{ formatTime(row.updated_at || row.created_at) }}</template></el-table-column></el-table>
        <div class="pager"><el-pagination v-model:current-page="modelPage" :page-size="pageSize" :total="candidateModels.length" layout="total, prev, pager, next" /></div>
      </el-card>
    </template>

    <el-dialog v-model="detailVisible" :title="`素材全链路详情 · ${selected?.sample_id || ''}`" width="1180px">
      <div v-if="selected" class="detail">
        <div>
          <div class="image-stage-head"><b>{{ activeStageView.title }}</b><span>{{ activeStageView.subtitle }}</span></div>
          <div class="audit-image"><img ref="detailImageRef" :key="`${selected?.sample_id || 'sample'}-${activeDetailStage}-${activeStageView.imageUrl}`" :src="asset(activeStageView.imageUrl)" @load="recordImageSize" @error="hideImage" /><template v-for="(item,index) in activeDrawableBoxes" :key="index"><span :class="['audit-box', item.source]" :style="boxStyle(item.box)" :aria-label="item.label" :title="item.label"></span></template></div>
          <div v-if="activeDrawableBoxes.length" class="box-legend"><span v-for="item in activeBoxLegend" :key="item.source" :class="['legend-dot', item.source]"></span><template v-for="(item, index) in activeBoxLegend" :key="`${item.source}-label`"><span>{{ item.label }}</span><i v-if="index < activeBoxLegend.length - 1">·</i></template></div>
          <p class="box-note">{{ boxNote(selected, activeDetailStage) }}</p>
        </div>
        <div class="chain-detail">
          <p><b>素材 ID：</b>{{ selected.sample_id }}</p><p><b>场景：</b>{{ selected.scenario }}</p>
          <div class="lifecycle-stages"><b>完整处理链路</b><button v-for="stageItem in lifecycleStages(selected)" :key="stageItem.key" type="button" class="stage-card" :class="[stageItem.state, { selected: activeDetailStage === stageItem.key }]" @click="selectDetailStage(stageItem.key)"><strong>{{ stageItem.index }} {{ stageItem.title }}</strong><span>{{ stageItem.summary }}</span><small v-if="stageItem.detail">{{ stageItem.detail }}</small></button></div>
        </div>
      </div>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import api, { apiAssetUrl } from '../api'

const route = useRoute()
const Metric = defineComponent({
  props: { label: { type: String, required: true }, value: { type: Number, required: true }, hint: { type: String, default: '' }, danger: { type: Boolean, default: false } },
  setup(props) { return () => h('div', { class: ['metric', { danger: props.danger }] }, [h('strong', String(props.value)), h('span', props.label), props.hint ? h('small', props.hint) : null]) },
})
const loading = ref(false)
const customerId = ref(localStorage.getItem('guardian_customer_id') || '')
const siteId = ref(localStorage.getItem('guardian_site_id') || '')
const scenario = ref('desk_drink_intrusion')
const alarmId = ref(String(route.query.source_event_id || ''))
const materials = ref<any[]>([]), datasets = ref<any[]>([]), trainingRuns = ref<any[]>([]), evaluations = ref<any[]>([]), models = ref<any[]>([])
const materialPage = ref(1), materialTotal = ref(0), materialMetrics = ref<any>({}), pageSize = 20
const datasetPage = ref(1), trainingPage = ref(1), modelPage = ref(1)
const detailVisible = ref(false), selected = ref<any>(null), selectedImageSize = ref({ width: 0, height: 0 }), activeDetailStage = ref('raw')
const detailImageRef = ref<HTMLImageElement | null>(null)
const activeStage = computed(() => String(route.meta.forgeStage || 'materials'))
const pages:any = { materials:{ title:'Forge 训练中心 · 素材收集', description:'查看现场采集、隐私处理、去重与入库状态。', note:'只有带可信 KKOS 脱敏与授权来源的完整 ROI 图，才会进入后续流程。' }, vlm:{ title:'Forge 训练中心 · VLM 审计', description:'自动审计合规素材，并生成可追溯的标注草稿。', note:'VLM 使用该算法已配置的提示词；不干预现场 L1/L2 即时报警。' }, review:{ title:'Forge 训练中心 · 人工审核', description:'只处理自动系统无法可靠确认的少量素材。', note:'人工审核确认的是训练标签，不改变已经发生的现场报警。' }, datasets:{ title:'Forge 训练中心 · 训练数据集', description:'把已确认素材冻结为可复现的数据集版本。', note:'历史隔离素材及未确认素材不允许加入数据集。' }, release:{ title:'Forge 训练中心 · 训练与发布', description:'管理训练任务、评估门禁、灰度与回滚。', note:'模型必须经过离线评估和灰度生效回报，才算正式发布。' } }
const stage = computed(() => pages[activeStage.value] || pages.materials)
const eligibleRows = computed(() => Number(materialMetrics.value.eligible || 0))
const vlmRows = computed(() => materials.value.map((r:any) => ({ ...r, teacher_model: auditModel(r), vlm_decision: r.sample_judgement?.vlm?.status || r.vlm_status || 'pending', reason: r.sample_judgement?.vlm?.reason || '等待自动审计' })))
const reviewRows = computed(() => materials.value)
const candidateModels = computed(() => models.value.filter((m:any) => m.status === 'candidate'))
const pagedDatasets = computed(() => paginate(datasets.value, datasetPage.value))
const pagedTrainingRuns = computed(() => paginate(trainingRuns.value, trainingPage.value))
const pagedCandidateModels = computed(() => paginate(candidateModels.value, modelPage.value))
function paginate(rows:any[], page:number) { return rows.slice((page - 1) * pageSize, page * pageSize) }
function params(extra:any = {}) { const p:any={ scope:'customer_optimized', scenario:scenario.value, ...extra }; if(alarmId.value.trim()) p.source_event_id=alarmId.value.trim(); if(customerId.value) p.customer_id=customerId.value; if(siteId.value) p.site_id=siteId.value; return { params:p } }
async function loadMaterials(page = materialPage.value) {
  materialPage.value = page
  const { data } = await api.get('/ai-center/material-pool', params({ summary: 1, stage: activeStage.value, page, page_size: pageSize }))
  materials.value = data.items || []
  materialTotal.value = Number(data.total || 0)
  materialMetrics.value = data.metrics || {}
}
async function refresh(){ loading.value=true; try { materialPage.value=1; const [,d,t,e,mo] = await Promise.all([loadMaterials(1),api.get('/datasets',{params:{scope:'customer',customer_id:customerId.value}}),api.get('/training-runs',{params:{customer_id:customerId.value}}),api.get('/evaluations'),api.get('/models')]); datasets.value=d.data||[]; trainingRuns.value=t.data||[]; evaluations.value=e.data||[]; models.value=mo.data||[] } catch(err:any){ ElMessage.error(err?.response?.data?.detail || '加载 Forge 数据失败') } finally { loading.value=false } }
async function buildDataset(){ try { const { data } = await api.post('/ai-lifecycle/datasets/build-customer',{ customer_id:customerId.value, site_id:siteId.value, scenario:scenario.value }); ElMessage.success(`已冻结数据集 ${data.dataset_version}`); refresh() } catch(err:any){ ElMessage.error(err?.response?.data?.detail || '无法创建数据集') } }
function asset(url:string){ return apiAssetUrl(url || '') }
function auditModel(row:any){ return row.sample_judgement?.vlm?.teacher_model || row.teacher_model || 'ollama/qwen2.5vl:7b@5070Ti' }
function auditTime(row:any){ return row.vlm_audited_at || row.sample_judgement?.vlm?.audited_at || row.sample_judgement?.vlm?.at || row.updated_at || row.created_at }
function formatTime(value:any){
  if(!value) return '-'
  const date=new Date(value)
  if(Number.isNaN(date.getTime())) return '-'
  const parts=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date)
  const values=Object.fromEntries(parts.filter((part)=>part.type!=='literal').map((part)=>[part.type,part.value])) as Record<string,string>
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`
}
function hideImage(e:any){ e.target.style.visibility='hidden' }
function refreshImageSizeFromDom(){
  const img=detailImageRef.value
  if(!img) return
  img.style.visibility='visible'
  if(img.naturalWidth && img.naturalHeight) selectedImageSize.value={ width:img.naturalWidth, height:img.naturalHeight }
}
async function openDetail(row:any, stage='raw'){
  detailVisible.value=true
  selected.value=null
  activeDetailStage.value=stage
  selectedImageSize.value={width:0,height:0}
  try {
    const { data } = await api.get(`/ai-center/material-pool/${encodeURIComponent(row.sample_id)}`, params())
    selected.value=data
    nextTick(refreshImageSizeFromDom)
  } catch(err:any) {
    detailVisible.value=false
    ElMessage.error(err?.response?.data?.detail || '加载素材详情失败')
  }
}
function selectDetailStage(stageKey:string){ activeDetailStage.value=stageKey; selectedImageSize.value={width:0,height:0}; nextTick(refreshImageSizeFromDom) }
function recordImageSize(event:any){ event.target.style.visibility='visible'; selectedImageSize.value={ width:event.target.naturalWidth || 0, height:event.target.naturalHeight || 0 } }
function needsHuman(r:any){
  const vlm=r.sample_judgement?.vlm || {}
  const confidence=Number(vlm.confidence ?? r.confidence ?? 0)
  const status=vlm.status || r.vlm_status
  const disagreement=String(r.disagreement_type || '')
  // “L1/L2 不一致”常来自未走完整边缘链路的定期防漏检样本，
  // 不是 VLM 与现有判断的真实冲突，不能因此塞入人工队列。
  const genuineConflict=disagreement && !['none','l1_l2_disagree','edge_result_not_ground_truth'].includes(disagreement)
  return ['uncertain','need_human_review','need_human_box'].includes(status)
    || (['positive','suspected_hazard','negative','no_hazard'].includes(status) && confidence>0 && confidence<0.75)
    || genuineConflict
}
function stageLabel(r:any){ const v=r.sample_judgement?.vlm?.status || r.vlm_status; const h=r.sample_judgement?.human?.status; if(h === 'human_reviewed') return '人工审核完成'; if(needsHuman(r)) return '等待人工审核'; if(['positive','negative','completed','suspected_hazard','no_hazard'].includes(v)) return 'VLM 审计完成'; return '已入库，待 VLM' }
function stageType(r:any){ const s=stageLabel(r); return s.includes('完成') ? 'success' : s.includes('等待人工') ? 'warning' : 'info' }
const activeStageView = computed(() => detailStageView(selected.value, activeDetailStage.value))
const activeDrawableBoxes = computed(() => selected.value ? drawableBoxesForStage(selected.value, activeDetailStage.value) : [])
const activeBoxLegend = computed(() => boxLegendForItems(activeDrawableBoxes.value))
function detailStageView(row:any, stageKey:string){
  const imageUrl = stageImageUrl(row, stageKey)
  const meta:any = {
    raw:['原图与上报原因','云端可查看图：完整 ROI · 已脱敏'],
    l1:['L1 标记图','只显示 L1 返回的橙色检测框'],
    l2:['L2 标记图','只显示 L2 返回的绿色复核框'],
    privacy:['本地脱敏图','云端保存的合规 ROI 图'],
    vlm:['VLM 审计标注图','只显示 VLM 返回的蓝色标注框'],
    human:['人工确认标注图','只显示人工最终确认框'],
    training:['训练准入图','显示最终训练标签对应框'],
  }
  const [title, subtitle] = meta[stageKey] || meta.raw
  return { title, subtitle, imageUrl }
}
function stageImageUrl(row:any, stageKey:string){
  if(!row) return ''
  const images=row.stage_images || row.images || {}
  return images[stageKey] || row[`${stageKey}_image_url`] || row.thumbnail_url || ''
}
function drawableBoxesForStage(row:any, stageKey:string){
  if(!row) return []
  const width=selectedImageSize.value.width || imageWidthHint(row), height=selectedImageSize.value.height || imageHeightHint(row)
  const stageBoxes=(raw:any,label:string,source:string)=>asBoxes(raw).map((box:any)=>normaliseBox(box,width,height)).filter(Boolean).map((box:any)=>({box,label,source}))
  const l1=edgeStage(row,'l1')
  const l2=edgeStage(row,'l2')
  const vlm=row.sample_judgement?.vlm || {}
  const human=row.sample_judgement?.human || {}
  if(stageKey === 'l1') return isEdgeStageReported(l1) ? stageBoxes(l1.detections || row.l1_detections || row.l1Detections || l1.bbox || row.l1_bbox,'L1 检测框','l1') : []
  if(stageKey === 'l2') return isEdgeStageReported(l2) ? stageBoxes(l2.detections || row.l2_detections || row.l2Detections || l2.bbox || row.l2_bbox,'L2 检测框','l2') : []
  if(stageKey === 'vlm') return stageBoxes(vlmBoxCandidates(row, vlm),'VLM 审计框','vlm')
  if(stageKey === 'human') return stageBoxes(human.bbox || row.human_bbox || row.human_label_bbox_norm,'人工确认框','human')
  if(stageKey === 'training') return stageBoxes(human.bbox || row.human_bbox || row.human_label_bbox_norm || vlmBoxCandidates(row, vlm),'最终训练框','human')
  return []
}
function asBoxes(raw:any){
  if(raw == null || raw === '') return []
  if(typeof raw === 'string'){
    try { return asBoxes(JSON.parse(raw)) } catch (_) { return [] }
  }
  if(Array.isArray(raw)){
    if(raw.length >= 4 && raw.slice(0,4).every((item:any)=>Number.isFinite(Number(item))) && typeof raw[0] !== 'object') return [raw]
    return raw.flatMap((item:any)=>asBoxes(item))
  }
  if(raw && typeof raw === 'object'){
    const grouped=raw.detections || raw.targets || raw.boxes || raw.bboxes || raw.items
    if(grouped) return asBoxes(grouped)
    const box=raw.bbox || raw.box || raw.xyxy || raw.bbox_xyxy || raw.bbox_norm || raw.bbox_xyxy_norm || raw.xywh
    if(box) return [{...raw,bbox:box,bbox_format:raw.bbox_format || raw.format || raw.coordinate_format}]
  }
  return []
}
function vlmBoxCandidates(row:any, vlm:any){
  const result:any[]=[]
  // Material detail returns the source audit in `row.vlm`, while the
  // normalized judgement keeps a flat `boxes` array. Read both contracts.
  const rawVlm=row?.vlm || row?.vlm_raw || {}
  const pushBox=(box:any, format='')=>{
    if(!Array.isArray(box) || box.length<4) return
    const normalizedFormat=String(format || (box.slice(0,4).every((value:any)=>Math.abs(Number(value))<=1.01) ? 'xyxy_norm' : 'xyxy')).toLowerCase()
    result.push({ bbox: box.slice(0,4), bbox_format: normalizedFormat })
  }
  const pushObjectBoxes=(value:any, fallbackFormat='')=>{
    if(!Array.isArray(value)) return
    for(const item of value){
      if(Array.isArray(item) && fallbackFormat) pushBox(item, fallbackFormat)
      else if(item && typeof item === 'object'){
        const box=item.bbox || item.box || item.bbox_norm || item.bbox_xyxy_norm || item.xyxy || item.xywh
        const format=String(item.bbox_format || item.format || item.coordinate_format || (item.xywh ? 'xywh' : item.xyxy ? 'xyxy' : item.bbox_xyxy_norm ? 'xyxy_norm' : item.bbox_norm ? 'xyxy_norm' : fallbackFormat)).toLowerCase()
        pushBox(box, format)
      }
    }
  }
  pushObjectBoxes(vlm?.suggested_labels)
  pushObjectBoxes(row?.suggested_labels)
  pushObjectBoxes(vlm?.labels)
  pushObjectBoxes(vlm?.detections)
  pushObjectBoxes(row?.vlm_raw?.suggested_labels)
  pushObjectBoxes(row?.vlm_raw?.labels)
  pushObjectBoxes(row?.vlm_raw?.detections)
  pushObjectBoxes(vlm?.boxes, String(vlm?.boxes_format || vlm?.bbox_format || '').toLowerCase())
  pushBox(vlm?.boxes, String(vlm?.boxes_format || vlm?.bbox_format || '').toLowerCase())
  pushObjectBoxes(row?.vlm_raw?.boxes, String(row?.vlm_raw?.boxes_format || row?.vlm_raw?.bbox_format || '').toLowerCase())
  pushBox(rawVlm?.bbox_xyxy_norm, 'xyxy_norm')
  pushBox(rawVlm?.bbox, String(rawVlm?.bbox_format || '').toLowerCase())
  pushBox(rawVlm?.bbox_norm, String(rawVlm?.bbox_format || rawVlm?.bbox_norm_format || 'xyxy_norm').toLowerCase())
  pushBox(vlm?.bbox_xyxy_norm, 'xyxy_norm')
  pushBox(vlm?.bbox, String(vlm?.bbox_format || '').toLowerCase())
  pushBox(row?.vlm_raw?.bbox_xyxy_norm, 'xyxy_norm')
  pushBox(row?.vlm_raw?.bbox, String(row?.vlm_raw?.bbox_format || '').toLowerCase())
  pushBox(vlm?.bbox_norm, String(vlm?.bbox_format || vlm?.bbox_norm_format || 'xyxy_norm').toLowerCase())
  pushBox(row?.vlm_raw?.bbox_norm, String(row?.vlm_raw?.bbox_format || row?.vlm_raw?.bbox_norm_format || 'xyxy_norm').toLowerCase())
  pushBox(row?.label_bbox_norm, String(row?.label_bbox_format || 'xyxy_norm').toLowerCase())
  pushObjectBoxes(row?.vlm_boxes, String(row?.vlm_bbox_format || '').toLowerCase())
  pushBox(row?.vlm_boxes, String(row?.vlm_bbox_format || '').toLowerCase())
  pushBox(row?.vlm_bbox, String(row?.vlm_bbox_format || '').toLowerCase())
  return result
}
function normaliseBox(raw:any,width:number,height:number){
  const payload=boxPayload(raw)
  if(!payload.values.length) return null
  const [a,b,c,d]=payload.values
  if(![a,b,c,d].every(Number.isFinite)) return null
  const fmt=payload.format
  const isNorm=fmt.includes('norm') || Math.max(Math.abs(a),Math.abs(b),Math.abs(c),Math.abs(d))<=1.01
  let x1=a,y1=b,x2=c,y2=d
  if(fmt.includes('cxcywh') || fmt.includes('center')){
    x1=a-c/2; y1=b-d/2; x2=a+c/2; y2=b+d/2
  } else if(fmt.includes('xywh') && !fmt.includes('xyxy')){
    x2=a+c; y2=b+d
  } else if((c<=a || d<=b) && canRecoverXywh(a,b,c,d,isNorm,width,height)){
    x2=a+c; y2=b+d
  }
  if(x2<=x1 || y2<=y1) return null
  // Forge/Qwen uses 0..1000 normalized coordinates; a few integrations use
  // 0..1. Support both before clamping, otherwise a valid 375..885 box is
  // collapsed to [1,1,1,1] and disappears.
  if(isNorm){
    const scale=Math.max(Math.abs(x1),Math.abs(y1),Math.abs(x2),Math.abs(y2))>1.01 ? 1000 : 1
    return clampNormBox([x1/scale,y1/scale,x2/scale,y2/scale])
  }
  if(!width || !height) return null
  return clampNormBox([x1/width,y1/height,x2/width,y2/height])
}
function canRecoverXywh(a:number,b:number,c:number,d:number,isNorm:boolean,width:number,height:number){
  return isNorm ? a+c<=1.05 && b+d<=1.05 : Boolean(width && height && a+c<=width*1.05 && b+d<=height*1.05)
}
function clampNormBox(box:number[]){
  const [x1,y1,x2,y2]=box.map((value)=>Math.max(0,Math.min(1,value)))
  return x2>x1 && y2>y1 ? [x1,y1,x2,y2] : null
}
function imageWidthHint(row:any){ return Number(row.frame_width || row.image_width || row.width || 1280) }
function imageHeightHint(row:any){ return Number(row.frame_height || row.image_height || row.height || 720) }
function edgeStage(row:any,key:'l1'|'l2'){
  const stage={ ...(row.sample_judgement?.[key] || {}) }
  const topBox=row[`${key}_bbox`]
  const topDetections=row[`${key}_detections`] || row[`${key}Detections`]
  const detectionRows=asBoxes(topDetections)
  const topStatus=row[`${key}_status`]
  const topClass=row[`${key}_class`]
  const topConfidence=row[`${key}_confidence`]
  if(!stage.detections && detectionRows.length) stage.detections=topDetections
  if(!stage.bbox && detectionRows.length) stage.bbox=topDetections
  if(!stage.bbox && asBoxes(topBox).length) stage.bbox=topBox
  if(!stage.status && topStatus) stage.status=topStatus
  if(!stage.classes && detectionRows.length) stage.classes=[...new Set(detectionRows.map((item:any)=>item.class_name || item.className || item.label || item.class).filter(Boolean))]
  if(!stage.classes && topClass) stage.classes=[topClass]
  if(stage.confidence == null && topConfidence != null) stage.confidence=topConfidence
  return stage
}
function boxPayload(raw:any){
  if(Array.isArray(raw)) return { values:raw.slice(0,4).map(Number), format:'' }
  if(raw && typeof raw === 'object'){
    if(['x','y','width','height'].every((key)=>Number.isFinite(Number(raw[key])))) return { values:[raw.x,raw.y,raw.width,raw.height].map(Number), format:String(raw.format || raw.bbox_format || raw.coordinate_format || 'xywh').toLowerCase() }
    const box=raw.bbox || raw.box || raw.bbox_norm || raw.bbox_xyxy_norm || raw.xyxy || raw.xywh || []
    const format=String(raw.format || raw.bbox_format || raw.coordinate_format || (raw.xywh ? 'xywh' : raw.xyxy ? 'xyxy' : raw.bbox_xyxy_norm ? 'xyxy_norm' : raw.bbox_norm ? 'xyxy_norm' : raw.bbox_norm_format || '')).toLowerCase()
    return { values:Array.isArray(box) ? box.slice(0,4).map(Number) : [], format }
  }
  return { values:[], format:'' }
}
function boxLegendForItems(items:any[]){
  const labels:any={l1:'L1 检测框',l2:'L2 检测框',vlm:'VLM 审计框',human:'人工确认框'}
  return [...new Set(items.map((item:any)=>item.source))].map((source:any)=>({source,label:labels[source] || source}))
}
function boxNote(_row:any, stageKey='raw'){ const boxes=activeDrawableBoxes.value; if(!boxes.length) return stageKey === 'raw' || stageKey === 'privacy' ? '此步骤展示完整 ROI 脱敏图，不叠加目标框。' : '当前步骤未返回可绘制定位框；这不等同于没有产生该阶段，只表示该阶段没有返回坐标。'; return '框内不填充颜色、不显示文字，以便直接查看桌面与目标。图例仅说明当前步骤的边框来源。' }
function boxStyle(box:any){ const [x1,y1,x2,y2]=box.map(Number); if(![x1,y1,x2,y2].every(Number.isFinite)) return {}; return {left:`${Math.max(0,x1)*100}%`,top:`${Math.max(0,y1)*100}%`,width:`${Math.max(0,x2-x1)*100}%`,height:`${Math.max(0,y2-y1)*100}%`} }
function sourceLabel(r:any){ if(r.source_type === 'guardian_forge_historical') return '历史隔离'; const kind=collectionKind(r); if(kind==='resolved') return '报警消除验证帧'; if(kind==='periodic') return '防漏报定期抽帧'; if(kind==='l2') return 'L2 命中上报'; if(kind==='l1') return 'L1 命中上报'; if(kind==='disagree') return 'L1/L2 判断不一致'; if(kind==='inconsistent') return '来源字段异常'; return 'KKOS 事件采集' }
function privacyLabel(r:any){ return r.privacy_status === 'privacy_processed' ? '完整 ROI · 本地脱敏 · 已授权' : r.privacy_status === 'legacy_provenance_unknown' ? '历史来源不可验证（已隔离）' : r.privacy_status || '待处理' }
function flowLabel(r:any){ if(r.source_type === 'guardian_forge_historical') return '隔离：不可进入闭环'; const v=r.sample_judgement?.vlm?.status || r.vlm_status; const h=r.sample_judgement?.human?.status; return h === 'human_reviewed' ? '人工已确认' : needsHuman(r) ? '等待人工审核' : ['positive','negative','completed','suspected_hazard','no_hazard'].includes(v) ? 'VLM 已生成草稿' : '等待 VLM 自动审计' }
function decisionLabel(v:string){ return ({positive:'饮品容器',suspected_hazard:'饮品容器',negative:'非饮品容器',no_hazard:'未见饮品容器',uncertain:'不确定',pending:'等待审计',not_run:'等待审计',failed:'审计失败'} as any)[v] || v }
function decisionType(v:string){ return v==='positive'?'success':v==='negative'?'info':v==='uncertain'?'warning':'' }
function score(r:any){ const n=Number(r.sample_judgement?.vlm?.confidence || r.confidence || 0); return n ? `${Math.round(n*100)}%` : '-' }
function humanLabel(r:any){ return r.sample_judgement?.human?.status === 'human_reviewed' ? '已确认' : '待审核' }
function labelDraftLabel(r:any){ const status=r.label_status || r.forge_label_status || ''; if(status === 'auto_labeled' || status === 'auto_label_draft') return 'VLM 已生成标注草稿'; if(['need_review','need_human_review','need_human_box'].includes(status)) return '等待人工确认标注'; return '等待 VLM 结果' }
function edgeStageSummary(stage:any, label:string){
  if(!isEdgeStageReported(stage)) return `${label} 未上报或未执行`
  const classes=Array.isArray(stage.classes) && stage.classes.length ? stage.classes.join('、') : '未返回类别'
  const confidence=Number(stage.confidence || 0)
  return `${stage.status === 'hit' ? '命中' : stage.status} · ${classes}${confidence ? ` · ${Math.round(confidence * 100)}%` : ''}`
}
function isEdgeStageReported(stage:any){ return Boolean(stage && !['not_reported','not_run','pending',''].includes(String(stage.status || ''))) }
function hasEdgeBox(stage:any){
  return asBoxes(stage?.detections || stage?.bbox || stage?.boxes || []).length > 0
}
function hasStageEvidence(stage:any){
  return isEdgeStageReported(stage) || hasEdgeBox(stage)
}
function collectionKind(row:any){
  const type=String(row.collection_type || row.collectionType || '').toLowerCase()
  const note=String(row.source_note || row.reason || '').toLowerCase()
  const l1=edgeStage(row,'l1')
  const l2=edgeStage(row,'l2')
  if(row.source_type === 'guardian_forge_historical') return 'legacy'
  if(type.includes('resolved') || note.includes('报警消除')) return 'resolved'
  const saysL2=['l2_alarm_frame','alarm','confirmed_alarm'].includes(type) || note.includes('l2 已确认') || note.includes('l2 命中')
  const saysL1=type.includes('l1') || note.includes('l1 命中')
  if(saysL2 && !hasStageEvidence(l2)) return 'inconsistent'
  if(saysL1 && !hasStageEvidence(l1)) return 'inconsistent'
  if(saysL2 || hasStageEvidence(l2)) return 'l2'
  if(type.includes('disagree') || String(row.disagreement_type || '').includes('disagree')) return 'disagree'
  if(['periodic_miss_guard','periodic_scan','miss_guard'].includes(type) || note.includes('防漏') || note.includes('定期') || note.includes('漏报') || note.includes('30 秒')) return 'periodic'
  if(hasStageEvidence(l1)) return 'l1'
  return 'event'
}
function collectionReason(row:any){
  const kind=collectionKind(row)
  if(kind === 'legacy') return '历史隔离素材：来源或隐私链路不符合当前训练标准'
  if(kind === 'resolved') return '报警消除验证帧：用于确认风险已消除，并沉淀困难负样本；与原始告警命中帧属于同一告警闭环'
  if(kind === 'inconsistent') return '来源字段异常：上报原因标记为 L1/L2 命中，但素材未携带对应模型结果或坐标框；需要人工确认，不能直接作为训练依据'
  if(kind === 'l2') return 'L2 命中上报：现场 L2 复核确认风险后进入 Forge 素材库'
  if(kind === 'l1') return 'L1 命中上报：L1 NPU 识别到候选目标后进入 Forge 素材库'
  if(kind === 'disagree') return 'L1/L2 判断不一致：用于回溯边缘模型差异与困难样本'
  if(kind === 'periodic') return '防漏报定期抽帧：按配置周期抽取完整 ROI，直接进入 Forge/VLM，防止静态目标漏检'
  return row.source_note || '现场事件采集：KKOS 在画面变化或规则命中后上报'
}
function isHazardStage(stage:any){
  if(!isEdgeStageReported(stage)) return false
  const classes=Array.isArray(stage.classes) ? stage.classes.map((item:any)=>String(item).toLowerCase()) : []
  const status=String(stage.status || '').toLowerCase()
  return ['hit','confirmed','positive'].includes(status) || classes.some((item:string)=>['cup','mug','bottle','thermos','can','drink_container','container'].includes(item))
}
function isHazardVlm(vlm:any){
  const status=String(vlm?.status || '').toLowerCase()
  const category=String(vlm?.suggested_category || '').toLowerCase()
  const labels=Array.isArray(vlm?.suggested_labels) ? vlm.suggested_labels.map((item:any)=>String(item).toLowerCase()) : []
  return ['positive','suspected_hazard'].includes(status) || ['positive','drink_container','container','cup','bottle'].includes(category) || labels.some((item:string)=>item.includes('drink') || ['cup','mug','bottle','thermos','can'].includes(item))
}
function boxIou(a:any,b:any){
  if(!a || !b) return 0
  const x1=Math.max(a[0],b[0]), y1=Math.max(a[1],b[1]), x2=Math.min(a[2],b[2]), y2=Math.min(a[3],b[3])
  const inter=Math.max(0,x2-x1)*Math.max(0,y2-y1)
  const areaA=Math.max(0,a[2]-a[0])*Math.max(0,a[3]-a[1])
  const areaB=Math.max(0,b[2]-b[0])*Math.max(0,b[3]-b[1])
  return inter/(areaA+areaB-inter || 1)
}
function edgeVlmWarning(row:any){
  const l1=edgeStage(row,'l1')
  const l2=edgeStage(row,'l2')
  const vlm=row.sample_judgement?.vlm || {}
  const edgeHit=isHazardStage(l1) || isHazardStage(l2)
  const vlmHit=isHazardVlm(vlm)
  const vlmDone=!['pending','not_run','queued','running',''].includes(String(vlm.status || '').toLowerCase())
  if(vlmDone && vlmHit && !edgeHit) return '注意：VLM 判断存在饮品容器，但当前素材没有 L1/L2 命中框佐证；VLM 框只能作为草稿，不能直接作为训练框，必须人工确认/修框。'
  if(vlmDone && edgeHit && !vlmHit) return '注意：L1/L2 命中饮品容器，但 VLM 未确认，疑似误报或 VLM 漏判，需要人工确认。'
  const width=selectedImageSize.value.width || imageWidthHint(row), height=selectedImageSize.value.height || imageHeightHint(row)
  const edgeRaw=(asBoxes(l2.detections || l2.bbox).length ? (l2.detections || l2.bbox) : (l1.detections || l1.bbox)) || []
  const edgeBoxes=asBoxes(edgeRaw).map((box:any)=>normaliseBox(box,width,height)).filter(Boolean)
  const vlmBoxes=asBoxes(vlmBoxCandidates(row, vlm)).map((box:any)=>normaliseBox(box,width,height)).filter(Boolean)
  if(edgeHit && vlmHit && edgeBoxes.length && vlmBoxes.length && edgeBoxes.length !== vlmBoxes.length) return `注意：L1/L2 返回 ${edgeBoxes.length} 个目标框，VLM 返回 ${vlmBoxes.length} 个目标框，数量不一致；请人工确认。`
  if(edgeHit && vlmHit && edgeBoxes.length && vlmBoxes.length){
    const badlyMatched=vlmBoxes.some((vlmBox:any)=>Math.max(...edgeBoxes.map((edgeBox:any)=>boxIou(edgeBox,vlmBox)))<0.2)
    if(badlyMatched) return '注意：VLM 标注框与 L1/L2 检测框位置偏差较大，不能直接作为训练标签，建议人工修框。'
  }
  return ''
}
function lifecycleStages(row:any){
  const l1=edgeStage(row,'l1')
  const l2=edgeStage(row,'l2')
  const vlm=row.sample_judgement?.vlm || {}
  const human=row.sample_judgement?.human || {}
  const trainingEligible=row.training_eligibility === 'eligible'
  const vlmDecision=decisionLabel(vlm.suggested_category || vlm.status || 'pending')
  return [
    {key:'raw',index:'①',title:'原图与上报原因',state:'done',summary:`${formatTime(row.created_at)} · ${sourceLabel(row)}`,detail:`${collectionReason(row)}。原始未脱敏图仅保留在现场 KKOS，云端不保存。`},
    {key:'l1',index:'②',title:'L1 标记',state:l1.status === 'hit' ? 'done' : 'waiting',summary:edgeStageSummary(l1,'L1'),detail:isEdgeStageReported(l1) && asBoxes(l1.bbox).length ? `已返回 ${asBoxes(l1.bbox).length} 个 L1 框（见图例）。` : '无 L1 坐标可绘制。'},
    {key:'l2',index:'③',title:'L2 标记',state:l2.status === 'hit' || l2.status === 'confirmed' ? 'done' : 'waiting',summary:edgeStageSummary(l2,'L2'),detail:isEdgeStageReported(l2) && asBoxes(l2.bbox).length ? `已返回 ${asBoxes(l2.bbox).length} 个 L2 框（见图例）。` : '无 L2 坐标可绘制。'},
    {key:'privacy',index:'④',title:'本地脱敏内容',state:row.privacy_status === 'privacy_processed' ? 'done' : 'blocked',summary:privacyLabel(row),detail:row.privacy_actions?.length ? `处理动作：${row.privacy_actions.join('、')}` : `处理方法：${row.privacy_method || '未上报'}`},
    {key:'vlm',index:'⑤',title:'VLM 审计标注',state:['pending','not_run'].includes(vlm.status) ? 'waiting' : 'done',summary:`${auditModel(row)} · ${vlmDecision}${vlm.confidence ? ` · ${Math.round(Number(vlm.confidence)*100)}%` : ''}`,detail:vlm.reason || '等待自动审计结果。'},
    {key:'human',index:'⑥',title:'人工确认 / 标注',state:human.status === 'human_reviewed' ? 'done' : 'waiting',summary:human.status === 'human_reviewed' ? `已确认${human.reviewed_at ? ` · ${formatTime(human.reviewed_at)}` : ''}` : '未人工确认',detail:human.comment || (needsHuman(row) ? '此素材需要人工确认最终类别或目标框。' : '当前自动标注可继续等待人工抽检。')},
    {key:'training',index:'⑦',title:'训练准入与最终标签',state:trainingEligible ? 'done' : 'waiting',summary:trainingEligible ? '可进入训练数据集' : '暂不可进入训练',detail:trainingEligible ? `最终标签：${row.sample_category || vlmDecision}；准入原因：隐私、授权与标注条件已满足。` : `阻塞原因：${row.blocked_reasons?.join('、') || '等待 VLM 或人工审核完成'}`},
  ]
}
watch(() => route.path, refresh)
onMounted(refresh)
</script>

<style scoped>
.page-head{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.page-head h2{margin:3px 0 8px}.page-head p{margin:0;color:#71809a}.eyebrow{font-size:13px;color:#3277d8;font-weight:700}.context-card,.panel{margin-bottom:16px}.context{display:grid;grid-template-columns:1fr 1fr 1fr 1.25fr 1.7fr;gap:14px;align-items:end}.context label{display:grid;gap:6px;color:#667792;font-size:13px}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:16px 0}.metric{border:1px solid #e4ebf5;padding:16px;border-radius:10px;background:white}.metric strong{font-size:30px;display:block;color:#17243d}.metric.danger strong{color:#cc4958}.metric span,.metric small{display:block;color:#72829c}.metric small{margin-top:7px;font-size:12px}.panel-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.panel-head span{color:#71809a;font-size:13px}.pager{display:flex;justify-content:flex-end;margin-top:14px}.ok{color:#168353}.blocked{color:#bb7b1a}.detail{display:grid;grid-template-columns:1.25fr 1fr;gap:22px}.image-stage-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px}.image-stage-head span{font-size:12px;color:#71809a}.audit-image{position:relative;background:#0f1b30;line-height:0;width:100%;max-height:560px;overflow:auto}.audit-image img{display:block;width:100%;height:auto;background:#0f1b30}.audit-box{position:absolute;box-sizing:border-box;border:3px solid #f59e0b;background:transparent!important;color:transparent!important;font-size:0!important;line-height:0!important;min-width:18px;min-height:18px;pointer-events:auto}.audit-box.l1{border-color:#f59e0b}.audit-box.l2{border-color:#22c55e}.audit-box.vlm{border-color:#3b82f6}.audit-box.human{border-color:#a855f7}.box-legend{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:9px 0;color:#53637c;font-size:12px}.box-legend i{font-style:normal;color:#a1adbf}.legend-dot{display:inline-block;width:10px;height:10px;border:2px solid;border-radius:2px;background:transparent}.legend-dot.l1{border-color:#f59e0b}.legend-dot.l2{border-color:#22c55e}.legend-dot.vlm{border-color:#3b82f6}.legend-dot.human{border-color:#a855f7}.box-note{color:#71809a;font-size:12px}.consistency-warning{margin:0 0 12px;padding:10px 12px;border:1px solid #fecaca;background:#fff1f2;color:#b91c1c;border-radius:8px;font-weight:700;line-height:1.55}.detail p{line-height:1.7;word-break:break-word;margin:4px 0}.lifecycle-stages{margin-top:12px;padding:14px;background:#f7f9fc;border-radius:8px}.stage-card{appearance:none;width:100%;position:relative;margin-top:9px;padding:9px 10px 9px 15px;border:0;border-left:3px solid #94a3b8;background:#fff;border-radius:6px;text-align:left;cursor:pointer}.stage-card:hover,.stage-card.selected{background:#eef6ff;box-shadow:0 0 0 1px #bfdbfe inset}.stage-card::before{content:'';position:absolute;left:-7px;top:15px;width:10px;height:10px;border-radius:50%;background:#94a3b8}.stage-card.done{border-color:#22a06b}.stage-card.done::before{background:#22a06b}.stage-card.waiting{border-color:#e2a126}.stage-card.waiting::before{background:#e2a126}.stage-card.blocked{border-color:#d94f5d}.stage-card.blocked::before{background:#d94f5d}.stage-card strong,.stage-card span,.stage-card small{display:block}.stage-card span{color:#334155;font-size:13px;line-height:1.55;margin-top:2px}.stage-card small{color:#71809a;font-size:12px;line-height:1.5;margin-top:2px}.chain-detail{min-width:0}@media(max-width:1200px){.context{grid-template-columns:1fr 1fr}.metrics{grid-template-columns:1fr}.detail{grid-template-columns:1fr}}
</style>
