<template>
  <div>
    <h3>报警列表</h3>
    <el-table :data="alarms" stripe border style="width:100%">
      <el-table-column prop="alarm_id" label="报警ID" width="280" />
      <el-table-column prop="alarm_type" label="类型" width="160" />
      <el-table-column prop="confidence" label="置信度" width="100">
        <template #default="{ row }">{{ (row.confidence * 100).toFixed(0) }}%</template>
      </el-table-column>
      <el-table-column prop="reasoning" label="理由" />
      <el-table-column label="审计状态" width="140">
        <template #default="{ row }">
          <AuditBadge :status="row.audit_status" :verdict="row.audit_verdict" :score="row.audit_score" />
        </template>
      </el-table-column>
      <el-table-column prop="audit_provider" label="VLM Provider" width="130" />
      <el-table-column prop="business_decision" label="业务动作" width="140">
        <template #default="{ row }"><el-tag v-if="row.business_decision" type="warning">{{ row.business_decision }}</el-tag><span v-else>-</span></template>
      </el-table-column>
      <el-table-column prop="audit_reasoning" label="VLM 审计理由" min-width="240" show-overflow-tooltip />
      <el-table-column prop="created_at" label="时间" width="180" />
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from '../api'
import AuditBadge from '../components/AuditBadge.vue'

const alarms = ref<any[]>([])

onMounted(async () => {
  const { data } = await api.get('/alarms/')
  alarms.value = data
})
</script>
