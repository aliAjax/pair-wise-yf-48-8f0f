<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { NAlert, NButton, NCard, NInput, NProgress, NRate, NSwitch, NTag, useMessage } from "naive-ui";
import { toTypedSchema } from "@vee-validate/zod";
import { useForm } from "vee-validate";
import { z } from "zod";
import { useReviewStore } from "../stores/review";

const store = useReviewStore();
const message = useMessage();
const selectedId = defineModel<string>("selectedId", { default: "a" });
const selected = computed(() => store.schemes.find((item) => item.id === selectedId.value) ?? store.schemes[0]);
const currentScore = computed(() => store.record(selected.value.id));
const form = reactive({ values: Object.fromEntries(store.criteria.map((item) => [item.id, 60])) as Record<string, number>, comment: "", conflict: false });
const schema = toTypedSchema(z.object({ comment: z.string().min(4, "请至少填写4个字的评审意见") }));
const { errors, validate } = useForm({ validationSchema: schema });

function syncForm() {
  const record = currentScore.value;
  form.values = Object.fromEntries(store.criteria.map((item) => [
    item.id,
    record?.values[item.id] ?? 60 // 仅新建评分走默认值；迁移缺项（停用维度）保持无值而非补默认分
  ]));
  form.comment = record?.comment ?? "";
  form.conflict = record?.conflict ?? false;
}

watch(selectedId, syncForm, { immediate: true });

const weighted = computed(() => store.criteria.reduce((sum, item) => sum + (form.values[item.id] ?? 0) * item.weight / 100, 0));
const disabled = computed(() => store.isOrganizer || !!currentScore.value?.submitted || store.published);
const pendingCells = computed(() => currentScore.value?.pendingCells ?? []);
const codeOf = (schemeId: string) => store.schemes.find((item) => item.id === schemeId)?.code ?? schemeId;

function draft() {
  const result = store.saveDraft(selected.value.id, form.values, form.comment, form.conflict, currentScore.value?.revision ?? 0);
  if (!result.ok) message.warning("该设备修订号已过期，晚到草稿已转入待复核");
  else if (!result.stored) message.warning("存储暂时不可写，评分已保留，恢复后自动重试");
  else message.success("评分草稿已保存到本地");
}

async function submit() {
  const result = await validate({ values: form } as any);
  if (!result.valid) return;
  if (pendingCells.value.length) {
    message.warning(`还有 ${pendingCells.value.length} 个拆分维度待复核，请确认沿用原分或改分后再提交`);
    return;
  }
  const res = store.submit(selected.value.id, form.values, form.comment, form.conflict, currentScore.value?.revision ?? 0);
  if (!res.ok) message.warning("另一台设备已先提交更新修订号，本次晚到写回转入待复核");
  else if (!res.stored) message.warning("存储暂时不可写，评分已保留，恢复后自动重试");
  else message.success("匿名评分已提交");
}

/** 演示两台设备同时提交：携带上一个修订号写回，必然失败并进待复核 */
function simulateLateSubmit() {
  const revision = (currentScore.value?.revision ?? 1) - 1;
  const res = store.submit(selected.value.id, form.values, form.comment, form.conflict, Math.max(revision, 0));
  if (!res.ok) message.warning("已模拟：第二台设备的晚到提交进入待复核队列");
  else message.info("当前没有更早修订号可模拟");
}

function keepOriginal(criterionId: string) {
  store.resolvePendingCell(selected.value.id, criterionId);
  message.success("已沿用迁移原分，该维度退出待复核");
}
function confirmNewScore(criterionId: string) {
  store.resolvePendingCell(selected.value.id, criterionId, form.values[criterionId]);
  message.success("已按新分确认，该维度退出待复核");
}
function adjudicate(pendingId: string, decision: "adopt" | "discard") {
  store.adjudicatePending(pendingId, decision);
  syncForm();
  message.success(decision === "adopt" ? "已采纳晚到评分，拆分维度仍需复核" : "晚到评分已丢弃");
}
</script>

<template>
  <NAlert v-if="store.isOrganizer" type="info" show-icon>主办方在结果锁定前不能查看任何评委的评分值。</NAlert>
  <div class="workspace">
    <NCard title="匿名方案" class="scheme-panel"><button v-for="item in store.schemes" :key="item.id" class="scheme" :class="{ active: selectedId === item.id }" @click="selectedId = item.id"><span>{{ item.code }}</span><b>{{ item.title }}</b><small>{{ item.publicNo }} · {{ item.status }}</small></button></NCard>
    <NCard class="score-panel">
      <template #header><div class="card-title"><div><small>{{ selected.code }} · {{ selected.publicNo }} · {{ store.versionLabel }}</small><h2>{{ selected.title }}</h2></div><div class="header-tags"><NTag v-if="currentScore" size="small" :bordered="false">修订号 r{{ currentScore.revision }}</NTag><NTag :type="selected.status === '已锁定' ? 'success' : 'warning'">{{ selected.status }}</NTag></div></div></template>
      <p class="synopsis">{{ selected.synopsis }}</p>
      <div class="criteria">
        <article v-for="item in store.criteria" :key="item.id" :class="{ pending: pendingCells.includes(item.id) }">
          <div><b>{{ item.name }} <NTag v-if="pendingCells.includes(item.id)" size="small" type="warning">待复核 · 迁移原分</NTag></b><span>权重 {{ item.weight }}%</span><p>{{ item.description }}</p></div>
          <div class="rate-cell"><NRate v-model:value="form.values[item.id]" :count="5" :disabled="disabled" /><small>{{ form.values[item.id] ?? "—" }} / {{ item.max }}</small></div>
          <div v-if="pendingCells.includes(item.id)" class="cell-actions"><NButton size="tiny" @click="keepOriginal(item.id)">沿用原分</NButton><NButton size="tiny" type="primary" @click="confirmNewScore(item.id)">按新分确认</NButton></div>
        </article>
      </div>
      <NAlert v-if="pendingCells.length" type="warning" show-icon style="margin-bottom:12px">「场地回应」已拆为「气候适应」「公共空间」，当前显示为迁移保留的原分。请逐项确认沿用或改分；待复核项不参加排名。</NAlert>
      <div class="weighted"><span>加权得分</span><NProgress type="line" :percentage="weighted" :height="18" /><b>{{ weighted.toFixed(1) }}</b></div>
      <label class="conflict-switch"><NSwitch v-model:value="form.conflict" :disabled="disabled" /><span><b>声明利益冲突</b><small>声明后本评分不计入最终排名</small></span></label>
      <label class="field"><span>评审意见（评委间不可见）</span><NInput v-model:value="form.comment" type="textarea" :disabled="disabled" placeholder="填写对方案的具体意见" /><small>{{ errors.comment }}</small></label>
      <div class="actions">
        <NButton :disabled="disabled" @click="draft">保存草稿</NButton>
        <NButton type="primary" :disabled="disabled || !!pendingCells.length" @click="submit">提交本方案评分</NButton>
        <NButton v-if="currentScore?.submitted && !store.published" quaternary @click="store.recalled(selected.id)">退回修改</NButton>
        <NButton v-if="!store.isOrganizer && !store.published" quaternary type="warning" @click="simulateLateSubmit">模拟另一台设备晚到提交</NButton>
      </div>

      <div v-if="store.myPendingSubmissions.length" class="pending-list">
        <h3>我的晚到写回（{{ store.myPendingSubmissions.length }}）</h3>
        <article v-for="pending in store.myPendingSubmissions" :key="pending.id">
          <div><b>{{ codeOf(pending.schemeId) }} · {{ pending.kind }}</b><small>基于 v{{ pending.baseVersion }} r{{ pending.baseRevision }}；{{ pending.reason }}</small></div>
          <div class="cell-actions"><NButton size="tiny" type="primary" @click="adjudicate(pending.id, 'adopt')">采纳</NButton><NButton size="tiny" @click="adjudicate(pending.id, 'discard')">丢弃</NButton></div>
        </article>
      </div>
    </NCard>
  </div>
</template>
