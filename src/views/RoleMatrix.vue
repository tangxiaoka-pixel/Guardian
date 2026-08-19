<template>
  <section class="page">
    <header>
      <h2>角色与权限 Role Matrix</h2>
      <p>平台后台和客户后台分域管理，避免超级管理员在同一后台直接操作客户运行内容。</p>
    </header>
    <el-card class="panel" shadow="never">
      <template #header>后台边界</template>
      <el-table :data="domains" stripe>
        <el-table-column prop="domain" label="后台域" width="150" />
        <el-table-column prop="role" label="角色" width="190" />
        <el-table-column prop="responsibility" label="职责" min-width="300" />
        <el-table-column prop="notAllowed" label="不直接做" min-width="300" />
      </el-table>
    </el-card>
    <el-card class="panel" shadow="never">
      <template #header>操作矩阵</template>
      <el-table :data="matrix" stripe>
        <el-table-column prop="module" label="模块" width="180" />
        <el-table-column prop="platform" label="平台超级管理员" min-width="260" />
        <el-table-column prop="customer" label="客户管理员" min-width="260" />
        <el-table-column prop="operator" label="实施/运维人员" min-width="260" />
      </el-table>
    </el-card>
  </section>
</template>

<script setup lang="ts">
const domains = [
  {
    domain: '平台后台',
    role: 'platform_super_admin',
    responsibility: '客户开通、合同/套餐、全局场景模板、模型版本、平台容量、平台审计、进入客户后台。',
    notAllowed: '不在平台后台直接配置某客户摄像头、ROI、告警处理、L1/L2 实时运行。',
  },
  {
    domain: '客户后台',
    role: 'customer_admin',
    responsibility: '管理本客户项目、设备、摄像头、场景绑定、运行配置、告警闭环、自学习策略。',
    notAllowed: '不能创建其他客户、不能修改守界 Guardian 全局模板、不能发布平台模型。',
  },
]
const matrix = [
  { module: '客户与合同', platform: '创建/编辑客户、服务套餐、数据策略', customer: '查看本客户信息', operator: '无' },
  { module: '全局场景模板', platform: '维护守界 Guardian 官方默认模板', customer: '不可编辑，只能继承', operator: '不可编辑' },
  { module: '客户场景策略', platform: '可代客户创建策略，但需进入客户后台', customer: '创建标准/严格/宽松/自定义策略', operator: '按授权调整实施参数' },
  { module: '摄像头场景绑定', platform: '不可在平台后台直接绑定', customer: '选择摄像头、场景、ROI、灵敏度并生成 runtime_config', operator: '执行接入和 ROI 配置' },
  { module: 'L1/L2 监控', platform: '只看平台级健康概览', customer: '查看本客户链路与结果', operator: '排障和重启解析' },
  { module: '告警/自学习', platform: '看跨客户统计，不处理单条客户告警', customer: '闭环处理本客户告警和样本策略', operator: '按客户权限处理' },
  { module: '模型管理', platform: '发布/灰度/回滚模型', customer: '查看当前使用模型', operator: '不可发布平台模型' },
]
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; }
.panel { border-radius:8px; border:1px solid #dbe4ef; }
h2 { margin:0; } p { margin:6px 0 0; color:#64748b; }
</style>
