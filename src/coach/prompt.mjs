import { readFileSync } from "node:fs";


const SKILL_ROOT = new URL("../../skills/philosophy-answer-coach/", import.meta.url);
const CORE_SKILL = readFileSync(new URL("SKILL.md", SKILL_ROOT), "utf8");
const EVALUATION_PROTOCOL = readFileSync(
  new URL("references/evaluation-protocol.md", SKILL_ROOT),
  "utf8"
);
const JIAQI_METHOD = readFileSync(
  new URL("references/jiaqi-philosophy-method.md", SKILL_ROOT),
  "utf8"
);
const KANT_FIXTURE = readFileSync(
  new URL("references/kant-freedom-pilot.md", SKILL_ROOT),
  "utf8"
);


const ACTION_RULES = {
  submit_attempt: `这是学生对整道题的首次主动提取。即使只写“不会”也算完成尝试。若缺少知识、存在严重误解或明确表示不知道，返回 TEACH；若已有可用理解，只需改进论证或表达，返回 REVISE。不得要求学生重新复述题意。`,
  request_hint: `只给一个能够唤起回忆的关键提示，不展开完整讲解，返回 TEACH。`,
  request_explanation: `用简短、准确、口语化的方式讲清当前唯一卡点及其关系，再配一个短例子，返回 TEACH。`,
  request_example: `用一个贴近题目的类比或微型例子解释当前关系，不冒充康德原文，返回 TEACH。`,
  request_reference: `学生已经完成首次作答，可以提供一份带说明的完整参考作答。必须明确称为“一种可行作答”，不称为标准答案，返回 TEACH。`,
  ask_followup: `先判断这是具体的相关知识问题，还是学生真的表示没听懂。具体问题必须先直接回答，再说明这条知识连接怎样帮助当前题目或学生已有表达；不得套用“换讲法”模板。可回答概念、时代背景、回应对象、哲学家比较及其与当前题目的关系。只有学生明确说没听懂时，才必须换一种解释结构或例子，也可使用类比、反例或对照问题。无关问题只简短回应并引回当前训练。始终返回 TEACH，并给出一条简洁的 knowledgeConnection；确实没有有效连接时返回空字符串。`,
  submit_restate: `判断学生能否用自己的话说清当前关键关系。基本正确则返回 REVISE；仍有关键误解则返回 RETEACH，并明确下一次要换什么讲法。`,
  submit_revision: `把学生的改写与首次作答和关键关系对照。出现真实、可指出的表达改进则返回 CLOSE_LOOP；否则返回 REVISE，且只指出一个具体可改之处。`
};


function snapshotText(snapshot = {}) {
  return JSON.stringify({
    sourceExcerpt: snapshot.sourceExcerpt || "",
    initialAnswer: snapshot.initialAnswer || "",
    primaryIssue: snapshot.primaryIssue || "",
    intervention: snapshot.intervention || "",
    repairResponse: snapshot.repairResponse || "",
    rewrittenAnswer: snapshot.rewrittenAnswer || "",
    knowledgeConnections: Array.isArray(snapshot.knowledgeConnections)
      ? snapshot.knowledgeConnections.slice(-8)
      : []
  }, null, 2);
}


export function buildCoachMessages({ action, snapshot = {}, input = "", question }) {
  if (!ACTION_RULES[action]) {
    throw new Error(`未知陪练动作：${action}`);
  }

  const questionText = String(question?.text || "康德自由拱顶石题").trim();
  const referenceBoundary = question?.guide
    ? `# 当前题目的参考边界（不是唯一标准答案）\n${JSON.stringify(question.guide, null, 2)}`
    : KANT_FIXTURE;
  const system = `${CORE_SKILL}\n\n${EVALUATION_PROTOCOL}\n\n${JIAQI_METHOD}\n\n${referenceBoundary}\n\n# 本轮产品规则（优先级最高）
- 采用“讲—问—调”：先接住学生当前状态，再提供最小必要教学，最后让学生用自己的话表达。
- 首次作答前不得提供参考作答；首次作答后，学生主动请求时可以给提示、讲解、例子或完整参考作答。
- 参考作答只能称为“一种可行作答”，不得称为唯一答案或标准答案。
- 学生明确说不会、想不起来或没听懂时，停止催答，不得重复要求他继续输出。
- 每轮只处理一个卡点。内部判断不得使用“材料堆积、理解证据、事实依据状态”等标题对学生说话。
- 需要补知识时，优先从“它试图解决什么问题”进入；时代背景、回应对象和后续影响只在确实帮助当前题目时使用，不能一次性铺成清单。
- 追问允许沿当前题目的相关知识网络展开：概念解释、时代背景、回应对象、哲学家比较，以及它与当前题目的关系。先直接回答具体问题，再指出这条连接对当前训练有什么用；不要把具体问题误判成“学生没听懂”。
- 无关问题只简短回应并引回当前题目，不扩展成无限聊天。
- 重点前置。message 严格只写一句结论，不超过 45 个汉字；解释、纠正和例子放进 teaching。
- teaching 按语义分段，每段最多两句；进入下一个观点时必须用空行分隔，不把结论、解释、例子和下一步挤成一整块。

# 当前动作
${ACTION_RULES[action]}

# 输出格式
只输出一个 JSON 对象，不要 Markdown，不解释推理过程。字段必须是 gate、learnerNeed、message、studentEvidence、missingPoint、focus、teaching、knowledgeConnection、nextActions、sourceStatus。
message 只给一句重点结论；studentEvidence 只概括学生已经说对的部分，没有时写“这部分目前还没有形成”；missingPoint 只写本轮唯一要补的关系或表达问题。
knowledgeConnection 用“已有概念 → 新连接”的一句话记录本轮建立的相关知识联系；没有有效连接时写空字符串。
learnerNeed 只能是 knowledge_gap、reasoning_gap、expression_gap、ready。
nextActions 只能从 hint、explain、example、reference、restate、revise 中选择。`;

  const user = `# 当前题目\n${questionText}\n\n# 当前会话快照\n${snapshotText(snapshot)}\n\n# 学生当前输入\n${String(input || "").trim()}`;
  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}
