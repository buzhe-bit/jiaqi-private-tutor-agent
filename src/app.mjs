import { randomUUID } from "node:crypto";

import {
  normalizeCoachResponse,
  studentFacingFeedback
} from "./coach/response-contract.mjs";
import { buildExpressionNote } from "./coach/expression-note.mjs";
import { actionAllowedFor, nextStageFor } from "./coach/state-machine.mjs";
import { DEFAULT_QUESTION_ID, getQuestion, publicQuestions } from "./questions.mjs";
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
    knowledgeConnections: cleanKnowledgeConnections(source.knowledgeConnections)
  };
}


function cleanKnowledgeConnections(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, 800)).filter(Boolean))].slice(-8);
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


function hasObservableRewrite(snapshot, input) {
  const rewrite = cleanText(input).replace(/\s+/g, "");
  const initial = cleanText(snapshot.initialAnswer).replace(/\s+/g, "");
  return rewrite.length >= 20 && rewrite !== initial;
}


function elapsedSeconds(startedAt, now) {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.round((now.getTime() - start) / 1000));
}


function inviteMetadata(config, inviteCode) {
  return config.invites.get(cleanText(inviteCode, 200));
}


function sessionRecord({ body, claims, stage, snapshot, feedback, now }) {
  const question = getQuestion(claims.questionId);
  return {
    sessionId: cleanText(claims.sessionId, 100),
    questionId: question?.id || DEFAULT_QUESTION_ID,
    question: question?.text || QUESTION_TEXT,
    participantCode: cleanText(claims.participantCode, 100),
    cohort: cleanText(claims.cohort, 40),
    stage,
    startedAt: cleanText(claims.startedAt, 80),
    updatedAt: now.toISOString(),
    elapsedSeconds: elapsedSeconds(claims.startedAt, now),
    snapshot,
    feedback: feedback || null,
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


export function createApp({ config, coach, recorder, now = () => new Date() }) {
  const sessionCodec = createSessionCodec(config.sessionSigningSecret || "local-development-only");

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
    const question = getQuestion(cleanText(body.questionId, 100) || DEFAULT_QUESTION_ID);
    if (!question) return json({ error: "题目不存在，请返回今日题单重新选择" }, 400);

    const startedAt = now().toISOString();
    const sessionId = randomUUID();
    const session = {
      sessionId,
      questionId: question.id,
      question: question.text,
      participantCode: metadata.participantCode,
      cohort: metadata.cohort,
      stage: "attempt",
      startedAt,
      updatedAt: startedAt,
      elapsedSeconds: 0,
      snapshot: cleanSnapshot({ sourceExcerpt: body.sourceExcerpt }),
      feedback: null,
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
      snapshot: session.snapshot
    }, 201);
  }

  async function processStep(request) {
    const body = await readJson(request);
    const claims = sessionClaims(body);
    const question = getQuestion(claims.questionId);
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
    let feedback = normalizeCoachResponse(rawFeedback, action);
    if (
      action === "submit_revision"
      && feedback.gate === "REVISE"
      && hasObservableRewrite(snapshot, input)
    ) {
      feedback = {
        ...feedback,
        gate: "CLOSE_LOOP",
        learnerNeed: "ready",
        message: "你已经完成了一次表达改进，本轮目标已达到。"
      };
    }
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

    await recorder.update(cleanText(claims.recordId, 120), sessionRecord({
      body: { ...body, messages, expressionNote },
      claims,
      stage: nextStage,
      snapshot,
      feedback,
      now: now()
    }));

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

    const reflection = {
      studentExplanation: cleanText(body.reflection?.studentExplanation, 1200),
      diagnosisHit: cleanText(body.reflection?.diagnosisHit, 20),
      willingReuse: cleanText(body.reflection?.willingReuse, 20),
      uxConfusion: cleanText(body.reflection?.uxConfusion, 1200)
    };
    const snapshot = cleanSnapshot(body.snapshot);
    await recorder.update(cleanText(claims.recordId, 120), sessionRecord({
      body: { ...body, reflection },
      claims,
      stage: "complete",
      snapshot,
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
    const sessions = records.map((record) => {
      const stage = cleanText(record.stage, 40);
      const question = getQuestion(record.questionId);
      const session = {
        sessionId: cleanText(record.sessionId || record._id, 100),
        questionId: question?.id || cleanText(record.questionId, 100),
        question: question?.text || cleanText(record.question),
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
    return json({ participantCode: metadata.participantCode, sessions });
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
