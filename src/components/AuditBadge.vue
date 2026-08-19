<template>
  <span :class="['audit-badge', badgeClass]">
    <span v-if="isPending" class="spinner" />
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue'

const props = defineProps<{
  status: string
  verdict: string | null
  score: number | null
}>()

const showConfirming = ref(false)

const isPending = computed(() => props.status === 'pending' || showConfirming.value)

const badgeClass = computed(() => {
  if (isPending.value) return 'pending'
  if (props.status !== 'done') return 'pending'

  const s = props.score ?? 0
  if (s >= 0.85) {
    return props.verdict === 'overturn' ? 'overturn' : 'confirm'
  }
  if (s >= 0.7) return 'uncertain'
  return 'human'
})

const label = computed(() => {
  if (isPending.value) return '确认中...'
  if (props.status === 'skipped') return '跳过'
  if (props.status === 'failed') return '失败'
  if (props.status !== 'done') return '待审'

  const s = props.score ?? 0
  if (s >= 0.85 && props.verdict === 'confirm') return '✅ 坐实'
  if (s >= 0.85 && props.verdict === 'overturn') return '❌ 推翻'
  if (s >= 0.7) return '⚠ 复核中'
  return '⚠ 待人工'
})

// v1.1 评审建议 2：报警弹窗 1.5s "确认中" 缓冲动画
onMounted(() => {
  if (props.status === 'pending') {
    showConfirming.value = true
    setTimeout(() => { showConfirming.value = false }, 1500)
  }
})

watch(() => props.status, (n, o) => {
  if (o === 'pending' && n === 'done') {
    showConfirming.value = false
  }
})
</script>

<style scoped>
.audit-badge { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:4px; font-size:12px; }
.audit-badge.pending { background:#e6f7ff; color:#1890ff; }
.audit-badge.confirm { background:#f6ffed; color:#52c41a; }
.audit-badge.overturn { background:#fff1f0; color:#ff4d4f; }
.audit-badge.uncertain { background:#fffbe6; color:#faad14; }
.audit-badge.human { background:#fff7e6; color:#d46b08; }

.spinner {
  display:inline-block; width:12px; height:12px; border:2px solid #1890ff;
  border-top-color:transparent; border-radius:50%;
  animation: spin 1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
