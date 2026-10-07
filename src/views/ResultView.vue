<script setup lang="ts">
import { computed } from "vue";
import { NAlert, NButton, NCard, NEmpty, NSwitch, NTable, NTag, useMessage } from "naive-ui";
import { useReviewStore } from "../stores/review";
const store = useReviewStore();
const message = useMessage();

const columns = [
  { title: "名次", key: "rank", width: 70 },
  { title: "匿名编号", key: "code" },
  { title: "方案", key: "title" },
  { title: "有效评委", key: "judgeCount" },
  { title: "利益冲突", key: "conflicts" },
  { title: "加权总分", key: "total" }
];

// 同名次并列：仅以有效评分（当前版本、已提交、无冲突、无待复核单元格）重算
const rankingRows = computed(() => {
  let previous: number | null = null;
  let rank = 0;
  return store.ranking.map((item, index) => {
    if (previous === null || item.total !== previous) rank = index + 1;
    previous = item.total;
    return { ...item, rank };
  });
});

function publish() {
  if (store.lockBlockers.length) {
    message.warning(`仍有待处理项，不能锁定：${store.lockBlockers[0]}`);
    return;
  }
  if (store.publish()) message.success("评分结果已锁定发布");
}

function upgrade() {
  const result = store.upgradeCriteria();
  if (!result.ok) return;
  if (!result.stored) message.warning("换版已生效但存储暂时不可写，对应关系已保留，恢复后自动重试");
  else message.success("评分表已换版，旧名次与有效评委数作废，待复核项处理后重算");
}
</script>
<template>
  <NAlert v-if="!store.published" type="warning" show-icon>结果尚未锁定。为避免影响独立判断，主办方当前只能看到提交进度与待复核状态，看不到分值。</NAlert>

  <div class="result-grid">
    <NCard title="提交进度（当前评分表有效提交）">
      <article v-for="scheme in store.schemes" :key="scheme.id" class="progress-row">
        <div><b>{{ scheme.code }} {{ scheme.title }}</b><small>有效评委 {{ store.validJudgeCount(scheme.id) }} / {{ store.judges.length }}（待复核评分不计数）</small></div>
        <NTag :type="store.allSubmittedFor(scheme.id) ? 'success' : 'warning'">{{ store.allSubmittedFor(scheme.id) ? "齐备" : "未齐" }}</NTag>
      </article>
    </NCard>

    <NCard title="评分表版本">
      <div class="discipline">
        <p><b>当前：</b>{{ store.versionLabel }}</p>
        <p>「场地回应」拆为「气候适应」「公共空间」；「环境策略」停用。旧分按对应关系迁移：未拆分的直接沿用，拆分项保留原分待复核，停用维度不以默认分补齐。维度版本一变，旧名次与有效评委数立即作废重算。</p>
      </div>
      <NButton v-if="store.hasNextVersion" type="primary" block :disabled="store.published" @click="upgrade">升级到新版评分表并迁移旧数据</NButton>
      <NTag v-else type="success" :bordered="false" style="margin-top:8px">已是最新版本</NTag>
    </NCard>
  </div>

  <NCard v-if="store.migrationLogs.length" title="换版迁移记录" class="ranking">
    <article v-for="log in store.migrationLogs" :key="log.id" class="progress-row">
      <div><b>v{{ log.from }} → v{{ log.to }}</b><small>迁移 {{ log.carriedScores }} 条旧评分；{{ log.splitCells }} 个拆分单元格保留原分待复核；停用：{{ log.retired.join("、") }}</small></div>
      <small>{{ new Date(log.at).toLocaleString() }}</small>
    </article>
  </NCard>

  <NCard title="待复核与异常处理" class="ranking">
    <div class="discipline">
      <p>拆分维度待复核单元格：<b>{{ store.pendingCellCount }}</b> 项（评委在打分页逐项确认沿用原分或改分）。</p>
      <p>晚到写回：<b>{{ store.openPendingSubmissions.length }}</b> 条（两台设备同交一份时，只有携带最新修订号的能写回，晚到的由评委采纳或丢弃）。</p>
      <article v-for="pending in store.openPendingSubmissions" :key="pending.id" class="pending-row">
        <b>{{ pending.judge }} · {{ store.schemes.find(s => s.id === pending.schemeId)?.code }} · {{ pending.kind }}</b>
        <small>{{ pending.reason }}（主办方仅可见状态，分值对评委外不可见）</small>
      </article>
      <p>待处理写回（存储故障）：<b :class="{ danger: store.outbox.length }">{{ store.outbox.length }}</b> 条。</p>
      <label class="offline-switch"><NSwitch :value="store.simulatedOffline" @update:value="(v: boolean) => store.setSimulatedOffline(v)" /><span>模拟存储暂时不可写</span></label>
      <NButton v-if="store.outbox.length" size="small" style="margin-top:8px" @click="store.retryPersist() && message.success('存储恢复，待处理写回已重试成功')">立即重试落盘</NButton>
    </div>
  </NCard>

  <NCard title="锁定发布" class="ranking">
    <div class="discipline">
      <p>评分纪律：评委只能查看自己的评分，主办方在锁定前无法读取分值；利益冲突评分保留审计但不参与排名；待复核项清零后才可锁定。</p>
      <NAlert v-if="store.lockBlockers.length" type="error" style="margin:10px 0">不能锁定：<ul style="margin:6px 0 0;padding-left:18px"><li v-for="(blocker, i) in store.lockBlockers" :key="i">{{ blocker }}</li></ul></NAlert>
    </div>
    <NButton type="primary" block :disabled="store.published || !!store.lockBlockers.length" @click="publish">锁定并发布结果</NButton>
  </NCard>

  <NCard title="最终排名" class="ranking"><NEmpty v-if="!store.published" description="锁定后查看最终排名" /><NTable v-else :columns="columns" :data="rankingRows" :bordered="false" /></NCard>
</template>
