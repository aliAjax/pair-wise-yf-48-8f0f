import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { Criterion, PendingReason, PendingWrite, ReviewEvent, Scheme, ScoreRecord, Viewer } from "../types";

const KEY = "pair-wise-yf-48/review";
const judges: Viewer[] = ["评委-林策", "评委-周筑"];

/** 维度表版本：换版后旧名次与有效评委数立即作废重算 */
export const RUBRIC_VERSION = 2;

/**
 * 新版维度表：场地回应拆成气候适应 + 公共空间；原环境策略停用。
 * 拆分后两项权重合计仍为原场地回应的 30%，停用的 20% 权重转至功能/结构。
 */
export const criteria: Criterion[] = [
  { id: "climate", name: "气候适应", description: "应对气候、水患、高温与极端天气的适应能力", weight: 15, max: 100 },
  { id: "public", name: "公共空间", description: "公共性、开放度与周边公共空间的融合", weight: 15, max: 100 },
  { id: "program", name: "功能组织", description: "空间组织、流线和公共性", weight: 35, max: 100 },
  { id: "structure", name: "结构与建造", description: "结构逻辑、材料和建造可行性", weight: 35, max: 100 }
];

/**
 * 旧数据按对应关系迁移：
 * - 未拆分的直接沿用（program / structure）
 * - 拆开的保留原分并记为待复核（site → climate + public），不拿默认分补上
 * - 停用的（sustain）仅留档，不计入新总分
 */
const MIGRATION: Record<string, string[] | null> = {
  site: ["climate", "public"],
  program: ["program"],
  structure: ["structure"],
  sustain: null
};

const seedSchemes: Scheme[] = [
  { id: "a", code: "S-01", title: "潮间带公共客厅", synopsis: "通过退台屋面把社区活动引向水岸，底层保留可被潮水短暂侵入的公共空间。", publicNo: "投递号 7182", status: "待评分" },
  { id: "b", code: "S-02", title: "风廊共生院", synopsis: "以双庭院组织低能耗社区中心，利用贯穿体量连接既有街巷。", publicNo: "投递号 6610", status: "待评分" },
  { id: "c", code: "S-03", title: "折线工坊", synopsis: "保留旧修理厂桁架，置入可拆装工坊和培训空间。", publicNo: "投递号 8024", status: "待评分" }
];

/** 第一轮（v1 维度表）已收集的评分，作为迁移演示的旧数据 */
function seedLegacyScores(): ScoreRecord[] {
  const at = new Date(Date.now() - 86400000).toISOString();
  const make = (judge: Viewer, values: Record<string, number>): ScoreRecord => ({
    id: `${judge}-a`, judge, schemeId: "a", values, comment: "", submitted: true, conflict: false,
    updatedAt: at, revision: 1, rubricVersion: 1, pendingReview: false, pendingReasons: []
  });
  return [
    make("评委-林策", { site: 85, program: 80, structure: 90, sustain: 70 }),
    make("评委-周筑", { site: 78, program: 88, structure: 82, sustain: 75 })
  ];
}

function emptyScore(judge: Viewer, schemeId: string): ScoreRecord {
  return {
    id: `${judge}-${schemeId}`, judge, schemeId,
    values: Object.fromEntries(criteria.map((item) => [item.id, 60])),
    comment: "", submitted: false, conflict: false,
    updatedAt: new Date().toISOString(), revision: 1, rubricVersion: RUBRIC_VERSION,
    pendingReview: false, pendingReasons: []
  };
}

/** 把任意历史记录迁移到当前维度表；返回迁移后的记录与是否发生过拆项 */
function migrateRecord(raw: Partial<ScoreRecord>): { record: ScoreRecord; split: boolean; changed: boolean } {
  const current: ScoreRecord = {
    id: raw.id ?? "", judge: raw.judge as Viewer, schemeId: raw.schemeId ?? "",
    values: { ...(raw.values ?? {}) }, comment: raw.comment ?? "", submitted: raw.submitted ?? false,
    conflict: raw.conflict ?? false, updatedAt: raw.updatedAt ?? new Date().toISOString(),
    revision: raw.revision ?? 1, rubricVersion: raw.rubricVersion ?? 1,
    pendingReview: raw.pendingReview ?? false, pendingReasons: [...(raw.pendingReasons ?? [])],
    legacyValues: raw.legacyValues ? { ...raw.legacyValues } : undefined
  };

  // 已是当前版本且无旧键遗留，直接沿用
  if (current.rubricVersion === RUBRIC_VERSION && !needsMigration(current.values)) {
    return { record: current, split: false, changed: false };
  }

  const values: Record<string, number> = {};
  const legacyValues: Record<string, number> = { ...(current.legacyValues ?? {}) };
  let split = false;

  for (const [oldId, newIds] of Object.entries(MIGRATION)) {
    const oldVal = current.values[oldId];
    if (oldVal == null) continue;
    if (newIds === null) { legacyValues[oldId] = oldVal; continue; }
    if (newIds.length === 1) { values[newIds[0]] = oldVal; continue; }
    // 拆项：保留原分（不拿默认分补），两项暂记同一原分，整份记为待复核
    newIds.forEach((id) => { values[id] = oldVal; });
    split = true;
  }

  const pendingReasons: PendingReason[] = split
    ? Array.from(new Set([...current.pendingReasons, "split-migration"]))
    : current.pendingReasons;

  const record: ScoreRecord = {
    ...current,
    values,
    legacyValues: Object.keys(legacyValues).length ? legacyValues : undefined,
    rubricVersion: RUBRIC_VERSION,
    pendingReview: split || current.pendingReview,
    pendingReasons
  };
  return { record, split, changed: true };
}

/** 记录是否仍含旧维度表的键（停用或已拆分项），需要迁移 */
function needsMigration(values: Record<string, number>): boolean {
  return Object.keys(values).some((key) => !criteria.some((criterion) => criterion.id === key));
}

function schemeCodeOf(schemeId: string): string {
  return seedSchemes.find((scheme) => scheme.id === schemeId)?.code ?? schemeId;
}

export const useReviewStore = defineStore("review", () => {
  const saved = localStorage.getItem(KEY);
  const initial = saved
    ? JSON.parse(saved)
    : { scores: seedLegacyScores(), events: [], published: false, schemeStatuses: {} };

  // 载入即迁移：旧版本维度表下的评分按对应关系换版
  let migratedAny = false;
  const scores = ref<ScoreRecord[]>(
    (initial.scores ?? []).map((raw: Partial<ScoreRecord>) => {
      const { record, changed } = migrateRecord(raw);
      if (changed) migratedAny = true;
      return record;
    })
  );
  // 维度版本一变，旧名次立即作废：若存在迁移，撤回已发布结果，待复核清空后重新锁定
  const published = ref<boolean>(migratedAny ? false : (initial.published ?? false));
  const schemes = ref<Scheme[]>(seedSchemes.map((scheme) => ({ ...scheme, status: initial.schemeStatuses?.[scheme.id] ?? scheme.status })));
  const events = ref<ReviewEvent[]>(initial.events ?? []);

  const viewer = ref<Viewer>("评委-林策");

  // 持久化容错：存不进时先保住对应关系与待处理评分，恢复后自动重试
  const persistError = ref(false);
  const pendingWrites = ref<PendingWrite[]>(initial.pendingWrites ?? []);
  let retryTimer: ReturnType<typeof setInterval> | null = null;

  const isOrganizer = computed(() => viewer.value === "主办方");
  const judge = computed(() => viewer.value.startsWith("评委-") ? viewer.value : null);
  const visibleScores = computed(() => isOrganizer.value ? scores.value : scores.value.filter((score) => score.judge === judge.value));

  /** 待复核评分数量（主办方锁定前必须为 0） */
  const pendingReviewCount = computed(() => scores.value.filter((score) => score.pendingReview).length);

  function log(action: string, detail: string) {
    events.value.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), actor: viewer.value, action, detail });
  }

  function snapshot() {
    return {
      scores: scores.value,
      events: events.value,
      published: published.value,
      pendingWrites: pendingWrites.value,
      schemeStatuses: Object.fromEntries(schemes.value.map((scheme) => [scheme.id, scheme.status]))
    };
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(snapshot()));
      persistError.value = false;
      if (retryTimer !== null) { clearInterval(retryTimer); retryTimer = null; }
    } catch {
      // 存不进：内存中的对应关系与待处理评分保留，稍后重试
      persistError.value = true;
      scheduleRetry();
    }
  }

  function scheduleRetry() {
    if (retryTimer !== null) return;
    retryTimer = setInterval(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(snapshot()));
        persistError.value = false;
        if (retryTimer !== null) { clearInterval(retryTimer); retryTimer = null; }
        log("持久化已恢复", "待处理评分已补写回本地");
      } catch {
        /* 仍不可写，继续等待恢复 */
      }
    }, 3000);
  }

  if (typeof window !== "undefined") {
    window.addEventListener("online", persist);
    window.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") persist(); });
    // 另一台设备写回后，本台据此合并更高修订号
    window.addEventListener("storage", (event) => {
      if (event.key !== KEY || !event.newValue) return;
      try {
        const incoming = JSON.parse(event.newValue);
        mergeIncoming(incoming);
      } catch { /* 忽略损坏的写入 */ }
    });
  }

  /** 跨设备合并：同 id 记录只保留修订号更高的写回 */
  function mergeIncoming(incoming: { scores?: ScoreRecord[]; published?: boolean; schemeStatuses?: Record<string, Scheme["status"]> }) {
    if (!Array.isArray(incoming.scores)) return;
    let merged = false;
    for (const remote of incoming.scores) {
      const local = scores.value.find((score) => score.id === remote.id);
      if (!local) { scores.value.push(remote); merged = true; continue; }
      if (remote.revision > local.revision) {
        Object.assign(local, remote);
        merged = true;
      }
    }
    if (typeof incoming.published === "boolean" && incoming.published !== published.value) {
      published.value = incoming.published;
      merged = true;
    }
    if (incoming.schemeStatuses) {
      for (const scheme of schemes.value) {
        const remoteStatus = incoming.schemeStatuses[scheme.id];
        if (remoteStatus && remoteStatus !== scheme.status) { scheme.status = remoteStatus; merged = true; }
      }
    }
    if (merged) persist();
  }

  function record(schemeId: string) {
    const currentJudge = judge.value;
    if (!currentJudge) return null;
    let item = scores.value.find((score) => score.judge === currentJudge && score.schemeId === schemeId);
    if (!item) {
      item = emptyScore(currentJudge, schemeId);
      scores.value.push(item);
    }
    return item;
  }

  /** 晚到写回进待复核：保住对应关系与内容，不覆盖新修订号 */
  function rejectAsPending(item: ScoreRecord, kind: PendingWrite["reason"], baseRevision: number, values: Record<string, number>, comment: string, conflict: boolean) {
    item.pendingReview = true;
    if (!item.pendingReasons.includes("stale-revision")) item.pendingReasons.push("stale-revision");
    pendingWrites.value.push({
      id: crypto.randomUUID(), judge: item.judge, schemeId: item.schemeId,
      values: { ...values }, comment, conflict, baseRevision,
      at: new Date().toISOString(), reason: kind
    });
    log("晚到写回进待复核", `${schemeCodeOf(item.schemeId)}：修订号 ${baseRevision} 已落后于 ${item.revision}`);
  }

  function saveDraft(schemeId: string, values: Record<string, number>, comment: string, conflict: boolean, baseRevision?: number) {
    const item = record(schemeId);
    if (!item || item.submitted) return { ok: false as const };
    const base = baseRevision ?? item.revision;
    if (base < item.revision) { rejectAsPending(item, "stale-revision", base, values, comment, conflict); persist(); return { ok: false as const, reason: "stale" as const }; }
    item.values = { ...values };
    item.comment = comment;
    item.conflict = conflict;
    item.revision += 1;
    item.updatedAt = new Date().toISOString();
    const scheme = schemes.value.find((entry) => entry.id === schemeId);
    if (scheme && scheme.status === "待评分") scheme.status = "评分中";
    log("保存评分草稿", `${scheme?.code ?? schemeId}${conflict ? "，声明利益冲突" : ""}`);
    persist();
    return { ok: true as const, revision: item.revision };
  }

  function submit(schemeId: string, values: Record<string, number>, comment: string, conflict: boolean, baseRevision?: number) {
    const item = record(schemeId);
    if (!item) return { ok: false as const };
    const base = baseRevision ?? item.revision;
    // 乐观并发：只有最新修订号能写回，晚到的进待复核
    if (base < item.revision) {
      rejectAsPending(item, "stale-revision", base, values, comment, conflict);
      persist();
      return { ok: false as const, reason: "stale" as const };
    }
    item.values = { ...values };
    item.comment = comment;
    item.conflict = conflict;
    item.submitted = true;
    item.revision += 1;
    item.rubricVersion = RUBRIC_VERSION;
    item.pendingReview = false;
    item.pendingReasons = [];
    // 已重新确认：该记录的晚到写回队列结清
    pendingWrites.value = pendingWrites.value.filter((write) => !(write.judge === item.judge && write.schemeId === item.schemeId));
    item.updatedAt = new Date().toISOString();
    const scheme = schemes.value.find((entry) => entry.id === schemeId);
    if (scheme) scheme.status = allSubmittedFor(schemeId) ? "已提交" : "评分中";
    log("提交评分", `${scheme?.code ?? schemeId}（修订号 ${item.revision}）`);
    persist();
    return { ok: true as const, revision: item.revision };
  }

  function recalled(schemeId: string) {
    const item = record(schemeId);
    if (!item || published.value) return;
    item.submitted = false;
    item.revision += 1;
    log("退回评分修改", schemes.value.find((scheme) => scheme.id === schemeId)?.code ?? schemeId);
    persist();
  }

  function allSubmittedFor(schemeId: string) {
    return judges.every((name) => scores.value.some(
      (score) => score.judge === name && score.schemeId === schemeId && score.submitted && !score.pendingReview
    ));
  }

  /** 有效评分：已提交、无利益冲突、非待复核、且为当前维度表版本 */
  function validRowsFor(schemeId: string) {
    return scores.value.filter((score) =>
      score.schemeId === schemeId &&
      score.submitted &&
      !score.conflict &&
      !score.pendingReview &&
      score.rubricVersion === RUBRIC_VERSION
    );
  }

  const ranking = computed(() => {
    if (!published.value) return [];
    return schemes.value.map((scheme) => {
      const rows = validRowsFor(scheme.id);
      const total = rows.length
        ? rows.reduce((sum, row) => sum + criteria.reduce((value, criterion) => value + row.values[criterion.id] * criterion.weight / 100, 0), 0) / rows.length
        : 0;
      return {
        ...scheme,
        total: Number(total.toFixed(2)),
        judgeCount: rows.length,
        pending: scores.value.filter((score) => score.schemeId === scheme.id && score.pendingReview).length,
        conflicts: scores.value.filter((score) => score.schemeId === scheme.id && score.conflict).length
      };
    }).sort((a, b) => b.total - a.total);
  });

  function publish() {
    // 还有待复核项时不能锁定
    if (pendingReviewCount.value > 0) return { ok: false as const, reason: "pending" as const };
    if (!schemes.value.every((scheme) => allSubmittedFor(scheme.id))) return { ok: false as const, reason: "incomplete" as const };
    published.value = true;
    schemes.value.forEach((scheme) => { scheme.status = "已锁定"; });
    log("锁定并发布结果", `${schemes.value.length} 个匿名方案`);
    persist();
    return { ok: true as const };
  }

  function setViewer(value: Viewer) { viewer.value = value; }

  /** 演示：另一台设备已先写回（修订号 +1），本台随后提交即为晚到 */
  function simulateRemoteWrite(schemeId: string) {
    const currentJudge = judge.value;
    if (!currentJudge) return;
    const item = record(schemeId);
    if (!item) return;
    item.revision += 1;
    item.updatedAt = new Date().toISOString();
    log("另一台设备已写回", `${schemeCodeOf(schemeId)}：修订号 ${item.revision} 领先`);
    persist();
  }

  /** 演示：模拟本地存储故障，验证存不进时保住待处理评分、恢复后重试 */
  function simulateStorageFailure() {
    persistError.value = true;
    scheduleRetry();
    log("持久化故障", "本地存储不可写，待处理评分暂存内存");
  }

  watch([scores, events, published, schemes], () => {
    if (!persistError.value) persist();
  }, { deep: true });

  return {
    viewer, schemes, criteria, judges, scores, events, published,
    ranking, visibleScores, isOrganizer, judge, pendingReviewCount,
    persistError, pendingWrites,
    setViewer, record, saveDraft, submit, recalled, publish, allSubmittedFor, validRowsFor,
    simulateRemoteWrite, simulateStorageFailure, retryPersist: persist
  };
});
