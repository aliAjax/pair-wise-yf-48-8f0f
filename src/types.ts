export type Viewer = "评委-林策" | "评委-周筑" | "主办方";
export type SchemeStatus = "待评分" | "评分中" | "已提交" | "已锁定";

export interface Scheme {
  id: string;
  code: string;
  title: string;
  synopsis: string;
  publicNo: string;
  status: SchemeStatus;
}

/** 单个维度定义（随评分表版本一起发布） */
export interface CriterionDef {
  id: string;
  name: string;
  description: string;
  weight: number;
  max: number;
}

/** 一版评分表 */
export interface CriterionVersion {
  version: number;
  label: string;
  criteria: CriterionDef[];
}

/**
 * 相邻版本之间的迁移对应关系。
 * map 的键为新维度 id、值为来源旧维度 id：
 * - 未拆分的维度直接沿用（id 不变也在此登记）
 * - 拆分维度的多个新 id 指向同一个旧 id，迁移后保留原分并标记待复核
 * - 停用的旧维度不出现在 map 中（其分值只留在 legacyValues 里备查）
 */
export interface CriterionMigration {
  from: number;
  to: number;
  /** 新维度 id -> 旧维度 id */
  map: Record<string, string>;
  /** 由旧维度拆分而来、迁移后需要人工复核的新维度 id */
  split: string[];
  /** 被停用的旧维度 */
  retired: { id: string; name: string }[];
}

export interface Criterion extends CriterionDef {}

export interface ScoreRecord {
  id: string;
  judge: Viewer;
  schemeId: string;
  /** 当前维度版本下各维度的分值 */
  values: Record<string, number>;
  /**
   * 待复核维度 id 列表：
   * 评分表换版时由旧维度拆分沿用的原分，评委确认或改分前不参加排名。
   */
  pendingCells: string[];
  /** 换版前的完整分值快照，用于审计对应关系 */
  legacyValues?: Record<string, number>;
  comment: string;
  submitted: boolean;
  conflict: boolean;
  /** 该评分依据的评分表版本 */
  version: number;
  /** 修订号：每次成功写回 +1，只有携带最新修订号的提交才能覆盖 */
  revision: number;
  updatedAt: string;
}

export type PendingKind = "晚到提交" | "晚到草稿";
export type PendingStatus = "待复核" | "已采纳" | "已作废" | "已丢弃";

/** 因修订号过期或评分表版本变更而未能写回的评分，先保住再人工复核 */
export interface PendingSubmission {
  id: string;
  judge: Viewer;
  schemeId: string;
  values: Record<string, number>;
  comment: string;
  conflict: boolean;
  kind: PendingKind;
  /** 晚到评分所基于的评分表版本与修订号 */
  baseVersion: number;
  baseRevision: number;
  /** 到达时系统内现行修订号 */
  currentRevision: number;
  reason: string;
  createdAt: string;
  status: PendingStatus;
}

/** 落盘失败后等待重试的写回记录 */
export interface OutboxItem {
  id: string;
  kind: string;
  detail: string;
  at: string;
}

/** 换版迁移审计记录 */
export interface MigrationLog {
  id: string;
  at: string;
  from: number;
  to: number;
  /** 迁移的评分条数 */
  carriedScores: number;
  /** 因拆分而进入待复核的维度单元格数 */
  splitCells: number;
  /** 停用的维度名称 */
  retired: string[];
}

export interface ReviewEvent {
  id: string;
  time: string;
  actor: Viewer;
  action: string;
  detail: string;
}
