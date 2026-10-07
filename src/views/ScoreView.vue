<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { NAlert, NButton, NCard, NInput, NProgress, NRate, NSwitch, NTag, useMessage } from "naive-ui";
import { toTypedSchema } from "@vee-validate/zod";
import { useForm } from "vee-validate";
import { z } from "zod";
import { storeToRefs } from "pinia";
import { useReviewStore, RUBRIC_VERSION } from "../stores/review";

const store = useReviewStore();
const message = useMessage();
const selectedId = defineModel<string>("selectedId", { default: "a" });
const selected = computed(() => store.schemes.find((item) => item.id === selectedId.value) ?? store.schemes[0]);
const currentScore = computed(() => store.record(selected.value.id));
const { persistError, pendingWrites } = storeToRefs(store);

const form = reactive({
  values: Object.fromEntries(store.criteria.map((item) => [item.id, 60])) as Record<string, number>,
  comment: "",
  conflict: false
});
const baseRevision = ref(1);

const schema = toTypedSchema(z.object({ comment: z.string().min(4, "请至少填写4个字的评审意见") }));
const { errors, validate } = useForm({ validationSchema: schema });

watch(selectedId, () => {
  const record = store.record(selected.value.id);
  form.values = { ...(record?.values ?? Object.fromEntries(store.criteria.map((item) => [item.id, 60]))) };
  form.comment = record?.comment ?? "";
  form.conflict = record?.conflict ?? false;
  baseRevision.value = record?.revision ?? 1;
}, { immediate: true });

const weighted = computed(() => store.criteria.reduce((sum, item) => sum + form.values[item.id] * item.weight / 100, 0));
const disabled = computed(() => store.isOrganizer || currentScore.value?.submitted || store.published);
const pendingHere = computed(() => currentScore.value?.pendingReview ?? false);
const legacySustain = computed(() => currentScore.value?.legacyValues?.sustain);

function draft() {
  const result = store.saveDraft(selected.value.id, form.values, form.comment, form.conflict, baseRevision.value);
  if (result && "ok" in result && !result.ok) {
    message.warning("另一台设备已提交更新，本份草稿进待复核");
  } else {
    message.success("评分草稿已保存到本地");
  }
}

async function submit() {
  const result = await validate({ values: form } as any);
  if (!result.valid) return;
  const write = store.submit(selected.value.id, form.values, form.comment, form.conflict, baseRevision.value);
  if (write.ok) {
    baseRevision.value = write.revision;
    message.success("匿名评分已提交");
  } else if (write.reason === "stale") {
    message.warning("另一台设备已提交更新，本份评分晚到，已进待复核");
  }
}

function simulateRemote() {
  store.simulateRemoteWrite(selected.value.id);
  message.info("另一台设备已先写回，修订号领先；本台提交将被判定为晚到");
}
</script>

<template>
  <NAlert v-if="store.isOrganizer" type="info" show-icon>主办方在结果锁定前不能查看任何评委的评分值。</NAlert>
  <NAlert v-if="persistError" type="error" show-icon class="persist-banner">
    <b>本地存储暂不可写</b>：对应关系与 {{ pendingWrites.length }} 项待处理评分已保存在内存，恢复后将自动重试。
    <NButton size="small" type="primary" @click="store.retryPersist">立即重试</NButton>
  </NAlert>
  <div class="workspace">
    <NCard title="匿名方案" class="scheme-panel">
      <button v-for="item in store.schemes" :key="item.id" class="scheme" :class="{ active: selectedId === item.id }" @click="selectedId = item.id">
        <span>{{ item.code }}</span><b>{{ item.title }}</b><small>{{ item.publicNo }} · {{ item.status }}</small>
      </button>
    </NCard>
    <NCard class="score-panel">
      <template #header>
        <div class="card-title">
          <div><small>{{ selected.code }} · {{ selected.publicNo }}</small><h2>{{ selected.title }}</h2></div>
          <NTag :type="selected.status === '已锁定' ? 'success' : 'warning'">{{ selected.status }}</NTag>
        </div>
      </template>
      <p class="synopsis">{{ selected.synopsis }}</p>

      <NAlert v-if="pendingHere" type="warning" show-icon class="pending-banner">
        <b>评分表已换版（v{{ RUBRIC_VERSION }}）</b>：原「场地回应」已拆分为「气候适应」与「公共空间」两项，原得分已保留，请重新确认后提交。待复核期间本评分不参与排名，锁定暂不可用。
      </NAlert>
      <NAlert v-if="legacySustain != null" type="info" show-icon class="legacy-banner">
        原「环境策略」得分 {{ legacySustain }} 已停用并留档，不计入新总分。
      </NAlert>

      <div class="criteria">
        <article v-for="item in store.criteria" :key="item.id">
          <div><b>{{ item.name }}</b><span>权重 {{ item.weight }}%</span><p>{{ item.description }}</p></div>
          <NRate v-model:value="form.values[item.id]" :count="5" :disabled="disabled" />
          <small>{{ form.values[item.id] }} / {{ item.max }}</small>
        </article>
      </div>
      <div class="weighted"><span>加权得分</span><NProgress type="line" :percentage="weighted" :height="18" /><b>{{ weighted.toFixed(1) }}</b></div>
      <label class="conflict-switch">
        <NSwitch v-model:value="form.conflict" :disabled="disabled" /><span><b>声明利益冲突</b><small>声明后本评分不计入最终排名</small></span>
      </label>
      <label class="field">
        <span>评审意见（评委间不可见）</span>
        <NInput v-model:value="form.comment" type="textarea" :disabled="disabled" placeholder="填写对方案的具体意见" />
        <small>{{ errors.comment }}</small>
      </label>
      <div class="actions">
        <NButton :disabled="disabled" @click="draft">保存草稿</NButton>
        <NButton type="primary" :disabled="disabled" @click="submit">提交本方案评分</NButton>
        <NButton v-if="currentScore?.submitted && !store.published" quaternary @click="store.recalled(selected.id)">退回修改</NButton>
      </div>
      <div class="demo-row">
        <small>修订号 {{ currentScore?.revision ?? 1 }} · 维度表 v{{ currentScore?.rubricVersion ?? RUBRIC_VERSION }}</small>
        <NButton size="tiny" quaternary @click="simulateRemote">演示：另一台设备已提交（并发修订号）</NButton>
      </div>
    </NCard>
  </div>
</template>
