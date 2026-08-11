import { randomUUID } from "node:crypto";

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


function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" }
  });
}


function cleanText(value, maxLength = 12000) {
  return String(value || "").trim().slice(0, maxLength);
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


function inviteMetadata(config, inviteCode) {
  return config.invites.get(cleanText(inviteCode, 200));
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
    reviewContext: resolvedQuestion?.reviewContext || (body.reviewContext && typeof body.reviewContext === "object"
      ? structuredClone(body.reviewContext)
      : null),
    messages: cleanMessages(body.messages),
    expressionNote: body.expressionNote && typeof body.expressionNote === "object"
      ? structuredClone(body.expressionNote)
      : null,
    reflection: body.reflection || null
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
  const sessionCodec = createSessionCodec(config.sessionSigningSecret || "local-development-only");

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

  async function resolveQuestion(questionId) {
    const seeded = getQuestion(questionId);
    if (seeded || !learningStore) return seeded;
    return storedQuestionToRuntime(await learningStore.getQuestion(questionId));
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
        await recorder.update(cleanText(record.sessionId || record._id, 120), record);
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

  async function startSession(request) {
    const body = await readJson(request);
    const metadata = inviteMetadata(config, body.inviteCode);
    if (!metadata) return json({ error: "这个试用链接无效或已过期" }, 403);
    if (body.consent !== true) return json({ error: "需要先确认匿名试用说明" }, 400);
    const question = await resolveQuestion(cleanText(body.questionId, 100) || DEFAULT_QUESTION_ID);
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
    const question = await resolveQuestion(claims.questionId);
    if (!question) return json({ error: "这道题已不在当前题单，请重新开始" }, 400);

    const stage = cleanText(body.stage, 40);
    if (!new Set(["attempt", "teaching", "restate", "revision"]).has(stage)) {
      return json({ error: "当前学习阶段无效，请刷新后重试" }, 400);
    }
    const action = cleanText(body.action, 40);
    if (!actionAllowedFor(stage, action)) {
      return json({ error: "当前步骤不支持这个操作，请刷新后重试" }, 400);
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

    const snapshot = cleanSnapshot(body.snapshot);
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
    const messages = cleanMessages(body.messages);
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

    const recordId = cleanText(claims.recordId, 120);
    let record = sessionRecord({
      body: {
        ...body,
        messages,
        expressionNote,
        masterySyncStatus: nextStage === "complete" && learningStore ? "pending" : ""
      },
      claims,
      stage: nextStage,
      snapshot,
      feedback,
      question,
      now: now()
    });
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

    return json({
      feedback: visibleFeedback,
      nextStage,
      snapshot,
      expressionNote
    });
  }

  async function completeSession(request) {
    const body = await readJson(request);
    const claims = sessionClaims(body);
    const recordId = cleanText(claims.recordId, 120);
    const existing = typeof recorder.get === "function" ? await recorder.get(recordId) : null;

    const reflection = {
      studentExplanation: cleanText(body.reflection?.studentExplanation, 1200),
      diagnosisHit: cleanText(body.reflection?.diagnosisHit, 20),
      willingReuse: cleanText(body.reflection?.willingReuse, 20),
      uxConfusion: cleanText(body.reflection?.uxConfusion, 1200)
    };
    const snapshot = cleanSnapshot(body.snapshot);
    const question = await resolveQuestion(claims.questionId);
    await recorder.update(recordId, sessionRecord({
      body: { ...existing, ...body, reflection },
      claims,
      stage: "complete",
      snapshot,
      feedback: existing?.feedback,
      question,
      now: now()
    }));
    return json({ stage: "complete", saved: true });
  }

  async function syncLearner(request) {
    const body = await readJson(request);
    const metadata = inviteMetadata(config, body.inviteCode);
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
      if (stage !== "complete" && session.sessionId) {
        session.sessionToken = sessionCodec.sign({
          sessionId: session.sessionId,
          recordId: session.sessionId,
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
    const metadata = inviteMetadata(config, body.inviteCode);
    if (!metadata) return json({ error: "这个试用链接无效或已过期" }, 403);
    if (!learningStore) return json({ error: "学习档案暂时不可用" }, 503);

    for (const seed of questionSeeds()) await learningStore.upsertQuestion(seed);
    const records = typeof recorder.listByParticipant === "function"
      ? await recorder.listByParticipant(metadata.participantCode, 100)
      : [];
    await repairPendingMastery(records);
    const masteryRecords = await learningStore.listMasteryByParticipant(metadata.participantCode);
    const questions = await learningStore.listQuestions();
    const existingIds = new Set(questions.map((question) => question.questionId));
    const currentTime = now();
    for (const mastery of masteryRecords.filter((record) => Date.parse(record.reviewAt) <= currentTime.getTime())) {
      const parentQuestionId = mastery.recentEvents?.at(-1)?.questionId;
      const parentQuestion = await resolveQuestion(parentQuestionId);
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
