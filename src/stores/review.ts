import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type {
  MigrationLog,
  OutboxItem,
  PendingSubmission,
  ReviewEvent,
  Scheme,
  ScoreRecord,
  Viewer
} from "../types";
import { criterionMigrations, criterionVersions, findMigration, findVersion } from "../criteria";

const KEY = "pair-wise-yf-48/review/v2";
const LEGACY_KEY = "pair-wise-yf-48/review";
const judges: Viewer[] = ["评委-林策", "评委-周筑"];

const seedSchemes: Scheme[] = [
  { id: "a", code: "S-01", title: "潮间带公共客厅", synopsis: "通过退台屋面把社区活动引向水岸，底层保留可被潮水短暂侵入的公共空间。", publicNo: "投递号 7182", status: "待评分" },
  { id: "b", code: "S-02", title: "风廊共生院", synopsis: "以双庭院组织低能耗社区中心，利用贯穿体量连接既有街巷。", publicNo: "投递号 6610", status: "待评分" },
  { id: "c", code: "S-03", title: "折线工坊", synopsis: "保留旧修理厂桁架，置入可拆装工坊和培训空间。", publicNo: "投递号 8024", status: "待评分" }
];

/** 首次进入时预置的 v1 旧数据，用于演示换版迁移（旧版评分表下的评分） */
function seedV1Scores(): ScoreRecord[] {
  const now = new Date().toISOString();
  const base = (judge: Viewer, schemeId: string): ScoreRecord => ({
    id: `${judge}-${schemeId}`,
    judge,
    schemeId,
    values: { site: 60, program: 60, structure: 60, sustain: 60 },
    pendingCells: [],
    comment: "",
    submitted: false,
    conflict: false,
    version: 1,
    revision: 0,
    updatedAt: now
  });
  const linA = base("评委-林策", "a");
  Object.assign(linA.values, { site: 78, program: 72, structure: 70, sustain: 68 });
  linA.comment = "水岸公共性处理细腻，退台与潮水的关系成立，结构表达稍显常规。";
  linA.submitted = true;
  linA.revision = 3;
  const zhouA = base("评委-周筑", "a");
  Object.assign(zhouA.values, { site: 65, program: 68, structure: 74, sustain: 60 });
  zhouA.comment = "公共空间可达性好；气候应对主要靠形体，构造细节还要再核。";
  zhouA.submitted = true;
  zhouA.revision = 2;
  const linB = base("评委-林策", "b");
  Object.assign(linB.values, { site: 58, program: 62, structure: 55, sustain: 70 });
  linB.comment = "风廊概念有潜力，结构与院落交接处还需推敲。";
  linB.revision = 1;
  return [linA, zhouA, linB];
}

interface PersistShape {
  dimensionVersion: number;
  scores: ScoreRecord[];
  pendingSubmissions: PendingSubmission[];
  events: ReviewEvent[];
  published: boolean;
  migrationLogs: MigrationLog[];
  outbox: OutboxItem[];
}

function emptyScore(judge: Viewer, schemeId: string, version: number): ScoreRecord {
  const def = findVersion(version);
  return {
    id: `${judge}-${schemeId}`,
    judge,
    schemeId,
    // 仅用于评委新建评分；迁移数据绝不走这里的默认分
    values: Object.fromEntries(def.criteria.map((item) => [item.id, 60])),
    pendingCells: [],
    comment: "",
    submitted: false,
    conflict: false,
    version,
    revision: 0,
    updatedAt: new Date().toISOString()
  };
}

/** 读入旧版应用（无版本字段）的数据，统一视为 v1 */
function normalizeLegacy(raw: any): ScoreRecord[] {
  return Array.isArray(raw?.scores)
    ? raw.scores.map((item: ScoreRecord) => ({
        ...item,
        pendingCells: item.pendingCells ?? [],
        version: 1,
        revision: item.revision ?? (item.submitted ? 1 : 0)
      }))
    : [];
}

function loadInitial(): PersistShape {
  let parsed: any = null;
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const raw = storage.getItem(KEY);
      if (raw) { parsed = JSON.parse(raw); break; }
    } catch { /* 该存储不可用，继续尝试下一个 */ }
  }
  if (parsed && typeof parsed.dimensionVersion === "number") {
    return {
      dimensionVersion: parsed.dimensionVersion,
      scores: parsed.scores ?? [],
      pendingSubmissions: parsed.pendingSubmissions ?? [],
      events: parsed.events ?? [],
      published: parsed.published ?? false,
      migrationLogs: parsed.migrationLogs ?? [],
      outbox: parsed.outbox ?? []
    };
  }
  // 兼容旧版应用落盘的数据
  let legacy: any = null;
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw) legacy = JSON.parse(raw);
  } catch { /* ignore */ }
  if (legacy && Array.isArray(legacy.scores) && legacy.scores.length) {
    return {
      dimensionVersion: 1,
      scores: normalizeLegacy(legacy),
      pendingSubmissions: [],
      events: legacy.events ?? [],
      published: false,
      migrationLogs: [],
      outbox: []
    };
  }
  return {
    dimensionVersion: 1,
    scores: seedV1Scores(),
    pendingSubmissions: [],
    events: [],
    published: false,
    migrationLogs: [],
    outbox: []
  };
}

/** 按迁移链把旧版本分值搬到新版本，返回新分值与拆分待复核维度 */
function carryValues(values: Record<string, number>, fromVersion: number, toVersion: number) {
  let current = fromVersion;
  let carried = { ...values };
  const splitCells: string[] = [];
  while (current < toVersion) {
    const migration = findMigration(current, current + 1);
    if (!migration) break;
    const target = findVersion(current + 1);
    const next: Record<string, number> = {};
    for (const criterion of target.criteria) {
      const sourceId = migration.map[criterion.id];
      if (sourceId != null && carried[sourceId] != null) {
        next[criterion.id] = carried[sourceId];
        if (migration.split.includes(criterion.id) && !splitCells.includes(criterion.id)) {
          splitCells.push(criterion.id);
        }
      }
      // 无来源（如停用维度）不填，绝不用默认分补齐
    }
    carried = next;
    current += 1;
  }
  return { values: carried, splitCells };
}

export const useReviewStore = defineStore("review", () => {
  const initial = loadInitial();
  const viewer = ref<Viewer>("评委-林策");
  const schemes = ref<Scheme[]>(seedSchemes.map((scheme) => ({ ...scheme })));
  const dimensionVersion = ref<number>(initial.dimensionVersion);
  const scores = ref<ScoreRecord[]>(initial.scores);
  const pendingSubmissions = ref<PendingSubmission[]>(initial.pendingSubmissions);
  const events = ref<ReviewEvent[]>(initial.events);
  const published = ref<boolean>(initial.published);
  const migrationLogs = ref<MigrationLog[]>(initial.migrationLogs);
  const outbox = ref<OutboxItem[]>(initial.outbox);
  /** 模拟两台设备 / 存储暂时不可写；恢复后自动重试 outbox */
  const simulatedOffline = ref(false);

  const criteria = computed(() => findVersion(dimensionVersion.value).criteria);
  const versionLabel = computed(() => findVersion(dimensionVersion.value).label);
  const hasNextVersion = computed(() => criterionVersions.some((item) => item.version === dimensionVersion.value + 1));

  const isOrganizer = computed(() => viewer.value === "主办方");
  const judge = computed(() => (viewer.value.startsWith("评委-") ? viewer.value : null));
  const visibleScores = computed(() =>
    isOrganizer.value ? scores.value : scores.value.filter((score) => score.judge === judge.value)
  );

  function log(action: string, detail: string) {
    events.value.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), actor: viewer.value, action, detail });
  }

  // ---------- 落盘：失败先保住对应关系与待处理评分，恢复后重试 ----------

  function snapshot(): PersistShape {
    return {
      dimensionVersion: dimensionVersion.value,
      scores: scores.value,
      pendingSubmissions: pendingSubmissions.value,
      events: events.value,
      published: published.value,
      migrationLogs: migrationLogs.value,
      outbox: outbox.value
    };
  }

  function queueOutbox(kind: string, detail: string) {
    const exists = outbox.value.some((item) => item.kind === kind && item.detail === detail);
    if (!exists) outbox.value.push({ id: crypto.randomUUID(), kind, detail, at: new Date().toISOString() });
  }

  /** 写回；失败时内存状态（含迁移对应关系、待复核评分）不丢，登记 outbox 等待重试 */
  function persist(kind: string, detail: string): boolean {
    if (simulatedOffline.value) {
      queueOutbox(kind, detail);
      return false;
    }
    const payload = JSON.stringify(snapshot());
    try {
      localStorage.setItem(KEY, payload);
      outbox.value = [];
      return true;
    } catch {
      // localStorage 不可用时降级到 sessionStorage，仍算写回成功
      try {
        sessionStorage.setItem(KEY, payload);
        outbox.value = [];
        return true;
      } catch {
        queueOutbox(kind, detail);
        return false;
      }
    }
  }

  function retryPersist(): boolean {
    if (simulatedOffline.value) return false;
    try {
      localStorage.setItem(KEY, JSON.stringify(snapshot()));
      outbox.value = [];
      return true;
    } catch {
      return outbox.value.length > 0; // 仍不可写：待处理项继续保留在内存
    }
  }

  function setSimulatedOffline(value: boolean) {
    simulatedOffline.value = value;
    if (!value) retryPersist(); // 恢复后立即重试
  }

  // ---------- 评分记录 ----------

  function record(schemeId: string): ScoreRecord | null {
    const currentJudge = judge.value;
    if (!currentJudge) return null;
    let item = scores.value.find((score) => score.judge === currentJudge && score.schemeId === schemeId);
    if (!item) {
      item = emptyScore(currentJudge, schemeId, dimensionVersion.value);
      scores.value.push(item);
    }
    return item;
  }

  function openPendingFor(schemeId: string) {
    return pendingSubmissions.value.some((item) => item.schemeId === schemeId && item.status === "待复核");
  }

  function isValidScore(score: ScoreRecord) {
    return score.submitted
      && !score.conflict
      && score.pendingCells.length === 0
      && score.version === dimensionVersion.value;
  }

  function recomputeSchemeStatuses() {
    for (const scheme of schemes.value) {
      if (published.value) { scheme.status = "已锁定"; continue; }
      const rows = scores.value.filter((score) => score.schemeId === scheme.id);
      if (judges.every((name) => rows.some((score) => score.judge === name && isValidScore(score)))) {
        scheme.status = "已提交";
      } else if (rows.length || openPendingFor(scheme.id)) {
        scheme.status = "评分中";
      } else {
        scheme.status = "待评分";
      }
    }
  }

  /** 修订号乐观锁：不是最新修订号的写回进待复核，不覆盖现有评分 */
  function writeScore(
    item: ScoreRecord,
    values: Record<string, number>,
    comment: string,
    conflict: boolean,
    submitted: boolean,
    expectedRevision: number,
    kind: "晚到提交" | "晚到草稿"
  ): boolean {
    const currentRevision = item.revision;
    if (item.version !== dimensionVersion.value || expectedRevision !== currentRevision) {
      pendingSubmissions.value.unshift({
        id: crypto.randomUUID(),
        judge: item.judge,
        schemeId: item.schemeId,
        values: { ...values },
        comment,
        conflict,
        kind,
        baseVersion: item.version,
        baseRevision: expectedRevision,
        currentRevision,
        reason: item.version !== dimensionVersion.value
          ? `评分表已升级到 v${dimensionVersion.value}，该写回基于 v${item.version}`
          : `携带修订号 r${expectedRevision}，现行修订号 r${currentRevision}`,
        createdAt: new Date().toISOString(),
        status: "待复核"
      });
      const code = schemes.value.find((scheme) => scheme.id === item.schemeId)?.code ?? item.schemeId;
      log(kind, `${code}（${item.judge}）：${expectedRevision !== currentRevision ? `修订号 r${expectedRevision} 已过期，现行为 r${currentRevision}` : "维度版本已变更"}，转入待复核`);
      persist("pending-submission", `${kind}-${item.schemeId}-${item.judge}`);
      recomputeSchemeStatuses();
      return false;
    }
    item.values = { ...values };
    item.comment = comment;
    item.conflict = conflict;
    item.submitted = submitted;
    item.revision += 1;
    item.updatedAt = new Date().toISOString();
    // 同一评委重新写回后，此前积压的晚到项自动作废
    for (const pending of pendingSubmissions.value) {
      if (pending.judge === item.judge && pending.schemeId === item.schemeId && pending.status === "待复核") {
        pending.status = "已作废";
      }
    }
    recomputeSchemeStatuses();
    return true;
  }

  function saveDraft(schemeId: string, values: Record<string, number>, comment: string, conflict: boolean, expectedRevision: number) {
    const item = record(schemeId);
    if (!item || (item.submitted && !item.pendingCells.length)) return { ok: false, stored: false };
    const ok = writeScore(item, values, comment, conflict, false, expectedRevision, "晚到草稿");
    const code = schemes.value.find((scheme) => scheme.id === schemeId)?.code ?? schemeId;
    const stored = persist("draft", `${code}-${item.judge}`);
    if (ok) {
      log("保存评分草稿", `${code}${conflict ? "，声明利益冲突" : ""}（r${item.revision}）`);
    }
    return { ok, stored };
  }

  function submit(schemeId: string, values: Record<string, number>, comment: string, conflict: boolean, expectedRevision: number) {
    const item = record(schemeId);
    if (!item) return { ok: false, stored: false };
    const ok = writeScore(item, values, comment, conflict, true, expectedRevision, "晚到提交");
    const code = schemes.value.find((scheme) => scheme.id === schemeId)?.code ?? schemeId;
    const stored = persist("submit", `${code}-${item.judge}`);
    if (ok) log("提交评分", `${code}（r${item.revision}）`);
    return { ok, stored };
  }

  /** 评委确认拆分维度：沿用原分（不给 newValue）或改分（给 newValue），确认后退出待复核 */
  function resolvePendingCell(schemeId: string, criterionId: string, newValue?: number) {
    const item = record(schemeId);
    if (!item) return;
    if (!item.pendingCells.includes(criterionId)) return;
    item.pendingCells = item.pendingCells.filter((id) => id !== criterionId);
    if (newValue != null) item.values[criterionId] = newValue;
    item.revision += 1;
    item.updatedAt = new Date().toISOString();
    recomputeSchemeStatuses();
    const criterion = criteria.value.find((entry) => entry.id === criterionId);
    const code = schemes.value.find((scheme) => scheme.id === schemeId)?.code ?? schemeId;
    persist("resolve-cell", `${code}-${criterionId}`);
    log("复核拆分维度", `${code}「${criterion?.name ?? criterionId}」${newValue != null ? `改分为 ${newValue}` : "沿用迁移原分"}（r${item.revision}）`);
  }

  /** 处理晚到评分：采纳（按对应关系搬到当前版本，拆分项仍需复核）或丢弃 */
  function adjudicatePending(pendingId: string, decision: "adopt" | "discard") {
    const pending = pendingSubmissions.value.find((item) => item.id === pendingId);
    if (!pending || pending.status !== "待复核") return;
    const code = schemes.value.find((scheme) => scheme.id === pending.schemeId)?.code ?? pending.schemeId;
    if (decision === "discard") {
      pending.status = "已丢弃";
      log("丢弃晚到评分", `${code}（${pending.judge}，${pending.kind}，r${pending.baseRevision}）`);
    } else {
      let item = scores.value.find((score) => score.judge === pending.judge && score.schemeId === pending.schemeId);
      if (!item) {
        item = emptyScore(pending.judge, pending.schemeId, dimensionVersion.value);
        scores.value.push(item);
      }
      const { values, splitCells } = carryValues(pending.values, pending.baseVersion, dimensionVersion.value);
      // 只写入当前版本仍存在的维度；无对应关系的值不补默认分
      item.values = { ...values };
      item.pendingCells = splitCells;
      item.comment = pending.comment;
      item.conflict = pending.conflict;
      item.version = dimensionVersion.value;
      item.submitted = pending.kind === "晚到提交";
      item.revision += 1;
      item.updatedAt = new Date().toISOString();
      pending.status = "已采纳";
      log("采纳晚到评分", `${code}（${pending.judge}，r${pending.baseRevision} → r${item.revision}）${splitCells.length ? `，${splitCells.length} 个拆分维度转待复核` : ""}`);
    }
    recomputeSchemeStatuses();
    persist("adjudicate-pending", `${code}-${pending.judge}`);
  }

  function recalled(schemeId: string) {
    const item = record(schemeId);
    if (!item || published.value) return;
    item.submitted = false;
    item.revision += 1;
    recomputeSchemeStatuses();
    const code = schemes.value.find((scheme) => scheme.id === schemeId)?.code ?? schemeId;
    persist("recall", `${code}-${item.judge}`);
    log("退回评分修改", `${code}（r${item.revision}）`);
  }

  function allSubmittedFor(schemeId: string) {
    const rows = scores.value.filter((score) => score.schemeId === schemeId);
    return judges.every((name) => rows.some((score) => score.judge === name && isValidScore(score)));
  }

  function validJudgeCount(schemeId: string) {
    return scores.value.filter((score) => score.schemeId === schemeId && isValidScore(score)).length;
  }

  // ---------- 评分表换版 ----------

  /** 维度版本升级：按对应关系迁移旧分；拆分项保留原分记待复核；停用维度不补分；旧名次立即作废 */
  function upgradeCriteria(): { ok: boolean; stored: boolean } {
    const from = dimensionVersion.value;
    const target = criterionVersions.find((item) => item.version === from + 1);
    const migration = findMigration(from, from + 1);
    if (!target || !migration) return { ok: false, stored: true };

    let carriedScores = 0;
    let splitCells = 0;
    for (const score of scores.value) {
      if (score.version !== from) continue;
      const oldValues = { ...score.values };
      const { values, splitCells: cells } = carryValues(oldValues, from, target.version);
      score.legacyValues = oldValues;
      score.values = values; // 未拆分的直接沿用；拆分的保留原分；停用维度不迁移
      score.pendingCells = cells;
      splitCells += cells.length;
      score.version = target.version;
      score.revision += 1; // 旧修订号随版本一并作废，设备上的晚到写回将进待复核
      score.submitted = false; // 旧提交状态、旧名次、有效评委数全部作废，复核后重新提交
      score.updatedAt = new Date().toISOString();
      carriedScores += 1;
    }
    dimensionVersion.value = target.version;
    published.value = false;
    recomputeSchemeStatuses();
    migrationLogs.value.unshift({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      from,
      to: target.version,
      carriedScores,
      splitCells,
      retired: migration.retired.map((item) => item.name)
    });
    const stored = persist("criteria-upgrade", `v${from}-v${target.version}`);
    log(
      "评分表换版",
      `v${from} → v${target.version}：「场地回应」拆为「气候适应」「公共空间」，${carriedScores} 条旧评分按对应关系迁移，${splitCells} 个拆分项保留原分待复核；「${migration.retired.map((item) => item.name).join("、")}」停用，不以默认分补齐；旧名次与有效评委数作废重算`
    );
    return { ok: true, stored };
  }

  // ---------- 排名与锁定 ----------

  const pendingCellCount = computed(() =>
    scores.value.reduce((sum, score) => sum + score.pendingCells.length, 0)
  );

  const openPendingSubmissions = computed(() =>
    pendingSubmissions.value.filter((item) => item.status === "待复核")
  );

  const myPendingSubmissions = computed(() =>
    openPendingSubmissions.value.filter((item) => item.judge === judge.value)
  );

  /** 维度版本一变即按当前版本重算；待复核评分（含拆分单元格、晚到写回）不参加排名 */
  const ranking = computed(() => {
    if (!published.value) return [];
    return schemes.value.map((scheme) => {
      const rows = scores.value.filter((score) => score.schemeId === scheme.id && isValidScore(score));
      const total = rows.length
        ? rows.reduce((sum, row) =>
            sum + criteria.value.reduce((value, criterion) => value + (row.values[criterion.id] ?? 0) * criterion.weight / 100, 0), 0) / rows.length
        : 0;
      return {
        ...scheme,
        total: Number(total.toFixed(2)),
        judgeCount: rows.length,
        conflicts: scores.value.filter((score) => score.schemeId === scheme.id && score.conflict).length
      };
    }).sort((a, b) => b.total - a.total);
  });

  /** 只要还有待复核项（或未落盘写回）就不能锁定 */
  const lockBlockers = computed<string[]>(() => {
    const blockers: string[] = [];
    if (pendingCellCount.value > 0) blockers.push(`有 ${pendingCellCount.value} 个拆分维度单元格待复核`);
    if (openPendingSubmissions.value.length > 0) blockers.push(`有 ${openPendingSubmissions.value.length} 条晚到写回待复核`);
    if (outbox.value.length > 0) blockers.push(`有 ${outbox.value.length} 条写回未落盘，待存储恢复后重试`);
    for (const scheme of schemes.value) {
      if (!allSubmittedFor(scheme.id)) {
        blockers.push(`${scheme.code} 有效评委未齐（${validJudgeCount(scheme.id)} / ${judges.length}，待复核不计）`);
      }
    }
    return blockers;
  });

  function publish() {
    if (published.value || lockBlockers.value.length) return false;
    published.value = true;
    recomputeSchemeStatuses();
    persist("publish", `${schemes.value.length}-schemes`);
    log("锁定并发布结果", `${schemes.value.length} 个匿名方案 · ${versionLabel.value}`);
    return true;
  }

  function setViewer(value: Viewer) { viewer.value = value; }

  recomputeSchemeStatuses();

  return {
    viewer, schemes, judges,
    criteria, dimensionVersion, versionLabel, hasNextVersion,
    scores, pendingSubmissions, events, published, migrationLogs, outbox, simulatedOffline,
    ranking, visibleScores, isOrganizer, judge,
    pendingCellCount, openPendingSubmissions, myPendingSubmissions, lockBlockers,
    setViewer, record, saveDraft, submit, recalled, resolvePendingCell, adjudicatePending,
    allSubmittedFor, validJudgeCount, upgradeCriteria, publish,
    setSimulatedOffline, retryPersist
  };
});
