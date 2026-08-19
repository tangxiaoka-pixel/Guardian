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
        <el-alert :title="stage.note" type="info" :closable="false" show-icon />
      </div>
    </el-card>

    <template v-if="activeStage === 'materials'">
      <div class="metrics">
        <Metric label="合规素材" :value="trustedRows.length" hint="完整 ROI、KKOS 本地脱敏、授权来源齐全" />
        <Metric label="待 VLM 审计" :value="pendingVlm.length" hint="系统自动提交，不需要手动逐张运行" />
        <Metric label="历史隔离" :value="legacyRows.length" hint="仅保留追溯，不可审计、审核或训练" danger />
      </div>
      <el-card shadow="never" class="panel">
        <template #header><div class="panel-head"><b>素材收集</b><span>现场事件级去重后入库；云端不保存原始未脱敏图。</span></div></template>
        <el-table :data="materials" v-loading="loading" height="560" row-key="sample_id">
          <el-table-column label="图片" width="108"><template #default="{ row }"><img class="thumb clickable" :src="asset(row.thumbnail_url)" @click="openDetail(row)" @error="hideImage" /></template></el-table-column>
          <el-table-column prop="sample_id" label="素材 ID" min-width="220" show-overflow-tooltip />
          <el-table-column prop="scenario" label="算法 / 场景" min-width="190" />
          <el-table-column label="采集时间" min-width="180"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column>
          <el-table-column label="来源" width="150"><template #default="{ row }"><el-tag :type="row.source_type === 'guardian_forge_historical' ? 'warning' : 'success'">{{ sourceLabel(row) }}</el-tag></template></el-table-column>
          <el-table-column label="隐私与授权" min-width="180"><template #default="{ row }"><span :class="row.privacy_status === 'privacy_processed' ? 'ok' : 'blocked'">{{ privacyLabel(row) }}</span></template></el-table-column>
          <el-table-column label="处理状态" min-width="180"><template #default="{ row }">{{ flowLabel(row) }}</template></el-table-column>
          <el-table-column label="当前阶段" width="150"><template #default="{ row }"><el-tag :type="stageType(row)">{{ stageLabel(row) }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="90" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">详情</el-button></template></el-table-column>
        </el-table>
      </el-card>
    </template>

    <template v-else-if="activeStage === 'vlm'">
      <div class="metrics"><Metric label="待审计" :value="pendingVlm.length" /><Metric label="已完成" :value="completedVlm.length" /><Metric label="待人工确认" :value="needHuman.length" hint="仅 uncertain、低置信或冲突样本进入" /></div>
      <el-alert type="success" :closable="false" show-icon title="自动 VLM 队列已启用" description="合规新素材入库后自动发送 Forge VLM；positive/negative 生成标注草稿，uncertain 与冲突结果才送人工审核。VLM 不参与现场即时报警。" />
      <el-card shadow="never" class="panel"><template #header><div class="panel-head"><b>VLM 审计队列</b><span>使用算法绑定的审计提示词，不需要按图片切换规则。</span></div></template>
        <el-table :data="vlmRows" v-loading="loading" height="560">
          <el-table-column label="素材" min-width="220"><template #default="{ row }"><div class="sample-cell"><img class="thumb clickable" :src="asset(row.thumbnail_url)" @click="openDetail(row)" @error="hideImage" /><span>{{ row.sample_id }}</span></div></template></el-table-column>
          <el-table-column label="审计模型" width="180"><template #default="{ row }">{{ auditModel(row) }}</template></el-table-column>
          <el-table-column label="结论" width="130"><template #default="{ row }"><el-tag :type="decisionType(row.vlm_decision)">{{ decisionLabel(row.vlm_decision) }}</el-tag></template></el-table-column>
          <el-table-column label="置信度" width="110"><template #default="{ row }">{{ score(row) }}</template></el-table-column>
          <el-table-column prop="reason" label="审计说明" min-width="330" show-overflow-tooltip />
          <el-table-column label="审计完成时间" min-width="180"><template #default="{ row }">{{ formatTime(auditTime(row)) }}</template></el-table-column>
          <el-table-column label="操作" width="90" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">看审计图</el-button></template></el-table-column>
        </el-table>
      </el-card>
    </template>

    <template v-else-if="activeStage === 'review'">
      <div class="metrics"><Metric label="待人工审核" :value="needHuman.length" /><Metric label="已确认正样本" :value="confirmedPositive.length" /><Metric label="已确认负样本" :value="confirmedNegative.length" /></div>
      <el-card shadow="never" class="panel"><template #header><div class="panel-head"><b>人工审核</b><span>只处理 VLM 不确定、低置信或 L1/L2 与 VLM 结论冲突的合规素材。</span></div></template>
        <el-table :data="reviewRows" v-loading="loading" height="560">
          <el-table-column label="图片" width="108"><template #default="{ row }"><img class="thumb clickable" :src="asset(row.thumbnail_url)" @click="openDetail(row)" @error="hideImage" /></template></el-table-column>
          <el-table-column prop="sample_id" label="素材 ID" min-width="220" show-overflow-tooltip />
          <el-table-column label="VLM 建议" min-width="190"><template #default="{ row }">{{ row.sample_judgement?.vlm?.suggested_category || '等待审计结论' }}</template></el-table-column>
          <el-table-column label="进入原因" min-width="300"><template #default="{ row }">{{ row.sample_judgement?.vlm?.reason || row.blocked_reasons?.join('、') || '需要人工确认' }}</template></el-table-column>
          <el-table-column label="当前状态" width="160"><template #default="{ row }"><el-tag>{{ humanLabel(row) }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="90"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">查看</el-button></template></el-table-column>
        </el-table>
      </el-card>
    </template>

    <template v-else-if="activeStage === 'datasets'">
      <div class="metrics"><Metric label="可入训练素材" :value="eligibleRows.length" hint="已完成 VLM 与人工确认" /><Metric label="正样本" :value="confirmedPositive.length" /><Metric label="困难负样本" :value="confirmedNegative.length" /></div>
      <el-alert type="warning" :closable="false" show-icon title="冻结后才可训练" description="创建训练数据集会固化素材清单、类别分布、采集时间范围与数据版本；训练过程不会受后续新增素材影响。" />
      <el-card shadow="never" class="panel"><template #header><div class="panel-head"><b>训练数据集版本</b><el-button type="primary" :disabled="eligibleRows.length === 0" @click="buildDataset">创建数据集版本</el-button></div></template>
        <el-table :data="datasets" v-loading="loading" height="520"><el-table-column prop="dataset_version" label="数据集版本" min-width="260" /><el-table-column prop="scenario" label="场景" min-width="180" /><el-table-column prop="sample_count" label="素材数" width="110" /><el-table-column label="创建时间" min-width="190"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column><el-table-column label="状态" width="140"><template #default><el-tag type="success">已冻结</el-tag></template></el-table-column></el-table>
      </el-card>
    </template>

    <template v-else>
      <div class="metrics"><Metric label="训练任务" :value="trainingRuns.length" /><Metric label="候选模型" :value="candidateModels.length" /><Metric label="评估报告" :value="evaluations.length" /></div>
      <el-card shadow="never" class="panel"><template #header><div class="panel-head"><b>训练与发布</b><span>训练 → 离线评估 → 人工批准 → 灰度下发 → 生效回报；任一步失败均可回滚。</span></div></template>
        <el-table :data="trainingRuns" height="260"><el-table-column prop="train_run_id" label="训练任务" min-width="220" /><el-table-column prop="dataset_version" label="数据集版本" min-width="220" /><el-table-column prop="status" label="状态" width="130" /><el-table-column label="发起时间" min-width="190"><template #default="{ row }">{{ formatTime(row.created_at) }}</template></el-table-column><el-table-column prop="output_model_id" label="输出模型" min-width="220" /></el-table>
      </el-card>
      <el-card shadow="never" class="panel"><template #header><div class="panel-head"><b>候选模型与发布门禁</b><span>需查看事件级召回、空桌误报、链路成功率与灰度设备回报。</span></div></template>
        <el-table :data="candidateModels" height="260"><el-table-column prop="model_id" label="模型 ID" min-width="240" /><el-table-column prop="scenario" label="场景" min-width="180" /><el-table-column prop="status" label="状态" width="120" /><el-table-column label="更新时间" min-width="190"><template #default="{ row }">{{ formatTime(row.updated_at || row.created_at) }}</template></el-table-column></el-table>
      </el-card>
    </template>

    <el-dialog v-model="detailVisible" :title="`素材全链路详情 · ${selected?.sample_id || ''}`" width="1080px">
      <div v-if="selected" class="detail">
        <div><div class="audit-image"><img :src="asset(selected.thumbnail_url)" @load="recordImageSize" @error="hideImage" /><template v-for="(item,index) in drawableBoxes(selected)" :key="index"><span :class="['audit-box', item.source]" :style="boxStyle(item.box)">{{ item.label }}</span></template></div><p class="box-note">{{ boxNote(selected) }}</p></div>
        <div class="chain-detail">
          <p><b>素材 ID：</b>{{ selected.sample_id }}</p><p><b>场景：</b>{{ selected.scenario }}</p><p><b>来源：</b>{{ selected.source_note || sourceLabel(selected) }}</p><p><b>隐私状态：</b>{{ privacyLabel(selected) }}</p>
          <div class="timeline"><b>完整处理链路</b><ol>
            <li><strong>① 现场采集</strong><span>{{ formatTime(selected.created_at) }} · {{ sourceLabel(selected) }}</span></li>
            <li><strong>② 本地脱敏与授权校验</strong><span>{{ privacyLabel(selected) }} · {{ selected.privacy_method || '未上报处理方法' }}</span></li>
            <li><strong>③ Forge VLM 审计</strong><span>{{ stageLabel(selected) }} · {{ auditModel(selected) }} · {{ formatTime(auditTime(selected)) }}</span><span>结论：{{ decisionLabel(selected.sample_judgement?.vlm?.suggested_category || selected.sample_judgement?.vlm?.status) }} {{ score(selected) }}</span><span>{{ selected.sample_judgement?.vlm?.reason || '等待自动审计' }}</span></li>
            <li><strong>④ 标注草稿</strong><span>{{ labelDraftLabel(selected) }}</span></li>
            <li><strong>⑤ 人工审核</strong><span>{{ humanLabel(selected) }}{{ selected.sample_judgement?.human?.reviewed_at ? ` · ${formatTime(selected.sample_judgement.human.reviewed_at)}` : '' }}</span></li>
            <li><strong>⑥ 训练准入</strong><span>{{ selected.training_eligibility === 'eligible' ? '已可加入训练数据集' : `暂不可训练：${selected.blocked_reasons?.join('、') || '等待审核完成'}` }}</span></li>
          </ol></div>
        </div>
      </div>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, ref, watch } from 'vue'
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
const materials = ref<any[]>([]), datasets = ref<any[]>([]), trainingRuns = ref<any[]>([]), evaluations = ref<any[]>([]), models = ref<any[]>([])
const detailVisible = ref(false), selected = ref<any>(null), selectedImageSize = ref({ width: 0, height: 0 })
const activeStage = computed(() => String(route.meta.forgeStage || 'materials'))
const pages:any = { materials:{ title:'Forge 训练中心 · 素材收集', description:'查看现场采集、隐私处理、去重与入库状态。', note:'只有带可信 KKOS 脱敏与授权来源的完整 ROI 图，才会进入后续流程。' }, vlm:{ title:'Forge 训练中心 · VLM 审计', description:'自动审计合规素材，并生成可追溯的标注草稿。', note:'VLM 使用该算法已配置的提示词；不干预现场 L1/L2 即时报警。' }, review:{ title:'Forge 训练中心 · 人工审核', description:'只处理自动系统无法可靠确认的少量素材。', note:'人工审核确认的是训练标签，不改变已经发生的现场报警。' }, datasets:{ title:'Forge 训练中心 · 训练数据集', description:'把已确认素材冻结为可复现的数据集版本。', note:'历史隔离素材及未确认素材不允许加入数据集。' }, release:{ title:'Forge 训练中心 · 训练与发布', description:'管理训练任务、评估门禁、灰度与回滚。', note:'模型必须经过离线评估和灰度生效回报，才算正式发布。' } }
const stage = computed(() => pages[activeStage.value] || pages.materials)
const trustedRows = computed(() => materials.value.filter((r:any) => r.privacy_status === 'privacy_processed' && r.source_type !== 'guardian_forge_historical'))
const legacyRows = computed(() => materials.value.filter((r:any) => r.source_type === 'guardian_forge_historical'))
const pendingVlm = computed(() => trustedRows.value.filter((r:any) => ['not_run','pending'].includes(r.sample_judgement?.vlm?.status || r.vlm_status)))
const completedVlm = computed(() => trustedRows.value.filter((r:any) => !['not_run','pending'].includes(r.sample_judgement?.vlm?.status || r.vlm_status)))
const needHuman = computed(() => trustedRows.value.filter((r:any) => needsHuman(r)))
const confirmedPositive = computed(() => trustedRows.value.filter((r:any) => r.sample_category === 'confirmed_positive'))
const confirmedNegative = computed(() => trustedRows.value.filter((r:any) => ['confirmed_hard_negative','background_negative','confirmed_boundary'].includes(r.sample_category)))
const eligibleRows = computed(() => trustedRows.value.filter((r:any) => r.training_eligibility === 'eligible'))
const vlmRows = computed(() => [...completedVlm.value, ...pendingVlm.value].map((r:any) => ({ ...r, teacher_model: auditModel(r), vlm_decision: r.sample_judgement?.vlm?.status || 'pending', reason: r.sample_judgement?.vlm?.reason || '等待自动审计' })))
const reviewRows = computed(() => needHuman.value)
const candidateModels = computed(() => models.value.filter((m:any) => m.status === 'candidate'))
function params() { const p:any={ scope:'customer_optimized', scenario:scenario.value }; if(customerId.value) p.customer_id=customerId.value; if(siteId.value) p.site_id=siteId.value; return { params:p } }
async function refresh(){ loading.value=true; try { const [m,d,t,e,mo] = await Promise.all([api.get('/ai-center/material-pool',params()),api.get('/datasets',{params:{scope:'customer',customer_id:customerId.value}}),api.get('/training-runs',{params:{customer_id:customerId.value}}),api.get('/evaluations'),api.get('/models')]); materials.value=m.data||[]; datasets.value=d.data||[]; trainingRuns.value=t.data||[]; evaluations.value=e.data||[]; models.value=mo.data||[] } catch(err:any){ ElMessage.error(err?.response?.data?.detail || '加载 Forge 数据失败') } finally { loading.value=false } }
async function buildDataset(){ try { const { data } = await api.post('/ai-lifecycle/datasets/build-customer',{ customer_id:customerId.value, site_id:siteId.value, scenario:scenario.value }); ElMessage.success(`已冻结数据集 ${data.dataset_version}`); refresh() } catch(err:any){ ElMessage.error(err?.response?.data?.detail || '无法创建数据集') } }
function asset(url:string){ return apiAssetUrl(url || '') }
function auditModel(_row:any){ return 'guardian-vlm' }
function auditTime(row:any){ return row.vlm_audited_at || row.sample_judgement?.vlm?.audited_at || row.sample_judgement?.vlm?.at || row.updated_at || row.created_at }
function formatTime(value:any){
  if(!value) return '-'
  const date=new Date(value)
  if(Number.isNaN(date.getTime())) return '-'
  const parts=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date)
  const values=Object.fromEntries(parts.filter((part)=>part.type!=='literal').map((part)=>[part.type,part.value])) as Record<string,string>
  return `${values.year}-${values.month}-${values.day} ${values.hour}-${values.minute}-${values.second}`
}
function hideImage(e:any){ e.target.style.visibility='hidden' }
function openDetail(row:any){ selected.value=row; selectedImageSize.value={width:0,height:0}; detailVisible.value=true }
function recordImageSize(event:any){ selectedImageSize.value={ width:event.target.naturalWidth || 0, height:event.target.naturalHeight || 0 } }
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
function drawableBoxes(row:any){
  const vlmBoxes=row.vlm_boxes || row.sample_judgement?.vlm?.boxes || row.sample_judgement?.vlm?.bbox_norm || row.label_bbox_norm || []
  const values=Array.isArray(vlmBoxes) && vlmBoxes.length>=4 ? (Array.isArray(vlmBoxes[0]) ? vlmBoxes : [vlmBoxes]) : []
  const width=selectedImageSize.value.width, height=selectedImageSize.value.height
  const realVlm=values.map((box:any)=>normaliseBox(box,width,height)).filter(Boolean).map((box:any)=>({box,label:'VLM 审计',source:'vlm'}))
  if(realVlm.length) return realVlm
  const edgeBox=row.raw_bbox || row.bbox || row.sample_judgement?.l2?.bbox || row.sample_judgement?.l1?.bbox || []
  const candidate=normaliseBox(edgeBox,width,height)
  return candidate ? [{box:candidate,label:'边缘检测候选',source:'candidate'}] : []
}
function normaliseBox(raw:any,width:number,height:number){
  if(!Array.isArray(raw) || raw.length<4) return null
  const [x1,y1,x2,y2]=raw.slice(0,4).map(Number)
  if(![x1,y1,x2,y2].every(Number.isFinite) || x2<=x1 || y2<=y1) return null
  if(Math.max(Math.abs(x1),Math.abs(y1),Math.abs(x2),Math.abs(y2))<=1.01) return [x1,y1,x2,y2]
  if(!width || !height) return null
  return [x1/width,y1/height,x2/width,y2/height]
}
function boxNote(row:any){ const boxes=drawableBoxes(row); if(!boxes.length) return '本次 VLM 未返回可绘制目标框。'; return boxes.some((item:any)=>item.source==='vlm') ? '橙框为 VLM 返回的目标定位框。' : '虚线框为边缘检测候选框；本次 VLM 只给出结论，没有返回定位坐标。' }
function boxStyle(box:any){ const [x1,y1,x2,y2]=box.map(Number); if(![x1,y1,x2,y2].every(Number.isFinite)) return {}; return {left:`${Math.max(0,x1)*100}%`,top:`${Math.max(0,y1)*100}%`,width:`${Math.max(0,x2-x1)*100}%`,height:`${Math.max(0,y2-y1)*100}%`} }
function sourceLabel(r:any){ if(r.source_type === 'guardian_forge_historical') return '历史隔离'; if(r.collection_type === 'periodic_miss_guard') return '防漏检定期抽帧'; if(r.collection_type === 'l2_alarm_frame') return 'L2 告警关键帧'; return 'KKOS 事件采集' }
function privacyLabel(r:any){ return r.privacy_status === 'privacy_processed' ? '完整 ROI · 本地脱敏 · 已授权' : r.privacy_status === 'legacy_provenance_unknown' ? '历史来源不可验证（已隔离）' : r.privacy_status || '待处理' }
function flowLabel(r:any){ if(r.source_type === 'guardian_forge_historical') return '隔离：不可进入闭环'; const v=r.sample_judgement?.vlm?.status || r.vlm_status; const h=r.sample_judgement?.human?.status; return h === 'human_reviewed' ? '人工已确认' : needsHuman(r) ? '等待人工审核' : ['positive','negative','completed','suspected_hazard','no_hazard'].includes(v) ? 'VLM 已生成草稿' : '等待 VLM 自动审计' }
function decisionLabel(v:string){ return ({positive:'饮品容器',suspected_hazard:'饮品容器',negative:'非饮品容器',no_hazard:'未见饮品容器',uncertain:'不确定',pending:'等待审计',not_run:'等待审计',failed:'审计失败'} as any)[v] || v }
function decisionType(v:string){ return v==='positive'?'success':v==='negative'?'info':v==='uncertain'?'warning':'' }
function score(r:any){ const n=Number(r.sample_judgement?.vlm?.confidence || r.confidence || 0); return n ? `${Math.round(n*100)}%` : '-' }
function humanLabel(r:any){ return r.sample_judgement?.human?.status === 'human_reviewed' ? '已确认' : '待审核' }
function labelDraftLabel(r:any){ const status=r.label_status || r.forge_label_status || ''; if(status === 'auto_labeled' || status === 'auto_label_draft') return 'VLM 已生成标注草稿'; if(['need_review','need_human_review','need_human_box'].includes(status)) return '等待人工确认标注'; return '等待 VLM 结果' }
watch(() => route.path, refresh)
onMounted(refresh)
</script>

<style scoped>
.page-head{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.page-head h2{margin:3px 0 8px}.page-head p{margin:0;color:#71809a}.eyebrow{font-size:13px;color:#3277d8;font-weight:700}.context-card,.panel{margin-bottom:16px}.context{display:grid;grid-template-columns:1fr 1fr 1fr 1.7fr;gap:14px;align-items:end}.context label{display:grid;gap:6px;color:#667792;font-size:13px}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:16px 0}.metric{border:1px solid #e4ebf5;padding:16px;border-radius:10px;background:white}.metric strong{font-size:30px;display:block;color:#17243d}.metric.danger strong{color:#cc4958}.metric span,.metric small{display:block;color:#72829c}.metric small{margin-top:7px;font-size:12px}.panel-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.panel-head span{color:#71809a;font-size:13px}.thumb{width:72px;height:54px;object-fit:cover;border-radius:7px;background:#edf2f8}.clickable{cursor:zoom-in}.sample-cell{display:flex;align-items:center;gap:10px}.sample-cell span{max-width:130px;overflow:hidden;text-overflow:ellipsis}.ok{color:#168353}.blocked{color:#bb7b1a}.detail{display:grid;grid-template-columns:1.25fr 1fr;gap:22px}.audit-image{position:relative;background:#0f1b30;line-height:0}.audit-image img{width:100%;max-height:560px;object-fit:contain;background:#0f1b30}.audit-box{position:absolute;border:3px solid #f59e0b;color:#fff;background:#b45309cc;font-size:12px;line-height:16px;min-width:18px;min-height:18px}.audit-box.candidate{border-style:dashed;background:#64748bcc}.box-note{color:#71809a;font-size:12px}.detail p{line-height:1.7;word-break:break-word}.timeline{margin-top:14px;padding:14px;background:#f7f9fc;border-radius:8px}.timeline ol{margin:10px 0 0;padding-left:20px;line-height:1.8}.timeline li{padding:6px 0}.timeline li strong,.timeline li span{display:block}.timeline li span{color:#64748b;font-size:13px;line-height:1.55}.chain-detail{min-width:0}@media(max-width:1200px){.context{grid-template-columns:1fr 1fr}.metrics{grid-template-columns:1fr}.detail{grid-template-columns:1fr}}
</style>
