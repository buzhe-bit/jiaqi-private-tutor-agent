import { expectedGatesForAction } from "./state-machine.mjs";


const LEARNER_NEEDS = new Set([
  "knowledge_gap",
  "reasoning_gap",
  "expression_gap",
  "ready"
]);
const SOURCE_STATES = new Set(["有材料支持", "材料存在冲突", "待核实"]);
const ISSUE_TYPES = new Set([
  "knowledge_missing",
  "concept_misunderstanding",
  "relation_broken",
  "expression_scattered",
  "basically_mastered",
  "delayed_recall_unstable"
]);
const MASTERY_STATES = new Set(["unstable", "developing", "stable"]);
const DIAGNOSIS_SOURCE_STATES = new Set(["material_supported", "ai_synthesized", "unverified"]);
const CONFIDENCE_STATES = new Set(["high", "medium", "low"]);
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


function textList(value, maxItems = 12, maxLength = 300) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}


export function normalizeDiagnosis(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("模型没有返回结构化诊断");
  }
  const issueType = text(raw.issueType, 40);
  if (!ISSUE_TYPES.has(issueType)) throw new Error("模型返回了未知的卡点类型");
  const confidence = text(raw.confidence, 20);
  if (!CONFIDENCE_STATES.has(confidence)) throw new Error("模型没有返回合法的诊断置信度");
  let masteryStatus = text(raw.masteryStatus, 30);
  if (!MASTERY_STATES.has(masteryStatus)) throw new Error("模型没有返回合法的掌握状态");
  if (confidence === "low" && masteryStatus === "stable") masteryStatus = "developing";
  const sourceStatus = text(raw.sourceStatus, 30);
  if (!DIAGNOSIS_SOURCE_STATES.has(sourceStatus)) throw new Error("模型没有返回合法的资料依据状态");

  const diagnosis = {
    subject: text(raw.subject, 80),
    topic: text(raw.topic, 200),
    thinker: text(raw.thinker, 100),
    concepts: textList(raw.concepts),
    knowledgeRelations: textList(raw.knowledgeRelations, 8, 800),
    issueType,
    misconception: text(raw.misconception, 1200),
    expressionIssue: text(raw.expressionIssue, 1200),
    evidence: text(raw.evidence, 1600),
    diagnosis: text(raw.diagnosis, 1200),
    masteryStatus,
    sourceStatus,
    sourceLabel: text(raw.sourceLabel, 300),
    confidence
  };
  if (
    !diagnosis.subject
    || !diagnosis.topic
    || !diagnosis.evidence
    || !diagnosis.diagnosis
    || diagnosis.concepts.length === 0
    || diagnosis.knowledgeRelations.length === 0
  ) {
    throw new Error("模型返回的结构化诊断不完整");
  }
  return diagnosis;
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
    sourceStatus: SOURCE_STATES.has(sourceStatusValue) ? sourceStatusValue : "待核实",
    diagnosis: normalizeDiagnosis(raw.diagnosis)
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
