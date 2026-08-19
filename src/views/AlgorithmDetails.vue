<template>
  <section class="page" v-loading="loading">
    <header class="head">
      <div><h2>{{ detail?.display_name || '算法详情' }}</h2><p>{{ detail?.description }}</p></div>
      <el-select v-model="scenario" style="width:260px" @change="load"><el-option v-for="item in templates" :key="item.scenario" :label="item.display_name" :value="item.scenario" /></el-select>
    </header>
    <el-alert v-if="detail?.scenario === 'desk_drink_intrusion'" type="warning" :closable="false" show-icon title="冷启动场景：需先完成客户授权、数据采集、人工审核和评估门禁，才可将专用模型发布到生产。" />
    <template v-if="detail?.scenario === 'desk_drink_intrusion'">
      <el-card class="panel" shadow="never"><template #header>场景定义</template>
        <el-descriptions :column="1" border>
          <el-descriptions-item label="场景 ID">desk_drink_intrusion</el-descriptions-item>
          <el-descriptions-item label="场景名称">桌面饮品容器禁放检测</el-descriptions-item>
          <el-descriptions-item label="目标">桌面指定 ROI 内出现饮品容器，即触发告警。</el-descriptions-item>
          <el-descriptions-item label="部署前提">摄像头固定朝向办公桌；ROI 仅覆盖需要保护的桌面区域，例如笔记本电脑、键盘周围。</el-descriptions-item>
          <el-descriptions-item label="首版告警对象">杯子、马克杯、保温杯、水瓶、饮料瓶、易拉罐。</el-descriptions-item>
          <el-descriptions-item label="不纳入首版">餐盘、碗、塑料袋、饮料盒；后续根据实际误漏报再增加。</el-descriptions-item>
        </el-descriptions>
      </el-card>
      <el-card class="panel" shadow="never"><template #header>闭环规则</template>
        <el-table :data="flowRules" border><el-table-column prop="stage" label="环节" width="150" /><el-table-column prop="rule" label="规则与职责" min-width="600" /></el-table>
      </el-card>
    </template>
    <el-card v-else class="panel" shadow="never"><template #header>实时判定规则</template>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="场景 ID">{{ detail?.scenario }}</el-descriptions-item><el-descriptions-item label="生命周期">{{ detail?.lifecycle_stage }}</el-descriptions-item>
        <el-descriptions-item label="L1">{{ detail?.default_sample_fps }}fps · 阈值 {{ detail?.l1_threshold }} · 连续 {{ detail?.consecutive_frames }} 帧</el-descriptions-item><el-descriptions-item label="L2">阈值 {{ detail?.l2_threshold }} · 持续 {{ detail?.min_duration_sec }} 秒</el-descriptions-item>
        <el-descriptions-item label="目标对象">{{ list(detail?.target_classes) }}</el-descriptions-item><el-descriptions-item label="ROI / 去重">必须绘制 ROI · 冷却 {{ detail?.cooldown_sec }} 秒 · 离开复位 {{ detail?.reset_after_absence_sec || '-' }} 秒</el-descriptions-item>
        <el-descriptions-item label="L1 初始模式">{{ detail?.initial_l1_mode }}</el-descriptions-item><el-descriptions-item label="L2 模式">{{ detail?.l2_local_mode }}</el-descriptions-item>
      </el-descriptions>
    </el-card>
    <el-card class="panel" shadow="never"><template #header>{{ detail?.scenario === 'desk_drink_intrusion' ? 'L1 细则' : '漏报审计、VLM 与训练闭环' }}</template>
      <div v-if="detail?.scenario === 'desk_drink_intrusion'" class="prose"><p>L1 的职责是“宁可多报候选，不要漏掉真实容器”。仅处理禁放 ROI 内物体，避免背景杯子、显示器画面造成误报。冷启动用通用模型可识别的 <code>cup</code>、<code>bottle</code>、<code>wine_glass</code> 做候选来源，专用 <code>drink_container</code> 模型通过训练门禁后替换。</p><p>每次候选保存 1 张最佳帧及前后约 2 秒的少量抽帧，不保存全天视频。L1 不直接推送用户告警，只将连续 2 帧命中的候选交给 L2。为防止 L1/L2 共同漏报，客户授权后还会将定时、画面变化、低置信和 L2 拒绝样本以脱敏形式送云端审计。</p></div>
      <div v-else class="grid"><div><b>双通道</b><p>L1 候选进入 L2 实时告警；定时、画面变化、低置信和 L2 拒绝样本独立进入审计。</p></div><div><b>采样策略</b><p>{{ sampleText }}</p></div><div><b>VLM 审计</b><p>{{ detail?.vlm_audit_prompt || detail?.teacher_policy || '-' }}</p></div><div><b>训练标签</b><p>检测类：{{ detail?.training_label_schema?.detector_class || '-' }}；子类：{{ list(detail?.training_label_schema?.attributes) }}</p></div></div>
      <el-alert type="info" :closable="false" title="VLM 不阻塞即时报警；高置信漏报以 shadow_positive 进入人工复核和训练优先队列。" />
    </el-card>
    <template v-if="detail?.scenario === 'desk_drink_intrusion'">
      <el-card class="panel" shadow="never"><template #header>L2 细则</template><div class="prose"><p>L2 对候选帧/短帧序列复核：是否确实是目标容器而非鼠标、音箱、手机、手部或屏幕内容；容器中心点是否在 ROI 内且目标框重叠达阈值；是否至少持续 3 秒以排除手持快速经过；并用轨迹及冷却时间去重。</p><p>默认判定：任一容器在 ROI 内稳定停留 3 秒，且 L2 置信度 ≥ 0.60，即为 <code>confirmed_hazard</code> 并触发告警。</p></div></el-card>
      <el-card class="panel" shadow="never"><template #header>VLM 与隐私规则</template><div class="prose"><p>VLM 输入为 L2 最佳告警帧、L1 审计抽帧、ROI 坐标与受控问题，不上传持续视频流。上传前默认模糊人体、人脸与屏幕，仅保留桌面 ROI 清晰内容。</p><p>VLM 输出结论、容器子类、是否位于禁放区、置信度和简短原因。高置信 <code>positive</code> 可自动预标注，<code>negative</code> 作为困难负样本，<code>uncertain</code> 与 <code>shadow_positive</code> 必须人工确认。未获客户授权时，L1/L2 仍可本地告警，但不上传训练和远端 VLM 数据。</p></div></el-card>
      <el-card class="panel" shadow="never"><template #header>训练数据与验收</template><el-descriptions :column="1" border><el-descriptions-item label="首轮数据">正样本至少 300 张；负样本至少 500 张；困难负样本至少 100 张；至少 10 个不同时间段采集，验证集独立留出 20%。</el-descriptions-item><el-descriptions-item label="样本范围">正样本包含容器进入 ROI；负样本包含空桌、键盘、鼠标、手机、纸巾、手部、食物包装和不同光照；困难负样本包含屏幕饮品图、反光图案、ROI 外容器及局部露出。</el-descriptions-item><el-descriptions-item label="首版发布门槛">容器事件级召回率 ≥ 95%；空桌误报 ≤ 每 8 小时 1 次；L2 到云端链路成功率 ≥ 99%；VLM 与人工一致率 ≥ 90%。</el-descriptions-item><el-descriptions-item label="灰度与下放">先仅在 MacBook 摄像头运行 3 天；通过离线评估和灰度验证后转 RKNN 包，并与规则、ROI、阈值以同一配置版本下发 L1/L2；设备回报生效版本后发布完成。</el-descriptions-item></el-descriptions></el-card>
    </template>
    <el-card v-else class="panel" shadow="never"><template #header>发布状态</template>
      <el-descriptions :column="2" border><el-descriptions-item label="训练种子目标">{{ targets }}</el-descriptions-item><el-descriptions-item label="生效绑定">{{ detail?.active_binding_count || 0 }} / {{ detail?.binding_count || 0 }}</el-descriptions-item><el-descriptions-item label="模型下放">{{ detail?.reporting_policy?.model_release || '-' }}</el-descriptions-item><el-descriptions-item label="当前模型">冷启动通用 COCO；专用 RKNN 模型待评估门禁后发布</el-descriptions-item></el-descriptions>
    </el-card>
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import api from '../api'
const route = useRoute(); const templates = ref<any[]>([]); const detail = ref<any>(null); const loading = ref(false)
const scenario = ref(String(route.query.scenario || 'desk_drink_intrusion'))
const flowRules = [
  { stage: 'L1 快速初筛', rule: '每秒抽 2 帧；检测 drink_container 冷启动候选（cup、bottle、wine_glass），置信度 ≥ 0.45；目标框与禁放 ROI 相交形成候选。连续 2 帧命中才上报 L2。' },
  { stage: 'L2 本地复核', rule: '复核目标类别、ROI 位置和轨迹稳定性；置信度 ≥ 0.60 且持续命中 ≥ 3 秒后形成正式告警。' },
  { stage: '告警抑制', rule: '同一容器、同一 ROI 在 5 分钟内只报一次；容器离开 ROI ≥ 5 秒后允许下一次报警。' },
  { stage: 'VLM 审计', rule: '对 L2 告警帧、L1 定时/变化/低置信审计帧及 L2 拒绝帧，在客户授权与本地脱敏后上传。审计饮品容器是否位于禁放区。' },
  { stage: '云端标注', rule: '输出 positive、negative、uncertain 与 shadow_positive；不确定及漏报样本进入人工审核。VLM 不阻塞 L2 的即时报警。' },
  { stage: '训练 / 模型下放', rule: '训练轻量 drink_container 检测模型，保留 cup、mug、bottle、thermos、can 子类属性；经评估、灰度后转 RKNN，并以版本化配置下发 L1/L2。' },
]
const list = (v: any) => Array.isArray(v) ? v.join('、') : '-'
const sampleText = computed(() => { const s = detail.value?.sampling_strategy || {}; return `${list(s.modes)}；定时 ${s.time_interval_sec || '-'} 秒；${s.privacy || '按客户隐私策略'}` })
const targets = computed(() => Object.entries(detail.value?.seed_dataset_target || {}).map(([k, v]) => `${k}: ${v}`).join(' / ') || '-')
async function load() { loading.value = true; try { templates.value = (await api.get('/scenario-templates')).data; detail.value = (await api.get(`/scenario-templates/${scenario.value}`)).data } finally { loading.value = false } }
onMounted(load)
</script>
<style scoped>.page{display:flex;flex-direction:column;gap:14px}.head{display:flex;justify-content:space-between;gap:16px}.head h2{margin:0}.head p{margin:6px 0;color:#64748b}.panel{border:1px solid #dbe4ef;border-radius:8px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:12px}.grid>div{padding:12px;border-radius:8px;background:#f8fafc}.grid p,.prose p{margin:6px 0 0;color:#475569;line-height:1.7}.prose p:first-child{margin-top:0}.prose code{padding:1px 5px;background:#eef2ff;border-radius:4px;color:#3730a3}@media(max-width:760px){.head{flex-direction:column}.grid{grid-template-columns:1fr}}</style>
