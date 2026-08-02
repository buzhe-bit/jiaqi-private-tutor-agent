import { readFileSync } from "node:fs";


const SKILL_ROOT = new URL("../../skills/philosophy-answer-coach/", import.meta.url);
const CORE_SKILL = readFileSync(new URL("SKILL.md", SKILL_ROOT), "utf8");
const EVALUATION_PROTOCOL = readFileSync(
  new URL("references/evaluation-protocol.md", SKILL_ROOT),
  "utf8"
);
const KANT_FIXTURE = readFileSync(
  new URL("references/kant-freedom-pilot.md", SKILL_ROOT),
  "utf8"
);

const ACTION_RULES = {
  interpretation: `判断学生能否用自己的话说清题目要处理的关系。只能返回 CLARIFY_QUESTION 或 SUBMIT_ATTEMPT。若需要澄清，只给一层审题提示。`,
  attempt: `审阅初始答案。若存在一个高杠杆问题，返回 REPAIR_ONE_ISSUE；若已经形成足以进入正式改写的论证，返回 REWRITE。`,
  repair: `只检查上一轮选定的首要问题是否被学生回应。不要换题。未通过时返回 REPAIR_ONE_ISSUE 并缩小任务；通过时返回 REWRITE。`,
  rewrite: `把重写与初答、本轮首要问题对照。真实改善则返回 CLOSE_LOOP；仍需学生修改时返回 REPAIR_ONE_ISSUE 或 REWRITE。`
};


function snapshotText(snapshot = {}) {
  return JSON.stringify({
    questionInterpretation: snapshot.questionInterpretation || "",
    sourceExcerpt: snapshot.sourceExcerpt || "",
    initialAnswer: snapshot.initialAnswer || "",
    primaryIssue: snapshot.primaryIssue || "",
    intervention: snapshot.intervention || "",
    repairResponse: snapshot.repairResponse || "",
    rewrittenAnswer: snapshot.rewrittenAnswer || ""
  }, null, 2);
}


export function buildCoachMessages({ action, snapshot = {}, input = "" }) {
  if (!ACTION_RULES[action]) {
    throw new Error(`未知陪练动作：${action}`);
  }

  const system = `${CORE_SKILL}\n\n${EVALUATION_PROTOCOL}\n\n${KANT_FIXTURE}\n\n# 当前动作\n${ACTION_RULES[action]}\n\n# 输出格式\n只输出一个 JSON 对象，不要 Markdown，不要解释推理过程。字段必须是 gate、descriptiveState、overall、evidence、primaryIssue、sourceStatus、nextAction。evidence 最多两项，每项只有 quote 和 meaning。不得输出完整答案或替学生改写。`;

  const user = `# 当前会话快照\n${snapshotText(snapshot)}\n\n# 学生这一步提交\n${String(input || "").trim()}`;
  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}
