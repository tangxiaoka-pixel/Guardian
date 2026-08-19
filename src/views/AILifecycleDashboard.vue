<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>AI 生命周期管理中心</h2>
        <p>面向超级管理员的客户自学习闭环工作台：授权、样本、脱敏、标注、审核、训练、评估、灰度和回滚。</p>
      </div>
      <el-button :loading="loading" @click="load">刷新状态</el-button>
    </header>

    <section class="context-bar">
      <div class="selectors">
        <el-select v-model="aiScope" placeholder="AI Scope" @change="onScopeChange">
          <el-option label="平台级 platform_baseline" value="platform_baseline" />
          <el-option label="客户级 customer_optimized" value="customer_optimized" />
        </el-select>
        <el-select v-if="isCustomerScope" v-model="selectedCustomerId" placeholder="选择客户" @change="onContextChange">
          <el-option v-for="item in customerOptions" :key="item.customer_id" :label="item.customer_name" :value="item.customer_id" />
        </el-select>
        <el-select v-if="isCustomerScope" v-model="selectedSiteId" placeholder="选择站点" @change="load">
          <el-option v-for="item in siteOptions" :key="item.site_id" :label="item.site_name" :value="item.site_id" />
        </el-select>
        <el-select v-model="selectedScenario" placeholder="选择场景" @change="load">
          <el-option v-for="item in scenarios" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-select v-model="selectedCycleId" :placeholder="isPlatformScope ? '选择平台训练批次' : '选择客户训练周期'" @change="load">
          <el-option label="全部周期" value="" />
          <el-option
            v-for="item in scopeCycleOptions"
            :key="item.cycle_id"
            :label="`${item.cycle_id} · ${item.status}`"
            :value="item.cycle_id"
          />
        </el-select>
      </div>
      <div class="context-meta">
        <template v-if="isPlatformScope">
          <div><span>当前平台 L1 基线</span><strong>{{ platformActiveModel('l1') }}</strong></div>
          <div><span>当前平台 L2 基线</span><strong>{{ platformActiveModel('l2') }}</strong></div>
          <div><span>候选平台模型</span><strong>{{ platformCandidateModel?.model_id || '-' }}</strong></div>
          <div><span>当前平台训练批次</span><strong>{{ currentCycle?.cycle_id || '-' }}</strong><small>{{ currentCycle?.status || 'none' }}</small></div>
          <div><span>AI Scope</span><el-tag type="primary">platform_baseline</el-tag></div>
        </template>
        <template v-else>
          <div><span>customer</span><strong>{{ currentCustomerName }}</strong><small>{{ selectedCustomerId }}</small></div>
          <div><span>客户 L1 active</span><strong>{{ activeModel('l1') }}</strong></div>
          <div><span>客户 L2 active</span><strong>{{ activeModel('l2') }}</strong></div>
          <div><span>优化模式</span><el-tag type="success">customer_optimized</el-tag></div>
          <div><span>当前客户训练批次</span><strong>{{ currentCycle?.cycle_id || '-' }}</strong><small>{{ currentCycle?.status || 'none' }}</small></div>
        </template>
      </div>
      <div class="scope-note">
        <strong>{{ isPlatformScope ? '平台级 AI 中心' : '客户级 AI 自学习中心' }}</strong>
        <span>{{ scopeDescription }}</span>
      </div>
      <section class="ai-dashboard">
        <div class="dashboard-grid">
          <div v-for="item in dashboardCards" :key="item.key"><span>{{ item.label }}</span><strong>{{ item.value }}</strong></div>
        </div>
      </section>
    </section>

    <section class="truth-banner">
      <strong>L1 / L2 不是 Ground Truth</strong>
      <span>Edge Positive Candidate 不能直接训练；所有素材必须经过素材池、本地脱敏、VLM 审计和人工审核，才可进入 Learning Cycle。</span>
    </section>

    <nav class="ai-center-nav">
      <button v-for="item in centerTabs" :key="item.value" :class="{ active: activeCenterTab === item.value }" @click="activeCenterTab = item.value">
        {{ item.label }}
      </button>
    </nav>

    <section v-if="activeCenterTab === 'material_pool'" class="material-pool">
      <div class="stat-grid">
        <div v-for="item in materialStatCards" :key="item.key"><span>{{ item.label }}</span><strong>{{ item.value }}</strong></div>
      </div>
      <el-card shadow="never">
        <template #header>
          <div class="card-head">
            <strong>Material Pool 素材池</strong>
            <span>不信任 L1/L2：所有 edge candidate 必须经过 VLM 和 Human Review</span>
          </div>
        </template>
        <div class="filters-row">
          <el-select v-model="materialFilters.sample_category" placeholder="sample_category" clearable>
            <el-option v-for="item in materialCategoriesOptions" :key="item" :label="item" :value="item" />
          </el-select>
          <el-select v-model="materialFilters.l1_status" placeholder="L1 status" clearable>
            <el-option label="hit" value="hit" /><el-option label="miss" value="miss" /><el-option label="not_run" value="not_run" />
          </el-select>
          <el-select v-model="materialFilters.l2_status" placeholder="L2 status" clearable>
            <el-option label="confirmed" value="confirmed" /><el-option label="rejected" value="rejected" /><el-option label="not_run" value="not_run" />
          </el-select>
          <el-select v-model="materialFilters.vlm_decision" placeholder="VLM" clearable>
            <el-option label="suspected_hazard" value="suspected_hazard" /><el-option label="no_hazard" value="no_hazard" /><el-option label="uncertain" value="uncertain" /><el-option label="not_run" value="not_run" />
          </el-select>
          <el-select v-model="materialFilters.training_eligibility" placeholder="training" clearable>
            <el-option label="eligible" value="eligible" /><el-option label="blocked" value="blocked" />
          </el-select>
        </div>
        <el-table :data="filteredMaterialPool" stripe height="520">
          <el-table-column label="thumbnail" width="110">
            <template #default="{ row }"><img class="sample-thumb" :src="materialFrameUrl(row)" @click="openMaterialDetail(row)" /></template>
          </el-table-column>
          <el-table-column prop="sample_id" label="sample_id" width="130" />
          <el-table-column v-if="isPlatformScope" prop="customer_alias" label="customer_alias" width="150" />
          <el-table-column v-else prop="customer_id" label="customer" width="130" />
          <el-table-column v-if="!isPlatformScope" prop="site_id" label="site" width="110" />
          <el-table-column prop="camera_id" label="camera" width="135" />
          <el-table-column prop="scenario" label="scenario" width="145" />
          <el-table-column prop="source_type" label="source_type" width="170" />
          <el-table-column prop="sample_category" label="sample_category" width="210">
            <template #default="{ row }"><el-tag :type="categoryTag(row.sample_category)">{{ row.sample_category }}</el-tag></template>
          </el-table-column>
          <el-table-column label="L1" width="130"><template #default="{ row }">{{ judgementText(row.sample_judgement.l1) }}</template></el-table-column>
          <el-table-column label="L2" width="135"><template #default="{ row }">{{ judgementText(row.sample_judgement.l2) }}</template></el-table-column>
          <el-table-column label="VLM" width="160"><template #default="{ row }">{{ row.sample_judgement.vlm.status }} · {{ row.sample_judgement.vlm.teacher_model || '-' }}</template></el-table-column>
          <el-table-column label="Human" width="190"><template #default="{ row }">{{ row.sample_judgement.human.status }}</template></el-table-column>
          <el-table-column prop="training_eligibility" label="training" width="120">
            <template #default="{ row }"><el-tag :type="row.training_eligibility === 'eligible' ? 'success' : 'danger'">{{ row.training_eligibility }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="created_at" label="created_at" min-width="150"><template #default="{ row }">{{ shortTime(row.created_at) }}</template></el-table-column>
          <el-table-column label="操作" fixed="right" width="360">
            <template #default="{ row }">
              <div class="row-actions">
                <el-button size="small" @click="openMaterialDetail(row)">详情</el-button>
                <el-button size="small" :disabled="!canPrivacy(row)" @click="runPrivacy(row)">运行脱敏</el-button>
                <el-button size="small" :disabled="!canAutoLabel(row)" @click="runAutoLabel(row)">运行 VLM 审计</el-button>
                <el-button size="small" :disabled="row.sample_judgement?.human?.status === 'need_review'" @click="sendReview(row)">送人工审核</el-button>
                <el-button
                  size="small"
                  :disabled="row.training_eligibility !== 'eligible'"
                  @click="addTrainingScope(row, isPlatformScope ? 'platform' : 'customer')"
                >{{ isPlatformScope ? '加入平台训练批次' : '加入客户训练批次' }}</el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </section>

    <section v-if="activeCenterTab === 'vlm_audit'" class="ops-grid">
      <el-card shadow="never">
        <template #header><strong>VLM Audit 大模型审计</strong></template>
        <el-table :data="vlmAudits" stripe height="560">
          <el-table-column label="图片" width="110">
            <template #default="{ row }">
              <img class="sample-thumb" :src="auditFrameUrl(row)" @click="openAuditDetail(row)" />
            </template>
          </el-table-column>
          <el-table-column prop="audit_id" label="audit_id" width="120" />
          <el-table-column prop="sample_id" label="sample_id" width="130" />
          <el-table-column prop="teacher_model" label="teacher_model" width="150" />
          <el-table-column prop="audit_status" label="status" width="110" />
          <el-table-column prop="vlm_decision" label="vlm_decision" width="160" />
          <el-table-column prop="suggested_category" label="suggested_category" width="150" />
          <el-table-column prop="disagreement_type" label="disagreement_type" min-width="210" />
          <el-table-column prop="priority" label="priority" width="90" />
          <el-table-column prop="reason" label="reason" min-width="260" />
          <el-table-column label="操作" fixed="right" width="90">
            <template #default="{ row }"><el-button size="small" @click="openAuditDetail(row)">详情</el-button></template>
          </el-table-column>
        </el-table>
      </el-card>
    </section>

    <section v-if="activeCenterTab === 'missed_pool'" class="ops-grid">
      <el-card shadow="never">
        <template #header><strong>Missed Candidate Pool 漏报抽检</strong></template>
        <div class="stat-grid">
          <div><span>今日 L1 未命中抽检帧</span><strong>{{ missedPool.stats?.today_missed_audit_frames || 0 }}</strong></div>
          <div><span>已脱敏</span><strong>{{ missedPool.stats?.privacy_processed || 0 }}</strong></div>
          <div><span>已 VLM 审计</span><strong>{{ missedPool.stats?.vlm_audited || 0 }}</strong></div>
          <div><span>VLM suspected_hazard</span><strong>{{ missedPool.stats?.vlm_suspected_hazard || 0 }}</strong></div>
          <div><span>confirmed_missed_event</span><strong>{{ missedPool.stats?.confirmed_missed_event || 0 }}</strong></div>
          <div><span>background_negative</span><strong>{{ missedPool.stats?.background_negative || 0 }}</strong></div>
        </div>
        <el-table :data="missedPool.rows || []" stripe height="420">
          <el-table-column prop="sample_id" label="sample_id" width="130" />
          <el-table-column prop="camera_id" label="camera" width="135" />
          <el-table-column prop="scenario" label="scenario" width="145" />
          <el-table-column prop="sample_category" label="category" width="190" />
          <el-table-column label="L1" width="100"><template #default="{ row }">{{ row.sample_judgement.l1.status }}</template></el-table-column>
          <el-table-column label="VLM" width="180"><template #default="{ row }">{{ row.sample_judgement.vlm.status }}</template></el-table-column>
          <el-table-column label="Human" width="190"><template #default="{ row }">{{ row.sample_judgement.human.status }}</template></el-table-column>
          <el-table-column prop="training_eligibility" label="training" width="120" />
        </el-table>
      </el-card>
    </section>

    <section v-if="activeCenterTab === 'learning_cycles'">
    <el-card class="table-card" shadow="never">
      <template #header>
        <div class="card-head">
          <strong>{{ isPlatformScope ? 'Platform Learning Cycles 平台基线训练批次' : 'Customer Learning Cycles 客户训练批次' }}</strong>
          <span>{{ isPlatformScope ? '只显示 scope=platform 的基线训练批次' : '只显示当前客户的 customer learning cycles' }}</span>
        </div>
      </template>
      <el-table :data="aiLearningCycles" stripe height="260">
        <el-table-column prop="cycle_id" label="cycle_id" min-width="240" />
        <el-table-column prop="scope" label="scope" width="100" />
        <el-table-column prop="scenario" label="scenario" width="150" />
        <el-table-column prop="status" label="status" width="120" />
        <el-table-column prop="sample_count" label="samples" width="100" />
        <el-table-column prop="dataset_version" label="dataset" min-width="210" />
        <el-table-column label="goal" min-width="260"><template #default="{ row }">{{ row.cycle_goal?.description || '-' }}</template></el-table-column>
      </el-table>
    </el-card>
    <section v-if="isCustomerScope" class="cycle-workbench">
      <el-card class="cycle-card" shadow="never">
        <template #header>
          <div class="card-head">
            <strong>Training Cycle / Learning Cycle</strong>
            <div class="head-actions">
              <el-button size="small" @click="cycleDialogVisible = true">新建训练周期</el-button>
              <el-button size="small" type="primary" @click="manualSampleDialogVisible = true">补录漏报样本</el-button>
            </div>
          </div>
        </template>
        <div class="cycle-main">
          <div class="cycle-title">
            <span class="eyebrow">当前优化批次</span>
            <strong>{{ currentCycle?.cycle_id || '未选择训练周期' }}</strong>
            <el-tag :type="cycleStatusType(currentCycle?.status)">{{ currentCycle?.status || 'draft' }}</el-tag>
          </div>
          <div class="cycle-fields">
            <div>
              <span>优化目标</span>
              <strong>{{ currentCycle?.cycle_goal?.type || '未定义' }}</strong>
              <small>{{ currentCycle?.cycle_goal?.description || '需要先定义本轮要解决的误报、漏报或适配问题。' }}</small>
            </div>
            <div>
              <span>目标指标</span>
              <strong>{{ targetMetricText }}</strong>
              <small>本轮训练不是泛泛训练，而是围绕该指标验收。</small>
            </div>
            <div>
              <span>样本范围</span>
              <strong>{{ currentCycle?.sample_count || 0 }} / {{ currentCycle?.sample_target || 0 }}</strong>
              <small>{{ currentCycle?.source_type || 'manual_learning_cycle' }}</small>
            </div>
            <div>
              <span>数据集版本</span>
              <strong>{{ currentCycle?.dataset_version || '未构建' }}</strong>
              <small>{{ currentCycle?.report_status || 'draft' }}</small>
            </div>
          </div>
        </div>
      </el-card>

      <el-card class="availability-card" shadow="never">
        <template #header>
          <div class="card-head">
            <strong>当前训练周期可用性</strong>
            <span>授权、脱敏、审核共同决定样本能否进入训练</span>
          </div>
        </template>
        <div class="availability-grid">
          <div><span>客户训练可用</span><strong>{{ availability.customer_trainable || 0 }}</strong></div>
          <div><span>平台训练可用</span><strong>{{ availability.platform_trainable || 0 }}</strong></div>
          <div><span>授权阻断</span><strong>{{ availability.blocked_by_policy || 0 }}</strong></div>
          <div><span>脱敏阻断</span><strong>{{ availability.blocked_by_privacy || 0 }}</strong></div>
          <div><span>审核阻断</span><strong>{{ availability.blocked_by_review || 0 }}</strong></div>
          <div><span>质量阻断</span><strong>{{ availability.blocked_by_quality || 0 }}</strong></div>
        </div>
      </el-card>
    </section>

    <section v-if="isCustomerScope" class="policy-grid">
      <el-card class="policy-card" shadow="never">
        <template #header>
          <div class="card-head">
            <strong>客户数据授权</strong>
            <span>操作权限由 data_policy 实时控制</span>
          </div>
        </template>
        <div class="policy-items">
          <div v-for="item in policyItems" :key="item.key" class="policy-item">
            <span>{{ item.label }}</span>
            <el-tag :type="item.allowed ? 'success' : 'danger'">{{ item.allowed ? '允许' : '禁止' }}</el-tag>
          </div>
        </div>
      </el-card>
      <el-card class="intervention-card" shadow="never">
        <template #header>
          <div class="card-head">
            <strong>需要人工介入</strong>
            <span>优先处理阻断闭环的事项</span>
          </div>
        </template>
        <div class="alerts">
          <el-tag v-if="!policy.allow_cloud_upload" type="danger">云端上传被禁止</el-tag>
          <el-tag v-if="!policy.allow_auto_labeling" type="danger">自动标注被禁止</el-tag>
          <el-tag v-if="!policy.allow_customer_model_training" type="danger">客户模型训练被禁止</el-tag>
          <el-tag v-if="privacyFailedCount" type="warning">{{ privacyFailedCount }} 条脱敏失败</el-tag>
          <el-tag v-if="needReviewCount" type="warning">{{ needReviewCount }} 条待人工审核</el-tag>
          <el-tag v-if="candidateModel" type="success">候选模型 {{ candidateModel.model_id }}</el-tag>
        </div>
      </el-card>
    </section>

    <section v-if="isCustomerScope" class="flow-board">
      <article v-for="(step, index) in lifecycleSteps" :key="step.key" class="flow-step" :class="step.status">
        <div class="step-index">{{ index + 1 }}</div>
        <div class="step-body">
          <div class="step-title">
            <strong>{{ step.title }}</strong>
            <el-tag size="small" :type="statusType(step.status)">{{ step.statusText }}</el-tag>
          </div>
          <div class="step-count">{{ step.count }}</div>
          <div class="step-meta">
            <span>成功 {{ step.success }}</span>
            <span>失败 {{ step.failed }}</span>
            <span>{{ step.lastRun }}</span>
          </div>
          <el-button size="small" :disabled="step.disabled" :title="step.disabledReason" @click="step.action">
            {{ step.button }}
          </el-button>
        </div>
      </article>
    </section>

    <section v-if="isCustomerScope" class="workspace">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="样本治理" name="samples">
          <div class="governance">
            <aside class="state-filter">
              <button v-for="item in sampleStates" :key="item.value" :class="{ active: sampleFilter === item.value }" @click="sampleFilter = item.value">
                <span>{{ item.label }}</span><strong>{{ sampleStateCount(item.value) }}</strong>
              </button>
            </aside>
            <el-card class="table-card" shadow="never">
              <template #header>
                <div class="card-head">
                  <strong>Sample Governance</strong>
                  <span>长路径隐藏在详情中，列表只展示治理状态</span>
                </div>
              </template>
              <el-table :data="filteredSamples" stripe height="430">
                <el-table-column label="图片" width="128">
                  <template #default="{ row }">
                    <img class="sample-thumb" :src="sampleFrameUrl(row)" :alt="row.sample_id" @click="openPrivacy(row)" />
                  </template>
                </el-table-column>
                <el-table-column prop="sample_id" label="sample_id" width="150" />
                <el-table-column prop="customer_id" label="customer" width="120" />
                <el-table-column prop="site_id" label="site" width="110" />
                <el-table-column prop="camera_id" label="camera" width="140" />
                <el-table-column prop="scenario" label="scenario" width="150" />
                <el-table-column prop="sample_type" label="sample_type" width="180" />
                <el-table-column label="teacher" width="170">
                  <template #default="{ row }">
                    <div class="mini-stack">
                      <strong>{{ row.teacher_model || '-' }}</strong>
                      <span>{{ row.teacher_type || '-' }} · {{ row.teacher_confidence || '-' }}</span>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column prop="privacy_status" label="privacy" width="155">
                  <template #default="{ row }"><el-tag :type="privacyTag(row.privacy_status)">{{ row.privacy_status }}</el-tag></template>
                </el-table-column>
                <el-table-column prop="label_status" label="label" width="140">
                  <template #default="{ row }"><el-tag :type="labelTag(row.label_status)">{{ row.label_status }}</el-tag></template>
                </el-table-column>
                <el-table-column prop="training_scope" label="training" width="120" />
                <el-table-column label="阻断原因" width="220">
                  <template #default="{ row }">
                    <div class="block-reasons">
                      <el-tag v-for="reason in row.block_reasons || []" :key="reason" size="small" type="warning">{{ reason }}</el-tag>
                      <span v-if="!(row.block_reasons || []).length">可进入下一步</span>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column prop="created_at" label="created_at" min-width="170">
                  <template #default="{ row }">{{ shortTime(row.created_at) }}</template>
                </el-table-column>
                <el-table-column label="操作" fixed="right" width="430">
                  <template #default="{ row }">
                    <div class="row-actions">
                      <el-button size="small" @click="viewSample(row)">查看样本</el-button>
                      <el-button size="small" @click="openPrivacy(row)">脱敏结果</el-button>
                      <el-button size="small" :disabled="!canPrivacy(row)" @click="runPrivacy(row)">重新脱敏</el-button>
                      <el-button size="small" :disabled="!canAutoLabel(row)" :title="disabledReason('auto_label')" @click="runAutoLabel(row)">自动标注</el-button>
                      <el-button size="small" :disabled="row.label_status === 'human_reviewed'" @click="sendReview(row)">送审核</el-button>
                      <el-button size="small" type="success" @click="confirmReview(row, 'positive')">positive</el-button>
                      <el-button size="small" @click="confirmReview(row, 'hard_negative')">hard_negative</el-button>
                      <el-button size="small" @click="confirmReview(row, 'boundary')">boundary</el-button>
                      <el-button size="small" type="danger" @click="rejectSample(row)">驳回</el-button>
                      <el-button size="small" :disabled="!row.can_customer_train" :title="sampleDisabledReason(row, 'customer')" @click="addTrainingScope(row, 'customer')">客户训练集</el-button>
                      <el-button size="small" :disabled="!row.can_platform_train" :title="sampleDisabledReason(row, 'platform')" @click="addTrainingScope(row, 'platform')">平台训练集</el-button>
                    </div>
                  </template>
                </el-table-column>
              </el-table>
            </el-card>
          </div>
        </el-tab-pane>

        <el-tab-pane label="人工审核队列" name="review">
          <div class="review-grid">
            <el-card v-for="item in reviewQueue" :key="item.sample_id" class="review-card" shadow="never">
              <div class="review-image"><img :src="sampleFrameUrl(item)" :alt="item.sample_id" /><div class="bbox main"></div><div class="bbox alt"></div></div>
              <h3>{{ item.sample_id }}</h3>
              <p>YOLO: person 0.81 / motorcycle 0.64</p>
              <p>大模型: 疑似 {{ scenarioLabel(item.scenario) }}</p>
              <p>推荐标签: {{ item.sample_type || 'confirmed_positive' }}</p>
              <div class="review-actions">
                <el-button size="small" type="success" @click="confirmReview(item, 'positive')">确认 positive</el-button>
                <el-button size="small" @click="confirmReview(item, 'hard_negative')">hard_negative</el-button>
                <el-button size="small" @click="confirmReview(item, 'boundary')">boundary</el-button>
                <el-button size="small">修改 bbox</el-button>
                <el-button size="small">修改 class</el-button>
                <el-button size="small" type="danger" @click="rejectSample(item)">驳回</el-button>
              </div>
            </el-card>
          </div>
        </el-tab-pane>

        <el-tab-pane label="模型生命周期" name="models">
          <div class="model-grid">
            <el-card shadow="never">
              <template #header><strong>Platform Baseline Models</strong></template>
              <el-table :data="platformModels" stripe>
                <el-table-column prop="model_id" label="model_id" min-width="190" />
                <el-table-column prop="model_type" label="type" width="80" />
                <el-table-column prop="target_device" label="device" width="105" />
                <el-table-column label="version" width="110">
                  <template #default="{ row }">{{ versionOf(row.model_id) }}</template>
                </el-table-column>
                <el-table-column prop="status" label="status" width="110" />
                <el-table-column prop="default_for_new_customer" label="default" width="90">
                  <template #default="{ row }"><el-tag :type="row.default_for_new_customer ? 'success' : 'info'">{{ row.default_for_new_customer ? '是' : '否' }}</el-tag></template>
                </el-table-column>
                <el-table-column prop="created_at" label="created_at" min-width="150">
                  <template #default="{ row }">{{ shortTime(row.created_at) }}</template>
                </el-table-column>
                <el-table-column label="操作" width="220">
                  <template #default="{ row }">
                    <el-button size="small" @click="toast(`查看 ${row.model_id}`)">查看</el-button>
                    <el-button size="small" @click="setDefaultBaseline(row)">设为默认</el-button>
                    <el-button size="small" type="danger" @click="toast('已模拟下架')">下架</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-card>
            <el-card shadow="never">
              <template #header><strong>Customer Models</strong></template>
              <el-table :data="customerModels" stripe>
                <el-table-column prop="model_id" label="model_id" min-width="210" />
                <el-table-column prop="customer_id" label="customer" width="120" />
                <el-table-column prop="scenario" label="scenario" width="150" />
                <el-table-column prop="model_type" label="type" width="70" />
                <el-table-column prop="target_device" label="device" width="105" />
                <el-table-column prop="derived_from" label="derived_from" width="150" />
                <el-table-column prop="dataset_version" label="dataset" width="160" />
                <el-table-column prop="status" label="status" width="110" />
                <el-table-column label="evaluation" width="110">
                  <template #default="{ row }"><el-tag :type="evaluationFor(row.model_id)?.decision === 'pass' ? 'success' : 'warning'">{{ evaluationFor(row.model_id)?.decision || 'pending' }}</el-tag></template>
                </el-table-column>
                <el-table-column label="deployment" width="120">
                  <template #default="{ row }">{{ rolloutFor(row.model_id)?.status || 'none' }}</template>
                </el-table-column>
                <el-table-column label="操作" width="260">
                  <template #default="{ row }">
                    <el-button size="small" @click="showEvaluation(row)">查看评估</el-button>
                    <el-button size="small" :disabled="evaluationFor(row.model_id)?.decision !== 'pass'" @click="approveRollout(row)">批准灰度</el-button>
                    <el-button size="small" type="danger" @click="toast('已模拟拒绝上线')">拒绝上线</el-button>
                    <el-button size="small" @click="rollback(row)">回滚</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-card>
          </div>
        </el-tab-pane>

        <el-tab-pane label="训练 / 评估 / 灰度" name="ops">
          <div class="ops-grid">
            <el-card shadow="never">
              <template #header><strong>Training Cycles</strong></template>
              <el-table :data="trainingCycles" stripe height="220">
                <el-table-column prop="cycle_id" label="cycle_id" min-width="230" />
                <el-table-column prop="source_type" label="source" width="150" />
                <el-table-column prop="status" label="status" width="130" />
                <el-table-column prop="sample_count" label="samples" width="95" />
                <el-table-column prop="privacy_processed_count" label="privacy" width="95" />
                <el-table-column prop="auto_labeled_count" label="labeled" width="95" />
                <el-table-column prop="human_reviewed_count" label="reviewed" width="95" />
                <el-table-column prop="dataset_version" label="dataset" min-width="230" />
                <el-table-column prop="started_at" label="started_at" width="150"><template #default="{ row }">{{ shortTime(row.started_at) }}</template></el-table-column>
                <el-table-column prop="finished_at" label="finished_at" width="150"><template #default="{ row }">{{ shortTime(row.finished_at) }}</template></el-table-column>
              </el-table>
            </el-card>
            <el-card shadow="never">
              <template #header><strong>Training Runs</strong></template>
              <el-table :data="trainingRuns" stripe height="280">
                <el-table-column prop="train_run_id" label="train_run_id" min-width="170" />
                <el-table-column prop="scope" label="scope" width="90" />
                <el-table-column prop="customer_id" label="customer" width="120" />
                <el-table-column prop="scenario" label="scenario" width="145" />
                <el-table-column prop="dataset_version" label="dataset" min-width="165" />
                <el-table-column prop="base_model_id" label="base_model" min-width="150" />
                <el-table-column prop="target_device" label="device" width="105" />
                <el-table-column prop="status" label="status" width="100" />
                <el-table-column prop="started_at" label="started_at" width="150"><template #default="{ row }">{{ shortTime(row.started_at) }}</template></el-table-column>
                <el-table-column prop="finished_at" label="finished_at" width="150"><template #default="{ row }">{{ shortTime(row.finished_at) }}</template></el-table-column>
                <el-table-column label="action" width="100"><template #default="{ row }"><el-button size="small" @click="toast(row.train_command || '暂无日志')">查看日志</el-button></template></el-table-column>
              </el-table>
            </el-card>
            <el-card shadow="never">
              <template #header>
                <div class="card-head">
                  <strong>Evaluation Reports</strong>
                  <span>当前线上模型 vs 候选模型</span>
                </div>
              </template>
              <div v-if="latestEvaluation" class="eval-compare">
                <div class="eval-row head"><span>指标</span><span>当前线上模型</span><span>候选模型</span><span>变化</span><span>结论</span></div>
                <div v-for="row in evaluationCompareRows" :key="row.metric" class="eval-row">
                  <span>{{ row.metric }}</span><strong>{{ row.current }}</strong><strong>{{ row.candidate }}</strong><span :class="row.good ? 'good' : 'warn'">{{ row.change }}</span><el-tag :type="row.good ? 'success' : 'warning'">{{ row.result }}</el-tag>
                </div>
                <div class="eval-decision">
                  <strong>{{ latestEvaluation.recommendation || (latestEvaluation.decision === 'pass' ? '建议灰度' : '需要复核') }}</strong>
                  <span>评估结论：{{ latestEvaluation.decision }}</span>
                </div>
              </div>
              <el-table :data="evaluations" stripe height="280">
                <el-table-column prop="evaluation_id" label="evaluation_id" min-width="160" />
                <el-table-column prop="candidate_model" label="candidate_model" min-width="210" />
                <el-table-column prop="current_model" label="current_model" min-width="190" />
                <el-table-column label="false_alarm_change" width="150"><template #default="{ row }">{{ percent(row.metrics?.map50_delta) }}</template></el-table-column>
                <el-table-column label="hard_negative_fp_change" width="185"><template #default="{ row }">{{ percent(row.metrics?.hard_negative_fp_delta) }}</template></el-table-column>
                <el-table-column label="recall_change" width="130"><template #default="{ row }">{{ percent(row.metrics?.recall_delta) }}</template></el-table-column>
                <el-table-column label="latency_change" width="130"><template #default="{ row }">{{ row.metrics?.latency_increase_percent ?? '-' }}%</template></el-table-column>
                <el-table-column prop="decision" label="pass/fail" width="100" />
                <el-table-column label="action" width="110"><template #default="{ row }"><el-button size="small" @click="toast(JSON.stringify(row.metrics))">查看报告</el-button></template></el-table-column>
              </el-table>
            </el-card>
            <el-card shadow="never">
              <template #header>
                <div class="card-head">
                  <strong>Rollout Records</strong>
                  <span>灰度必须绑定设备、摄像头、观察窗口和回滚模型</span>
                </div>
              </template>
              <div v-if="latestRollout" class="rollout-detail">
                <div v-for="stage in latestRollout.stages || []" :key="stage.stage" class="rollout-stage">
                  <strong>{{ stage.stage }}</strong>
                  <span>设备：{{ listText(stage.devices) }}</span>
                  <span>摄像头：{{ listText(stage.cameras) }}</span>
                  <span>场景：{{ stage.scenario || selectedScenario }}</span>
                  <span>观察：{{ stage.observe_window || `${stage.duration_hours || 24}h` }}</span>
                  <el-tag :type="stage.status === 'running' ? 'success' : 'info'">{{ stage.status }}</el-tag>
                </div>
                <p>回滚模型：{{ latestRollout.rollback_model_id }}</p>
              </div>
              <el-table :data="rollouts" stripe height="280">
                <el-table-column prop="rollout_id" label="rollout_id" min-width="165" />
                <el-table-column prop="model_id" label="model" min-width="210" />
                <el-table-column prop="customer_id" label="customer" width="120" />
                <el-table-column prop="status" label="stage" width="120" />
                <el-table-column label="devices" width="110"><template #default="{ row }">{{ rolloutDevices(row) }}</template></el-table-column>
                <el-table-column prop="status" label="status" width="120" />
                <el-table-column prop="rollback_model_id" label="rollback_model" min-width="180" />
                <el-table-column label="action" width="210">
                  <template #default="{ row }">
                    <el-button size="small" @click="approveRollout({ model_id: row.model_id })">批准下一阶段</el-button>
                    <el-button size="small" type="danger" @click="rollback({ model_id: row.model_id })">回滚</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-card>
            <el-card shadow="never">
              <template #header>
                <div class="card-head">
                  <strong>Trial Optimization Report</strong>
                  <span>试用转正式部署的客户优化报告</span>
                </div>
              </template>
              <div class="report-grid">
                <div><span>接入摄像头</span><strong>{{ trialReport.camera_count || 0 }}</strong></div>
                <div><span>回流样本</span><strong>{{ trialReport.sample_total || 0 }}</strong></div>
                <div><span>确认误报</span><strong>{{ trialReport.confirmed_false_alarm || 0 }}</strong></div>
                <div><span>漏报补录</span><strong>{{ trialReport.missed_event || 0 }}</strong></div>
                <div><span>脱敏完成</span><strong>{{ trialReport.privacy_processed || 0 }}</strong></div>
                <div><span>人工审核</span><strong>{{ trialReport.human_reviewed || 0 }}</strong></div>
                <div><span>候选模型</span><strong>{{ trialReport.candidate_model || '-' }}</strong></div>
                <div><span>误报下降</span><strong>{{ trialReport.false_alarm_reduction || '-' }}</strong></div>
                <div><span>灰度状态</span><strong>{{ trialReport.rollout_status || '-' }}</strong></div>
                <div class="report-wide"><span>商用建议</span><strong>{{ trialReport.recommendation || '-' }}</strong></div>
              </div>
            </el-card>
          </div>
        </el-tab-pane>
      </el-tabs>
    </section>
    </section>

    <section v-if="activeCenterTab === 'model_lifecycle'" class="ops-grid">
      <el-card shadow="never">
        <template #header>
          <div class="card-head">
            <strong>{{ isPlatformScope ? 'Platform Baseline / Candidate Models' : 'Customer Models / Active Models' }}</strong>
            <span>{{ isPlatformScope ? '平台基线模型、候选基线模型和 baseline rollout history' : '当前客户专属模型、候选模型和 rollout / rollback' }}</span>
          </div>
        </template>
        <p>模型只能由 Learning Cycle 产生，不能由 L1/L2 告警直接训练生成。</p>
        <el-table :data="scopedModels" stripe height="460">
          <el-table-column prop="model_id" label="model_id" min-width="220" />
          <el-table-column prop="scope" label="scope" width="100" />
          <el-table-column v-if="!isPlatformScope" prop="customer_id" label="customer" width="120" />
          <el-table-column prop="model_type" label="type" width="90" />
          <el-table-column prop="target_device" label="device" width="110" />
          <el-table-column prop="dataset_version" label="dataset_version" min-width="180" />
          <el-table-column prop="status" label="status" width="110" />
          <el-table-column v-if="isPlatformScope" label="default" width="110"><template #default="{ row }">{{ row.default_for_new_customer ? 'yes' : '-' }}</template></el-table-column>
          <el-table-column label="gate" width="180"><template #default="{ row }">{{ row.status === 'candidate' ? 'needs evaluation' : 'active / baseline' }}</template></el-table-column>
        </el-table>
      </el-card>
    </section>

    <section v-if="activeCenterTab === 'trial_report'" class="ops-grid">
      <el-card shadow="never">
        <template #header><strong>Trial Optimization Report 试用报告</strong></template>
        <div class="report-grid">
          <div><span>客户</span><strong>{{ aiTrialReport.customer_id }}</strong></div>
          <div><span>站点</span><strong>{{ aiTrialReport.site_id }}</strong></div>
          <div><span>试用周期</span><strong>{{ aiTrialReport.trial_period }}</strong></div>
          <div><span>接入摄像头数</span><strong>{{ aiTrialReport.camera_count }}</strong></div>
          <div><span>启用场景</span><strong>{{ listText(aiTrialReport.scenarios) }}</strong></div>
          <div><span>素材池总量</span><strong>{{ aiTrialReport.material_total }}</strong></div>
          <div><span>L1/L2 告警数量</span><strong>{{ aiTrialReport.edge_alarm_count }}</strong></div>
          <div><span>escaped_false_positive</span><strong>{{ aiTrialReport.escaped_false_positive_count }}</strong></div>
          <div><span>confirmed_missed_event</span><strong>{{ aiTrialReport.confirmed_missed_event_count }}</strong></div>
          <div><span>confirmed_hard_negative</span><strong>{{ aiTrialReport.confirmed_hard_negative_count }}</strong></div>
          <div><span>VLM 审计数量</span><strong>{{ aiTrialReport.vlm_audit_count }}</strong></div>
          <div><span>人工审核数量</span><strong>{{ aiTrialReport.human_review_count }}</strong></div>
          <div><span>训练批次数</span><strong>{{ aiTrialReport.learning_cycle_count }}</strong></div>
          <div><span>候选模型数量</span><strong>{{ aiTrialReport.candidate_model_count }}</strong></div>
          <div><span>误报下降</span><strong>{{ aiTrialReport.false_alarm_reduction }}</strong></div>
          <div><span>召回提升</span><strong>{{ aiTrialReport.recall_improvement }}</strong></div>
          <div class="report-wide"><span>正式部署建议</span><strong>{{ aiTrialReport.recommendation }}</strong></div>
          <div class="report-wide"><span>下一阶段扩展建议</span><strong>{{ listText(aiTrialReport.next_steps) }}</strong></div>
        </div>
      </el-card>
    </section>

    <el-dialog v-model="privacyDialogVisible" title="脱敏详情" width="920px">
      <div v-if="selectedSample" class="privacy-detail">
        <div class="privacy-image privacy-output">
          <h3>{{ legacyPrivacySample(selectedSample) ? '历史裁剪图（不可用于训练）' : '本地脱敏后的完整桌面 ROI 图' }}</h3>
          <div class="privacy-photo processed">
            <img :src="sampleFrameUrl(selectedSample)" alt="" />
          </div>
        </div>
        <div class="privacy-side">
          <el-alert
            v-if="legacyPrivacySample(selectedSample)"
            title="这是旧链路裁剪素材，缺少可信的隐私处理来源；已隔离，不能用于 VLM、人工审核或训练。"
            type="warning"
            :closable="false"
          />
          <el-alert
            v-else
            title="云端不保存原始图。该图已在 KKOS 本地完成桌面 ROI 截取、检测到的人脸模糊和元数据移除后上传。"
            type="success"
            :closable="false"
          />
          <p><strong>隐私处理方法</strong> {{ selectedSample.privacy_method || selectedSample.privacyMethod || '-' }}</p>
          <p><strong>脱敏动作</strong></p>
          <el-tag v-for="action in privacyActions(selectedSample)" :key="action">{{ action }}</el-tag>
          <p><strong>脱敏状态</strong> {{ selectedSample.privacy_status }}</p>
          <p><strong>训练资格</strong> {{ selectedSample.training_eligibility || 'blocked' }}</p>
          <p><strong>失败/阻断原因</strong> {{ privacyBlockReason(selectedSample) }}</p>
          <p class="path-text"><strong>frame_path</strong> {{ selectedSample.frame_path }}</p>
        </div>
      </div>
    </el-dialog>

    <el-dialog v-model="materialDetailVisible" title="Sample Detail / 判断矩阵" width="1080px">
      <div v-if="selectedMaterial" class="material-detail">
        <div class="detail-image">
          <img
            v-if="!imageLoadFailed(selectedMaterial)"
            :src="materialFrameUrl(selectedMaterial)"
            :alt="selectedMaterial.sample_id"
            @error="markImageLoadFailed(selectedMaterial)"
          />
          <div v-else class="image-error">
            <strong>图片加载失败</strong>
            <span>{{ materialFrameUrl(selectedMaterial) }}</span>
            <small>{{ selectedMaterial.frame_path || selectedMaterial.thumbnail_url || '-' }}</small>
          </div>
          <template v-if="materialBoxes(selectedMaterial).length">
            <div
              v-for="box in materialBoxes(selectedMaterial)"
              :key="box.key"
              class="bbox dynamic"
              :class="box.kind"
              :style="box.style"
            >
              <span>{{ box.label }}</span>
            </div>
          </template>
          <div v-else class="no-box-note">
            当前样本没有有效标注框；L1/L2/VLM 只有文字判断或 bbox 为空。
          </div>
        </div>
        <div class="judgement-matrix">
          <div v-for="part in judgementParts" :key="part.key" class="judge-card">
            <span>{{ part.label }}</span>
            <strong>{{ selectedMaterial.sample_judgement?.[part.key]?.status }}</strong>
            <small>{{ selectedMaterial.sample_judgement?.[part.key]?.reason || selectedMaterial.sample_judgement?.[part.key]?.comment || '-' }}</small>
          </div>
        </div>
        <div class="detail-side">
          <p><strong>sample_id</strong> {{ selectedMaterial.sample_id }}</p>
          <p><strong>sample_category</strong> {{ selectedMaterial.sample_category }}</p>
          <p><strong>training_eligibility</strong> {{ selectedMaterial.training_eligibility }}</p>
          <p><strong>blocked_reason</strong> {{ listText(selectedMaterial.blocked_reasons) }}</p>
          <p><strong>disagreement_type</strong> {{ selectedMaterial.disagreement_type }}</p>
          <div class="timeline">
            <div v-for="item in materialTimeline(selectedMaterial)" :key="item">{{ item }}</div>
          </div>
        </div>
      </div>
    </el-dialog>

    <el-dialog v-model="cycleDialogVisible" title="新建训练周期" width="680px">
      <div class="form-grid">
        <label><span>cycle_id</span><el-input v-model="cycleForm.cycle_id" /></label>
        <label><span>优化类型</span>
          <el-select v-model="cycleForm.cycle_goal.type">
            <el-option label="降低误报" value="reduce_false_positive" />
            <el-option label="提升召回" value="improve_recall" />
            <el-option label="适配新摄像头" value="adapt_new_camera" />
            <el-option label="优化夜间场景" value="optimize_night_scene" />
            <el-option label="类别混淆修复" value="fix_class_confusion" />
          </el-select>
        </label>
        <label class="full"><span>目标描述</span><el-input v-model="cycleForm.cycle_goal.description" type="textarea" :rows="3" /></label>
        <label><span>目标指标名</span><el-input v-model="cycleForm.metric_key" /></label>
        <label><span>目标指标值</span><el-input v-model="cycleForm.metric_value" /></label>
      </div>
      <template #footer>
        <el-button @click="cycleDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="createCycle">创建训练周期</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="manualSampleDialogVisible" title="补录漏报 / 客户反馈样本" width="720px">
      <div class="form-grid">
        <label><span>样本类型</span>
          <el-select v-model="manualSampleForm.sample_type">
            <el-option label="漏报事件 missed_event" value="missed_event" />
            <el-option label="人工上传图片 manual_uploaded_frame" value="manual_uploaded_frame" />
            <el-option label="人工上传片段 manual_uploaded_clip" value="manual_uploaded_clip" />
            <el-option label="客户反馈 customer_feedback_sample" value="customer_feedback_sample" />
            <el-option label="边界样本 boundary" value="confirmed_boundary" />
          </el-select>
        </label>
        <label><span>摄像头</span><el-input v-model="manualSampleForm.camera_id" /></label>
        <label class="full"><span>来源说明</span><el-input v-model="manualSampleForm.source_note" type="textarea" :rows="3" placeholder="例如：客户反馈 14:32 电动车进入电梯但系统未报警" /></label>
      </div>
      <template #footer>
        <el-button @click="manualSampleDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="manualAddSample">补录到当前周期</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api, { apiAssetUrl, apiPublicUrl } from '../api'

const scenarios = [
  { value: 'ev_intrusion', label: '电瓶车进电梯' },
  { value: 'fire_lane', label: '消防通道占用' },
  { value: 'trash_overflow', label: '垃圾箱溢满' },
  { value: 'person_intrusion', label: '危险区域有人停留' },
]
const sampleStates = [
  { value: 'all', label: '全部' },
  { value: 'raw_local', label: 'raw_local' },
  { value: 'privacy_processing', label: 'privacy_processing' },
  { value: 'privacy_processed', label: 'privacy_processed' },
  { value: 'privacy_check_failed', label: 'privacy_failed' },
  { value: 'auto_labeled', label: 'auto_labeled' },
  { value: 'need_review', label: 'need_review' },
  { value: 'human_reviewed', label: 'human_reviewed' },
  { value: 'confirmed_positive', label: 'confirmed_positive' },
  { value: 'confirmed_hard_negative', label: 'confirmed_hard_negative' },
  { value: 'confirmed_boundary', label: 'confirmed_boundary' },
  { value: 'rejected', label: 'rejected' },
]
const centerTabs = [
  { value: 'material_pool', label: 'Material Pool 素材池' },
  { value: 'vlm_audit', label: 'VLM Audit 大模型审计' },
  { value: 'missed_pool', label: 'Missed Candidate Pool 漏报抽检' },
  { value: 'learning_cycles', label: 'Learning Cycles 训练批次' },
  { value: 'model_lifecycle', label: 'Model Lifecycle 模型生命周期' },
  { value: 'trial_report', label: 'Trial Optimization Report 试用报告' },
]
const judgementParts = [
  { key: 'l1', label: 'L1 判断' },
  { key: 'l2', label: 'L2 判断' },
  { key: 'vlm', label: 'VLM 判断' },
  { key: 'human', label: 'Human 判断' },
]

const loading = ref(false)
const activeCenterTab = ref('material_pool')
const activeTab = ref('samples')
const aiScope = ref<'platform_baseline' | 'customer_optimized'>('customer_optimized')
const selectedCustomerId = ref(localStorage.getItem('guardian_customer_id') || '')
const selectedSiteId = ref(localStorage.getItem('guardian_site_id') || '')
const selectedScenario = ref('desk_drink_intrusion')
const selectedCycleId = ref('')
const sampleFilter = ref('all')
const privacyDialogVisible = ref(false)
const materialDetailVisible = ref(false)
const cycleDialogVisible = ref(false)
const manualSampleDialogVisible = ref(false)
const selectedSample = ref<any>(null)
const selectedMaterial = ref<any>(null)
const imageErrors = ref<Record<string, boolean>>({})
const availability = ref<any>({})
const trialReport = ref<any>({})
const materialPool = ref<any[]>([])
const vlmAudits = ref<any[]>([])
const missedPool = ref<any>({})
const aiLearningCycles = ref<any[]>([])
const aiTrialReport = ref<any>({})
const materialFilters = ref<any>({
  sample_category: '',
  l1_status: '',
  l2_status: '',
  vlm_decision: '',
  training_eligibility: '',
})
const cycleForm = ref<any>({
  cycle_id: '',
  cycle_goal: {
    type: 'reduce_false_positive',
    description: '降低试用期间发现的误报问题',
  },
  metric_key: 'hard_negative_fp',
  metric_value: '-30%',
})
const manualSampleForm = ref<any>({
  sample_type: 'missed_event',
  camera_id: 'manual_camera',
  source_note: '',
})

const summary = ref<any>({})
const customers = ref<any[]>([])
const sites = ref<any[]>([])
const policy = ref<any>({})
const samples = ref<any[]>([])
const models = ref<any[]>([])
const datasets = ref<any[]>([])
const trainingCycles = ref<any[]>([])
const trainingRuns = ref<any[]>([])
const evaluations = ref<any[]>([])
const rollouts = ref<any[]>([])

const customerOptions = computed(() => {
  return customers.value.map((item) => ({ customer_id: item.customer_id, customer_name: item.customer_name }))
})
const siteOptions = computed(() => {
  return sites.value.filter((item) => item.customer_id === selectedCustomerId.value).map((item) => ({ site_id: item.site_id, site_name: item.site_name }))
})
const currentCustomerName = computed(() => customerOptions.value.find((item) => item.customer_id === selectedCustomerId.value)?.customer_name || selectedCustomerId.value)
const isPlatformScope = computed(() => aiScope.value === 'platform_baseline')
const isCustomerScope = computed(() => aiScope.value === 'customer_optimized')
const cycleOptions = computed(() => [...trainingCycles.value].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))))
const scopeCycleOptions = computed(() => cycleOptions.value.filter((item) => isPlatformScope.value ? item.scope === 'platform' : item.scope === 'customer'))
const currentCycle = computed(() => {
  if (selectedCycleId.value) return scopeCycleOptions.value.find((item) => item.cycle_id === selectedCycleId.value)
  return scopeCycleOptions.value.find((item) => item.source_type === 'rv1126_rk3568_real_chain' && item.status === 'dataset_ready')
    || scopeCycleOptions.value.find((item) => item.status === 'dataset_ready')
    || scopeCycleOptions.value[0]
})
const scenarioSamples = computed(() => samples.value.filter((item) => {
  const cycleId = selectedCycleId.value || currentCycle.value?.cycle_id || ''
  return item.customer_id === selectedCustomerId.value
    && item.scenario === selectedScenario.value
    && (!cycleId || item.cycle_id === cycleId)
}))
const filteredSamples = computed(() => scenarioSamples.value.filter((item) => {
  if (sampleFilter.value === 'all') return true
  if (['auto_labeled', 'need_review', 'human_reviewed'].includes(sampleFilter.value)) return item.label_status === sampleFilter.value
  if (['confirmed_positive', 'confirmed_hard_negative', 'confirmed_boundary', 'rejected'].includes(sampleFilter.value)) return item.sample_type === sampleFilter.value
  return item.privacy_status === sampleFilter.value
}))
const platformModels = computed(() => models.value.filter((item) => item.scope === 'platform'))
const customerModels = computed(() => models.value.filter((item) => item.scope === 'customer' && (!item.customer_id || item.customer_id === selectedCustomerId.value)))
const candidateModel = computed(() => customerModels.value.find((item) => item.status === 'candidate' && (!item.scenario || item.scenario === selectedScenario.value)))
const platformCandidateModel = computed(() => platformModels.value.find((item) => item.status === 'candidate' && (!item.scenario || item.scenario === selectedScenario.value)))
const scopedModels = computed(() => isPlatformScope.value ? platformModels.value : customerModels.value)
const currentDataset = computed(() => datasets.value.find((item) => item.scope === 'customer' && item.customer_id === selectedCustomerId.value && (!item.scenario || item.scenario === selectedScenario.value)))
const optimizationMode = computed(() => customerModels.value.some((m) => m.status === 'active') ? 'customer_optimized' : 'platform_baseline')
const privacyFailedCount = computed(() => scenarioSamples.value.filter((s) => s.privacy_status === 'privacy_check_failed' || s.privacy_status === 'privacy_failed').length)
const needReviewCount = computed(() => scenarioSamples.value.filter((s) => s.label_status === 'need_review' || s.label_status === 'unlabeled').length)
const reviewQueue = computed(() => scenarioSamples.value.filter((s) => s.label_status === 'need_review' || s.label_status === 'unlabeled').slice(0, 12))
const policyItems = computed(() => [
  { key: 'allow_cloud_upload', label: '云端上传', allowed: policy.value.allow_cloud_upload !== false },
  { key: 'allow_auto_labeling', label: '自动标注', allowed: policy.value.allow_auto_labeling !== false },
  { key: 'allow_customer_model_training', label: '客户模型训练', allowed: policy.value.allow_customer_model_training !== false },
  { key: 'allow_platform_baseline_training', label: '加入平台训练集', allowed: policy.value.allow_platform_baseline_training !== false },
  { key: 'require_human_review', label: '强制人工审核', allowed: policy.value.require_human_review !== false },
])
const materialCategoriesOptions = computed(() => [...new Set(materialPool.value.map((item) => item.sample_category))])
const filteredMaterialPool = computed(() => materialPool.value.filter((item) => {
  const f = materialFilters.value
  return (!f.sample_category || item.sample_category === f.sample_category)
    && (!f.l1_status || item.sample_judgement?.l1?.status === f.l1_status)
    && (!f.l2_status || item.sample_judgement?.l2?.status === f.l2_status)
    && (!f.vlm_decision || item.sample_judgement?.vlm?.status === f.vlm_decision)
    && (!f.training_eligibility || item.training_eligibility === f.training_eligibility)
}))
const materialStats = computed(() => ({
  pending_vlm: materialPool.value.filter((item) => item.sample_judgement?.vlm?.status === 'not_run').length,
  pending_human: materialPool.value.filter((item) => item.sample_judgement?.human?.status === 'pending').length,
  eligible: materialPool.value.filter((item) => item.training_eligibility === 'eligible').length,
  blocked: materialPool.value.filter((item) => item.training_eligibility === 'blocked').length,
}))
const scopeDescription = computed(() => isPlatformScope.value
  ? '用于训练守界 Guardian 平台基线模型，只纳入客户明确授权给平台训练且已完成脱敏治理的素材。'
  : '用于优化当前客户、站点、场景的客户专属模型，素材、批次、模型都按当前客户上下文过滤。')
const dashboardCards = computed(() => {
  const count = (category: string) => materialPool.value.filter((item) => item.sample_category === category).length
  const candidateCount = scopedModels.value.filter((item) => item.status === 'candidate').length
  if (isPlatformScope.value) {
    return [
      { key: 'platform_material_total', label: '平台授权素材总数', value: materialPool.value.length },
      { key: 'pending_vlm', label: '待 VLM 审计', value: materialStats.value.pending_vlm },
      { key: 'pending_human', label: '待人工审核', value: materialStats.value.pending_human },
      { key: 'eligible', label: '可进入平台训练集', value: materialStats.value.eligible },
      { key: 'hard_negative', label: '平台 hard negative', value: count('confirmed_hard_negative') },
      { key: 'missed_event', label: '平台 missed event', value: count('confirmed_missed_event') },
      { key: 'cycles', label: '平台训练批次', value: aiLearningCycles.value.length },
      { key: 'candidates', label: '平台候选模型', value: candidateCount },
    ]
  }
  return [
    { key: 'customer_material_total', label: '客户素材总数', value: materialPool.value.length },
    { key: 'pending_vlm', label: '待 VLM 审计', value: materialStats.value.pending_vlm },
    { key: 'pending_human', label: '待人工审核', value: materialStats.value.pending_human },
    { key: 'eligible', label: '可进入客户训练集', value: materialStats.value.eligible },
    { key: 'escaped_false_positive', label: 'escaped false positive', value: count('escaped_false_positive') },
    { key: 'confirmed_missed_event', label: 'confirmed missed event', value: count('confirmed_missed_event') },
    { key: 'cycles', label: '客户训练批次', value: aiLearningCycles.value.length },
    { key: 'candidates', label: '客户候选模型', value: candidateCount },
  ]
})
const materialStatCards = computed(() => {
  const count = (category: string) => materialPool.value.filter((item) => item.sample_category === category).length
  return [
    { key: 'total', label: '总素材数', value: materialPool.value.length },
    { key: 'edge_positive_candidate', label: 'Edge Positive Candidate', value: count('edge_positive_candidate') },
    { key: 'edge_rejected_candidate', label: 'Edge Rejected Candidate', value: count('edge_rejected_candidate') },
    { key: 'escaped_false_positive', label: 'Escaped False Positive', value: count('escaped_false_positive') },
    { key: 'confirmed_positive', label: 'Confirmed Positive', value: count('confirmed_positive') },
    { key: 'confirmed_hard_negative', label: 'Confirmed Hard Negative', value: count('confirmed_hard_negative') },
    { key: 'confirmed_missed_event', label: 'Confirmed Missed Event', value: count('confirmed_missed_event') },
    { key: 'l2_false_negative', label: 'L2 False Negative', value: count('l2_false_negative') },
    { key: 'boundary', label: 'Boundary', value: count('confirmed_boundary') },
    { key: 'background_negative', label: 'Background Negative', value: count('background_negative') },
    { key: 'pending_vlm', label: '待 VLM 审计', value: materialStats.value.pending_vlm },
    { key: 'pending_human', label: '待人工审核', value: materialStats.value.pending_human },
    { key: 'eligible', label: isPlatformScope.value ? '可进入平台训练集' : '可进入客户训练集', value: materialStats.value.eligible },
    { key: 'blocked', label: '被阻断样本', value: materialStats.value.blocked },
  ]
})
const targetMetricText = computed(() => {
  const metric = currentCycle.value?.cycle_goal?.target_metric || {}
  const entries = Object.entries(metric)
  return entries.length ? entries.map(([key, value]) => `${key}: ${value}`).join(' / ') : '-'
})
const latestEvaluation = computed(() => evaluations.value.find((item) => item.customer_id === selectedCustomerId.value && (!candidateModel.value || item.candidate_model === candidateModel.value.model_id)) || evaluations.value[0])
const latestRollout = computed(() => rollouts.value.find((item) => item.customer_id === selectedCustomerId.value && (!candidateModel.value || item.model_id === candidateModel.value.model_id)) || rollouts.value[0])
const evaluationCompareRows = computed(() => {
  const metrics = latestEvaluation.value?.metrics || {}
  return [
    { metric: '误报率', current: pct(metrics.current_false_alarm_rate ?? 0.124), candidate: pct(metrics.candidate_false_alarm_rate ?? 0.081), change: deltaPct(metrics.false_alarm_delta ?? -0.346), good: true, result: '通过' },
    { metric: 'hard negative 误报', current: String(metrics.current_hard_negative_fp ?? 31), candidate: String(metrics.candidate_hard_negative_fp ?? 18), change: deltaPct(metrics.hard_negative_fp_delta ?? -0.419), good: true, result: '通过' },
    { metric: '召回率', current: pct(metrics.current_recall ?? 0.912), candidate: pct(metrics.candidate_recall ?? 0.925), change: deltaPct(metrics.recall_delta ?? 0.013), good: true, result: '通过' },
    { metric: 'RV1126 延迟', current: `${metrics.current_latency_ms ?? 42}ms`, candidate: `${metrics.candidate_latency_ms ?? 45}ms`, change: `+${metrics.latency_increase_percent ?? 7.1}%`, good: Number(metrics.latency_increase_percent ?? 0) <= 10, result: Number(metrics.latency_increase_percent ?? 0) <= 10 ? '通过' : '需观察' },
    { metric: 'CMA 错误', current: '0', candidate: String(metrics.cma_error ?? 0), change: '0', good: Number(metrics.cma_error ?? 0) === 0, result: Number(metrics.cma_error ?? 0) === 0 ? '通过' : '失败' },
  ]
})
const lifecycleSteps = computed(() => {
  const processed = scenarioSamples.value.filter((s) => s.privacy_status === 'privacy_processed').length
  const labeled = scenarioSamples.value.filter((s) => ['auto_labeled', 'need_review', 'human_reviewed'].includes(s.label_status)).length
  const reviewed = scenarioSamples.value.filter((s) => s.label_status === 'human_reviewed').length
  const latestRun = trainingRuns.value.find((r) => r.customer_id === selectedCustomerId.value && (!r.scenario || r.scenario === selectedScenario.value))
  const latestEval = latestEvaluation.value
  const rollout = latestRollout.value
  return [
    step('sample', '样本回流', `${scenarioSamples.value.length} samples`, scenarioSamples.value.length, 0, 'ready', '导入样本', () => toast('第一版用真实 L1 candidate 和本地样本回流，导入入口已预留')),
    step('privacy', '本地脱敏', `${processed} passed / ${privacyFailedCount.value} failed`, processed, privacyFailedCount.value, privacyFailedCount.value ? 'warning' : 'ready', '运行脱敏', runPrivacyBatch),
    step('label', '自动标注', `${labeled} labeled / ${needReviewCount.value} need review`, labeled, needReviewCount.value, policy.value.allow_auto_labeling === false ? 'blocked' : 'ready', '运行自动标注', runAutoLabelBatch, policy.value.allow_auto_labeling === false, disabledReason('auto_label')),
    step('review', '人工审核', `${needReviewCount.value} pending`, reviewed, needReviewCount.value, needReviewCount.value ? 'warning' : 'ready', '进入审核队列', () => { activeTab.value = 'review' }),
    step('dataset', '数据集构建', currentDataset.value?.dataset_version || 'none', currentDataset.value?.sample_count || 0, 0, policy.value.allow_customer_model_training === false ? 'blocked' : 'ready', '构建客户训练集', buildDataset, policy.value.allow_customer_model_training === false, disabledReason('customer_training')),
    step('train', '模型训练', candidateModel.value?.model_id || 'none', trainingRuns.value.length, 0, candidateModel.value ? 'ready' : 'warning', '发起训练', startTraining, policy.value.allow_customer_model_training === false, disabledReason('customer_training')),
    step('eval', '评估准入', latestEval?.decision || 'pending', latestEval?.decision === 'pass' ? 1 : 0, latestEval?.decision === 'fail' ? 1 : 0, latestEval?.decision === 'pass' ? 'ready' : 'warning', '运行评估', runEvaluation),
    step('rollout', '灰度发布', rollout?.status || 'none', rollout ? 1 : 0, rollout?.status === 'rolled_back' ? 1 : 0, rollout?.status === 'rolled_back' ? 'warning' : 'ready', '批准灰度', () => approveRollout(candidateModel.value || {}), !candidateModel.value, '暂无候选模型'),
    step('online', '上线 / 回滚', rollout?.status === 'full_release' ? 'online' : 'rollback ready', rollout?.status === 'full_release' ? 1 : 0, 0, 'ready', '回滚', () => rollback(candidateModel.value || {}), !candidateModel.value, '暂无候选模型'),
  ]
})

function step(key: string, title: string, count: string, success: number, failed: number, status: string, button: string, action: any, disabled = false, disabledReason = '') {
  return { key, title, count, success, failed, status, statusText: status === 'blocked' ? 'blocked' : status === 'warning' ? 'attention' : 'ready', lastRun: 'last ' + shortTime(new Date().toISOString()), button, action, disabled, disabledReason }
}
async function load() {
  loading.value = true
  try {
    summary.value = (await api.get('/ai-lifecycle/summary')).data
    customers.value = (await api.get('/customers')).data
    sites.value = (await api.get('/sites')).data
    if (!customers.value.some((item) => item.customer_id === selectedCustomerId.value)) selectedCustomerId.value = customers.value[0]?.customer_id || ''
    if (!sites.value.some((item) => item.site_id === selectedSiteId.value && item.customer_id === selectedCustomerId.value)) selectedSiteId.value = sites.value.find((item) => item.customer_id === selectedCustomerId.value)?.site_id || ''
    policy.value = selectedCustomerId.value ? (await api.get(`/customers/${selectedCustomerId.value}/data-policy`)).data : {}
    samples.value = (await api.get('/samples')).data
    datasets.value = (await api.get('/datasets')).data
    const platformCycles = (await api.get('/ai-center/learning-cycles?scope=platform_baseline')).data
    const customerCycles = (await api.get(`/ai-center/learning-cycles?scope=customer_optimized&customer_id=${selectedCustomerId.value}`)).data
    const cycles = [...platformCycles, ...customerCycles]
    trainingCycles.value = cycles
    const preferredCycle = scopeCycleOptions.value.find((item: any) => item.source_type === 'rv1126_rk3568_real_chain' && item.status === 'dataset_ready')
      || scopeCycleOptions.value.find((item: any) => item.status === 'dataset_ready')
      || scopeCycleOptions.value[0]
    if (!selectedCycleId.value && preferredCycle?.cycle_id) {
      selectedCycleId.value = preferredCycle.cycle_id
      if (preferredCycle.scenario && preferredCycle.scenario !== 'multi_scenario') selectedScenario.value = preferredCycle.scenario
    }
    const platform = (await api.get('/models?scope=platform')).data
    const customer = (await api.get('/models?scope=customer')).data
    models.value = [...platform, ...customer]
    trainingRuns.value = (await api.get('/training-runs')).data
    evaluations.value = (await api.get('/evaluations')).data
    rollouts.value = (await api.get('/rollouts')).data
    const aiQuery = aiCenterQuery()
    materialPool.value = (await api.get(`/ai-center/material-pool?${aiQuery}`)).data
    vlmAudits.value = (await api.get(`/ai-center/vlm-audits?${aiQuery}`)).data
    missedPool.value = (await api.get(`/ai-center/missed-candidates?${aiQuery}`)).data
    aiLearningCycles.value = (await api.get(`/ai-center/learning-cycles?${aiQuery}`)).data
    aiTrialReport.value = (await api.get(`/ai-center/trial-report?${aiQuery}`)).data
    const cycleId = selectedCycleId.value || currentCycle.value?.cycle_id || ''
    availability.value = (await api.get(`/training-cycles/availability?customer_id=${selectedCustomerId.value}&cycle_id=${encodeURIComponent(cycleId)}&scenario=${selectedScenario.value}`)).data
    trialReport.value = (await api.get(`/trial-optimization-report?customer_id=${selectedCustomerId.value}&cycle_id=${encodeURIComponent(cycleId)}`)).data
  } finally {
    loading.value = false
  }
}
function aiCenterQuery() {
  const params = new URLSearchParams({
    scope: aiScope.value,
    scenario: selectedScenario.value,
    cycle_id: selectedCycleId.value || '',
  })
  if (isCustomerScope.value) {
    params.set('customer_id', selectedCustomerId.value)
    params.set('site_id', selectedSiteId.value)
  }
  return params.toString()
}
async function onScopeChange() {
  selectedCycleId.value = ''
  materialFilters.value.training_eligibility = ''
  await load()
}
async function onContextChange() {
  selectedCycleId.value = ''
  policy.value = (await api.get(`/customers/${selectedCustomerId.value}/data-policy`)).data
  await load()
}
async function postAction(url: string, payload: any, message: string) {
  try {
    await api.post(url, { customer_id: selectedCustomerId.value, site_id: selectedSiteId.value, scenario: selectedScenario.value, ...payload })
    ElMessage.success(message)
    await load()
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.detail || error?.message || '操作失败')
  }
}
function runPrivacyBatch() { return postAction('/ai-lifecycle/privacy-process', {}, '已运行本地脱敏') }
function runAutoLabelBatch() { return postAction('/ai-lifecycle/auto-label', {}, '已运行自动标注') }
function buildDataset() { return postAction('/ai-lifecycle/datasets/build-customer', { cycle_id: currentCycle.value?.cycle_id }, '已构建客户训练集') }
function startTraining() { return postAction('/ai-lifecycle/training/start', { dataset_version: currentDataset.value?.dataset_version }, '已发起训练并生成候选模型') }
function runEvaluation() { return postAction('/ai-lifecycle/evaluation/run', { candidate_model: candidateModel.value?.model_id }, '评估已通过 mock 准入') }
function approveRollout(row: any) { return postAction('/ai-lifecycle/rollout/approve', { model_id: row.model_id }, '已批准灰度阶段') }
function rollback(row: any) { return postAction('/ai-lifecycle/rollout/rollback', { model_id: row.model_id }, '已触发回滚') }
function runPrivacy(row: any) { return postAction('/ai-lifecycle/privacy-process', { sample_id: row.sample_id }, '已重新脱敏') }
function runAutoLabel(row: any) { return postAction('/ai-lifecycle/auto-label', { sample_id: row.sample_id }, '已自动标注') }
function confirmReview(row: any, type: string) {
  const url = type === 'positive' ? '/ai-lifecycle/human-review/confirm-positive' : type === 'hard_negative' ? '/ai-lifecycle/human-review/confirm-hard-negative' : '/ai-lifecycle/human-review/confirm-boundary'
  return postAction(url, { sample_id: row.sample_id }, '人工审核状态已更新')
}
async function sendReview(row: any) {
  await api.put(`/samples/${row.sample_id}`, { label_status: 'need_review', needs_review_reason: 'manual_send_review' })
  ElMessage.success('已送入人工审核队列')
  await load()
}
async function rejectSample(row: any) {
  await api.put(`/samples/${row.sample_id}`, { sample_type: 'rejected', label_status: 'human_reviewed' })
  ElMessage.success('已驳回样本')
  await load()
}
async function addTrainingScope(row: any, scope: string) {
  const training_scope = row.training_scope === 'both' || row.training_scope === scope ? row.training_scope : row.training_scope === 'none' ? scope : 'both'
  await api.put(`/samples/${row.sample_id}`, { training_scope })
  ElMessage.success(`已加入${scope === 'customer' ? '客户' : '平台'}训练集`)
  await load()
}
function viewSample(row: any) {
  ElMessageBox.alert(`sample_id: ${row.sample_id}\nframe_path: ${row.frame_path || '-'}\nmetadata_path: ${row.metadata_path || '-'}`, '样本详情')
}
function openPrivacy(row: any) {
  selectedSample.value = row
  privacyDialogVisible.value = true
}
function legacyPrivacySample(row: any) {
  const method = String(row?.privacy_method || row?.privacyMethod || '')
  const status = String(row?.privacy_status || '')
  return status === 'legacy_provenance_unknown' || method.includes('candidate_crop') || row?.source_type === 'guardian_forge_historical'
}
function privacyActions(row: any) {
  if (legacyPrivacySample(row)) return ['历史裁剪素材', '隐私来源未验证', '已禁止训练']
  const actions = Array.isArray(row?.privacy_actions) ? row.privacy_actions : []
  return actions.length ? actions : ['完整桌面 ROI', '检测到的人脸模糊', '移除元数据']
}
function privacyBlockReason(row: any) {
  if (legacyPrivacySample(row)) return '历史素材未带可信的本地脱敏与授权证明'
  return (row?.blocked_reasons || []).join(' / ') || '无'
}
function openMaterialDetail(row: any) {
  selectedMaterial.value = row
  imageErrors.value[row.sample_id] = false
  materialDetailVisible.value = true
}
function materialFromAudit(row: any) {
  const existing = materialPool.value.find((item) => item.sample_id === row.sample_id)
  if (existing) return existing
  const sourceEventId = String(row.sample_id || '').replace(/^candidate_/, '')
  return {
    sample_id: row.sample_id,
    customer_id: selectedCustomerId.value,
    site_id: selectedSiteId.value,
    camera_id: '-',
    scenario: selectedScenario.value,
    source_event_id: sourceEventId,
    source_type: 'vlm_audit_record',
    sample_category: row.suggested_category || row.vlm_decision || '-',
    sample_judgement: {
      l1: { status: '-', classes: [], confidence: 0, bbox: [] },
      l2: { status: '-', classes: [], confidence: 0, bbox: [] },
      vlm: { status: row.audit_status || '-', teacher_model: row.teacher_model || '', suggested_category: row.suggested_category || '', suggested_labels: row.suggested_labels || [], confidence: 0, reason: row.reason || '' },
      human: { status: 'pending', comment: '' },
    },
    privacy_status: '-',
    training_eligibility: 'blocked',
    blocked_reasons: ['waiting_material_pool_record'],
    disagreement_type: row.disagreement_type || '',
    thumbnail_url: sourceEventId ? `/api/l1/candidates/${sourceEventId}/frame` : '',
    created_at: row.created_at || '',
  }
}
function openAuditDetail(row: any) {
  openMaterialDetail(materialFromAudit(row))
}
function sampleFrameUrl(row: any) { return apiPublicUrl(`/api/samples/${row.sample_id}/frame?t=${Date.now()}`) }
function materialFrameUrl(row: any) {
  const path = row.thumbnail_url || `/api/samples/${row.sample_id}/frame`
  return apiAssetUrl(`${path}${path.includes('?') ? '&' : '?'}t=${Date.now()}`)
}
function auditFrameUrl(row: any) { return materialFrameUrl(materialFromAudit(row)) }
function imageLoadFailed(row: any) { return Boolean(imageErrors.value[row?.sample_id || '']) }
function markImageLoadFailed(row: any) {
  if (!row?.sample_id) return
  imageErrors.value = { ...imageErrors.value, [row.sample_id]: true }
}
function validBox(raw: any) {
  if (!Array.isArray(raw) || raw.length < 4) return null
  const values = raw.slice(0, 4).map((item) => Number(item))
  if (values.some((item) => !Number.isFinite(item))) return null
  if (values.every((item) => item === 0)) return null
  const max = Math.max(...values)
  if (max <= 1) {
    const [x, y, wOrX2, hOrY2] = values
    const width = wOrX2 > x ? wOrX2 - x : wOrX2
    const height = hOrY2 > y ? hOrY2 - y : hOrY2
    if (width <= 0 || height <= 0) return null
    return { x, y, width, height }
  }
  const imageWidth = 1280
  const imageHeight = 720
  const [x, y, third, fourth] = values
  const width = third > x ? third - x : third
  const height = fourth > y ? fourth - y : fourth
  if (width <= 0 || height <= 0) return null
  return { x: x / imageWidth, y: y / imageHeight, width: width / imageWidth, height: height / imageHeight }
}
function materialBoxes(row: any) {
  const judgement = row?.sample_judgement || {}
  const sources = [
    { key: 'l1', label: `L1 ${(judgement.l1?.classes || []).join(',') || 'bbox'}`, raw: judgement.l1?.bbox, kind: 'l1' },
    { key: 'l2', label: `L2 ${(judgement.l2?.classes || []).join(',') || 'bbox'}`, raw: judgement.l2?.bbox, kind: 'l2' },
    { key: 'vlm', label: `VLM ${(judgement.vlm?.suggested_labels || []).join(',') || 'bbox'}`, raw: judgement.vlm?.bbox || judgement.vlm?.boxes, kind: 'vlm' },
  ]
  return sources
    .map((source) => ({ ...source, box: validBox(source.raw) }))
    .filter((source) => source.box)
    .map((source) => ({
      key: source.key,
      label: source.label,
      kind: source.kind,
      style: {
        left: `${Math.max(0, Math.min(1, source.box!.x)) * 100}%`,
        top: `${Math.max(0, Math.min(1, source.box!.y)) * 100}%`,
        width: `${Math.max(0.01, Math.min(1, source.box!.width)) * 100}%`,
        height: `${Math.max(0.01, Math.min(1, source.box!.height)) * 100}%`,
      },
    }))
}
function showEvaluation(row: any) {
  const report = evaluationFor(row.model_id)
  ElMessageBox.alert(JSON.stringify(report || { status: 'pending' }, null, 2), '评估报告')
}
function setDefaultBaseline(row: any) {
  platformModels.value.forEach((item) => { item.default_for_new_customer = item.model_id === row.model_id })
  ElMessage.success('已模拟设为默认基线')
}
async function createCycle() {
  const metricKey = cycleForm.value.metric_key || 'hard_negative_fp'
  await api.post('/training-cycles', {
    customer_id: selectedCustomerId.value,
    site_id: selectedSiteId.value,
    scenario: selectedScenario.value,
    cycle_id: cycleForm.value.cycle_id || undefined,
    cycle_goal: {
      ...cycleForm.value.cycle_goal,
      target_metric: { [metricKey]: cycleForm.value.metric_value || '-30%' },
    },
  })
  cycleDialogVisible.value = false
  ElMessage.success('已创建训练周期')
  await load()
}
async function manualAddSample() {
  await api.post('/ai-lifecycle/samples/manual-add', {
    customer_id: selectedCustomerId.value,
    site_id: selectedSiteId.value,
    scenario: selectedScenario.value,
    cycle_id: currentCycle.value?.cycle_id,
    ...manualSampleForm.value,
  })
  manualSampleDialogVisible.value = false
  ElMessage.success('已补录样本到当前训练周期')
  await load()
}
function toast(message: string) { ElMessage.success(message) }
function customerName(id: string) {
  const names: Record<string, string> = { 'cust-demo-001': '示范物业集团' }
  return names[id] || id
}
function scenarioLabel(value: string) { return scenarios.find((item) => item.value === value)?.label || value }
function activeModel(type: string) {
  return customerModels.value.find((m) => m.model_type === type && m.status === 'active')?.model_id || platformModels.value.find((m) => m.model_type === type && m.status === 'active')?.model_id || '-'
}
function platformActiveModel(type: string) {
  return platformModels.value.find((m) => m.model_type === type && m.status === 'active')?.model_id || '-'
}
function sampleStateCount(value: string) { return value === 'all' ? scenarioSamples.value.length : scenarioSamples.value.filter((s) => s.privacy_status === value || s.label_status === value || s.sample_type === value).length }
function canPrivacy(row: any) { return !legacyPrivacySample(row) && (row.privacy_status !== 'privacy_processed' || row.privacy_status === 'privacy_check_failed') }
function canAutoLabel(row: any) { return policy.value.allow_auto_labeling !== false && row.privacy_status === 'privacy_processed' && row.label_status !== 'human_reviewed' }
function disabledReason(kind: string) {
  const reasons: Record<string, string> = {
    auto_label: '该客户未授权自动标注',
    customer_training: '该客户未授权客户模型训练',
    platform_training: '该客户未授权加入平台训练集',
    cloud_upload: '该客户未授权云端上传',
  }
  return reasons[kind] || ''
}
function sampleDisabledReason(row: any, scope: string) {
  if (scope === 'customer' && policy.value.allow_customer_model_training === false) return disabledReason('customer_training')
  if (scope === 'platform' && policy.value.allow_platform_baseline_training === false) return disabledReason('platform_training')
  if (row.privacy_status !== 'privacy_processed') return '样本未完成脱敏，不能进入训练'
  if (policy.value.require_human_review !== false && row.label_status !== 'human_reviewed') return '样本尚未完成人工审核'
  return (row.block_reasons || []).join(' / ')
}
function privacyTag(status: string) { return status === 'privacy_processed' ? 'success' : status === 'privacy_check_failed' || status === 'privacy_failed' ? 'danger' : 'warning' }
function labelTag(status: string) { return status === 'human_reviewed' || status === 'auto_labeled' ? 'success' : status === 'need_review' || status === 'unlabeled' ? 'warning' : 'info' }
function categoryTag(category: string) { return ['confirmed_positive', 'confirmed_missed_event'].includes(category) ? 'success' : ['edge_positive_candidate', 'edge_rejected_candidate'].includes(category) ? 'warning' : ['escaped_false_positive', 'confirmed_hard_negative'].includes(category) ? 'danger' : 'info' }
function judgementText(part: any) { return `${part?.status || '-'} ${part?.confidence ? Number(part.confidence).toFixed(2) : ''}`.trim() }
function materialTimeline(row: any) {
  const j = row.sample_judgement || {}
  return [
    `${shortTime(row.created_at)} RV1126 L1 ${j.l1?.status || '-'} ${(j.l1?.classes || []).join(',')} ${j.l1?.confidence || ''}`.trim(),
    `${shortTime(row.created_at)} RK3568 L2 ${j.l2?.status || '-'}`,
    `${shortTime(row.created_at)} Privacy ${row.privacy_status}`,
    `${shortTime(row.created_at)} VLM audit: ${j.vlm?.status || '-'}`,
    `${shortTime(j.human?.reviewed_at || row.created_at)} Human review: ${j.human?.status || 'pending'}`,
  ]
}
function statusType(status: string) { return status === 'blocked' ? 'danger' : status === 'warning' ? 'warning' : 'success' }
function cycleStatusType(status: string) { return status === 'failed' || status === 'cancelled' ? 'danger' : ['training', 'evaluating', 'rollout'].includes(status) ? 'warning' : 'success' }
function shortTime(value: string) { return value ? String(value).replace('T', ' ').slice(0, 16) : '-' }
function percent(value: number) { return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : '-' }
function pct(value: number) { return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : '-' }
function deltaPct(value: number) { return typeof value === 'number' ? `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%` : '-' }
function versionOf(modelId: string) { return modelId?.match(/v\d+/)?.[0] || '-' }
function evaluationFor(modelId: string) { return evaluations.value.find((item) => item.candidate_model === modelId || item.current_model === modelId) }
function rolloutFor(modelId: string) { return rollouts.value.find((item) => item.model_id === modelId) }
function rolloutDevices(row: any) { return listText(row.stages?.find((s: any) => s.status === 'running')?.devices) || row.stages?.find((s: any) => s.status === 'running')?.devices_percent || '-' }
function listText(value: any) { return Array.isArray(value) ? value.join(', ') : value || '-' }
function onDataPolicyChange(event: Event) {
  const detail = (event as CustomEvent).detail || {}
  if (!detail.customer_id || detail.customer_id === selectedCustomerId.value) load()
}
onMounted(() => {
  window.addEventListener('guardian-data-policy-change', onDataPolicyChange)
  load()
})
onBeforeUnmount(() => window.removeEventListener('guardian-data-policy-change', onDataPolicyChange))
</script>

<style scoped>
.page { display:flex; flex-direction:column; gap:14px; color:#172033; }
.page-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
h2, h3 { margin:0; }
p { margin:6px 0 0; color:#64748b; }
.context-bar { display:flex; flex-direction:column; gap:14px; padding:16px; border:1px solid #dbe4ef; border-radius:8px; background:#fff; }
.truth-banner { display:flex; justify-content:space-between; gap:16px; align-items:center; padding:12px 14px; border:1px solid #fecaca; border-radius:8px; background:#fff7f7; color:#991b1b; }
.truth-banner strong { white-space:nowrap; }
.truth-banner span { color:#7f1d1d; }
.ai-center-nav { display:flex; gap:8px; padding:8px; border:1px solid #dbe4ef; border-radius:8px; background:#fff; overflow-x:auto; }
.ai-center-nav button { border:1px solid transparent; background:transparent; color:#475569; padding:8px 10px; border-radius:6px; cursor:pointer; white-space:nowrap; font-weight:600; }
.ai-center-nav button.active { border-color:#60a5fa; color:#0b63ce; background:#eff6ff; }
.ai-dashboard { display:block; }
.dashboard-grid, .stat-grid { display:grid; grid-template-columns:repeat(6, minmax(0,1fr)); gap:10px; margin-bottom:12px; }
.dashboard-grid div, .stat-grid div { padding:12px; border:1px solid #e5edf6; border-radius:8px; background:#f8fafc; min-width:0; }
.dashboard-grid span, .stat-grid span { display:block; color:#64748b; font-size:12px; }
.dashboard-grid strong, .stat-grid strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pipeline-note { padding:14px; border-radius:8px; background:#f8fafc; color:#334155; line-height:1.8; }
.filters-row { display:grid; grid-template-columns:repeat(5, minmax(150px, 1fr)); gap:10px; margin-bottom:12px; }
.material-pool { display:flex; flex-direction:column; gap:12px; }
.selectors { display:grid; grid-template-columns:repeat(4, minmax(180px, 1fr)); gap:12px; }
.context-meta { display:grid; grid-template-columns:1.4fr 1fr 1fr 1fr 1.3fr; gap:12px; }
.context-meta div { padding:12px; border-radius:8px; background:#f8fafc; border:1px solid #e5edf6; min-width:0; }
.context-meta span, .context-meta small { display:block; color:#64748b; font-size:12px; }
.context-meta strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.scope-note { display:flex; justify-content:space-between; gap:12px; align-items:center; padding:10px 12px; border:1px solid #dbe4ef; border-radius:8px; background:#f8fafc; }
.scope-note span { color:#64748b; font-size:13px; }
.policy-grid { display:grid; grid-template-columns:1.2fr .8fr; gap:14px; }
.cycle-workbench { display:grid; grid-template-columns:1.25fr .75fr; gap:14px; }
.cycle-card, .availability-card { border-radius:8px; border:1px solid #dbe4ef; }
.head-actions { display:flex; gap:8px; align-items:center; }
.cycle-main { display:flex; flex-direction:column; gap:14px; }
.cycle-title { display:flex; align-items:center; gap:10px; min-width:0; }
.cycle-title .eyebrow { color:#64748b; font-size:12px; }
.cycle-title strong { font-size:18px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cycle-fields { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:10px; }
.cycle-fields div, .availability-grid div, .report-grid div { padding:12px; border-radius:8px; background:#f8fafc; border:1px solid #e5edf6; min-width:0; }
.cycle-fields span, .cycle-fields small, .availability-grid span, .report-grid span { display:block; color:#64748b; font-size:12px; }
.cycle-fields strong, .availability-grid strong, .report-grid strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.availability-grid { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:10px; }
.policy-card, .intervention-card, .table-card { border-radius:8px; border:1px solid #dbe4ef; }
.card-head { display:flex; justify-content:space-between; align-items:center; gap:12px; }
.card-head span { color:#64748b; font-size:13px; }
.policy-items { display:grid; grid-template-columns:repeat(5, minmax(0,1fr)); gap:10px; }
.policy-item { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:10px; border-radius:8px; background:#f8fafc; }
.alerts { display:flex; flex-wrap:wrap; gap:8px; }
.flow-board { display:grid; grid-template-columns:repeat(9, minmax(150px,1fr)); gap:10px; overflow-x:auto; padding-bottom:4px; }
.flow-step { min-width:150px; padding:12px; border:1px solid #dbe4ef; border-radius:8px; background:#fff; display:flex; gap:10px; }
.flow-step.ready { border-color:#b7dfc7; }
.flow-step.warning { border-color:#f2d48b; background:#fffaf0; }
.flow-step.blocked { border-color:#f3b4b4; background:#fff5f5; }
.step-index { width:26px; height:26px; display:grid; place-items:center; flex:0 0 auto; border-radius:50%; background:#1f6feb; color:#fff; font-weight:700; }
.step-body { display:flex; flex-direction:column; gap:8px; min-width:0; }
.step-title { display:flex; justify-content:space-between; gap:6px; align-items:center; }
.step-title strong, .step-count { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.step-count { font-weight:700; }
.step-meta { display:flex; flex-direction:column; gap:2px; color:#64748b; font-size:12px; }
.workspace { background:#fff; border:1px solid #dbe4ef; border-radius:8px; padding:12px; }
.governance { display:grid; grid-template-columns:220px minmax(0,1fr); gap:14px; }
.state-filter { display:flex; flex-direction:column; gap:8px; }
.state-filter button { display:flex; justify-content:space-between; align-items:center; border:1px solid #dbe4ef; background:#fff; border-radius:8px; padding:9px 10px; cursor:pointer; color:#334155; }
.state-filter button.active { background:#eaf4ff; border-color:#65a8f7; color:#0b63ce; }
.row-actions { display:flex; flex-wrap:wrap; gap:6px; }
.mini-stack { display:flex; flex-direction:column; gap:2px; min-width:0; }
.mini-stack strong, .mini-stack span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.mini-stack span { color:#64748b; font-size:12px; }
.block-reasons { display:flex; flex-wrap:wrap; gap:4px; }
.block-reasons span { color:#64748b; font-size:12px; }
.review-grid { display:grid; grid-template-columns:repeat(3, minmax(240px,1fr)); gap:12px; }
.review-card { border:1px solid #dbe4ef; border-radius:8px; }
.review-actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:12px; }
.model-grid, .ops-grid { display:flex; flex-direction:column; gap:14px; }
.eval-compare { border:1px solid #e5edf6; border-radius:8px; overflow:hidden; margin-bottom:12px; }
.eval-row { display:grid; grid-template-columns:1.2fr 1fr 1fr 1fr .8fr; gap:10px; align-items:center; padding:10px 12px; border-top:1px solid #e5edf6; }
.eval-row:first-child { border-top:0; }
.eval-row.head { background:#f8fafc; color:#64748b; font-weight:700; }
.eval-row .good { color:#16a34a; font-weight:700; }
.eval-row .warn { color:#b45309; font-weight:700; }
.eval-decision { display:flex; justify-content:space-between; gap:12px; align-items:center; padding:12px; background:#f0fdf4; color:#166534; }
.rollout-detail { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:10px; margin-bottom:12px; }
.rollout-stage { display:flex; flex-direction:column; gap:5px; padding:12px; border:1px solid #e5edf6; border-radius:8px; background:#f8fafc; }
.rollout-stage span, .rollout-detail p { color:#64748b; font-size:12px; margin:0; }
.report-grid { display:grid; grid-template-columns:repeat(5, minmax(0,1fr)); gap:10px; }
.report-wide { grid-column:span 2; }
.form-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.form-grid label { display:flex; flex-direction:column; gap:6px; color:#64748b; font-size:13px; }
.form-grid label.full { grid-column:1 / -1; }
.sample-thumb { width:96px; height:58px; object-fit:cover; border-radius:6px; border:1px solid #dbe4ef; background:#0f172a; cursor:pointer; display:block; }
.review-image, .privacy-photo { position:relative; height:170px; border-radius:8px; overflow:hidden; background:#0f172a; }
.review-image img, .privacy-photo img { width:100%; height:100%; object-fit:cover; display:block; }
.privacy-photo { height:260px; }
.privacy-photo.processed img { filter:saturate(.92); }
.bbox, .blur-box { position:absolute; border:2px solid #ff4d4f; border-radius:4px; }
.bbox.main { left:40%; top:22%; width:90px; height:72px; }
.bbox.alt { left:18%; top:56%; width:120px; height:46px; border-color:#f59e0b; }
.bbox.face, .blur-box.face { left:28%; top:25%; width:74px; height:68px; }
.bbox.plate, .blur-box.plate { left:55%; top:58%; width:120px; height:38px; border-color:#f59e0b; }
.blur-box { border:0; backdrop-filter:blur(10px); background:rgba(255,255,255,.45); }
.privacy-detail { display:grid; grid-template-columns:minmax(0, 1.35fr) minmax(280px, .9fr); gap:14px; }
.privacy-output { grid-column:1; }
.material-detail { display:grid; grid-template-columns:1.2fr 1fr 1fr; gap:14px; }
.detail-image { position:relative; min-height:300px; max-height:520px; border-radius:8px; overflow:hidden; background:#0f172a; display:flex; align-items:center; justify-content:center; }
.detail-image img { width:100%; height:auto; max-height:520px; object-fit:contain; display:block; }
.bbox.dynamic { border-width:2px; background:rgba(15,23,42,.08); pointer-events:none; }
.bbox.dynamic span { position:absolute; left:-2px; top:-24px; max-width:180px; padding:2px 8px; border-radius:5px 5px 0 0; background:#ef4444; color:#fff; font-size:12px; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.bbox.dynamic.l1 { border-color:#22c55e; }
.bbox.dynamic.l1 span { background:#16a34a; }
.bbox.dynamic.l2 { border-color:#f59e0b; }
.bbox.dynamic.l2 span { background:#d97706; }
.bbox.dynamic.vlm { border-color:#38bdf8; }
.bbox.dynamic.vlm span { background:#0284c7; }
.no-box-note { position:absolute; left:14px; right:14px; bottom:14px; padding:10px 12px; border-radius:8px; background:rgba(15,23,42,.72); color:#dbeafe; font-size:13px; line-height:1.5; }
.image-error { display:flex; flex-direction:column; gap:8px; max-width:90%; padding:18px; border:1px dashed #475569; border-radius:10px; color:#cbd5e1; background:#111827; overflow-wrap:anywhere; }
.image-error strong { color:#fff; }
.image-error span, .image-error small { color:#94a3b8; }
.judgement-matrix { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.judge-card { padding:12px; border:1px solid #e5edf6; border-radius:8px; background:#f8fafc; min-width:0; }
.judge-card span, .judge-card small { display:block; color:#64748b; font-size:12px; }
.judge-card strong { display:block; margin:4px 0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.detail-side { display:flex; flex-direction:column; gap:8px; }
.timeline { display:flex; flex-direction:column; gap:6px; padding:10px; border-radius:8px; background:#f8fafc; color:#334155; font-size:12px; }
.privacy-side { display:flex; flex-direction:column; gap:10px; }
.privacy-side .el-tag { margin-right:6px; }
.path-text { overflow-wrap:anywhere; font-size:12px; }
@media (max-width: 1180px) {
  .policy-grid, .cycle-workbench, .governance, .privacy-detail, .material-detail, .ai-dashboard { grid-template-columns:1fr; }
  .policy-items, .context-meta, .review-grid, .cycle-fields, .rollout-detail, .report-grid, .dashboard-grid, .stat-grid, .filters-row { grid-template-columns:1fr 1fr; }
}
</style>
