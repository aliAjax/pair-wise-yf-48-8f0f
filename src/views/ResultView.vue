<script setup lang="ts">
import { NAlert, NButton, NCard, NEmpty, NTable, NTag, useMessage } from "naive-ui";
import { storeToRefs } from "pinia";
import { useReviewStore } from "../stores/review";

const store = useReviewStore();
const message = useMessage();
const { pendingReviewCount, persistError, pendingWrites } = storeToRefs(store);

const columns = [
  { title: "名次", key: "rank", width: 70 },
  { title: "匿名编号", key: "code" },
  { title: "方案", key: "title" },
  { title: "有效评委", key: "judgeCount" },
  { title: "待复核", key: "pending" },
  { title: "利益冲突", key: "conflicts" },
  { title: "加权总分", key: "total" }
];

function publish() {
  const result = store.publish();
  if (result.ok) {
    message.success("评分结果已锁定发布");
  } else if (result.reason === "pending") {
    message.warning(`仍有 ${pendingReviewCount.value} 项评分待复核，待复核评分不参加排名，不能锁定结果`);
  } else {
    message.warning("仍有评委未提交，不能锁定结果");
  }
}
</script>

<template>
  <NAlert v-if="!store.published" type="warning" show-icon>结果尚未锁定。维度表已换版，旧评分需评委重新确认；待复核评分不参加排名，锁定后名次与有效评委数据此重算。</NAlert>
  <NAlert v-if="persistError" type="error" show-icon class="persist-banner">
    <b>本地存储暂不可写</b>：对应关系与 {{ pendingWrites.length }} 项待处理评分已保存在内存，恢复后自动重试。
    <NButton size="small" type="primary" @click="store.retryPersist">立即重试</NButton>
  </NAlert>
  <div class="result-grid">
    <NCard title="提交进度">
      <article v-for="scheme in store.schemes" :key="scheme.id" class="progress-row">
        <div>
          <b>{{ scheme.code }} {{ scheme.title }}</b>
          <small>{{ store.judges.filter((judge) => store.scores.some((score) => score.schemeId === scheme.id && score.judge === judge && score.submitted && !score.pendingReview)).length }} / {{ store.judges.length }} 已提交</small>
          <small v-if="store.scores.some((score) => score.schemeId === scheme.id && score.pendingReview)" class="pending-note">含待复核评分，不计入有效提交</small>
        </div>
        <NTag :type="store.allSubmittedFor(scheme.id) ? 'success' : 'warning'">{{ store.allSubmittedFor(scheme.id) ? "齐备" : "待提交" }}</NTag>
      </article>
    </NCard>
    <NCard title="评分纪律">
      <div class="discipline">
        <p>评委只能查看自己的评分，主办方在锁定前无法读取分值。</p>
        <p>存在利益冲突的评分保留审计记录，但不参与最终排名。</p>
        <p>维度表换版后，拆分维度的旧评分保留原分并记为待复核，不拿默认分补上；待复核评分不参加排名，全部复核后方可锁定。</p>
        <p>两台设备同时提交时，只有最新修订号能写回，晚到的进待复核。</p>
        <p>评分提交后可由评委主动退回，结果锁定后不可修改。</p>
      </div>
      <NAlert v-if="pendingReviewCount > 0" type="warning" show-icon class="pending-banner">当前有 {{ pendingReviewCount }} 项评分待复核，暂不能锁定结果。</NAlert>
      <NButton type="primary" block :disabled="store.published || pendingReviewCount > 0" @click="publish">锁定并发布结果</NButton>
    </NCard>
  </div>
  <NCard title="最终排名" class="ranking">
    <NEmpty v-if="!store.published" description="锁定后查看最终排名" />
    <NTable v-else :columns="columns" :data="store.ranking.map((item, index) => ({ ...item, rank: index + 1 }))" :bordered="false" />
  </NCard>
  <NCard title="容错演示" class="demo">
    <div class="discipline">
      <p>模拟本地存储故障：写入失败时对应关系与待处理评分暂存内存，恢复后自动重试补写。</p>
      <p>存储状态：<NTag :type="persistError ? 'error' : 'success'">{{ persistError ? "故障中" : "正常" }}</NTag> 待处理写入：{{ pendingWrites.length }} 项</p>
    </div>
    <NButton block :disabled="persistError" @click="store.simulateStorageFailure">模拟存储故障</NButton>
  </NCard>
</template>
