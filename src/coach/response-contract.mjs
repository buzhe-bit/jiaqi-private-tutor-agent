import { expectedGatesFor } from "./state-machine.mjs";


const DESCRIPTIVE_STATES = new Set([
  "材料堆积",
  "基本理解",
  "形成论证",
  "独立判断"
]);
const SOURCE_STATES = new Set(["有材料支持", "材料存在冲突", "待核实"]);


function text(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}


export function normalizeCoachResponse(raw, action) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("模型没有返回对象");
  }

  const gate = text(raw.gate, 40);
  if (!expectedGatesFor(action).includes(gate)) {
    throw new Error(`模型返回了当前阶段不允许的 gate：${gate || "空"}`);
  }

  const descriptiveState = text(raw.descriptiveState, 20);
  if (!DESCRIPTIVE_STATES.has(descriptiveState)) {
    throw new Error("模型没有返回合法的理解状态");
  }

  const suppliedSourceStatus = text(raw.sourceStatus, 20);
  const sourceStatus = SOURCE_STATES.has(suppliedSourceStatus)
    ? suppliedSourceStatus
    : "待核实";

  const evidence = (Array.isArray(raw.evidence) ? raw.evidence : [])
    .slice(0, 2)
    .map((item) => ({
      quote: text(item?.quote, 180),
      meaning: text(item?.meaning, 220)
    }))
    .filter((item) => item.quote && item.meaning);

  const response = {
    gate,
    descriptiveState,
    overall: text(raw.overall, 420),
    evidence,
    primaryIssue: text(raw.primaryIssue, 360),
    sourceStatus,
    nextAction: text(raw.nextAction, 280)
  };

  if (!response.overall || !response.nextAction) {
    throw new Error("模型反馈缺少整体判断或下一动作");
  }
  if (gate === "REPAIR_ONE_ISSUE" && !response.primaryIssue) {
    throw new Error("需要修复时必须明确一个首要问题");
  }

  return response;
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
