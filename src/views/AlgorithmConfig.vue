<template>
  <section class="page">
    <header><h2>旧算法配置 Legacy Algorithm Config</h2><p>兼容旧的一路一业务规则下发链路；新实施入口请使用“摄像头场景绑定”。</p></header>
    <el-card class="panel" shadow="never">
      <el-table :data="configs" stripe>
        <el-table-column prop="channel_id" label="Channel" width="90" />
        <el-table-column prop="algorithm" label="Algorithm" width="150" />
        <el-table-column label="RTSP" min-width="260"><template #default="{ row }">{{ row.rtsp_url }}</template></el-table-column>
        <el-table-column label="L1"><template #default="{ row }">{{ row.l1.model }} · {{ row.l1.sample_fps }}fps · {{ row.l1.threshold }}</template></el-table-column>
        <el-table-column label="Target Classes" min-width="220"><template #default="{ row }">{{ row.l1.target_classes.join(', ') }}</template></el-table-column>
        <el-table-column label="Rules" width="180"><template #default="{ row }">连续 {{ row.rules.consecutive_frames }} · {{ row.rules.min_duration_sec }}s</template></el-table-column>
        <el-table-column label="Config" width="120"><template #default="{ row }">v{{ row.config_version }}</template></el-table-column>
        <el-table-column label="操作" width="120"><template #default="{ row }"><el-button size="small" @click="open(row)">编辑</el-button></template></el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="editing" title="编辑算法配置" width="760px">
      <el-form v-if="form" label-width="150px">
        <el-form-item label="enabled"><el-switch v-model="form.enabled" /></el-form-item>
        <el-form-item label="rtsp_url"><el-input v-model="form.rtsp_url" /></el-form-item>
        <el-form-item label="l1.threshold"><el-input-number v-model="form.l1.threshold" :step="0.01" :min="0" :max="1" /></el-form-item>
        <el-form-item label="l1.sample_fps"><el-input-number v-model="form.l1.sample_fps" :min="0.2" :step="0.2" /></el-form-item>
        <el-form-item label="target_classes"><el-select v-model="form.l1.target_classes" multiple filterable style="width:100%"><el-option v-for="c in classes" :key="c" :label="c" :value="c" /></el-select></el-form-item>
        <el-form-item label="cooldown_sec"><el-input-number v-model="form.l1.cooldown_sec" :min="0" /></el-form-item>
        <el-form-item label="ROI JSON"><el-input v-model="roiJson" type="textarea" :rows="4" /></el-form-item>
        <el-form-item label="consecutive_frames"><el-input-number v-model="form.rules.consecutive_frames" :min="1" /></el-form-item>
        <el-form-item label="l2.enabled"><el-switch v-model="form.l2.enabled" /></el-form-item>
        <el-form-item label="upload.save_clip"><el-switch v-model="form.upload.save_clip" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="editing=false">取消</el-button><el-button type="primary" @click="save">保存并下发</el-button></template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import api from '../api'

const configs = ref<any[]>([])
const editing = ref(false)
const form = ref<any>(null)
const roiJson = ref('')
const classes = ['person','bicycle','motorcycle','electric_scooter','electric_bike','car','truck','van','bottle','outdoor_trash_bin_full','garbage_bag','trash_overflow']
async function load() { configs.value = (await api.get('/algorithms/configs')).data }
function open(row: any) { form.value = JSON.parse(JSON.stringify(row)); roiJson.value = JSON.stringify(row.roi, null, 2); editing.value = true }
async function save() {
  try {
    form.value.roi = JSON.parse(roiJson.value)
    const res = await api.put(`/algorithms/configs/${form.value.channel_id}`, form.value)
    if (!res.data?.ok) throw new Error(res.data?.detail || '下发失败')
    ElMessage.success(`配置已保存并下发，将在下次开始解析时生效`)
    editing.value = false
    await load()
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.detail || error?.message || '配置保存失败')
  }
}
onMounted(load)
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
.panel { border-radius:8px; border:1px solid #dbe4ef; }
</style>
