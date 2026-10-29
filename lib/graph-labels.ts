const nodeTypesZh: Record<string, string> = {
  intent: "需求", page: "页面", tag: "标签", owner: "负责人", person: "人物",
  decision: "决策", source: "来源", concept: "概念"
};
const relationsZh: Record<string, string> = {
  depends_on: "依赖", related_to: "相关", mentions: "提及", owned_by: "负责人",
  source_for: "来源", decision_from: "决策依据", links_to: "链接", tagged: "标记"
};

export function graphTypeLabel(type: string, language: "en" | "zh") {
  if (language === "zh" && Object.hasOwn(nodeTypesZh, type)) return nodeTypesZh[type];
  return type.replace(/_/g, " ").replace(/^./, value => value.toUpperCase());
}

export function graphRelationLabel(relation: string, language: "en" | "zh") {
  if (language === "zh" && Object.hasOwn(relationsZh, relation)) return relationsZh[relation];
  return relation.replace(/_/g, " ");
}
