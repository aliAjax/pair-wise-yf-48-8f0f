import type { CriterionMigration, CriterionVersion } from "./types";

/**
 * 评分表版本表。换版 = 新增一版 + 登记一条到下一版的迁移对应关系。
 *
 * v1 -> v2：
 * - 场地回应（site，权重 30）拆为「气候适应」「公共空间」两项，各保留原分并待复核
 * - 环境策略（sustain，权重 20）停用，分值不迁移、不用默认分补
 * - 功能组织、结构与建造直接沿用（权重重新配平，原分不动）
 */
export const criterionVersions: CriterionVersion[] = [
  {
    version: 1,
    label: "v1 · 场地回应版",
    criteria: [
      { id: "site", name: "场地回应", description: "与气候、地貌和周边公共空间的关系", weight: 30, max: 100 },
      { id: "program", name: "功能组织", description: "空间组织、流线和公共性", weight: 25, max: 100 },
      { id: "structure", name: "结构与建造", description: "结构逻辑、材料和建造可行性", weight: 25, max: 100 },
      { id: "sustain", name: "环境策略", description: "节能、碳排和长期维护", weight: 20, max: 100 }
    ]
  },
  {
    version: 2,
    label: "v2 · 气候 / 公共空间拆分版",
    criteria: [
      { id: "climate", name: "气候适应", description: "由「场地回应」拆分：对气候、地貌的回应（迁移原分，待复核）", weight: 15, max: 100 },
      { id: "public-space", name: "公共空间", description: "由「场地回应」拆分：与周边公共空间的关系（迁移原分，待复核）", weight: 15, max: 100 },
      { id: "program", name: "功能组织", description: "空间组织、流线和公共性（直接沿用）", weight: 35, max: 100 },
      { id: "structure", name: "结构与建造", description: "结构逻辑、材料和建造可行性（直接沿用）", weight: 35, max: 100 }
    ]
  }
];

export const criterionMigrations: CriterionMigration[] = [
  {
    from: 1,
    to: 2,
    map: {
      climate: "site",
      "public-space": "site",
      program: "program",
      structure: "structure"
      // sustain 停用：不登记映射，分值不迁移、不以默认分补齐
    },
    split: ["climate", "public-space"],
    retired: [{ id: "sustain", name: "环境策略" }]
  }
];

export function findVersion(version: number): CriterionVersion {
  return criterionVersions.find((entry) => entry.version === version) ?? criterionVersions[criterionVersions.length - 1];
}

export function findMigration(from: number, to: number): CriterionMigration | undefined {
  return criterionMigrations.find((entry) => entry.from === from && entry.to === to);
}
