<template>
  <div class="roi-editor">
    <div class="toolbar">
      <el-segmented v-model="draft.hit_test.mode" :options="modes" @change="commit" />
      <label v-if="draft.hit_test.mode.includes('ratio')">
        <span>命中比例</span>
        <el-input-number v-model="draft.hit_test.min_ratio" :min="0.05" :max="1" :step="0.05" size="small" @change="commit" />
      </label>
      <el-button size="small" :disabled="draft.points.length === 0" @click="undo">撤销</el-button>
      <el-button size="small" :disabled="draft.points.length === 0" @click="clear">清空</el-button>
      <el-button size="small" @click="fullFrame">全画面</el-button>
    </div>

    <div ref="stage" class="stage" @click="addPoint">
      <img :src="imageUrl" alt="摄像头 ROI 配置快照" @load="onImageLoad" />
      <svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
        <polygon v-if="draft.points.length >= 3" :points="polygonPoints" class="area" />
        <polyline v-if="draft.points.length >= 2" :points="polygonPoints" class="line" />
        <circle
          v-for="(point, index) in draft.points"
          :key="index"
          :cx="point[0] * 1000"
          :cy="point[1] * 1000"
          r="12"
          class="handle"
          @pointerdown.stop.prevent="beginDrag(index, $event)"
        />
      </svg>
      <span v-if="draft.points.length < 3" class="empty">点击画面添加至少 3 个 ROI 点</span>
    </div>

    <div class="status">
      <el-tag :type="valid ? 'success' : 'danger'" size="small">{{ valid ? 'ROI 有效' : validationMessage }}</el-tag>
      <span>{{ draft.points.length }} 个点 · {{ imageSize.width }} × {{ imageSize.height }}</span>
      <span>坐标：normalized</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'

const props = defineProps<{ modelValue: any; imageUrl: string }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: any): void }>()
const modes = [
  { label: '中心点', value: 'center_point' },
  { label: '脚点', value: 'foot_point' },
  { label: 'BBox 交集', value: 'bbox_intersection_ratio' },
  { label: 'ROI 覆盖', value: 'roi_coverage_ratio' },
]
const stage = ref<HTMLElement | null>(null)
const imageSize = reactive({ width: 0, height: 0 })
const draft = reactive(normalize(props.modelValue))
let dragIndex = -1

const polygonPoints = computed(() => draft.points.map((p: number[]) => `${p[0] * 1000},${p[1] * 1000}`).join(' '))
const validationMessage = computed(() => validatePolygon(draft.points))
const valid = computed(() => validationMessage.value === '')

watch(() => props.modelValue, (value) => Object.assign(draft, normalize(value)), { deep: true })

function normalize(value: any) {
  const points = Array.isArray(value?.points) ? value.points.map((p: number[]) => {
    const x = Number(p[0]) || 0
    const y = Number(p[1]) || 0
    return [x > 1 ? x / 800 : x, y > 1 ? y / 600 : y]
  }) : []
  return {
    roi_id: value?.roi_id || `roi-${Date.now()}`,
    type: 'polygon',
    coordinate_space: 'normalized',
    points,
    hit_test: {
      mode: value?.hit_test?.mode || 'bbox_intersection_ratio',
      min_ratio: Number(value?.hit_test?.min_ratio || 0.3),
      anchor: value?.hit_test?.anchor || 'foot_point',
    },
  }
}
function pointFromEvent(event: PointerEvent | MouseEvent) {
  const rect = stage.value!.getBoundingClientRect()
  return [
    Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  ]
}
function addPoint(event: MouseEvent) {
  if ((event.target as HTMLElement).tagName.toLowerCase() === 'circle') return
  draft.points.push(pointFromEvent(event))
  commit()
}
function beginDrag(index: number, event: PointerEvent) {
  dragIndex = index
  ;(event.target as Element).setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', drag)
  window.addEventListener('pointerup', endDrag, { once: true })
}
function drag(event: PointerEvent) {
  if (dragIndex >= 0 && stage.value) draft.points[dragIndex] = pointFromEvent(event)
}
function endDrag() {
  dragIndex = -1
  window.removeEventListener('pointermove', drag)
  commit()
}
function undo() { draft.points.pop(); commit() }
function clear() { draft.points.splice(0); commit() }
function fullFrame() { draft.points.splice(0, draft.points.length, [0.02, 0.02], [0.98, 0.02], [0.98, 0.98], [0.02, 0.98]); commit() }
function commit() {
  emit('update:modelValue', JSON.parse(JSON.stringify(draft)))
}
function onImageLoad(event: Event) {
  const image = event.target as HTMLImageElement
  imageSize.width = image.naturalWidth
  imageSize.height = image.naturalHeight
}
function validatePolygon(points: number[][]) {
  if (points.length < 3) return '至少需要 3 个点'
  if (points.some((p) => p.length !== 2 || p.some((v) => !Number.isFinite(v) || v < 0 || v > 1))) return '点位超出画面'
  let area = 0
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]
    area += point[0] * next[1] - next[0] * point[1]
  })
  if (Math.abs(area) / 2 < 0.005) return 'ROI 面积过小'
  return ''
}
onBeforeUnmount(endDrag)
</script>

<style scoped>
.roi-editor { display:flex; flex-direction:column; gap:10px; width:100%; }
.toolbar,.status { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.toolbar label { display:flex; align-items:center; gap:8px; color:#475569; }
.stage { position:relative; width:100%; aspect-ratio:16/9; overflow:hidden; background:#101827; border:1px solid #cbd5e1; border-radius:6px; cursor:crosshair; }
.stage img,.stage svg { position:absolute; inset:0; width:100%; height:100%; }
.stage img { object-fit:contain; background:#0f172a; }
.stage svg { z-index:2; }
.area { fill:rgba(14,165,233,.22); stroke:#0ea5e9; stroke-width:5; vector-effect:non-scaling-stroke; }
.line { fill:none; stroke:#38bdf8; stroke-width:4; vector-effect:non-scaling-stroke; }
.handle { fill:#fff; stroke:#0284c7; stroke-width:5; vector-effect:non-scaling-stroke; cursor:grab; }
.empty { position:absolute; z-index:3; left:50%; top:50%; transform:translate(-50%,-50%); color:#e2e8f0; background:rgba(15,23,42,.8); padding:8px 12px; border-radius:4px; pointer-events:none; }
.status { color:#64748b; font-size:12px; }
</style>
