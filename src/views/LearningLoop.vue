<template>
  <section class="page">
    <header><h2>自学习中心 Learning Loop</h2><p>样本回流、自动标注、人工审核、数据集、训练、评估、RKNN 转换和灰度发布。</p></header>
    <div class="stats">
      <el-card v-for="(v, k) in status.stats" :key="k" class="stat" shadow="never"><span>{{ k }}</span><strong>{{ v }}</strong></el-card>
    </div>
    <el-card class="panel" shadow="never">
      <template #header>闭环流水线</template>
      <el-table :data="status.pipeline" stripe>
        <el-table-column prop="stage" label="阶段" width="150" />
        <el-table-column prop="status" label="状态" width="110" />
        <el-table-column prop="input_count" label="输入" width="90" />
        <el-table-column prop="output_count" label="输出" width="90" />
        <el-table-column prop="success_count" label="成功" width="90" />
        <el-table-column prop="failed_count" label="失败" width="90" />
        <el-table-column prop="last_run_time" label="最近运行" min-width="220" />
        <el-table-column prop="artifact_path" label="产物路径" min-width="220" />
        <el-table-column prop="next_action" label="下一步" width="160" />
      </el-table>
    </el-card>
    <el-card class="panel" shadow="never">
      <template #header>训练任务</template>
      <el-table :data="runs" stripe>
        <el-table-column prop="train_run_id" label="run" width="120" />
        <el-table-column prop="dataset_version" label="dataset" width="150" />
        <el-table-column prop="model_type" label="type" width="80" />
        <el-table-column prop="base_model" label="base" width="130" />
        <el-table-column prop="imgsz" label="imgsz" width="90" />
        <el-table-column prop="epochs" label="epochs" width="90" />
        <el-table-column prop="status" label="status" width="120" />
        <el-table-column prop="mAP50" label="mAP50" width="90" />
        <el-table-column prop="precision" label="precision" width="100" />
        <el-table-column prop="recall" label="recall" width="90" />
        <el-table-column prop="hard_negative_fp" label="hard FP" width="100" />
        <el-table-column label="通过" width="80"><template #default="{ row }">{{ row.evaluation_passed ? 'yes' : 'no' }}</template></el-table-column>
      </el-table>
    </el-card>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '../api'

const status = ref<any>({ stats: {}, pipeline: [] })
const runs = ref<any[]>([])
onMounted(async () => { status.value = (await api.get('/learning/status')).data; runs.value = (await api.get('/learning/training-runs')).data })
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
.stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
.stat,.panel { border-radius:8px; border:1px solid #dbe4ef; }
.stat span { color:#64748b; font-size:13px; }
.stat strong { display:block; margin-top:8px; font-size:22px; }
</style>
