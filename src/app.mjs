import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import {
  normalizeCoachResponse,
  studentFacingFeedback
} from "./coach/response-contract.mjs";
import { buildExpressionNote } from "./coach/expression-note.mjs";
import { actionAllowedFor, nextStageFor } from "./coach/state-machine.mjs";
import {
  applyMasteryEvent,
  buildMasteryEvent,
  masteryIdFor
} from "./learning/mastery.mjs";
import { selectNextPractice } from "./learning/practice-selector.mjs";
import { buildFollowupReviewQuestion, buildReviewQuestion } from "./learning/review-question.mjs";
import {
  DEFAULT_QUESTION_ID,
  getQuestion,
  publicQuestions,
  questionSeeds,
  storedQuestionToRuntime
} from "./questions.mjs";
import { createSessionCodec } from "./session-token.mjs";


export const QUESTION_TEXT = getQuestion().text;

const SNAPSHOT_FIELDS = [
  "questionInterpretation",
  "sourceExcerpt",
  "initialAnswer",
  "primaryIssue",
  "intervention",
  "repairResponse",
  "rewrittenAnswer",
  "closureFeedback"
];

const USAGE_EVENTS = new Set([
  "app_open", "page_view", "question_shown", "training_started",
  "answer_submitted", "help_used", "stage_changed", "ai_response_completed",
  "ai_response_failed", "app_hidden", "session_resumed", "training_completed",
  "next_question_started", "feedback_submitted"
]);

const EVENT_LABELS = {
  app_open: "打开小程序",
  page_view: "浏览页面",
  question_shown: "看到题目",
  training_started: "开始训练",
  answer_submitted: "提交回答",
  help_used: "请求帮助",
  stage_changed: "进入下一步",
  ai_response_completed: "收到私教反馈",
  ai_response_failed: "私教响应失败",
  app_hidden: "离开小程序",
  session_resumed: "继续训练",
  training_completed: "完成一题",
  next_question_started: "继续下一题",
  feedback_submitted: "留下反馈"
};

const FEEDBACK_LABELS = {
  helpful: "有帮助",
  not_relevant: "没回答到问题",
  fact_concern: "内容可能不准确",
  more_writeable: "明显更能写",
  no_change: "没什么变化",
  more_confused: "反而更糊涂"
};

const STAGE_LABELS = {
  attempt: "初次作答",
  teaching: "弄懂关系",
  restate: "用自己的话说",
  revision: "改进答案",
  complete: "已完成"
};


function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" }
  });
}


function cleanText(value, maxLength = 12000) {
  return String(value || "").trim().slice(0, maxLength);
}


function cleanNumber(value, max = 3_600_000) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(max, Math.round(number))) : 0;
}


function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}


function authorizedTeacher(request, token) {
  if (!token) return false;
  const value = request.headers.get("authorization") || "";
  if (!value.startsWith("Basic ")) return false;
  let supplied;
  try {
    supplied = Buffer.from(value.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const actual = Buffer.from(supplied);
  const expected = Buffer.from(`admin:${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}


function cleanSnapshot(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...Object.fromEntries(SNAPSHOT_FIELDS.map((field) => [field, cleanText(source[field])])),
    knowledgeConnections: cleanKnowledgeConnections(source.knowledgeConnections),
    followupQuestions: cleanFollowupQuestions(source.followupQuestions)
  };
}


function cleanKnowledgeConnections(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, 800)).filter(Boolean))].slice(-8);
}


function cleanFollowupQuestions(value) {
  if (!Array.isArray(value)) return [];
  const unique = new Map();
  for (const item of value) {
    const question = cleanText(item?.question, 1200);
    if (!question) continue;
    unique.set(question, {
      question,
      knowledgeConnection: cleanText(item?.knowledgeConnection, 800),
      coachAnswer: cleanText(item?.coachAnswer, 2400)
    });
  }
  return [...unique.values()].slice(-8);
}


function cleanMessages(value) {
  if (!Array.isArray(value)) return [];
  const fields = ["message", "studentEvidence", "missingPoint", "focus", "teaching", "knowledgeConnection", "kind"];
  return value.slice(-40).map((item) => ({
    role: item?.role === "student" ? "student" : "coach",
    ...Object.fromEntries(fields.map((field) => [field, cleanText(item?.[field], 12000)])),
    complete: item?.complete === true
  }));
}


function mergeSnapshots(storedValue, incomingValue) {
  const stored = cleanSnapshot(storedValue);
  const incoming = cleanSnapshot(incomingValue);
  const snapshot = Object.fromEntries(SNAPSHOT_FIELDS.map((field) => [
    field,
    stored[field] || incoming[field]
  ]));
  snapshot.knowledgeConnections = cleanKnowledgeConnections([
    ...stored.knowledgeConnections,
    ...incoming.knowledgeConnections
  ]);
  snapshot.followupQuestions = cleanFollowupQuestions([
    ...stored.followupQuestions,
    ...incoming.followupQuestions
  ]);
  return snapshot;
}


function mergeMessages(storedValue, incomingValue) {
  const merged = [];
  const seen = new Set();
  for (const item of [
    ...(Array.isArray(storedValue) ? storedValue : []),
    ...(Array.isArray(incomingValue) ? incomingValue : [])
  ]) {
    const cleaned = cleanMessages([item])[0];
    if (!cleaned) continue;
    const key = JSON.stringify(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(cleaned);
  }
  return merged.slice(-40);
}


function cleanReflection(value) {
  return {
    studentExplanation: cleanText(value?.studentExplanation, 1200),
    diagnosisHit: cleanText(value?.diagnosisHit, 20),
    willingReuse: cleanText(value?.willingReuse, 20),
    uxConfusion: cleanText(value?.uxConfusion, 1200)
  };
}


function mergeReflection(storedValue, incomingValue) {
  const stored = cleanReflection(storedValue);
  const incoming = cleanReflection(incomingValue);
  const merged = Object.fromEntries(Object.keys(stored).map((field) => [
    field,
    stored[field] || incoming[field]
  ]));
  return Object.values(merged).some(Boolean) ? merged : null;
}


function mergeExpressionNote(storedValue, incomingValue) {
  const stored = storedValue && typeof storedValue === "object" ? structuredClone(storedValue) : null;
  const incoming = incomingValue && typeof incomingValue === "object" ? structuredClone(incomingValue) : null;
  if (!incoming || !Object.keys(incoming).length) return stored;
  return { ...(stored || {}), ...incoming };
}


function stepFingerprint(claims, body) {
  const payload = {
    sessionId: cleanText(claims.sessionId, 100),
    recordId: cleanText(claims.recordId, 120),
    questionId: cleanText(claims.questionId, 100),
    stage: cleanText(body.stage, 40),
    action: cleanText(body.action, 40),
    input: cleanText(body.input),
    snapshot: cleanSnapshot(body.snapshot)
  };
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}


function appendText(current, addition, maxLength = 12000) {
  return [cleanText(current, maxLength), cleanText(addition, maxLength)]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, maxLength);
}


function elapsedSeconds(startedAt, now) {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.round((now.getTime() - start) / 1000));
}


function requestMetadata(config, body) {
  return config.invites.get(cleanText(body.inviteCode, 200));
}


function questionReviewState(question) {
  const value = question?.reviewContext;
  const contextPresent = value !== null && value !== undefined;
  const contextValid = !contextPresent || (typeof value === "object" && !Array.isArray(value));
  const contextMasteryId = contextValid && contextPresent ? cleanText(value.masteryId, 300) : "";
  const storedMasteryId = cleanText(question?.masteryId, 300);
  const owner = cleanText(question?.participantCode, 100);
  return {
    contextPresent,
    contextValid,
    contextMasteryId,
    storedMasteryId,
    masteryId: contextMasteryId || storedMasteryId,
    owner,
    private: Boolean(owner)
      || question?.questionKind === "review"
      || contextPresent
  };
}


function recordIdFor(record, fallback = "") {
  return cleanText(record?._id || record?.recordId || record?.sessionId || fallback, 120);
}


function sessionRecord({ body, claims, stage, snapshot, feedback, question, now }) {
  const resolvedQuestion = question || getQuestion(claims.questionId);
  return {
    sessionId: cleanText(claims.sessionId, 100),
    questionId: resolvedQuestion?.id || DEFAULT_QUESTION_ID,
    question: resolvedQuestion?.text || QUESTION_TEXT,
    questionKind: resolvedQuestion?.questionKind || cleanText(body.questionKind, 30) || "new",
    participantCode: cleanText(claims.participantCode, 100),
    cohort: cleanText(claims.cohort, 40),
    stage,
    startedAt: cleanText(claims.startedAt, 80),
    updatedAt: now.toISOString(),
    elapsedSeconds: elapsedSeconds(claims.startedAt, now),
    snapshot,
    feedback: feedback || null,
    diagnosis: feedback?.diagnosis || body.diagnosis || null,
    masteryKey: cleanText(body.masteryKey, 300),
    masterySyncStatus: cleanText(body.masterySyncStatus, 20),
    reviewContext: resolvedQuestion?.reviewContext || null,
    messages: cleanMessages(body.messages),
    expressionNote: body.expressionNote && typeof body.expressionNote === "object"
      ? structuredClone(body.expressionNote)
      : null,
    reflection: body.reflection ? cleanReflection(body.reflection) : null
  };
}


async function readJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw Object.assign(new Error("请求必须使用 JSON"), { status: 415 });
  }
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error("请求 JSON 无法解析"), { status: 400 });
  }
}


export function createApp({
  config,
  coach,
  recorder,
  learningStore = null,
  now = () => new Date(),
  logger = console,
  random = Math.random
}) {
  const sessionSigningSecret = config.sessionSigningSecret || "local-development-only";
  const sessionCodec = createSessionCodec(sessionSigningSecret);
  const sessionLocks = new Map();

  async function withSessionLock(recordId, operation) {
    const previous = sessionLocks.get(recordId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    sessionLocks.set(recordId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (sessionLocks.get(recordId) === current) sessionLocks.delete(recordId);
    }
  }

  async function recordUsageEvent(request) {
    if (!learningStore?.saveUsageEvent) return json({ error: "试用观察暂时不可用" }, 503);
    const body = await readJson(request);
    const metadata = requestMetadata(config, body);
    if (!metadata) return json({ error: "这个试用码无效或已过期" }, 403);
    const event = cleanText(body.event, 60);
    if (!USAGE_EVENTS.has(event)) return json({ error: "不支持这个事件" }, 400);

    const sessionId = cleanText(body.sessionId, 100);
    if (sessionId && typeof recorder.get === "function") {
      const session = await recorder.get(sessionId);
      if (session?.participantCode && session.participantCode !== metadata.participantCode) {
        return json({ error: "不能写入其他学员的训练记录" }, 403);
      }
    }
    const record = {
      eventId: randomUUID(),
      participantCode: metadata.participantCode,
      cohort: metadata.cohort,
      event,
      sessionId,
      questionId: cleanText(body.questionId, 100),
      page: cleanText(body.page, 40),
      stage: cleanText(body.stage, 40),
      action: cleanText(body.action, 60),
      value: cleanText(body.value, 120),
      draftLength: cleanNumber(body.draftLength, 12000),
      durationMs: cleanNumber(body.durationMs),
      errorCode: cleanText(body.errorCode, 80),
      appVersion: cleanText(body.appVersion, 40),
      createdAt: now().toISOString()
    };
    await learningStore.saveUsageEvent(record);
    return json({ saved: true }, 201);
  }

  async function pilotDashboard(request) {
    if (!authorizedTeacher(request, config.adminAccessToken)) {
      return new Response("需要老师账号", {
        status: 401,
        headers: { "www-authenticate": 'Basic realm="Pilot"' }
      });
    }
    const events = learningStore?.listUsageEvents
      ? await learningStore.listUsageEvents({ limit: 100 })
      : [];
    const participants = [...new Set([
      ...[...config.invites.values()].map((item) => item.participantCode),
      ...events.map((item) => item.participantCode)
    ])];
    const sessionsByParticipant = new Map(await Promise.all(participants.map(async (participantCode) => [
      participantCode,
      typeof recorder.listByParticipant === "function"
        ? await recorder.listByParticipant(participantCode, 30)
        : []
    ])));
    const active = new Set(events.map((item) => item.participantCode));
    const submitted = new Set(events
      .filter((item) => item.event === "answer_submitted" && item.stage === "attempt")
      .map((item) => item.participantCode));
    const continued = new Set(events
      .filter((item) => item.event === "next_question_started")
      .map((item) => item.participantCode));
    const completed = new Set();
    for (const [participantCode, sessions] of sessionsByParticipant) {
      if (sessions.some((session) => session.stage === "complete")) completed.add(participantCode);
    }
    for (const event of events.filter((item) => item.event === "training_completed")) {
      completed.add(event.participantCode);
    }

    const rows = participants.map((participantCode) => {
      const participantEvents = events.filter((item) => item.participantCode === participantCode);
      const sessions = sessionsByParticipant.get(participantCode) || [];
      const completedCount = sessions.filter((item) => item.stage === "complete").length;
      const latestSession = [...sessions].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
      const latestEvent = participantEvents[0];
      const feedback = participantEvents.find((item) => item.event === "feedback_submitted");
      const lastActive = [latestSession?.updatedAt, latestEvent?.createdAt].filter(Boolean).sort().at(-1) || "—";
      const state = completedCount
        ? "已完成"
        : STAGE_LABELS[latestSession?.stage] || (latestEvent ? "已进入" : "未进入");
      return `<tr><td>${escapeHtml(participantCode)}</td><td>${escapeHtml(state)}</td><td>${completedCount}</td><td>${escapeHtml(EVENT_LABELS[latestEvent?.event] || "—")}</td><td>${escapeHtml(FEEDBACK_LABELS[feedback?.value] || feedback?.value || "—")}</td><td>${escapeHtml(lastActive)}</td></tr>`;
    }).join("");
    const cards = [
      ["已激活", active.size],
      ["交过初答", submitted.size],
      ["完成训练", completed.size],
      ["继续下一题", continued.size],
      ["AI 失败", events.filter((item) => item.event === "ai_response_failed").length]
    ].map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join("");
    return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>试用观察台</title><link rel="stylesheet" href="/pilot.css"></head><body><main><header><p>哲学论述陪练</p><h1>试用观察台</h1><small>最近 100 条关键行为；不保存输入原文。</small></header><section class="metrics">${cards}</section><section class="panel"><h2>学员进度</h2><div class="table-wrap"><table><thead><tr><th>试用编号</th><th>当前状态</th><th>完成题数</th><th>最近动作</th><th>最近反馈</th><th>最后活跃</th></tr></thead><tbody>${rows}</tbody></table></div></section></main></body></html>`, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
    });
  }

  async function syncMastery(record) {
    if (!learningStore || !record?.diagnosis) return "";
    const observedAt = Number.isFinite(Date.parse(record.updatedAt))
      ? new Date(record.updatedAt)
      : now();
    const event = buildMasteryEvent({ session: record, diagnosis: record.diagnosis, now: observedAt });
    const masteryId = masteryIdFor(event);
    const previous = await learningStore.getMastery(masteryId);
    await learningStore.upsertMastery(applyMasteryEvent(previous, event, { now: observedAt }));
    return masteryId;
  }

  async function resolveQuestion(questionId, participantCode = "") {
    const seeded = getQuestion(questionId);
    if (seeded || !learningStore) return seeded;
    const question = storedQuestionToRuntime(await learningStore.getQuestion(questionId));
    const privacy = questionReviewState(question);
    if (!privacy.private) return question;
    if (!privacy.contextValid || question?.questionKind !== "review") return null;
    const { contextMasteryId, storedMasteryId, masteryId, owner } = privacy;
    if (!participantCode || !masteryId || !owner || owner !== participantCode) return null;
    if (contextMasteryId && storedMasteryId && contextMasteryId !== storedMasteryId) return null;
    const mastery = await learningStore.getMastery(masteryId);
    return mastery?.participantCode === participantCode ? question : null;
  }

  function questionBelongsToParticipant(question, participantCode, masteryRecords) {
    const privacy = questionReviewState(question);
    if (!privacy.private) return true;
    const {
      contextValid,
      contextMasteryId,
      storedMasteryId,
      masteryId,
      owner
    } = privacy;
    return Boolean(
      contextValid
      && question.questionKind === "review"
      && participantCode
      && masteryId
      && owner
      && owner === participantCode
      && (!contextMasteryId || !storedMasteryId || contextMasteryId === storedMasteryId)
      && masteryRecords.some((record) => cleanText(record.masteryId, 300) === masteryId
        && cleanText(record.participantCode, 100) === participantCode)
    );
  }

  async function repairPendingMastery(records) {
    if (!learningStore) return;
    for (const record of records.filter((item) => item.stage === "complete"
      && item.masterySyncStatus === "pending"
      && item.diagnosis)) {
      try {
        const masteryKey = await syncMastery(record);
        record.masteryKey = masteryKey;
        record.masterySyncStatus = "complete";
        await recorder.update(recordIdFor(record), record);
      } catch (error) {
        logger?.warn?.(`掌握档案重试未完成：${error.code || error.message}`);
      }
    }
  }

  function sessionClaims(body) {
    try {
      return sessionCodec.verify(cleanText(body.sessionToken, 4000));
    } catch {
      throw Object.assign(new Error("本次陪练状态已失效，请重新打开老师发送的链接"), { status: 401 });
    }
  }

  async function existingSession(claims) {
    if (typeof recorder.get !== "function") return null;
    const record = await recorder.get(recordIdFor(claims));
    return record;
  }

  async function verifiedStoredSession(claims) {
    const record = await existingSession(claims);
    if (!recorder.enforceSessionState) return record;
    if (!record) {
      throw Object.assign(new Error("本次陪练记录不存在，请重新开始"), { status: 404 });
    }
    if (record.sessionId && cleanText(record.sessionId, 100) !== cleanText(claims.sessionId, 100)) {
      throw Object.assign(new Error("本次陪练状态已失效，请重新打开老师发送的链接"), { status: 401 });
    }
    if (record.participantCode
      && cleanText(record.participantCode, 100) !== cleanText(claims.participantCode, 100)) {
      throw Object.assign(new Error("本次陪练状态已失效，请重新打开老师发送的链接"), { status: 401 });
    }
    return record;
  }

  async function storedSessionForRequest(claims) {
    if (typeof recorder.get !== "function") return null;
    return recorder.enforceSessionState
      ? verifiedStoredSession(claims)
      : existingSession(claims);
  }

  async function startSession(request) {
    const body = await readJson(request);
    const metadata = requestMetadata(config, body);
    if (!metadata) return json({ error: "这个试用链接无效或已过期" }, 403);
    if (body.consent !== true) return json({ error: "需要先确认匿名试用说明" }, 400);
    const question = await resolveQuestion(
      cleanText(body.questionId, 100) || DEFAULT_QUESTION_ID,
      metadata.participantCode
    );
    if (!question) return json({ error: "题目不存在，请返回今日题单重新选择" }, 400);

    const startedAt = now().toISOString();
    const sessionId = randomUUID();
    const session = {
      sessionId,
      questionId: question.id,
      question: question.text,
      questionKind: question.questionKind || "new",
      participantCode: metadata.participantCode,
      cohort: metadata.cohort,
      stage: "attempt",
      startedAt,
      updatedAt: startedAt,
      elapsedSeconds: 0,
      snapshot: cleanSnapshot({ sourceExcerpt: body.sourceExcerpt }),
      feedback: null,
      diagnosis: null,
      masteryKey: "",
      masterySyncStatus: "",
      reviewContext: question.reviewContext || null,
      messages: [],
      expressionNote: null,
      reflection: null
    };
    const recordId = await recorder.create(session);
    const sessionToken = sessionCodec.sign({
      sessionId,
      recordId,
      questionId: question.id,
      participantCode: metadata.participantCode,
      cohort: metadata.cohort,
      startedAt,
      stage: "attempt"
    });
    return json({
      sessionId,
      sessionToken,
      questionId: question.id,
      participantCode: metadata.participantCode,
      stage: "attempt",
      startedAt,
      question: question.text,
      questionKind: question.questionKind || "new",
      snapshot: session.snapshot
    }, 201);
  }

  async function processStep(request) {
    const body = await readJson(request);
    const claims = sessionClaims(body);
    const recordId = recordIdFor(claims);
    return withSessionLock(recordId, async () => {
      const existing = await storedSessionForRequest(claims);
      const fingerprint = stepFingerprint(claims, body);
      const savedResult = existing?._lastStep?.fingerprint === fingerprint
        ? existing._lastStep.result
        : null;
      if (savedResult && typeof savedResult === "object") {
        return json(structuredClone(savedResult));
      }

      const question = await resolveQuestion(claims.questionId, claims.participantCode);
      if (!question) return json({ error: "这道题已不在当前题单，请重新开始" }, 400);

      const stage = cleanText(body.stage, 40);
      if (!new Set(["attempt", "teaching", "restate", "revision"]).has(stage)) {
        return json({ error: "当前学习阶段无效，请刷新后重试" }, 400);
      }
      const action = cleanText(body.action, 40);
      if (!actionAllowedFor(stage, action)) {
        return json({ error: "当前步骤不支持这个操作，请刷新后重试" }, 400);
      }
      const storedStage = cleanText(existing?.stage, 40);
      const localRestateTransition = storedStage === "teaching"
        && stage === "restate"
        && ["ask_followup", "submit_restate"].includes(action);
      if (existing && storedStage !== stage && !localRestateTransition) {
        return json({ error: "当前陪练阶段已变化，请刷新后重试" }, 409);
      }

      const input = cleanText(body.input);
      const actionsRequiringInput = new Set([
        "submit_attempt",
        "ask_followup",
        "submit_restate",
        "submit_revision"
      ]);
      if (actionsRequiringInput.has(action) && !input) {
        return json({ error: "请先写下你现在真实能说出的内容" }, 400);
      }

      const snapshot = mergeSnapshots(existing?.snapshot, body.snapshot);
      if (action === "request_reference" && !snapshot.initialAnswer) {
        return json({ error: "先完成一次自己的尝试，再查看参考作答" }, 400);
      }
      if (action === "submit_attempt") snapshot.initialAnswer = input;
      if (action === "submit_restate") snapshot.repairResponse = input;
      if (action === "submit_revision") snapshot.rewrittenAnswer = input;

      const rawFeedback = await coach.evaluate({ action, snapshot, input, question });
      const feedback = normalizeCoachResponse(rawFeedback, action);
      const nextStage = nextStageFor(stage, feedback.gate);

      snapshot.primaryIssue = feedback.focus;
      if (feedback.gate === "TEACH" || feedback.gate === "RETEACH") {
        const label = action === "submit_attempt" ? "首次诊断" : action;
        snapshot.intervention = appendText(
          snapshot.intervention,
          `【${label}】${feedback.message}${feedback.teaching ? `\n${feedback.teaching}` : ""}`
        );
      }
      if (action === "ask_followup") {
        snapshot.knowledgeConnections = cleanKnowledgeConnections([
          ...snapshot.knowledgeConnections,
          feedback.knowledgeConnection
        ]);
        snapshot.followupQuestions = cleanFollowupQuestions([
          ...snapshot.followupQuestions,
          {
            question: input,
            knowledgeConnection: feedback.knowledgeConnection || feedback.focus,
            coachAnswer: feedback.teaching || feedback.message
          }
        ]);
      }
      if (feedback.gate === "CLOSE_LOOP") {
        snapshot.closureFeedback = feedback.message;
      }

      const visibleFeedback = studentFacingFeedback(feedback);
      const messages = mergeMessages(existing?.messages, body.messages);
      if (actionsRequiringInput.has(action)) messages.push({ role: "student", message: input });
      messages.push({
        role: "coach",
        ...visibleFeedback,
        complete: nextStage === "complete",
        kind: action === "request_reference" ? "reference" : ""
      });
      const expressionNote = nextStage === "complete"
        ? buildExpressionNote({ question, snapshot, feedback })
        : null;

      let record = sessionRecord({
        body: {
          ...body,
          messages,
          expressionNote,
          reflection: mergeReflection(existing?.reflection, body.reflection),
          masterySyncStatus: nextStage === "complete" && learningStore ? "pending" : ""
        },
        claims,
        stage: nextStage,
        snapshot,
        feedback,
        question,
        now: now()
      });
      const result = {
        feedback: visibleFeedback,
        nextStage,
        snapshot,
        expressionNote
      };
      record._lastStep = {
        fingerprint,
        result: structuredClone(result)
      };
      await recorder.update(recordId, record);
      if (nextStage === "complete" && learningStore) {
        try {
          const masteryKey = await syncMastery(record);
          record = { ...record, masteryKey, masterySyncStatus: "complete" };
          await recorder.update(recordId, record);
        } catch (error) {
          logger?.warn?.(`掌握档案暂未同步：${error.code || error.message}`);
        }
      }

      return json(result);
    });
  }

  async function completeSession(request) {
    const body = await readJson(request);
    const claims = sessionClaims(body);
    const recordId = recordIdFor(claims);
    return withSessionLock(recordId, async () => {
      const existing = await storedSessionForRequest(claims);
      if (existing && cleanText(existing.stage, 40) !== "complete") {
        return json({ error: "本次陪练还没有完成，不能提交体验反馈" }, 409);
      }

      const snapshot = mergeSnapshots(existing?.snapshot, body.snapshot);
      const reflection = mergeReflection(existing?.reflection, body.reflection);
      const question = await resolveQuestion(claims.questionId, claims.participantCode);
      const messages = mergeMessages(existing?.messages, body.messages);
      const expressionNote = mergeExpressionNote(existing?.expressionNote, body.expressionNote);
      const record = sessionRecord({
        body: {
          ...existing,
          ...body,
          messages,
          expressionNote,
          reflection,
          masteryKey: body.masteryKey || existing?.masteryKey || "",
          masterySyncStatus: body.masterySyncStatus || existing?.masterySyncStatus || ""
        },
        claims,
        stage: "complete",
        snapshot,
        feedback: existing?.feedback,
        question,
        now: now()
      });
      if (existing?._lastStep) record._lastStep = structuredClone(existing._lastStep);
      await recorder.update(recordId, record);
      return json({ stage: "complete", saved: true });
    });
  }

  async function syncLearner(request) {
    const body = await readJson(request);
    const metadata = requestMetadata(config, body);
    if (!metadata) return json({ error: "这个试用链接无效或已过期" }, 403);
    if (typeof recorder.listByParticipant !== "function") {
      return json({ participantCode: metadata.participantCode, sessions: [] });
    }
    const records = await recorder.listByParticipant(metadata.participantCode, 30);
    await repairPendingMastery(records);
    const masteryRecords = learningStore
      ? await learningStore.listMasteryByParticipant(metadata.participantCode)
      : [];
    const sessions = records.map((record) => {
      const stage = cleanText(record.stage, 40);
      const recordId = recordIdFor(record);
      const question = getQuestion(record.questionId);
      const session = {
        sessionId: cleanText(record.sessionId || record._id, 100),
        questionId: question?.id || cleanText(record.questionId, 100),
        question: question?.text || cleanText(record.question),
        questionKind: cleanText(record.questionKind, 30) || question?.questionKind || "new",
        participantCode: metadata.participantCode,
        stage,
        startedAt: cleanText(record.startedAt, 80),
        updatedAt: cleanText(record.updatedAt, 80),
        snapshot: cleanSnapshot(record.snapshot),
        feedback: record.feedback ? studentFacingFeedback(record.feedback) : null,
        messages: cleanMessages(record.messages),
        expressionNote: record.expressionNote && typeof record.expressionNote === "object"
          ? record.expressionNote
          : null
      };
      if (stage !== "complete" && session.sessionId && recordId) {
        session.sessionToken = sessionCodec.sign({
          sessionId: session.sessionId,
          recordId,
          questionId: session.questionId,
          participantCode: metadata.participantCode,
          cohort: metadata.cohort,
          startedAt: session.startedAt,
          stage
        });
      }
      return session;
    });
    const currentTime = now().getTime();
    const profile = {
      masteryCount: masteryRecords.length,
      dueCount: masteryRecords.filter((record) => Date.parse(record.reviewAt) <= currentTime).length,
      unstableCount: masteryRecords.filter((record) => record.masteryStatus === "unstable").length,
      developingCount: masteryRecords.filter((record) => record.masteryStatus === "developing").length,
      stableCount: masteryRecords.filter((record) => record.masteryStatus === "stable").length,
      recentWeaknesses: [...masteryRecords]
        .sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")))
        .slice(0, 3)
        .map((record) => ({
          topic: cleanText(record.topic, 200),
          thinker: cleanText(record.thinker, 100),
          summary: cleanText(
            record.followupQuestions?.at(-1)?.question
              || record.misconception
              || record.expressionIssue
              || record.knowledgeRelation,
            600
          ),
          status: record.masteryStatus === "stable"
            ? "延迟复习稳定"
            : record.masteryStatus === "developing" ? "正在巩固" : "需要再练",
          reviewAt: cleanText(record.reviewAt, 80)
        }))
    };
    return json({ participantCode: metadata.participantCode, sessions, profile });
  }

  function dayKey(value) {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(value));
    const get = (type) => parts.find((part) => part.type === type)?.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  }

  async function nextPractice(request) {
    const body = await readJson(request);
    const metadata = requestMetadata(config, body);
    if (!metadata) return json({ error: "这个试用链接无效或已过期" }, 403);
    if (!learningStore) return json({ error: "学习档案暂时不可用" }, 503);

    for (const seed of questionSeeds()) await learningStore.upsertQuestion(seed);
    const records = typeof recorder.listByParticipant === "function"
      ? await recorder.listByParticipant(metadata.participantCode, 100)
      : [];
    await repairPendingMastery(records);
    const masteryRecords = await learningStore.listMasteryByParticipant(metadata.participantCode);
    const questions = (await learningStore.listQuestions())
      .filter((question) => questionBelongsToParticipant(
        question,
        metadata.participantCode,
        masteryRecords
      ));
    const existingIds = new Set(questions.map((question) => question.questionId));
    const currentTime = now();
    for (const mastery of masteryRecords.filter((record) => Date.parse(record.reviewAt) <= currentTime.getTime())) {
      const parentQuestionId = mastery.recentEvents?.at(-1)?.questionId;
      const parentQuestion = await resolveQuestion(parentQuestionId, metadata.participantCode);
      if (!parentQuestion) continue;
      const reviews = [
        buildReviewQuestion({ mastery, parentQuestion, now: currentTime }),
        buildFollowupReviewQuestion({ mastery, parentQuestion, now: currentTime })
      ].filter(Boolean);
      for (const review of reviews) {
        if (existingIds.has(review.questionId)) continue;
        await learningStore.upsertQuestion(review);
        questions.push(review);
        existingIds.add(review.questionId);
      }
    }
    const today = dayKey(currentTime);
    const enrichedRecords = records.map((record) => ({
      ...record,
      questionKind: record.questionKind || getQuestion(record.questionId)?.questionKind || "new"
    }));
    const selected = selectNextPractice({
      questions,
      masteryRecords,
      recentSessions: enrichedRecords.filter((record) => record.stage === "complete").slice(0, 30),
      todaySessions: enrichedRecords.filter((record) => record.updatedAt && dayKey(record.updatedAt) === today),
      now: currentTime,
      random
    });
    return json({
      questionId: selected.question.questionId,
      question: selected.question.stem,
      questionKind: selected.questionKind,
      reason: selected.reason,
      sourceStatus: selected.question.sourceStatus,
      sourceLabel: selected.question.sourceLabel,
      todayCompleted: selected.todayCompleted,
      baseTargetReached: selected.baseTargetReached
    });
  }

  return {
    async handle(request) {
      try {
        const url = new URL(request.url);
        if (request.headers.has("x-wx-openid") || request.headers.has("x-wx-appid")) {
          return json({ error: "公网服务只接受试用码进入" }, 403);
        }
        if (request.method === "GET" && url.pathname === "/api/health") {
          const storageMode = config.recordProvider === "cloudbase" && config.mirrorProvider === "feishu"
            ? "cloudbase+feishu"
            : config.recordProvider || "memory";
          return json({
            ok: true,
            product: "philosophy-answer-coach",
            coachMode: config.coachProvider === "cloudbase" ? "real" : "demo",
            storageMode
          });
        }
        if (request.method === "GET" && url.pathname === "/api/questions") {
          return json({ questions: publicQuestions() });
        }
        if (request.method === "GET" && url.pathname === "/pilot") {
          return await pilotDashboard(request);
        }
        if (request.method === "POST" && url.pathname === "/api/events") {
          return await recordUsageEvent(request);
        }
        if (request.method === "POST" && url.pathname === "/api/session/start") {
          return await startSession(request);
        }
        if (request.method === "POST" && url.pathname === "/api/session/step") {
          return await processStep(request);
        }
        if (request.method === "POST" && url.pathname === "/api/session/complete") {
          return await completeSession(request);
        }
        if (request.method === "POST" && url.pathname === "/api/learner/sync") {
          return await syncLearner(request);
        }
        if (request.method === "POST" && url.pathname === "/api/practice/next") {
          return await nextPractice(request);
        }
        return json({ error: "接口不存在" }, 404);
      } catch (error) {
        const status = Number(error.status) || 500;
        if (status >= 500) {
          return json({
            error: cleanText(error.userMessage, 500)
              || "这次处理没有完成，你写的内容已保留。请重新提交。",
            code: cleanText(error.code, 80) || "INTERNAL_ERROR",
            retryable: error.retryable !== false
          }, status);
        }
        return json({
          error: cleanText(error.message, 500),
          code: cleanText(error.code, 80) || "REQUEST_ERROR",
          retryable: false
        }, status);
      }
    }
  };
}
