export type Viewer = "评委-林策" | "评委-周筑" | "主办方";
export type SchemeStatus = "待评分" | "评分中" | "已提交" | "已锁定";
export type PendingReason = "split-migration" | "stale-revision" | "incomplete";

export interface Criterion {
  id: string;
  name: string;
  description: string;
  weight: number;
  max: number;
}

export interface Scheme {
  id: string;
  code: string;
  title: string;
  synopsis: string;
  publicNo: string;
  status: SchemeStatus;
}

export interface ScoreRecord {
  id: string;
  judge: Viewer;
  schemeId: string;
  values: Record<string, number>;
  comment: string;
  submitted: boolean;
  conflict: boolean;
  updatedAt: string;
  /** 乐观并发修订号：每次成功写回 +1，晚到的旧修订号不能写回 */
  revision: number;
  /** 该评分是在哪一版维度表下填写的 */
  rubricVersion: number;
  /** 待复核：拆项迁移或晚到修订，需评委重新确认后才参与排名 */
  pendingReview: boolean;
  pendingReasons: PendingReason[];
  /** 已停用维度的历史得分，仅留档，不计入新总分 */
  legacyValues?: Record<string, number>;
}

/** 晚到或未能持久化的写回，先保住对应关系与内容，待恢复后重试 */
export interface PendingWrite {
  id: string;
  judge: Viewer;
  schemeId: string;
  values: Record<string, number>;
  comment: string;
  conflict: boolean;
  baseRevision: number;
  at: string;
  reason: "stale-revision" | "storage-failed";
}

export interface ReviewEvent {
  id: string;
  time: string;
  actor: Viewer;
  action: string;
  detail: string;
}
