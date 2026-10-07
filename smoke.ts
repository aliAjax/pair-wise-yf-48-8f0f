import { setActivePinia, createPinia } from "pinia";
import { useReviewStore } from "./src/stores/review";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (!cond) { failures += 1; console.error(`FAIL: ${name} ${detail}`); }
  else console.log(`ok  : ${name}`);
}

// localStorage / sessionStorage shim（内存版）
function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k); },
    setItem: (k, v) => { map.set(k, String(v)); }
  } as Storage;
}
(globalThis as any).localStorage = memStorage();
(globalThis as any).sessionStorage = memStorage();

setActivePinia(createPinia());
const store = useReviewStore();

// ---------- 初始：v1 预置数据 ----------
check("初始为 v1 评分表", store.dimensionVersion === 1);
check("预置 3 条 v1 评分", store.scores.length === 3);
const linA_v1 = store.scores.find((s) => s.judge === "评委-林策" && s.schemeId === "a")!;
check("v1 场地回应旧分 78", linA_v1.values.site === 78 && linA_v1.submitted);
check("a 方案有效评委 2（v1 已提交两条）", store.validJudgeCount("a") === 2, `got ${store.validJudgeCount("a")}`);

// ---------- 修订号并发：只有最新修订号能写回 ----------
store.setViewer("评委-林策");
const revBefore = linA_v1.revision;
const formA = { ...linA_v1.values };
// 设备 A：带最新修订号正常提交
const r1 = store.submit("a", formA, linA_v1.comment, false, revBefore);
check("携带最新修订号写回成功", r1.ok && r1.stored);
// 设备 B：仍带旧修订号
const r2 = store.submit("a", { ...formA, site: 50 }, "第二台设备的晚到评分", false, revBefore);
check("旧修订号写回失败并进待复核", !r2.ok && store.openPendingSubmissions.length === 1, `pending=${store.openPendingSubmissions.length}`);
check("晚到写回不覆盖现值", store.record("a")!.values.site === 78);
check("存在待复核时不能锁定", store.publish() === false && store.lockBlockers.some((b) => b.includes("晚到写回")));

// 采纳晚到写回（v1→v1，无拆分）
const lateId = store.openPendingSubmissions[0].id;
store.adjudicatePending(lateId, "adopt");
check("采纳后待复核清零", store.openPendingSubmissions.length === 0);
check("采纳以采纳时现值写回且修订号推进", store.record("a")!.values.site === 50 && store.record("a")!.revision === revBefore + 2);
// 恢复现场到 78 便于后续迁移
store.submit("a", { ...linA_v1.values, site: 78 }, linA_v1.comment, false, store.record("a")!.revision);

// ---------- 换版迁移 ----------
const up = store.upgradeCriteria();
check("换版成功并落盘", up.ok && up.stored);
check("版本变为 v2", store.dimensionVersion === 2);
check("场地回应拆为两项", store.criteria.some((c) => c.id === "climate") && store.criteria.some((c) => c.id === "public-space"));
check("环境策略维度停用", !store.criteria.some((c) => c.id === "sustain"));
const linA_v2 = store.record("a")!;
check("拆分项保留原分 78", linA_v2.values.climate === 78 && linA_v2.values["public-space"] === 78);
check("拆分项标记待复核", linA_v2.pendingCells.length === 2);
check("停用维度不以默认分补齐", linA_v2.values.sustain === undefined && linA_v2.values.climate === 78);
check("未拆分维度直接沿用原分", linA_v2.values.program === 72 && linA_v2.values.structure === 70);
check("旧分留档 legacyValues", linA_v2.legacyValues?.sustain === 68);
check("换版后旧提交状态作废", linA_v2.submitted === false);
check("迁移日志登记", store.migrationLogs.length === 1 && store.migrationLogs[0].splitCells > 0);
check("有效评委数立即作废重算为 0", store.validJudgeCount("a") === 0, `got ${store.validJudgeCount("a")}`);
check("方案状态回退为评分中", store.schemes.find((s) => s.id === "a")!.status === "评分中");
check("待复核单元格不参加排名（未发布为空）", store.ranking.length === 0);
check("有待复核项不能锁定", store.publish() === false && store.lockBlockers.some((b) => b.includes("拆分维度")));

// ---------- 复核拆分项：沿用原分 / 改分 ----------
store.resolvePendingCell("a", "climate"); // 沿用原分 78
check("沿用原分后退出待复核", store.record("a")!.pendingCells.length === 1 && store.record("a")!.values.climate === 78);
store.resolvePendingCell("a", "public-space", 88); // 改分
check("改分后确认", store.record("a")!.values["public-space"] === 88 && store.record("a")!.pendingCells.length === 0);

// 周筑复核并提交（保持离线场景前后）
store.setViewer("评委-周筑");
const zhouA = store.record("a")!;
check("周筑 a 方案拆分项同样待复核", zhouA.pendingCells.length === 2);
store.setSimulatedOffline(true);
store.resolvePendingCell("a", "climate");
store.resolvePendingCell("a", "public-space");
const offSubmit = store.submit("a", zhouA.values, zhouA.comment || "复核后重新提交", false, zhouA.revision);
check("存储不可写时评分保留在内存", !offSubmit.stored && offSubmit.ok);
check("outbox 有待处理写回", store.outbox.length > 0);
check("未落盘时不能锁定", store.lockBlockers.some((b) => b.includes("未落盘")));
store.setSimulatedOffline(false);
check("恢复后自动重试落盘", store.outbox.length === 0);

// 林策重新提交
store.setViewer("评委-林策");
const linRec = store.record("a")!;
const linSubmit = store.submit("a", linRec.values, linRec.comment || "复核后重新提交", false, linRec.revision);
check("林策复核后重新提交", linSubmit.ok);
check("a 方案有效评委恢复为 2", store.validJudgeCount("a") === 2, `got ${store.validJudgeCount("a")}`);

// 其余方案仍有待复核/未齐：a 齐备但整体不能锁
check("a 方案齐备", store.allSubmittedFor("a"));
check("b/c 未齐不能锁定整体", store.publish() === false);

// ---------- 基于旧版本的晚到写回：版本不符也进待复核 ----------
store.pendingSubmissions = store.pendingSubmissions.filter((p) => p.status !== "待复核");
const oldLateRevision = store.record("a")!.revision - 1;
// 直接构造一个携带过期修订号的晚到写回
store.submit("a", linRec.values, "旧版本设备", false, Math.max(oldLateRevision, 0));
check("修订号过期仍进待复核", store.openPendingSubmissions.length === 1);
const p = store.openPendingSubmissions[0];
// 丢弃路径
store.adjudicatePending(p.id, "discard");
check("丢弃后清零", store.openPendingSubmissions.length === 0);

// ---------- b 方案复核提交、c 无评分：补齐后锁定 ----------
store.setViewer("评委-林策");
const linB = store.record("b")!;
store.resolvePendingCell("b", "climate");
store.resolvePendingCell("b", "public-space");
store.submit("b", linB.values, linB.comment || "b 复核提交", false, linB.revision);
store.setViewer("评委-周筑");
const zhouB = store.record("b")!;
store.resolvePendingCell("b", "climate", 70);
store.resolvePendingCell("b", "public-space", 72);
store.submit("b", zhouB.values, "b 周筑复核提交", false, zhouB.revision);
const zhouC = store.record("c")!;
store.submit("c", zhouC.values, "c 周筑提交", false, zhouC.revision);
store.setViewer("评委-林策");
const linC = store.record("c")!;
store.submit("c", linC.values, "c 林策提交", false, linC.revision);

check("所有方案有效评委齐备", store.schemes.every((s) => store.allSubmittedFor(s.id)), store.lockBlockers.join("; "));
check("待复核全部清零", store.pendingCellCount === 0 && store.openPendingSubmissions.length === 0);
check("锁定成功", store.publish() === true);
check("锁定后生成按 v2 权重的排名", store.ranking.length === 3 && store.ranking.every((r) => r.judgeCount === 2));
check("方案状态为已锁定", store.schemes.every((s) => s.status === "已锁定"));
check("已锁定不能再次发布", store.publish() === false);

// ---------- 持久化往返 ----------
const raw = localStorage.getItem("pair-wise-yf-48/review/v2");
check("v2 数据已落盘", !!raw && raw.includes('"dimensionVersion":2'));

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
if (failures) process.exit(1);
