<template>
  <section class="page">
    <header><h2>人工审核 Human Review</h2><p>处理自动标注低置信、疑似误报、边界样本和模型上线审批。</p></header>
    <div class="review-layout">
      <el-card class="panel queue" shadow="never">
        <template #header>审核队列</template>
        <el-table :data="items" height="680" highlight-current-row @current-change="selected = $event">
          <el-table-column prop="item_id" label="item" width="115" />
          <el-table-column prop="queue_type" label="queue" width="210" />
          <el-table-column prop="algorithm" label="algorithm" width="150" />
          <el-table-column prop="status" label="status" width="120" />
        </el-table>
      </el-card>
      <el-card class="panel detail" shadow="never">
        <template #header>审核工作台</template>
        <div v-if="selected" class="workspace">
          <div class="media">
            <div class="box">图片 / 视频片段</div>
            <div class="mini-row"><span>前帧</span><span>当前帧</span><span>后帧</span></div>
          </div>
          <div class="side">
            <el-descriptions :column="1" border>
              <el-descriptions-item label="大模型标注">{{ selected.teacher_label.class_name }} {{ selected.teacher_label.confidence }}</el-descriptions-item>
              <el-descriptions-item label="当前 YOLO">{{ selected.yolo_result.class_name }} {{ selected.yolo_result.confidence }}</el-descriptions-item>
              <el-descriptions-item label="历史同类">12 条</el-descriptions-item>
              <el-descriptions-item label="建议">{{ selected.suggestion }}</el-descriptions-item>
            </el-descriptions>
            <div class="actions">
              <el-button type="success" @click="positive(selected.item_id)">确认 positive</el-button>
              <el-button type="warning" @click="hardNegative(selected.item_id)">确认 hard_negative</el-button>
              <el-button>确认 boundary</el-button>
              <el-button>修改 bbox</el-button>
              <el-button>修改 class</el-button>
              <el-button type="danger" @click="reject(selected.item_id)">驳回</el-button>
              <el-button>送入训练集</el-button>
              <el-button>批准模型上线</el-button>
            </div>
          </div>
        </div>
        <el-empty v-else description="请选择审核项" />
      </el-card>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '../api'

const items = ref<any[]>([])
const selected = ref<any>(null)
async function load() { items.value = (await api.get('/review/items')).data; selected.value = selected.value ?? items.value[0] }
async function positive(id: string) { await api.post(`/review/items/${id}/approve-positive`); await load() }
async function hardNegative(id: string) { await api.post(`/review/items/${id}/approve-hard-negative`); await load() }
async function reject(id: string) { await api.post(`/review/items/${id}/reject`); await load() }
onMounted(load)
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
.review-layout { display:grid; grid-template-columns: minmax(520px, 1fr) minmax(440px, .9fr); gap:14px; }
.panel { border-radius:8px; border:1px solid #dbe4ef; }
.workspace { display:grid; grid-template-columns:1fr 360px; gap:16px; }
.box { height:360px; border-radius:8px; background:#1f2937; color:#cbd5e1; display:grid; place-items:center; }
.mini-row { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:10px; }
.mini-row span { height:72px; border-radius:8px; background:#334155; color:#cbd5e1; display:grid; place-items:center; }
.actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:16px; }
@media (max-width: 1200px) { .review-layout,.workspace { grid-template-columns:1fr; } }
</style>
