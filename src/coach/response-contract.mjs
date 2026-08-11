import { expectedGatesForAction } from "./state-machine.mjs";


const LEARNER_NEEDS = new Set([
  "knowledge_gap",
  "reasoning_gap",
  "expression_gap",
  "ready"
]);
const SOURCE_STATES = new Set(["有材料支持", "材料存在冲突", "待核实"]);
const NEXT_ACTIONS = new Set(["hint", "explain", "example", "reference", "restate", "revise"]);
const DEFAULT_NEXT_ACTIONS = {
  TEACH: ["hint", "explain", "reference", "restate"],
  RETEACH: ["hint", "explain", "reference", "restate"],
  REVISE: ["revise"],
  CLOSE_LOOP: []
};


function text(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}


export function normalizeCoachResponse(raw, action) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("模型没有返回对象");
  }

  const gate = text(raw.gate, 40);
  if (!expectedGatesForAction(action).includes(gate)) {
    throw new Error(`模型返回了当前动作不允许的 gate：${gate || "空"}`);
  }

  const learnerNeed = text(raw.learnerNeed, 30);
  if (!LEARNER_NEEDS.has(learnerNeed)) {
    throw new Error("模型没有返回合法的学习卡点");
  }

  const sourceStatusValue = text(raw.sourceStatus, 20);
  const parsedNextActions = [...new Set(Array.isArray(raw.nextActions) ? raw.nextActions : [])]
    .map((item) => text(item, 30))
    .filter((item) => NEXT_ACTIONS.has(item))
    .slice(0, 6);
  const nextActions = parsedNextActions.length
    ? parsedNextActions
    : DEFAULT_NEXT_ACTIONS[gate];

  const response = {
    gate,
    learnerNeed,
    message: text(raw.message, 800),
    studentEvidence: text(raw.studentEvidence, 1200),
    missingPoint: text(raw.missingPoint, 1200),
    focus: text(raw.focus, 600),
    teaching: text(raw.teaching, 5000),
    knowledgeConnection: text(raw.knowledgeConnection, 800),
    nextActions,
    sourceStatus: SOURCE_STATES.has(sourceStatusValue) ? sourceStatusValue : "待核实"
  };

  if (
    !response.message
    || !response.studentEvidence
    || !response.missingPoint
    || !response.focus
    || (response.gate !== "CLOSE_LOOP" && response.nextActions.length === 0)
  ) {
    throw new Error("模型反馈缺少学生可理解的说明、当前重点或下一步");
  }
  if (action === "request_reference" && !response.teaching) {
    throw new Error("参考作答请求必须返回教学内容");
  }

  return response;
}


export function studentFacingFeedback(feedback) {
  return {
    message: text(feedback?.message, 800),
    studentEvidence: text(feedback?.studentEvidence, 1200),
    missingPoint: text(feedback?.missingPoint, 1200),
    focus: text(feedback?.focus, 600),
    teaching: text(feedback?.teaching, 5000),
    knowledgeConnection: text(feedback?.knowledgeConnection, 800),
    nextActions: Array.isArray(feedback?.nextActions) ? feedback.nextActions.slice(0, 6) : []
  };
}


export function parseModelJson(rawText) {
  const cleaned = String(rawText || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("模型响应不是合法 JSON");
  }
}
