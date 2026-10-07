<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router";
import { useI18n } from "vue-i18n";
import { NMessageProvider, NSelect } from "naive-ui";
import { useReviewStore } from "./stores/review";
import type { Viewer } from "./types";
const store = useReviewStore();
const { t } = useI18n();
const choices = ["评委-林策", "评委-周筑", "主办方"].map((value) => ({ label: value, value }));
</script>
<template>
  <div class="shell">
    <aside class="sidebar"><div class="brand"><b>ANON</b><span>建筑评审</span></div><nav><RouterLink to="/">{{ t("scoring") }}</RouterLink><RouterLink to="/results">{{ t("results") }}</RouterLink></nav><div class="identity"><small>当前身份</small><NSelect :value="store.viewer" :options="choices" @update:value="(value: Viewer) => store.setViewer(value)" /></div></aside>
    <main><header><div><small>城市公共空间设计竞赛 · 第二轮 · {{ store.versionLabel }}</small><h1>建筑设计竞赛匿名评审</h1><p>评分期间作者信息不可见，评委只能查看和维护自己的评分。</p></div><div class="badge">{{ store.isOrganizer ? "主办方视图" : "评委独立视图" }}</div></header>
      <div v-if="store.simulatedOffline || store.outbox.length" class="storage-banner">
        <b>存储暂时不可写</b><span>评分表对应关系与待处理评分已暂存在内存中，不会丢失；恢复后将自动重试落盘（待处理 {{ store.outbox.length }} 条）。</span>
        <button v-if="!store.simulatedOffline" @click="store.retryPersist()">立即重试</button>
      </div>
      <NMessageProvider><RouterView /></NMessageProvider></main>
  </div>
</template>
